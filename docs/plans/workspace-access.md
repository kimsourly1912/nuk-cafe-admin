# Workspace access: who may open which door, and what a refusal shows

Status: **draft for the owner's review (2026-10-30).** Nothing past D239's first slice is built until the questions below are answered, except page access inside a workspace (§7 steps A–B), which needs no answer: A and B are done (D240). Related: D52 (admin is owners only), D97 (one session per browser), D102 (counter), D135 (platform team never opens cafe data), D142 (console), D144 (Your cafes), D156 (guests), D188 (two-step sign-in), D193 (support access), D238 (first load), D239 (refused sign-in panel, in progress).

## 1. The pieces

**Accounts** (one Better Auth session per browser holds exactly one of these):

| Id | Account | What the server lets it open |
|---|---|---|
| A | Signed out | Customer site, account pages |
| B | Guest (D156: signed in by Place order, no email) | Customer site; counts as signed out everywhere else |
| C | Customer (an account with no role) | Customer site, account pages, Your cafes (empty) |
| D | Branch staff or manager of **this** cafe | This cafe's counter |
| E | Owner of **this** cafe | This cafe's admin and counter |
| F | Owner or staff of **another** cafe only | That cafe's admin/counter |
| G | Platform team (super admin), no cafe | The console; a cafe's admin read-only during a support visit (D193) |
| G+E | Platform team that also owns this cafe | Everything E has, plus the console |
| T | Any staff/owner/platform account on a **temporary password** | Only its own workspace's change-password page |
| X | Banned account | Nothing (401) |

**Doors:** the customer site and account pages (`/c/<slug>`, `/sign-in`, …), the cafe **admin** (`/c/<slug>/admin`), the **counter** (`/c/<slug>/counter`), the platform **console** (`/platform`), and **Your cafes** (`/cafes`).

**Ways to reach a door:** (a) arriving signed out; (b) **arriving already signed in** (pasted link, bookmark, PWA icon); (c) signing in on that door's form, incl. after the two-step code; (d) losing access mid-session (role removed, cafe paused, banned, support visit over); (e) another tab changing who is signed in.

## 2. How other products handle it

- A 403 after sign-in is usually "**wrong account**", not "you're blocked": Canva tells people to sign in with the account the link was sent to; 2i2c separates "this account isn't allowed" from "you signed in with the wrong one" and fixes the second with sign out and choose again.
- **Name who is signed in and give a one-tap way out.** A sign-in redirect with no sign-out option is a known complaint (Apigee community: users had to find the sign-out URL or clear cookies); Cisco SecureX users were stuck because each visit signed them straight back in; Nolt users asked for an in-page "switch account".
- **Send people to the door they can use.** Google Admin sends a signed-in non-admin to their normal dashboard and tells them to ask an administrator; Shopify's "no access to this store" points to the account it is signed in with and to the store owner.
- **A bare "no access" page with nowhere to go is a dead end**: the UK Department for Education team who shipped one called it interim, since users couldn't find how to get access.
- **Security:** say "not allowed" (403) only to an account that proved who it is, and don't reveal more than that account may know. Before sign-in, an unknown resource is just "not found".

## 3. Principles proposed

1. **The server decides; the app only picks words and links.** Every link the panel offers leads to a door that checks again.
2. **A correct password at the wrong door isn't punished.** The account sees who is signed in, why this door refuses it, the door it *can* use, and **Use another account**. One shared panel (`<WorkspaceRefused>`) at every staff door: admin, counter, console.
3. **Arriving already signed in never shows a form that would refuse the account again.** The door's sign-in shows a skeleton until it knows (D238), then the panel or the form.
4. **Only the account's own facts.** The panel names the current cafe (public) and the account's own cafes; never other people or other cafes.
5. **Shared devices are never left without a way out.** Use another account is always there; where keeping the session has no benefit, sign out (see Q1).
6. **Unknown or paused cafe first.** "Cafe not found" / "This cafe is paused" come before any identity check (as today).

## 4. The matrix (proposed)

`panel → X` means `<WorkspaceRefused>` with X as the primary action and Use another account below it. ✅ = opens. Rows marked **change** differ from the code before D239.

### Cafe admin (`/c/<slug>/admin`)

| Account | Arriving signed in (b) | Signing in here (c) |
|---|---|---|
| A, B | form | ✅ if E, else as the row for that account |
| C customer | panel, nothing to offer: "Only <cafe>'s owners use the admin app" (**change**) | signed out, "This account doesn't have access to the admin app" (**Q1**) |
| D staff/manager here | panel → **Open the counter** (**change**) | panel → Open the counter (**change**) |
| E owner | ✅ | ✅ |
| F other cafe | panel → **Your cafes** (**change**) | panel → Your cafes (D144) |
| G platform | panel → **Open the platform console**, "with the owner's permission, look at a cafe from the console" (**change**) | same (**change**) |
| G+E | ✅ | ✅ |
| T on temporary password | E: ✅ → change-password page. Others: as their row (the door they're sent to asks for the new password) | same |
| X banned | form | the sign-in error (verify Better Auth's banned message, **E7**) |

### Counter (`/c/<slug>/counter`)

| Account | Arriving signed in | Signing in here |
|---|---|---|
| C, G without cafe | panel, nothing / → console (**change**) | C: signed out (**Q1**); G: panel → console (**change**) |
| D, E | ✅ | ✅ |
| F | panel → Your cafes (**change**) | panel → Your cafes |

### Platform console (`/platform`)

| Account | Arriving signed in | Signing in here |
|---|---|---|
| C customer | today: the form, then signed out on sign-in. Proposed: panel "This account isn't on the platform team", → **Back to home** (**Q2**) | signed out (**Q1**) or panel (**Q2**) |
| D, E, F cafe staff/owners | today: same. Proposed: panel → **Your cafes** (**Q2**) | today: signed out. Proposed: panel → Your cafes (**Q2**) |
| G | ✅ (two-step setup forced first, D188) | ✅ |

### Customer site and account pages

| Account | Behavior |
|---|---|
| Anyone with a real account | May sign in; one session for the whole browser (D97). Signed in and opening `/sign-in`/`/sign-up`: skeleton, then on to the return page (done, D238 follow-up) |
| T staff on a temporary password | Today: signed out, "This account still has a temporary password". Proposed: keep it, plus a link to **its workspace's change-password page** (**Q3**) |
| G platform | May order like a customer (nothing stops it today; **Q5**) |

### Your cafes (`/cafes`)

| Account | Behavior |
|---|---|
| A | sign in first (`?redirect=/cafes`) |
| C | "This account doesn't work at a cafe" |
| G | same, plus **Open the platform console** (**Q5**) |
| D, E, F | their cafes with Admin/Counter buttons |

### Inside a workspace: which pages each account opens

The doors above decide who gets into a workspace; once inside, each page needs its own permission. The server checks every request either way (D134); this is what the app shows.

| Account | Page | Behavior |
|---|---|---|
| E owner | any admin page | ✅ (an owner holds every admin permission) |
| G on a support visit (D193) | menu, reports, Cafe profile, Payments, Telegram, branches, Staff | ✅ read-only; a save is stopped by `useMutation`'s `readOnly` |
| G on a support visit | Platform support, Sample data | not in the sidebar; the address shows **No access to this page** → Back to dashboard (**done, D240**) |
| D staff | the counter's Dining tables and Reports (D198) | not in Manage; the address shows **No access to this page** → Back to the counter, no request sent (**done, D240**) |
| E owner also listed as staff at a branch | the counter's manager tools there | ✅ (an owner holds every branch permission; before D240 the menu hid them by the `staff` role) |
| D staff/manager | another branch's counter (`/counter/<id>`) | the server's 404 on the page (unchanged; the session's list may be older than a new branch) |
| D manager → staff mid-session | Dining tables open | the next request's 403; after the session is read again, the refusal page |

## 5. Edge cases to cover

- **E1 Two-step sign-in:** the refusal comes after the code (super admins always have it): the panel after Verify. Covered by `finishLogin`/`finishSignIn`; add a test.
- **E2 Access removed mid-session:** removing a role deletes the sessions → 401 → the sign-in form with `?redirect=` (as today). A role changed without deleting sessions answers 403 `NOT_ADMIN` → sent to the sign-in → the panel (arrival rule).
- **E3 Another tab changes the account while the panel shows:** the panel's "Signed in as" goes stale. Re-check on `app:session-changed` (auth-sync) and redraw.
- **E4 The account-list check fails** (network) **at sign-in:** today the session is signed out as if nothing were offered. Proposed: keep it and show the panel with **Try again** (**Q4**). On arrival a failure already falls back to the form.
- **E5 The door's own check failed for a reason other than 403** (owner on a bad network): the arrival check sees the cafe list says this door opens → the form, never a wrong "no access" (built).
- **E6 Paused cafe:** its pages answer "This cafe is paused" before any sign-in; a paused cafe is never offered as a way on (built: active cafes only).
- **E7 Banned account:** Better Auth refuses the sign-in itself; check what the form shows (`BANNED_USER` message) and that no panel appears.
- **E8 Support visit ended (D193) while in the admin:** the next request is refused → sent to the sign-in → panel → console. Check the wording fits.
- **E9 A guest's session on the device** when staff sign in at a door: Better Auth replaces the anonymous session; the guest's device-only orders (D156) are no longer reachable on that device. Pre-existing; record, no change.
- **E10 `?redirect=` survives** Use another account (form keeps it) and is ignored for another door (the panel's links never carry it).
- **E11 Installed app (D204):** the panel's links leave the workspace's scope and open with the browser's bar. Acceptable.
- **E12 Rate limits:** the extra reads (`get-session`, `/me/cafes`) happen once per refusal or arrival; `/me/cafes` isn't rate limited per account. Fine.
- **E13 Information:** the panel never says whether an email exists before a correct password (the refusal comes only after one).

## 6. Questions for the owner

- **Q1 Sign out when the account has nothing to do at this door** (a customer signing in at the admin, counter or console)? *Recommended: yes, at sign-in only.* That person just typed a password on a staff device; keeping the session gains nothing and risks leaving a customer's session on a shared tablet. On arrival (they were already signed in elsewhere on purpose) show the panel and don't sign out.
- **Q2 The platform console gets the same panel?** A non-team account stays signed in and is offered Your cafes (or Back to home). *Recommended: yes*, for one rule at every staff door.
- **Q3 Staff on a temporary password at the customer sign-in:** keep signing them out, or keep the session and link to their workspace's change-password page? *Recommended: link.*
- **Q4 When the account-list check fails at sign-in:** keep the session with Try again? *Recommended: yes.*
- **Q5 Platform team accounts as customers and on Your cafes:** allowed to order (as today), and Your cafes links them to the console? *Recommended: yes to both.*

## 7. Steps

Not waiting for the owner (page access inside a workspace):

- **A. Admin pages name their permission (done, D240).** `permission` route meta, checked by `auth.global.ts`, the sidebar filtered by it, **No access to this page**.
- **B. Counter pages (done, D240):** `/counter/me` sends each branch's permissions (from `branchRoles` on the server, as `adminSession` does for the admin); counter pages name a branch permission (`table:manage`, `report:read`); `counter.global.ts` checks the branch in the path; the counter menu reads the same meta instead of `role !== 'staff'`.

Once the questions are answered:

1. Finish the cafe doors (admin, counter): the built slice of D239 plus E3, E4 and the two-step test.
2. The console door with the same panel (Q2).
3. Customer sign-in for temporary passwords (Q3) and Your cafes for the platform team (Q5).
4. Tests: one e2e per matrix row group (mocked API), real-server tests for D at the admin, F at the admin, G at the admin (needs a seeded super admin with two-step sign-in), C at the console; each new guard removed once to see its test fail.
5. D239 rewritten as the final rule; app-behavior gets the matrix's rows; this plan marked done.
