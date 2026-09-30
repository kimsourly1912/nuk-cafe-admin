# Reports and Telegram (step 8.1)

_2026-09-30. The owner's scope (reports on sales, items and orders; print, CSV and Telegram), reviewed against the repository, with the owner's answers R1–R6 ("use your defaults"). Decision entries: D110 onwards._

## Goal

Cafe admins can see how the day went (sales, best sellers, payments, refunds), look up any order and its history, print or download a report, and receive new-order alerts and a closing summary in Telegram.

**Out of scope:** inventory, payroll, profit, customer marketing, an automation builder, acting on orders from Telegram (pay, accept, cancel, refund), manager access to the admin portal (later, R1).

## What the repository already has (checked)

- **One lifecycle status per order:** `awaiting_payment → preparing → ready → completed`, or `cancelled` (D99, D101). The payment is a separate row, `counter_payments`: one per order (unique), with the method, the USD amount, the riel amount and the rate for cash riel, a KHQR reference, who took it and when (`collected_at`), and for a paid order cancelled before ready, how the money went back, who returned it and when (`return_method`, `returned_by`, `returned_at`). **The lifecycle is not changed**: the reports derive two views from it (below).
- **Payment methods:** `cash_usd`, `cash_khr`, `khqr`. The tendered cash and the change are not stored; each order's amount in its currency is.
- **Refunds exist** (Q36, D101): a paid order cancelled before it's ready records the money returned, in full.
- **Business day:** 04:00 to 04:00 in the branch's time zone (`BUSINESS_DAY_START_MINUTE`, `businessDateAt`, D99); each order stores its `business_date` at placement. Riverside's zone is Asia/Phnom_Penh. Reports use the **branch's** zone, never the browser's or UTC.
- **History:** order lines keep the item name, the version (`detail`), the add-ons with their prices, the unit price, quantity, line total and note as sold. `order_events` records every step (placed, paid, ready, completed, cancelled, expired with no actor) with who, reason and note. **Missing:** the item's category at sale time: added in stage 1 (below).
- **Outbox** (D51): messages written in the same batch as the change, delivered at least once every minute with backoff (1, 2, 4 … minutes, at most 6 h, 8 attempts), then `failed`.
- **Access:** only platform admins use the admin portal (D52). Managers and staff use the counter app.

## Owner's decisions (2026-09-30, defaults accepted)

| # | Decision |
|---|---|
| R1 | Reports and the owner's Telegram messages: **admins only** for now; manager access later (it means managers in the admin portal) |
| R2 | The staff group's **Open order** button opens the order in the **counter app** (`/counter/<branchId>?order=<id>`) |
| R3 | New-order alerts include the customer's **first name** only; never the email or member code |
| R4 | **No closing summary on a closed day** |
| R5 | A report covers **at most 93 business days**; CSV is built in the request (about 20,000 rows at most at our volume) |
| R6 | Sales by item shows **gross paid sales** and a **Refunded** column |

## Definitions

A **period** is a range of business dates, `from` to `to` inclusive (at most 93). Its instants are `[from 04:00, to+1 04:00)` in the branch's zone: inclusive start, exclusive end. An event at 00:30 belongs to the previous business date; one at exactly 04:00 to the new one.

| Metric | Definition | Date it counts on |
|---|---|---|
| **Paid sales** | Sum of the USD amount of payments collected in the period, each order once (one payment per order, enforced by a unique index) | Payment time (`collected_at`) |
| **Paid orders** | Number of those payments | Payment time |
| **Average order** | Paid sales ÷ paid orders, in whole cents rounded half up; none when there are no paid orders | Payment time |
| **Refunds** | Sum of the USD amount of payments whose money was returned in the period (the full payment) | Return time (`returned_at`) |
| **Net sales** | Paid sales − refunds (both in the period; a payment and its refund can fall in different periods) | as above |
| **Payments by method** | Per method: orders, USD amount; for cash riel also the riel amount (each at its own recorded rate, never today's) | Payment time |
| **Paid sales by hour / day** | Paid sales grouped by the local hour (one business day) or business date (longer periods) | Payment time |
| **Best sellers** | Items by quantity sold in paid orders (ties by sales), top 5 | Payment time |
| **Cancelled, not paid** | Orders placed in the period and cancelled without payment, by who: customer, cafe, system (expired after 30 minutes) | Placement (`business_date`) |
| **Orders placed** | Orders placed in the period, any outcome | Placement |
| **Current orders** | Live counts now: waiting for payment, preparing, ready. Shown only when the period includes today's business date, labelled "Current orders" | Now |
| **Sales by item** | Per item: quantity and line totals (unit price with add-ons × quantity) of paid orders; **Refunded** = line totals of orders refunded in the period. Grouped by item; the name and category shown are those of the item's latest sale | Payment time; refunds at return time |

Money is summed as integer cents (and whole riel) in SQL; never floats.

**Order history** filters by placement business date and shows two derived columns:

- **Payment:** `unpaid` (waiting for payment), `paid` (payment, no return), `refunded` (payment returned), `not_paid` (cancelled without a payment).
- **Progress:** the order's status: waiting for payment, preparing, ready, completed, cancelled.

## Stages (one pull request each)

1. **Reports on the server:** the category snapshot on order lines (migration, filled for existing test orders from the current menu), the report rules (period → instants, buckets, derived payment state), `GET /api/admin/reports/summary`, `/items`, `/orders`, `/orders/{id}`; `report: ['read', 'export']` for admins; server tests with written examples (this document's definitions).
2. **The report pages** (after the owner's frames): Reports → Summary, Sales by item, Order history (with the order panel and timeline); date presets, the branch's zone and business-day note, "Updated …"; **Download CSV** (every matching row, the filters and sort kept, formula injection neutralized, UTF-8 with BOM, filenames like `riverside-2026-09-30-summary.csv`) and **Print** (a print stylesheet: title, branch, period, zone, printed at and by, definitions, totals, page breaks).
3. **Telegram connection:** Admin → Telegram; the bot (`NUXT_TELEGRAM_BOT_TOKEN`, `NUXT_TELEGRAM_BOT_USERNAME`, `NUXT_TELEGRAM_WEBHOOK_SECRET`; off without a token); `POST /api/webhooks/telegram` verified by Telegram's secret header; private chats by `t.me/<bot>?start=<code>`, groups by `?startgroup=<code>` with the linking Telegram user checked as a group admin (`getChatMember`) and a confirm step in the portal; codes random, stored hashed, 10 minutes, single use; supergroup migration and "bot removed" handled; Send test, Disconnect; manual **Send to Telegram** from a report.
4. **Alerts and the closing summary:** orders write neutral outbox events in their own batches (`orders.placed`, `orders.paid`); the notification feature turns them into messages per enabled destination (deduplicated by event and destination). The closing summary: the end of the day's last opening window (overnight windows end the next day), plus 30 minutes, for the business date that window started on; nothing on a closed day (R4); a snapshot stored and sent (a retry resends the same snapshot), deduplicated by branch, business date, kind and destination; optional CSV attachment. Delivery history (Pending, Sent, Failed with the reason), Retry, Telegram's `retry_after` respected, a blocked bot shown. At least once: a network failure after Telegram accepted a message can repeat it (documented). The counter app's `?order=` deep link.
5. **Verification on staging** with the owner's bot, and the setup guide.

## Security

- Every report, export, connection and share route checks the permission on the server; report links need the admin session; exports are not stored.
- Filters are validated (dates, 93 days, page size ≤ 100) and bounded.
- A group destination shows its name and "everyone in the group sees what's sent" before it's enabled.
- Telegram messages never contain emails or member codes (R3).
