# Release check (step 10.5)

The [system blueprint's release test scenarios (§8)](system-blueprint.md#8-release-test-scenarios), each mapped to the tests that prove it, plus a short check by hand on staging. Production (8.2) launches only when every row is ✅ and the hand check passed. Re-run the hand check before each launch; the automated tests run in CI on every PR.

The two loyalty rows (points awarded once, exchanging points for a voucher, the last voucher use) wait for phase 7, deferred by the owner (D115).

## Scenarios and their tests

| # | Scenario | Proved by | Status |
|---|---|---|---|
| 1 | A signed-out visitor opens a table QR and tries to order: sign-in is required, and the table is still there afterwards | e2e `shop-checkout.test.ts` "signed out at a table: ordering asks to sign in, and the table is still there after signing in" (new in 10.5); "signed out: Review order asks to sign in, comes back…" (pickup) | ✅ |
| 2 | A changed, archived, rotated or made-up table QR is refused; no order is written | server `orders.service.test.ts` "refuses a token of another branch, an archived table or a made-up token: never pickup instead"; `branches.service.test.ts` "rotating makes a new QR and the printed one stops working", "an archived table's QR stops working…", "an unknown or malformed token, another secret's token, and another branch's table are 404"; e2e `shop-checkout.test.ts` "a table that stopped taking orders is refused, never switched silently" | ✅ |
| 3 | A price, availability or option changes after the cart was built: never charged the old price | server `orders.service.test.ts` "refuses a total other than the one shown, and places nothing", "refuses a line that can't be ordered now"; `quote.service.test.ts` "a price edit shows in the next quote"; e2e `shop-checkout.test.ts` "a price changed since the quote: the order is refused, the new price is shown…"; `shop-orders-api.test.ts` "…a changed total 409" | ✅ |
| 4 | The same checkout sent twice: one order, both answers name it; the same key with another order is refused | server `orders.service.test.ts` "the same key gives the same order, once", "two tabs sending the same key at the same moment place one order", "the same key with a different order is refused"; e2e `shop-orders-api.test.ts` "the same key again answers 200 with the same order" | ✅ |
| 5 | A payment retried, or two cashiers at once: one payment, one paid transition; preparing only after it | server `counter.service.test.ts` "two cashiers paying the same order at once: one payment…", "paying and cancelling at once: exactly one wins", "a retry with the same key returns the first answer and records nothing more", "an unpaid order can't be marked ready"; e2e `counter-orders-api.test.ts` "…a retry answers the same" | ✅ |
| 6 | Staff of another branch can't see or change an order; nothing is written | server `counter.service.test.ts` "another branch's order is not found, like an unknown one" (10.5 added: ready and cancel refused too, and the order, its payment, events and audit untouched); e2e `counter-orders-api.test.ts` "a customer, or staff of another branch, doesn't reach the counter: 404" | ✅ |
| 7 | Two staff move the same order from one version: one wins, the other is told it changed | server `counter.service.test.ts` "two staff marking the same order ready at once: one wins…" (new in 10.5), "a change landing between the read and the write stops the batch (the version guard)", "preparing → ready → completed, each once" | ✅ |
| 8 | Completing is retried: completed once (points wait for phase 7) | server `counter.service.test.ts` "completing retried with the same key answers the same and completes once; a new key is refused" (new in 10.5) | ✅ |
| 9 | A privileged action is audited with who, what and which record; a customer reads only their own orders | server: every write's test checks its audit entry (e.g. `counter.service.test.ts` "cash in dollars: … the audit entry are written", `staff.service.test.ts`, `branches.service.test.ts` "…audited"); `orders.service.test.ts` "someone else's order is 404, like an unknown one"; e2e `shop-orders-api.test.ts` "someone else's order is 404", "…refuses signed out and someone else"; `identity.permissions.test.ts` "gives customers nothing" | ✅ |
| 10 | An image uploads but the item save fails: no broken image, the upload is cleaned up | server `items.service.test.ts` "an upload whose item save fails at the write stays unattached…" (new in 10.5); `media.service.test.ts` "deletes uploads unused for 24 hours, row and object; keeps newer and attached ones", "removes the object again when the row can't be written", "fails the caller's batch when the upload is cleaned up between the check and the write" | ✅ |

**Two guards, not one (found in 10.5):** an order's status change is guarded by the version check in the batch (`requireOneChange`) **and** by the unique index `order_events_version_idx` (one event per order and version). With the first removed, the race test of row 7 still passes: the second writer fails on the index and is told the order changed.

## The hand check on staging (the owner, about 20 minutes)

What the tests can't see: real phones, the real Worker and D1, two real devices. Use a verified customer account (staging's test email sender delivers only to the Resend account's own address, so sign up with that one) and the counter on a second device or window.

1. **Table QR, signed out (row 1).** On a phone in a private tab, scan a table's QR (Admin → Branch → Dining tables → View QR). Add an item, Review order, Sign in. After signing in, Review order still says **Dine-in · Table …**. Place the order: its page says the table.
2. **Price changed underneath (row 3).** Open Review order with an item. In another window, change that item's price in Admin → Menu items and save. Back on Review order, Place order: it's refused, the new price is shown next to the old one, and placing again charges the new price.
3. **Two cashiers (row 5).** Open the same unpaid order on the counter in two windows (or a phone and a computer). Press Take payment → Cash USD in both, close together. One succeeds; the other is refused with the order's new state (already paid). The order shows one payment.
4. **Ready twice (row 7).** On the paid order, press Mark ready in both windows. One succeeds; the other says it changed and offers Reload.
5. **Image without a save (row 10).** In Admin → Menu items, open an item, upload a photo, then close without saving (Discard). The item keeps its old image (or none) on the customer menu.

Write the date and anything odd into `docs/progress.md` (step 10.5).

## Hand check result, 2026-10-01 (staging, run for the owner by an AI browser agent): NOT PASSED

| Check | Result |
|---|---|
| 1. Table QR, signed out | **Not done.** A valid T08 QR kept the table through a signed-in checkout and the order page; a made-up QR showed the refusal page. The signed-out round trip and a real phone scan are still to do. |
| 2. Price changed underneath | **Passed.** Macchiato quoted $2.25, changed to $2.35: refused with both prices shown; placing again made order 002 at $2.35, Table T08. Price restored to $2.25. |
| 3. Two cashiers | **Passed on the server, found a counter hazard.** The database shows **one payment per order** (002, 003, 004). On 002 and 003 "ready" was recorded 1 second after "paid": the second cashier's open panel had refreshed and its **Confirm payment** button had become **Mark ready** under the click. Fixed: the panel now says "Paid meanwhile by …" and offers the next step only after **OK** (e2e `counter.test.ts`, checked to fail without the guard). |
| 4. Ready twice | **Not shown.** The second window refreshed and hid Mark ready before its click; no stale-version refusal was exercised by hand (the server test covers it, row 7). |
| 5. Image without a save | **Passed.** Upload, close, Discard: no image on the customer menu. The 24-hour cleanup isn't visible by hand (server test, row 10). |

**Blocker found: Cloudflare Error 1102, "Worker exceeded resource limits"** (Ray a43c2ce298723fad, 14:32 UTC): the customer menu and saving the branch hours failed. The Workers **Free** plan allows **10 ms of CPU per request**; server rendering, sessions and password hashing use more, and under steady use Cloudflare starts stopping the Worker. None of these failures reached our error handler (no server-error alert was queued), which fits a stop by Cloudflare rather than an error in the app. To confirm: dashboard → Workers → nuk-cafe-staging → Metrics → Errors → "Exceeded CPU Time Limits". The fix is the Workers Paid plan (5 USD a month), which production needs anyway (Q24).

**Left on staging:** Thursday closes at 23:20 (checked in D1: minute 1400); set it back to 21:20 in Admin → Branch once saves work. Test orders 002–004 are Ready at Table T08, one payment each.

**Still to do before sign-off:** checks 1 (signed out, a real phone) and 4 by two people on two devices, after the 1102 fix.
