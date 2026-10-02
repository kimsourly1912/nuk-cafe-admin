# KHQR at the counter plan (step 10.15)

_2026-10-02. The owner's choice after the KHQR research: a dynamic KHQR shown **at the counter** (not online payment: the launch rule "pay at the counter before preparation" stays, D45), free, on Cloudflare only, no server of our own. The cafe isn't a registered business, so ABA PayWay is out; the money goes to a personal Bakong account (the owner's, verification pending). Decision entries: D130 (10.15a), D131 (10.15b)._

## How KHQR works (research, 2026-10-02)

- **KHQR** is the National Bank of Cambodia's (NBC) payment QR, on EMVCo's merchant-presented QR format; every Cambodian banking app scans it. A **dynamic** KHQR carries the receiver (a Bakong account ID such as `name@aclb`), the amount, the currency (USD 840 or KHR 116), a bill number, a store label and a creation and expiry time, closed by a CRC-16.
- **Free:** banks charge no fee to receive KHQR; the Bakong Open API is free with a registered email; its token lasts **90 days**.
- **Checking a payment** (step 2): `POST https://api-bakong.nbc.gov.kh/v1/check_transaction_by_md5` with the QR text's MD5 and the token. No webhooks: the payee asks. In production it reportedly **refuses servers outside Cambodia (403)**; whether a Cloudflare Worker serving a request from Phnom Penh is refused is unknown until tried.
- Sources: NBC's *QR Payment Integration*, *KHQR SDK Document* v2.9 and *Bakong Open API Document*; the NBC JavaScript SDK `bakong-khqr` 1.0.20 (gitlab.nbc.gov.kh).

## Step 10.15a: the QR at the counter, confirmed by the cashier

- **Purpose:** the customer scans a QR that already holds the exact amount and the order number; the cashier sees the money arrive in the bank app and confirms. No mistyped amounts; each payment names its order in the bank's history.
- **Server:**
  - **`khqr_settings`** (one row): on/off, the Bakong account ID (`name@bank`, ≤ 32), the name customers see before paying (≤ 25, letters, digits and simple punctuation: the QR is ASCII), the city (≤ 15), the currencies offered (USD, riel or both), `version`. Admin only (`settings: ['manage']`), audited. `GET/PUT /api/admin/khqr`.
  - **`khqr_charges`**: one QR made for an order: currency, amount (cents or riel), the riel rate for riel, the QR text, its MD5 (unique), the bill number, made by, made at, expires at. `POST /api/counter/{branchId}/orders/{orderId}/khqr` `{ currency }` answers the order's open QR in that currency, or makes one: unpaid orders only, before the pay-by time, expiring after 15 minutes or at the pay-by time, whichever is first. Riel at the current rate rounded up to ៛100 (`toRiel`, as cash riel).
  - **The QR text** is built by our own `buildKhqr` (`server/features/orders/khqr.ts`, no network): the NBC SDK's tags and order, checked against vectors the SDK made (`khqr.test.ts`). The SDK isn't a dependency: it pulls in axios 0.24 (known advisories) and does far more than we need. MD5 by `@noble/hashes` (already installed through Better Auth; Web Crypto has no MD5 outside Workers).
  - **Pay:** `pay` with `method: 'khqr'` takes an optional `chargeId`: it must be this order's, in this branch; the payment row keeps it (`counter_payments.khqr_charge_id`, a new nullable column). Its expiry doesn't block the cashier: a customer can pay at the last second, and the cashier only confirms money they see.
- **Counter (Take payment → KHQR):** with KHQR set up, the QR (made by the server, drawn by `uqr` like the table QRs), the amount and currency, "Order 042", the minutes left, USD/riel buttons when both are offered, **New QR** once it has expired, and **Confirm KHQR payment**. Not set up: today's instruction (the counter's printed KHQR) and the optional reference.
- **Admin → Payments:** a KHQR card: off until an admin fills in the account, the name and the city; Reload after someone else's save keeps the input. The first real test is an order at the counter (the money goes to the cafe's own account).
- **Out of scope:** online payment, checking with Bakong (10.15b), refunds by QR (staff send money back in their banking app, recorded as today).

## Step 10.15b: checking with Bakong (built, D131)

- **`NUXT_BAKONG_TOKEN`** (a Worker secret, set by the owner; never in chat) turns it on; `NUXT_BAKONG_API_URL` (default `https://api-bakong.nbc.gov.kh`) can point at a relay later. Setup and renewal: [operations.md → KHQR](../server/operations.md#khqr).
- `POST /api/counter/{branchId}/orders/{orderId}/khqr/{chargeId}/check`: the server asks Bakong by MD5; **paid** only when Bakong's answer names our account, the charge's currency and amount; then it records the payment as the cashier who asked (the same payment as `pay`, keyed by the QR). The counter asks every **5 s** while the QR is on screen, until 5 minutes after it expired. Confirm stays as the fallback.
- **Payments → Automatic check with Bakong:** On/Off and **Test connection** (`POST /api/admin/khqr/test`).
- **The 403 test:** done (owner, 2026-10-02): **Connected** on staging, Bakong answers the Worker. Should it ever refuse (another Cloudflare location, a Bakong policy change), a refusal says "Bakong refused this server" and cashiers confirm by hand. If refused, the free fallback is a Cloudflare Tunnel to a device at the cafe (needs a domain, Q4).
- **Token expiry:** shown at the counter ("Automatic check unavailable") and on Payments; a Telegram reminder before the 90 days is left for later.

## Edge cases

| Case | Handling | Test |
|---|---|---|
| Two cashiers open KHQR for the same order | The same open QR is answered (one per order and currency while unexpired) | server |
| The QR expires while shown | Minutes left reach 0: "Expired", New QR; Confirm stays (money may already be sent) | unit, e2e |
| The order expires or is cancelled | No new QR (`ORDER_CHANGED`); pay refused as today | server |
| A charge from another order or branch | `pay` refuses it (`KHQR_CHARGE_INVALID`) | server |
| KHQR not set up, or turned off | No QR; today's instruction | e2e |
| The riel rate changes after the QR was made | The QR keeps its riel; the payment records the charge | server |
| A name with Khmer letters | Refused on the settings form (the QR's name is ASCII; a Khmer name tag is later) | unit |
| Bakong confirms the QR (10.15b) | Recorded as the cashier who asked, once; the panel closes | server, e2e |
| Two cashiers' counters check the same QR at once | One payment; both answer paid | server (race, checked without the read-back) |
| Something else arrived on the QR (amount, currency, account) | "Doesn't match", nothing recorded; the cashier settles it | server, e2e |
| Paid after the pay-by time, before the expiry ran | Recorded (the money arrived) | server |
| Paid on a QR of an order already paid in cash, or cancelled | "Give it back to the customer", a toast that stays | server |
| No token, token expired, Bakong refuses this server or is down | "Automatic check unavailable": Confirm by hand; Try again (not for a blip, which retries by itself) | server, unit |
