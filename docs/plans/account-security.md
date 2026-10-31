# Account security: two-step sign-in, session length, re-confirming dangerous actions

Status: **step 1 built (D242, 2026-10-30, in review)**; steps 2–5 not started. The owner waived the mockup round for step 1. Follows the [workspace access plan](workspace-access.md) (done: D239 refusal panels, D240 page access, D241 the sign-ins' rules). Related: D45 (sessions), D52 (admin is owners only), D97 (one session per browser), D102 (counter), D135 (platform team never opens cafe data), D188 (two-step sign-in for super admins), D193 (support access).

## 1. Where we are (checked in the code, 2026-10-30)

| Area | State |
|---|---|
| Access on every request, per cafe | ✅ `server/utils/access.ts` (D134); pages by permission (D240); refusal panels at every sign-in (D239, D241) |
| Passwords | Breached-password check on set; sign-in 5 per minute per network address (`identity.auth.ts` → `rateLimit`, `cf-connecting-ip`); human check on sign-up/sign-in |
| Ending access | Changing or removing a person's access, disabling them, or resetting their password deletes all their sessions (`staff.service.ts`, `staff.repository.ts` → "Signs the account out everywhere") |
| Two-step sign-in | Better Auth `twoFactor` plugin (`identity.auth.ts`). **Required for super admins** (D188); setup page only in the console (`app/features/platform/components/PlatformTwoFactorPage.vue`). The cafe sign-ins and the customer sign-in already ask for a code when an account has it (`<TwoFactorCodeForm>`, e2e `two-factor.test.ts`), but **owners and staff have no page to turn it on** |
| Sessions | **7 days for everyone, renewed once a day while used** (`session: { expiresIn: 7 * DAY, updateAge: DAY }`): customers, counter tablets, owners and super admins alike |
| Seeing sessions | No "your devices" page; the only way to end one's other sessions is changing the password (`revokeOtherSessions: true`). The console can sign an account out everywhere (P1, D187) |
| Dangerous actions | No re-confirmation: payment receiving settings (`PUT /api/c/<slug>/admin/khqr`, `…/khqr/token`), giving someone admin (staff create/update with `admin: true`), owners added/removed/transferred (`/api/platform/tenants/{id}/owners/**`) |
| Owners' view of staff | Name, email, roles; no last sign-in, no two-step status |

## 2. How others handle it

- **Two-step sign-in:** Shopify lets every staff account turn it on for itself; on its top plan owners can require it for everyone, with POS-only staff exempt ([Shopify: two-step authentication](https://help.shopify.com/en/manual/your-account/logging-in/two-step-authentication), [requiring it](https://help.shopify.com/en/manual/organization-settings/security/two-step-authentication)).
- **Session length:** every session needs an absolute limit, shorter for valuable accounts (OWASP: [insufficient session expiration](https://owasp.org/index.php/OWASP_Periodic_Table_of_Vulnerabilities_-_Insufficient_Session_Expiration)).
- **Re-confirming:** GitHub's "sudo mode" asks for the password or a code before sensitive actions, then trusts the session for a few hours ([GitHub: sudo mode](https://docs.github.com/en/enterprise-server@3.22/authentication/keeping-your-account-and-data-secure/sudo-mode)). Better Auth has a "fresh session" age (`freshAge`) for its own sensitive endpoints ([Better Auth: session management](https://www.better-auth.com/docs/concepts/session-management)); our routes need their own check.
- **Shared counters:** Toast and Square sign the device in once; each person then uses a short PIN, and an idle timeout returns to the PIN screen. Toast's kitchen-display screens are exempt from the idle lock so orders stay visible ([Toast: screen timeout](https://support.toasttab.com/en/article/Adjust-POS-Screen-Timeout), [Toast: passcodes](https://support.toasttab.com/en/article/Find-Change-or-Fix-Your-POS-Access-Code-Passcode), [Square: passcodes](https://square.com/help/us/en/article/5643)). **Our counter's queue is like that kitchen display: no idle lock.**

## 3. The owner's answers (2026-10-30: every recommendation)

- **Q1 Two-step sign-in for owners and staff:** available to every owner and staff member (self-service). Owners first optional, then **required for owners** after a short grace period (a later step; the period is set then). **Never required for counter staff** (it would slow the counter).
- **Q2 Session length:** customers keep **7 days** (renewed while used). Owners, staff and super admins: **1 day** absolute, so a tablet or phone left signed in is signed out by the next day.
- **Q3 Re-confirm (password or code, valid about 15 minutes) before:** changing payment receiving settings (KHQR settings and the Bakong token); giving someone admin (owner) access; adding, removing or transferring owners (console).
- **Q4 PIN mode for the counter:** not now. Instead a **Switch person** action on the counter. Revisit PINs if cashiers find switching slow.

## 4. Steps (one branch and PR each, in this order)

### Step 1: two-step sign-in for owners and staff ✅ (D242, in review)

Built as planned: the page per workspace, the shared `<TwoFactorSetupFrame>` (the console's setup moved to the root), the Staff column. Also: a super admin can't turn it off (server). Deferred: the lost-authenticator recovery below (QA1).

- An **account security** page for a signed-in owner or staff member, reachable from the admin's and the counter's user menus: turn two-step sign-in on (password → QR code and key → backup codes → a code from the app), and off (password). Reuse the console's setup flow (`PlatformTwoFactorPage.vue`, `usePlatformSession.startTwoFactor` / `confirmTwoFactor`, D188) rather than a copy: move the shared part to a root building block if both need it (app-architecture: promote when a second feature needs it).
- Setting it up already ends the account's other sessions (`identity.auth.ts` after-hook on `/two-factor/verify-totp`): keep that, and say so on the page.
- Staff page: a **Two-step sign-in: on/off** column or badge per person (the server adds `twoFactorEnabled` to the staff list; owners only see their own cafe's people).
- Tests: e2e setup and turn-off for an owner and a cashier (mocked API), the code asked at the next sign-in (real server, a seeded account), Staff shows the status, two-cafe isolation for the new field.
- Decision: a new D (how setup is shared with the console; what owners see).

### Step 2: session length by role, and "Your devices"

- 1 day for any account that is an owner, staff member or super admin; 7 days for others. **Needs verification first** (installed `better-auth` ^1.7.7, its current docs, never from memory): whether `databaseHooks.session.create.before` may set `expiresAt` per user, and whether `updateAge` renewal then extends it past the limit (the limit must be absolute: measured from sign-in, not renewed). If the hook can't do it, record the alternative before building.
- A role change after sign-in: removing access already deletes sessions; gaining access mid-session keeps the 7-day session until the next sign-in. Decide whether that's acceptable (likely yes: the server checks every request; record it).
- **Your devices** on the account security page: this browser and the others (device, last used), **Sign out other devices** (Better Auth's session list and revoke endpoints, checked against the installed version).
- Tests: server test that a staff sign-in's session ends after a day and a customer's doesn't; e2e for the devices list and signing others out.

### Step 3: re-confirm before dangerous actions

- A server check (a new access helper beside `requirePermission`, `server/utils/access.ts`) that the session was confirmed within 15 minutes; refused with a clear code (e.g. `CONFIRMATION_REQUIRED`). Confirming: the password, or a two-step code when the account has it. Where the confirmation time is kept (the session row's own field, or a small table) is decided in the step; it must be per session, server-side, and cleared at sign-out.
- The app: `apiFetch`/`useMutation` turns that code into a confirm dialog, then repeats the request once (the request's idempotency key and version unchanged).
- Applies to: `PUT …/admin/khqr`, `PUT/DELETE …/admin/khqr/token`, staff create/update that gives `admin`, console owner add/remove/transfer.
- Tests: each route refuses without confirmation and works after; removing the check fails its test; confirmation expires; another session's confirmation doesn't count.

### Step 4: owners see their staff's access

- Staff list: last sign-in (from Better Auth's sessions) and two-step status. Only this cafe's staff (two-cafe isolation test). No new action: disabling someone already signs them out everywhere.

### Step 5: Switch person on the counter

- Counter user menu → **Switch person**: signs out and shows the counter sign-in at once, keeping the branch in `?redirect=`. No idle auto-lock (the queue must stay visible).

### Later (not planned in detail)

- Two-step required for owners after the grace period (Q1's second half).
- Per-account sign-in limits (many customers share a cafe's Wi-Fi address), "new sign-in" emails to owners.
- A PIN mode for the counter (Q4), only if asked.

## 5. Edge cases to keep in mind

- **Lost authenticator:** backup codes at setup; an owner without them is helped by the platform team. Whether the console can turn two-step off for an account is open question **QA1** (recommended: yes, the platform team only, audited, signing the account out everywhere). Cafe owners can't do it for their staff: one account can work at several cafes.
- **Shared counter tablet with two-step:** counter staff aren't required to use it (Q1), but a staff member who turned it on enters a code at the counter like anywhere else.
- **Support visits (D193):** a super admin on a visit never re-confirms cafe actions: visits are read-only already.
- **Session cut at 1 day mid-shift:** the 401 already sends the person to sign-in with `?redirect=`; unsaved form drafts are kept by the existing draft rules. Check the counter's queue recovers cleanly after re-sign-in.
- **Two tabs:** confirming in one tab should count for the other (same session).
