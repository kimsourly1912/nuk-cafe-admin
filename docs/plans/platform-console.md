# Platform console: people, owners, activity and health (phase P)

The owner asked for a platform console that controls more than cafes (2026-10-19). Today `/platform`
creates a cafe, lists cafes with usage numbers, changes a cafe's address, and pauses or resumes it
(D142, D185). It can't see or act on accounts (owners, staff, customers), can't fix a cafe's
ownership, and shows neither what the platform team did nor whether the platform is healthy. The T2
frame's Overview, People, Activity and System health items were never built. Decision:
[D186](../decisions.md#d186-the-platform-console-manages-the-container-never-the-contents-2026-10-19).

## The boundary (unchanged, D134)

```text
Platform team controls the CONTAINER        A cafe's owner controls the CONTENTS
──────────────────────────────────          ─────────────────────────────────────
cafes: create, address, pause               menu, prices, promotions
accounts: sign-in, ban, sessions            orders, payments, reports
who owns which cafe                         staff and their branch roles
platform activity and health                the cafe's customers and their profiles
```

Every step below stays on the left. A super admin still never reads a cafe's menu, orders,
customers' profiles or reports. Counts and dates are allowed (as on the Cafes list today); contents
are not.

## What comparable platforms do (research, 2026-10-19)

- **Support access is granted by the customer, never taken.** Shopify collaborator requests,
  Zendesk Account Assumption, Atlassian Statuspage access grants, Zoho and Simployer: the account's
  owner turns access on, it ends by itself (24 hours to 14 days), and the owners are told.
  ([Atlassian](https://support.atlassian.com/statuspage/docs/customer-data-access-grants-information/),
  [Simployer](https://mysupport.simployer.com/en/support/solutions/articles/201000129288-how-simployer-support-accesses-your-account),
  [Zendesk](https://support.zendesk.com/hc/en-us/articles/4408830808474/comments/5329349123994))
- **Impersonation safeguards:** step-up 2FA before it starts, a short session, a banner the whole
  time, every action audited, never a higher-privileged account.
  ([dev.to](https://dev.to/ideasasylum/implementing-impersonation-10g0),
  [OctopusPro](https://help.octopuspro.com/user-impersonation-login-as))
- **Audit records the scope** (platform or which tenant), not only the actor. `audit_events.tenant_id`
  already does (`null` = the platform's own).
- **Better Auth's `admin` plugin** has ban (reason, expiry), session revocation and impersonation
  ([docs](https://better-auth.com/docs/plugins/admin)). We use its fields (`banned`, `ban_reason`,
  `ban_expires`) but write through our own routes (below).

## Rules every step follows

- **Our routes, not Better Auth's admin endpoints.** Every platform write is one `db.batch` with its
  guards and its `audit_events` row (`tenant_id` null and `platform.account.*` for an account
  action; the cafe's id and `tenant.*` for an action on a cafe, as since D142). Better Auth's `/api/auth/admin/*` endpoints write
  without our audit row or version guard. P1 removed the `superadmin` role's `user`/`session`
  grants (D187; a test shows the endpoints refused), so the console is the only way in.
- **Versions:** every account and cafe edit sends the version read (409 on stale), as staff edits do
  (`user.updatedAt`).
- **No deletion.** No account delete, no cafe delete: ban and pause instead. Orders and ledgers are
  never deleted.
- **Reasons:** ban, unban, ownership changes and temporary passwords ask for a reason (required,
  max 500 characters), stored in the audit row's metadata. It's for the platform team, never shown
  to the customer.
- **Self-protection:** a super admin can't ban themselves, can't change their own role, and can't
  ban another super admin from the console (a second super admin is set by hand, as today).
- **Two-cafe tests** wherever a query takes a cafe; a guard-removal test for every new guard.

## Owner decisions taken with this plan (2026-10-19, "go with your recommendations")

1. **Banning an owner doesn't pause their cafe.** Ban acts on the account, pause on the cafe. A cafe
   whose owners are all banned keeps serving customers; its page in the console says **No active
   owner** and offers Add owner (P2). Staff changes in that cafe wait for an owner (the existing
   `requireAnOwner` guard already counts only unbanned owners).
2. **A super admin may transfer or add ownership alone,** with a required reason (the owner's
   request, or "owner unreachable"). It's audited. Telling the cafe waits for email (Q4).
3. **The account page shows name, email, sign-in facts and which cafes the account works in**
   (owner/staff, from memberships). It **doesn't** list the cafes a customer has ordered from or
   has a profile in: that is order data.
4. **Super admins sign in with 2FA** (Better Auth `twoFactor`, an authenticator app), required for
   `/platform` from P1b on.
5. **Support access (impersonation) stays off** until there is a support process (QP1). When built,
   it is granted by the cafe's owner, never taken.

**QT4 answered (owner, 2026-10-19): a super admin may be a cafe's owner** ([D190](../decisions.md#d190-a-super-admin-may-be-a-cafes-owner-qt4-answered-2026-10-19));
never one's own ownership changed from the console (D189). Still open: **QP1** (the support process, blocks P5). Mockups per step: the owner says per step
whether there's a mockup round (T2a skipped it, D185 used an owner frame); the screens otherwise
follow the page patterns and Nuxt UI defaults (D142).

## Steps (one PR each)

| # | Step | Done when |
|---|---|---|
| P1 ✅ | **Accounts**, merged (PR #140) (D187; owner: no mockup round). Platform nav **Accounts**: every registered account (guests excluded), search by name or email (`instr`, D183), tabs Owners, Staff, Customers, Super admins, Banned, pages, newest first. An account page: email and verified, joined, open sessions and the latest activity, the cafes it works in with the role and "Only owner", the ban with its reason and end. **Ban** (reason, until unbanned or 1/7/30 days; sessions deleted), **Unban**, **Sign out everywhere**, **Set temporary password** (as D115). Never one's own or a super admin's. Better Auth's `user`/`session` grants removed from `superadmin`; platform statement `account: ['read', 'ban', 'sign-out', 'reset-password']`; the owner picker's search moved to `/api/platform/owner-candidates` | Server tests (every refusal, version 409, in-batch guards against a role or ban that didn't move the version, ban ends sessions and blocks every workspace, an expired ban lifted at sign-in, Better Auth's endpoints refused), real-D1 search test; e2e for the list, the page and each action at 390/1440 with axe in light and dark |
| P1b ✅ | **2FA for super admins**, merged (PR #141) (D188): Better Auth `twoFactor` (an authenticator app, ten backup codes), setup required before any other console page, the code step on every sign-in (console, admin, counter, customer account) because 2FA belongs to the account; turning it on signs out other devices; recovery by hand | Server tests (the console refuses without 2FA, after the password check; setup, the code at sign-in, a backup code once, other devices signed out); e2e for setup, the code step on all four sign-ins, axe |
| P2 | **Cafe owners**, built, awaiting review ([D189](../decisions.md#d189-a-cafes-owners-and-internal-notes-in-the-console-add-remove-transfer-one-batch-each-2026-10-19); owner: no mockup round). Routes `POST …/tenants/{id}/owners`, `…/owners/{userId}/remove`, `…/owners/{userId}/transfer`, `PUT …/tenants/{id}/notes`; statements `owner: ['add', 'remove', 'transfer']`, `notes: ['update']`; never one's own ownership; table `tenant_notes`. On a cafe's page: **Add owner** (an existing account, the D185 search, or a new account with a temporary password), **Remove owner** (they keep staff access only if they had a branch role; else none), **Transfer ownership** (add the new one and remove the old one in one batch). The batch keeps at least one active owner (`requireAnOwner`). Reason required. The **No active owner** state on the cafe's page and as a Cafes list filter. **Internal notes** per cafe (contact person, phone, notes: platform-only, versioned) | Server tests incl. the last-owner race (two removals at once leave one), two cafes, version 409; e2e |
| P3 | **Overview and Activity.** `/platform` opens on **Overview**: cafes by status, new cafes this month, cafes with no order in 7 days, cafes with no active owner, banned accounts; counts only. **Activity**: every audit row a super admin wrote (`platform.*` on accounts, `tenant.*` on cafes), newest first, filters by actor, cafe, action and date, paged (`audit_events_at_idx`, `audit_events_tenant_idx`). A cafe's page lists the platform's actions on it | Server tests (only the platform's actions; never a cafe's own staff's audit rows); e2e |
| P4 | **System health.** The outbox (waiting, failing, dead, per kind and cafe), scheduled jobs' last run and failures, Telegram deliveries failing per cafe, Bakong token expiry per cafe (dates only, never the token). Read-only; links to the cafe's page. Prepares for QT3 | Server tests (no secret in any answer); e2e |
| P5 ✋ | **Support access**, after QP1: the cafe's owner turns on "Allow platform support" for 24 hours in the admin; the super admin, after a 2FA check, opens the cafe read-only with a banner; every request audited with the grant's id; the owner can end it at any time; it ends by itself. Not Better Auth's plain `impersonateUser` (it acts as a person in all their cafes and needs no consent) | Owner's go on QP1 |

Later, with T3 (QT2): plans and limits per cafe, billing, announcements to owners, per-cafe feature
switches. Several platform roles (support vs super admin) when more than one or two people run the
platform.

## Edge cases to cover

- Banning an account with an order in progress at the counter: the order stays; the account can't
  sign in. Guests (anonymous accounts) are not listed and can't be banned from the console.
- A ban with an end date: Better Auth lifts it at the next sign-in after the end (to verify in P1
  against the installed version); the list shows it as banned until then, with the end date.
- Banning an owner who is the only active owner: allowed (decision 1), with a warning in the
  confirmation naming the cafes left without an owner.
- Two super admins acting on one account at once: the version guard; the second gets 409 and reloads.
- A temporary password for a banned account: refused (unban first).
- Removing an owner who is also signed in to the admin: their sessions end in the batch, as staff
  disable does.
