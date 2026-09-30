# Order tracking plan (step 6.5b)

_2026-09-30. The owner's 6.5 frames and their review (accepted: "use your defaults"); the server is step 6.5a (D106). Decision entry: D114. Live pushes later: [live-updates.md](live-updates.md)._

## Purpose and scope

- **Purpose:** after placing an order, a customer sees where it is (waiting for payment, preparing, ready, picked up or cancelled) without asking at the counter, can cancel it while it's unpaid, can find it again, and can order the same again.
- **In scope:**
  1. `/orders/<id>` tracks the order: the number as the hero, the status badge, a 4-step tracker (Paid → Preparing → Ready → Picked up; hidden when cancelled), the next step, the payment line, "Updated …", the lines, the total, the branch and Pickup or the table. Two columns from `lg`.
  2. Waiting for payment: "Pay at the counter by 10:45 AM" with a minute countdown, red in the last 5 minutes, "Time's up: this order will be cancelled" at 0 until the expiry (D104) shows up.
  3. **Ready** stands out: the number panel turns success-colored, "Ready for pickup", "Show this number at the counter"; the tab title becomes "Ready: 042".
  4. Dine-in says **collect at the counter** (D106's correction; no table service exists).
  5. **Cancel** while unpaid: a confirm sheet (a dialog from `sm`): "Cancel order 042?", "You haven't paid, so nothing is charged.", Keep order / Cancel order. Paid meanwhile: the server's words ("… is paid now, so it can't be cancelled here. Ask at the counter.") and the page shows Preparing.
  6. **Completed:** "Picked up at 10:34 AM" (success), the lines kept as the receipt, **Order again**.
  7. **Cancelled:** a neutral badge and card with the reason: "Not paid within 30 minutes" (system), "You cancelled this order" (customer), "Cancelled by the cafe: item unavailable." (cafe, its reason), plus "$9.75 returned in cash/by KHQR" when a payment went back. "Back to the menu".
  8. **Order again** adds the lines that are still on the menu (same version and add-ons, the notes kept) to the order in this browser for that branch and opens the menu; the rest are skipped with a note ("Added 1 item. Banana Bread isn't available now."). The table isn't carried over: a new order is pickup unless this tab scanned the table's QR.
  9. **`/orders` "Your orders":** In progress (cards) and Past (rows: number, date, status, total), 20 more at a time with Load more; empty state "No orders yet" with Browse the menu; signed out, Sign in. Linked from the account menu ("Your orders").
  10. **The order bar on the menu** (signed-in customers with an order in progress): above the first section, scrolling with the page: "Order 042 · Preparing · View", success-colored "Order 042 is ready"; several: "2 orders in progress · View" to `/orders`.
- **Out of scope:** live pushes (Durable Objects, [live-updates.md](live-updates.md)), sound, push notifications, SMS, rating an order, reorder from the list rows.

## API contract

No new routes (D106): `GET /api/shop/orders/{id}`, `GET /api/shop/orders?page=&pageSize=`, `POST /api/shop/orders/{id}/cancel` `{ version }` with an `Idempotency-Key`.

- **[Choice] `OrderLine.variationId`** is added to the contract (already stored per line): Order again needs the version, not only its label. The counter's lines carry it too (same type).

## Freshness (D22 exception, like the counter D102)

- `/orders/<id>`: refetch every **10 s while the tab is visible**, stopped once the order is completed or cancelled; on return to the tab by the freshness plugin.
- The menu's order bar: every 10 s only while an order is in progress; nothing for signed-out visitors (no request).
- `/orders`: no timer; refreshed on return to the tab and after a cancel (`invalidate('orders')`).

## Mutations

- `orders:cancel`, key and lock the order id, an idempotency key per attempt kept across "Try again" of the same attempt, `invalidate: ['orders']`, success toast "Order 042 cancelled".

## Edge cases and verification

| Risk | Test |
|---|---|
| Status changes at the counter show without a reload | e2e (seeded server): the counter's API pays, readies, completes; the page follows within the poll |
| Cancel while the cashier pays | e2e: pay over the API with the sheet open, then Cancel: the refusal and Preparing |
| The countdown at 0 | unit (`countdown`) |
| Order again with a sold-out or removed item | unit (`reorderLines`) + e2e |
| Another customer's order | e2e: "This order wasn't found" |
| The bar only when signed in and in progress | e2e: signed out none, one order "Order 042", ready turns green |
| Wording of each cancellation | unit (`cancellationText`) |
