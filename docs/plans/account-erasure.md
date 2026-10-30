# Account erasure (D229, D237)

A customer deletes their own account. The cafes keep its orders and payments (kept 5 years, D229) without the person's name. The owner's answers (2026-10-30, the recommended defaults): self-service only; staff, managers and owners first lose their cafe access; immediate, with a confirmation email; refused while an order is in progress; no mockup round (a button in the account menu and a dialog).

## Behaviour

- **Who:** the signed-in account itself, after its password (Better Auth's `verifyPassword` against the session). Never a guest (the 90-day cleanup empties those, D236).
- **Refused, writing nothing:**

  | Case | Answer |
  |---|---|
  | Not signed in, or already deleted | 401 `UNAUTHENTICATED` |
  | A guest | 403 `FORBIDDEN` |
  | Wrong password | 400 `WRONG_PASSWORD` (on `password`) |
  | A member of any cafe, or staff at any branch | 409 `ACCOUNT_HAS_ACCESS`: the owner removes the access first, so a cafe never loses its last owner |
  | A super admin | 409 `ACCOUNT_HAS_ACCESS`: another super admin removes the role first |
  | An order waiting for payment, being made or ready, in any cafe | 409 `ORDER_IN_PROGRESS` |
  | Access, the platform role, the email or an order changed between the checks and the write; a second request at once | 409 `VERSION_CONFLICT`, nothing written |
  | More than 3 tries a minute from one address | 429 `RATE_LIMITED` |

- **What it writes** (one batch): `user`: name "Deleted account", email `deleted-<id>@anonymous.invalid` (unique, frees the real one for a new sign-up), not verified, no picture, `anonymized_at`; deletes `session`, `account`, `two_factor` and Better Auth's reset rows (`verification.value` = the id); every cafe's `customer_profiles`: phone and marketing choice removed, `anonymized_at` (member code kept); the order guard; the "account deleted" email through the outbox, **only to a verified address**; audit `identity.account.delete` (the id only, never the old name or email).
- **What stays:** orders, payments, events and audit, pointing at the emptied account; they show "Deleted account". A line note the customer wrote stays part of its order.
- **Not erased at once:** D1 Time Travel keeps a restorable copy for 30 days, and the nightly backups (once they work, D225) for their retention. The outbox clears a message's address once sent, and a failed or stuck "account deleted" message's after a day (`maintainOutbox`).

## API

`POST /api/me/delete-account` `{ password }` → 204. A platform route: an account is the platform's, not a cafe's. The route hands identity two checks that belong to the orders feature (whether an order is in progress, and its guard statement for the batch), because orders already imports identity.

## Screen

The customer site's account menu → **Delete account** (red, ghost, below Sign out) → `DeleteAccountModal`: what goes, what stays, the password, **Delete account** and **Keep my account**. A refusal stays in the dialog (a wrong password on its field). Deleted: a toast "Your account was deleted", the cafe's menu, signed out.

## Platform staff (owner, 2026-10-30)

Today the platform team doesn't reach a cafe's data (AGENTS.md); support visits (D193) are read-only and have their own records, so erasure doesn't touch them. A super admin's own account can't delete itself. The owner noted that the platform team may later work in some of a cafe's features. When such a feature is planned, revisit this plan: whether the console may erase an account on a person's request (with its own audit), whether a platform role should still block deletion, and what a deleted account shows in that feature.

## Tests

Server `erasure.service.test.ts` (12, real Better Auth): everything above is written and another customer untouched; signed out and the email free for a new account; no email for an unverified address; each refusal writes nothing; the races (access, order, email, platform role, a second request); each of the 16 guards removed in turn failed a test. `identity.accounts.test.ts` (the email: platform name, no link), `maintenance.test.ts` (the address cleared after a day), `rate-limit.test.ts`, `routes.test.ts`. e2e `shop-account.test.ts` → "deleting the account" (real server, phone width).
