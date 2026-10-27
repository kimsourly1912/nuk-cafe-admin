# Plan: no default cafe (D221)

Owner request, 2026-10-27: a fresh environment (no cafe yet) must work, and nothing may guess a cafe. Decision: [D221](../decisions.md#d221-nothing-guesses-a-cafe-the-sites-root-is-the-platforms-2026-10-27). Setup order per environment: [operations → Setting up an empty environment](../server/operations.md#setting-up-an-empty-environment-d220).

## Rule

A cafe comes from exactly two places: the address (`/c/<slug>`, `/api/c/<slug>`, resolved by `tenantBySlug`) or a record that belongs to one (a table token). There is no default cafe (`NUXT_PUBLIC_DEFAULT_TENANT` removed) and no "oldest cafe" (`currentTenant`, `findOldestTenant` removed). Code without a cafe works without one or refuses; it never falls back.

## Leaks found and fixed (step 1, this change)

| # | Where | What happened | Now |
|---|---|---|---|
| 1 | `server/error-handler.ts` | A server error outside a cafe's API (platform routes, sign-in) alerted the oldest cafe's Telegram chats | Only the cafe the request resolved (`alertTenantOf`); the platform's stay in the logs |
| 2 | `server/utils/jobs.ts`, `platform:deliver-outbox` | Every scheduled job failure and outbox give-up alerted the oldest cafe's chats | Logs and System health only (Q24) |
| 3 | `identity.auth.ts` sign-up hook | Every sign-up made a member profile in the oldest cafe | No profile at sign-up; each cafe's on first use there |
| 4 | Account pages (`/sign-in`, `/sign-up`, `/verify-email`, `/email-verified`) | Read NUK's `/shop/me`, which made any signed-in visitor a NUK member | `useAccountSession`: Better Auth's session only |
| 5 | `apiPath` / `plugins/api.ts` / server-rendered `apiFetch` | A cafe's API called from a page without a cafe went to NUK's | Throws |
| 6 | `/table/<token>` with a broken QR | "Order for pickup" opened NUK's menu | No link; ask the staff |
| 7 | Your cafes, no cafe | "Go to the menu" opened NUK's menu | No link |
| 8 | Account pages' "Back to the menu", error page "Go to home", sign-out fallbacks | NUK's menu or sign-in | `?redirect=`'s cafe, else `/` (or Your cafes) |
| 9 | Email verification link | Came back with no cafe | Carries `?redirect=` to the cafe page it was sent from |
| 10 | `/` and pre-D141 addresses | Redirected into NUK | `/` → Your cafes, then the platform's page (next step 1); old addresses not found |
| 11 | Platform form drafts | Stored under NUK's key | Under `_platform` (no cafe slug can be it) |

Checked and fine: `/api/cafes/{slug}` (name and logo only), `/api/tables/{token}` (the token names the cafe), `/api/me/cafes` (the account's own), browser storage (keyed by globally unique branch ids), Better Auth's active organization (unused).

## Next steps

1. **Done (2026-10-27): the platform's page at `/`.** Owner approved the mockup: Angder, a tagline, the two audiences in a `TaskFrame`, Sign in → `/cafes`. The contact line for cafes that want to join is left out until the owner gives the Telegram contact. Planned content: the platform's name; for customers "scan the QR on your table or open your cafe's link"; for owners and staff Sign in → Your cafes; a contact line for cafes. No public list of cafes. Static, no session read on the server. Then "Back to the menu" on the account pages without a cafe reads "Back to home".
2. **Platform alert channel (Q24).** Until then the independent health check reports stuck work: production sets `NUXT_MAINTENANCE_NOTIFICATION_MAX_AGE_SECONDS=300` and `NUXT_MAINTENANCE_DELIVERY_MAX_AGE_SECONDS=900` (done, 2026-10-27).
3. **Membership by choice (step 7.1).** Opening a cafe's menu signed in makes a profile there. No cafe screen shows profiles today; when loyalty or a customer list does, joining must be the customer's explicit action.
4. **The platform's name** ("NUK Platform" in the console, two-step setup and tab titles) is a working name until the owner names it; emails already use `NUXT_MAIL_APP_NAME`.
