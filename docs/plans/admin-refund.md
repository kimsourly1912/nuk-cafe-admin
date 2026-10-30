# Admin refund (D231, D233)

The cafe's owner records that a **ready or completed** order's money went back. Before ready, the counter's cancel already does this (Q36, D101). The owner's answers (2026-10-30): the full amount only; within 30 days; a ready order becomes cancelled, a completed one stays completed; no mockup round (a button and a dialog on an existing panel, like D197).

## Behaviour

- **Who:** `payment: ['refund']`, a branch permission only the tenant's owners hold (D45, `identity.permissions.ts`), checked on the order's branch (in the path, like the counter's commands); another branch's order is 404. An archived branch's orders can't be refunded (its access is gone). Managers see the same order panel in the counter's reports (D198) without the button; the server refuses them (403).
- **Which orders:** status `ready` or `completed`, paid (a counter payment exists), not refunded yet, paid within the last **30 days**.
- **What it writes** (one batch through `runOrderCommand`): the payment's `return_method`, `returned_by`, `returned_at` (guarded: still not returned); the status change at the version read (ready → cancelled, completed → completed with the version + 1); an `order_events` row (reason `other`, the owner's note); the audit entry `orders.order.refund` (method, amount); the idempotency key `orders.refund`.
- **Reports:** unchanged code. A refund already counts on the day the money went back (`returned_at`, D110); the payment shows "Refunded"; past days' totals never change.
- **Timestamps:** a status timestamp (`completed_at`…) is written only when the status changes, so a completed order keeps its completion time (fix in `transitionStatement`).

## API

`POST /api/c/<slug>/admin/branches/{branchId}/orders/{orderId}/refund` (header `Idempotency-Key`) `{ version, returnMethod: 'cash' | 'khqr', note }` (note 1–200, required: why; the counter's cancel-note limit) → the `OrderHistoryDetail` as it is now.

| Case | Answer |
|---|---|
| Another cafe's order, unknown id | 404 `NOT_FOUND` |
| Not an owner | 403 `FORBIDDEN` |
| Stale version | 409 `ORDER_CHANGED` |
| Awaiting payment or preparing | 409 `ORDER_NOT_REFUNDABLE` (cancel it at the counter) |
| Cancelled, or already refunded | 409 `ORDER_NOT_REFUNDABLE` |
| Paid more than 30 days ago | 409 `REFUND_TOO_LATE` |
| The same key again | the first answer, nothing more written |
| The same key, another body | 422 `IDEMPOTENCY_MISMATCH` |

`OrderHistoryDetail` gains `version` (additive), which the dialog sends.

## Screen

Admin → Reports → Orders → an order: a **Refund** button when the order can be refunded (admin surface only). The dialog: "Refund $X.XX", how the money went back (Cash or KHQR), why (required, ≤ 200), the 30-day rule; Refund and Cancel. On success the panel shows "Money returned (method) by …" and, for a ready order, "Cancelled". The counter's 409 message names where to refund.

## Tests

Server: completed stays completed with its completion time; ready → cancelled and out of the queue; each refusal writes nothing; 30 days and 30 days + 1 minute; replay and mismatch; two cafes; the payment guard and the status guard each removed fail a test; the report counts the refund on its own day. Browser (mocked API): the button only where it applies, the dialog's validation, the request body and key, the panel after success. Help page: the assistant's Reports page.
