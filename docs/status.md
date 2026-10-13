# Status

> **Purpose:** the current state, the next steps and the open questions. Read it to know what is done, what is next and what waits on the owner. Completed-step history: [archive/progress-2026.md](archive/progress-2026.md) (history, not current behavior). How a change is verified and the test pitfalls: [how-to-verify.md](how-to-verify.md).

_Last updated: 2026-10-13. Content as of the last entry of the former `docs/progress.md` (step 10.28, D166)._

> **Where the old `docs/progress.md` went:** current state, next steps, open questions and known limitations are in this file; "Verification levels", "How to verify" and "Environment notes" are in [how-to-verify.md](how-to-verify.md); the completed-step narratives (the Foundation and Features tables, closed step rows, the history paragraph) are in [archive/progress-2026.md](archive/progress-2026.md).

## Current state

**Not built yet:** no production environment (staging runs on Cloudflare, steps 2.1–2.2); no live pushes (polling, D114). The customer site is server-rendered (D95); the admin stays a SPA.

Everything else (loyalty, vouchers) is not started; it is built in the numbered steps below. Community posts, carbon and banners from the old API have no product design and are out of scope until the owner asks for them.

### What exists, one line per feature

_Written for this file from the Features table and the step rows in the archive; the long versions with their verification are in [archive/progress-2026.md](archive/progress-2026.md)._

- **auth** (staff sign-in, forced password change): done, D52 · [auth](reference/auth.md)
- **staff**: done, D49, D52; reset a password 10.1, D115 · [security](server/security.md)
- **categories** (the reference feature): done, D69 · [public API](reference/features.md)
- **availability-rules** ("Availability"): done, D66, D76 · [plan](plans/availability-rules.md)
- **option-sets** ("Options"): done, D67, D73 · [plan](plans/option-sets.md)
- **modifier-groups** ("Add-ons"): done, D68, D75 · [plan](plans/modifier-groups.md)
- **products** ("Menu items"): done, D70, D90; Reorder 10.3, Duplicate 10.22, photos 10.26 to 10.26d (10.26e awaiting review) · [plan (historical)](plans/products.md)
- **branches** ("Branch"): done, D91, D92 · [plan](plans/branch-settings.md)
- **menu** (the customer menu): done, D93, D124 · [blueprint](plans/system-blueprint.md)
- **account** (the customer's account): done, D97 · [auth](reference/auth.md)
- **orders** (customer orders and tracking): done, D100, D114; guests D156, "ready" message on Telegram D157 · [plan](plans/order-tracking.md)
- **counter** (the cashier's workspace): done, D102, D105, D117 · [blueprint](plans/system-blueprint.md)
- **exchange-rates** ("Payments", KHQR at the counter): done, D102, D130, D131; token expiry 10.16 (D132) and each cafe's own token T2d (D148) awaiting review · [plan](plans/khqr.md)
- **reports**: done, D110, D111 · [plan](plans/reports.md)
- **notifications** ("Telegram"): done, D112, D113 · [plan](plans/reports.md)
- **cafe** ("Cafe profile"): done, T2b, D143 · [plan](plans/multi-tenant.md)
- **platform** (the super admins' console, Your cafes): done, T2a to T2c++, D142 to D146 · [plan](plans/multi-tenant.md)
- **sample-data**: done, D94 (local and staging only) · [decisions](decisions-index.md)
- **dashboard** (the admin's home): done, 10.23, D155 · [decisions](decisions-index.md)
- **promotions**: done, M1, D163 · [plan](plans/marketing.md)
- **marketing** ("Channels", posting to a Telegram channel): awaiting review, M2a, D164 · [plan](plans/marketing.md)
- **assistant** (the help assistant): 9.0 and 9.1 done, D108, D109; 9.2 and 9.3 not started · [plan](plans/ai-assistant.md)
- **rewards, vouchers, banners, customers** (loyalty): not started; deferred by the owner (phase 7, D115)

## Known limitations

- Staging runs on Cloudflare (step 2.1): D1 migrations, both batch guards (stale version, last admin) under simultaneous requests, cron triggers and the outbox were verified there. R2 uploads and serving were verified on staging after step 3.2 (upload, byte-identical read-back, object present in the bucket), and the hourly `media:purge-temporary` deleted a backdated upload there (row and object). The CI deploy was checked step by step by hand (same commands, same smoke check); **its first run in GitHub is the merge of the phase 1–2 pull request**. Staging mail uses Resend's test sender, which delivers only to the Resend account's own address, until the sending domain exists (Q4). WAF rate limits need a custom domain (a `workers.dev` address isn't a zone we control); until then only Better Auth's own limits apply.
- The public API is rate limited per client address by Workers bindings (D121: the checkout quote 120 a minute, the rest of `/api/public/**` 600); the WAF rules for `/api/shop/orders` and the edge wait for a custom domain (Q4).
- The menu page `/` is cached for 60 s per Worker instance (D122): sold-out marks, the open state and menu edits can show up to a minute late there; checkout always reads the current menu.
- Uploads: abandoned or replaced images stay as `temporary` assets for up to 24 hours, then `media:purge-temporary` (hourly) deletes them and their R2 objects.
- The dependency audit ignores two advisories by id (owner, D54), each without a patched version: `node-forge` GHSA-86w9-cpqp-85rv (2026-10-02, dev server only) and `braces` GHSA-vfj7-8cjw-p6xm (2026-10-03, the build's file globbing only, not in the built server). Remove each exemption in `pnpm-workspace.yaml` once its package is patched. Since 2026-10-08 (owner) it also ignores `simple-git`'s four (GHSA-x6jw-m9v5-85vh, GHSA-g4wm-2vf7-vfgr, GHSA-858h-whjf-mvg5, GHSA-v5rq-49vh-5v5c): only `@nuxt/devtools` 3 uses it, under `nuxt dev`, and the patched simple-git 4 breaks it; remove once a stable devtools uses simple-git 4. `tinypool` and `sharp` are forced to their patched versions by overrides (their parents pin the vulnerable ones).
- Backups: D1 Time Travel covers the database only (7 days on the free plan); R2 images aren't rolled back by a restore.
- A 409 (someone else saved first) keeps the form open. The menu item editor and the add-on group's settings offer Reload that keeps this person's changes on top of the newer version part by part (D153); Categories, Branch settings and Cafe profile Reload with all of the input on top (D72). No value-by-value merge UI.
- Unsaved-changes comparison treats `1` and `'1'` as different and array order as meaningful (see docs/reference/forms.md).
- List filters in the URL support strings and numbers only, and one URL-synced list per page (`syncUrl: false` for others). See docs/reference/data-fetching.md.
- Data freshness: another device's change shows up only when the user returns to the tab or navigates (no push from the backend). No per-query opt-out yet. Polling only on live screens: the counter queue (D102) and a customer's order in progress (D114); pushes are planned ([plans/live-updates.md](plans/live-updates.md)).

## Next steps (recommended order)

The server follows the **server standard** ([docs/server/](server/README.md), D43; all server code since D71). Each phase gets a short plan before coding and ends with passing tests and an update here.

**How we work:** one step at a time. For each step the agent writes a short plan (for steps marked ✋, it asks first), builds it on its own branch, runs the local checks (lint, typecheck, unit/server tests and the changed feature's e2e files; docs/workflow.md → Checks, D83), updates the docs, opens a PR whose CI runs the full suite, then **stops for review**. A step with new screens first goes through the mockup round ([feature-standard.md → Designing a UI step with mockups](feature-standard.md#designing-a-ui-step-with-mockups-the-owners-workflow)): prompts, the owner uploads frames and says "all uploaded", a review together, then "next" to build. The owner merges when the PR's checks are green. The next step starts only after approval. ✋ marks a step that needs a decision from the owner first (question numbers link to the Open questions table). ✅ marks a step that is done.

_Below: the step rows that are not closed (not ✅, or "awaiting review", or not started). The closed rows are in [archive/progress-2026.md](archive/progress-2026.md)._

### Phase 5: branches and the customer website

| # | Step | Done when |
|---|---|---|
| 5.1 | **Branch settings + dining tables** ([plan](plans/branch-settings.md), D91): **5.1a server** ✅ (settings and hours with one version, tables, QR tokens rebuilt from `NUXT_QR_SECRET` and stored hashed, rotation, `GET /api/public/tables/{token}`; server tests 22, real-server smoke on `pnpm dev`); **5.1b the Branch pages** done, awaiting review (D92) | Tests: unknown or archived tokens rejected |
| 5.3 | **Menu browsing:** categories as tabs, sub-categories as sections, item page with options and add-ons, QR table context: **5.3a** done, awaiting review (D93, with the order before checkout kept in the browser) | e2e |

### Phase 6: orders and counter payment

| # | Step | Done when |
|---|---|---|
| 6.3 | **Counter queue, payment and actions** (owner, 2026-09-29: 6.4 folded in, since recording the payment is what starts preparation, D45): **6.3a server** ✅ (D101: the queue; pay (cash USD, cash riel at the admin-set rate rounded up to ៛100, KHQR) → preparing; ready; complete; cancel (a paid order before ready records how the money went back, Q36); `order_events`; every command versioned and idempotent; the riel rate for admins); **6.3b the pages** ✅ (D102: the counter app at `/counter` with its own sign-in, the queue board (tabs on phones), Take payment (cash with change, riel, KHQR as text), Mark ready, Complete, Cancel with the money returned; the admin Payments page); **6.3c the Sold out page** done, awaiting review (D105: `/counter/<branchId>/sold-out`, stays until switched back per Q37, who and when on each row) | Concurrent-action tests; one payment per order under retries |
| 6.5 | **Order tracking** for the customer (the owner's frames, 2026-09-30): **6.5a server** ✅ (D106: the order's step times, payment and who cancelled; `GET /api/shop/orders`; the customer's cancel while unpaid, guarded like the counter's commands); **6.5b the pages** done, awaiting review (D114: tracking on `/orders/<id>` polled every 10 s, the cancel sheet, Order again, `/orders`, the order bar on the menu; live pushes later, [plans/live-updates.md](plans/live-updates.md)) | e2e |
| 6.6 | **Unpaid-order expiry** task (30 minutes; D45): done, awaiting review (D104: `orders:expire-unpaid` every minute, each order guarded by status and version so a payment at that moment wins, the event with no actor, audit; migration `0016` adds the index) | Task test |

### Phase 10: launch essentials (owner, 2026-09-30, D115)

What a working cafe runs into first, before the optional features. Ordered by the owner's review.

| # | Step | Done when |
|---|---|---|
| 10.5 | **Release check** ([release-check.md](plans/release-check.md)): the blueprint's release scenarios (§8, without the loyalty rows) mapped to the tests that prove them; the gaps filled (signed out at a table QR, wrong-branch writes leave nothing, two staff marking ready at once, completing retried, an upload whose item save fails); a hand check on staging for the owner. Merged (D120). **Hand check 2026-10-01: NOT PASSED** ([result](plans/release-check.md#hand-check-result-2026-10-01-staging-run-for-the-owner-by-an-ai-browser-agent-not-passed)): price change and image discard passed; the database shows one payment per order; a counter hazard found and fixed (a refreshed panel swapped Confirm payment for Mark ready under the click; awaiting review); **blocker: Cloudflare Error 1102**, the Workers Free plan's 10 ms CPU limit (the Paid plan fixes it); Thursday left at 23:20 on staging; the signed-out QR round trip and Ready twice still to do | Every row ✅; the owner's hand check on staging |
| 10.16 | **The Bakong token's expiry** (the owner, 2026-10-02: on the page and on Telegram, D132): read from the token (a JWT's `exp`), shown on Payments ("Token expires 21 Dec 2026 · 80 days left", amber within 14 days, red once expired); Telegram reminders 14, 7, 3 and 1 days before and on the day to the chats with **Server errors and reminders** on, once per token and stage. Done, awaiting review | Server; unit; e2e |
| 10.26e | **The photo editor's layout** (the owner's mockup, 2026-10-11, D162): **Adjust photo** and **How customers see it** as two columns; the tabs beside the title; one toolbar under the frame (**− slider +**, rotate, **Reset**); each preview a card with a grey header (name and shape, **Editing** or **Edit crop**) and a caption (the item page: "The whole photo" or "Cropped to fill"); on phones the previews side by side under the toolbar, the whole editor without scrolling at 390 × 844; **Choose another photo** outlined. Done, awaiting review. **To check on staging:** open Add photo on a computer and on a phone | e2e (`products.test.ts` 60, `accessibility.test.ts`); screenshots 1300/390 |
| 10.27 | **UI fixes** (the owner's report, 2026-10-13, D165): the order drawer's lines scroll at its edge (the scrollbar was 16 px in); Categories and Options' Move up / Move down are chevrons and a moved row slides to its place (`useReorderTransition`, off while dragging and for reduced motion); **AM/PM changes with a tap** in every time field (`<TimeInput>`; a phone's keyboard can't type A or P), `UInputTime` a lint error elsewhere; New add-on group's **Pre-selected** ticks the box clicked (every box had the Add-ons field's id), the promotion editor's branch boxes the same. Done, awaiting review. **To check on staging:** on a phone, Branch → hours: tap AM/PM; New add-on group: tick the second Pre-selected | e2e (`modifier-groups.test.ts` +1, `availability-rules.test.ts` +1, `shop-menu.test.ts` drawer edge; categories, option-sets, branches, promotions) |
| 10.28 | **UI fixes, second report** (the owner, 2026-10-13, D166): **errors leave as soon as they're fixed**, a rule across fields too (`useFormErrorRecheck`, every `UForm`; server errors stay until their field changes); New add-on group's **Pre-selected** boxes in their own fields (no borrowed red); the add-on group page's **Preselected ticks never wait** (the box at once with a spinner, the changes sent in turn on the group's version, `usePreselectQueue`); **chevrons and the slide** on the add-on group's Reorder, Menu items → Reorder and the item form's add-on groups; **drawers padded per part** (only the body scrolls, nothing cut); **a black backdrop** behind modals, slide-overs and drawers; the expected behavior written into the standard (ui.md §17, the checklist, forms.md, AGENTS.md). Done, awaiting review. **To check on staging:** New add-on group: two add-ons with one name, then rename one; At least 2, At most 1, then At least 1; an add-on group's page: tick three Preselected boxes quickly; the order drawer on a phone | e2e (`modifier-groups.test.ts` +3, 41 of 41); the full e2e suite (565 of 566, the one failure this step's own test, fixed and rerun) |

### Phase T: multi-tenant, SaaS-ready (owner, 2026-10-02, D134, [plan](plans/multi-tenant.md))

Other cafes may subscribe to the app. Built **SaaS-ready, not SaaS-complete**: the tenant boundary now, sign-up and billing once the commercial plan is confirmed. **Before any other feature**, because every new table would need reworking.

| # | Step | Done when |
|---|---|---|
| T2d | **Each cafe's own Bakong token** (D148): `bakong_tokens`, the token sealed with AES-256-GCM under the Worker secret `NUXT_BAKONG_ENCRYPTION_KEY` (the cafe's id bound in), its expiry kept in plain; Payments → **Add token / Replace token / Remove token** (sent once, never shown again; at the version read; an expired one refused; "can't be saved on this server yet" without the key); the counter's check, Test connection and the 14/7/3/1/0-day reminders per cafe; a token this server can't open answers `key`; `NUXT_BAKONG_TOKEN` no longer read; migration `0032_bakong_tokens`. server (`bakong-token.service.test.ts` 10, two guards checked to fail when removed) + e2e (`payments.test.ts` +3, the counter on the real server with a sealed token). Done, awaiting review. **Staging needs, in this order:** the platform team sets `NUXT_BAKONG_ENCRYPTION_KEY` (operations.md → KHQR), NUK Cafe's owner pastes the token on Payments, then the old `NUXT_BAKONG_TOKEN` secret is deleted | Server tests; staging |
| T3 ✋ | Self sign-up, plans, billing: after the commercial plan (QT2) | |

### Phase M: marketing (owner, 2026-10-11, D163, [plan](plans/marketing.md))

Promotions and posting them to the cafe's social channels. Posters are made elsewhere and uploaded; channels for now: a Telegram channel and a Facebook Page.

| # | Step | Done when |
|---|---|---|
| M2a | **Post to a Telegram channel** (D164, no mockup round): Marketing → **Channels** (connect a channel: add the bot as an admin, post the `/connect` code shown, confirm; Connected or Bot removed with Reconnect; Disconnect; a Facebook card marked Coming soon); on a promotion's page **Posts** (Sent with View post, Scheduled with Cancel, Retrying, Failed with Try again, Cancelled) and **Post to channels** (channels, the caption started from the promotion, Include the poster, Now or Later up to 30 days, the post as followers see it); scheduled posts by `marketing:deliver-posts` every minute with retries; the **Order now** button opens the menu with the offer (`?promo=`) and marks the next order **from Telegram** (`?src=telegram`, 24 hours, `orders.source`), counted in Results. The webhook asks for `channel_post` by itself. Migration `0037_marketing_channels`. Done, awaiting review. **To check on staging:** create a Telegram channel, Connect a channel, post the code there: the dialog shows the channel; post a live promotion now and at a time; open its Order now link in a private window and order: Results say 1 order from Telegram posts | Server (`marketing.service.test.ts` 21; the claim and Cancel guards checked to fail when removed); unit (`post-form.test.ts` 3); e2e (`channels.test.ts` 7, `shop-marketing.test.ts` 3 on the real server, `accessibility.test.ts` +2, `promotions.test.ts`) |
| M2b | **Post to a Facebook Page**: a Page as another channel kind. **Needs** Meta App Review, Business Verification and a domain (QM1, Q4) | |

**Agreed next features (owner, 2026-10-02), built tenant-aware after T1:** KHQR payment on the customer's phone (reuses 10.15; needs the refund rule for a paid order cancelled), the Telegram "your order is ready" message to customers (a one-time link to the bot), then the shop's location with Directions and a small map (Google Maps Embed, free; maps step A). Later, from the trend review: a stamp card instead of the points ledger (phase 7, owner's decision), pick-up time, "Your usual", Khmer on the customer site.

### Phase 7: loyalty and vouchers (deferred by the owner, 2026-09-30, D115)

Not part of the launch: a small cafe runs without them. The design stays (blueprint §5, D45) for when the owner asks for them.

| # | Step | Done when |
|---|---|---|
| 7.1 | **Points ledger + earn on completion** (paid amount after discounts, rounded down; D45) | Earned once under retries; balance reconciles |
| 7.2 | **Voucher templates** ($ off or free item, 30 days, one per order; D45) | Tests |
| 7.3 | **Exchange points for a voucher** (by the customer on the website; D45) | No double spend under races |
| 7.4 | **Staff-issued vouchers** with reason and audit | Tests |
| 7.5 | **Redemption at the counter** (lookup, redeem; not on one's own voucher) | Last-use race test |
| 7.6 | **Reversals on cancel / refund** (reverse points, restore an unexpired voucher; D45) | Ledger reconciles |

### Phase 9: AI assistant (owner, 2026-09-30: before 6.5b; [plan](plans/ai-assistant.md), D107; options for later: [ai-later.md](plans/ai-later.md))

Admins only, any AI provider by settings (Vercel AI SDK), the AI suggests and a person saves. Each step with screens starts with the mockup round.

| # | Step | Done when |
|---|---|---|
| 9.2 | **Menu item draft from a description:** `/menu-item-draft` (names mapped to existing categories and add-ons, unknown ones listed, prices only when stated), the item editor filled in with an "AI draft" banner | e2e; the quality check's descriptions |
| 9.3 | **Improve wording:** `/rewrite`, 2–3 suggestions for an item's name or description, Use replaces the field (unsaved) | e2e; the quality check's wording cases |

### Phase 8: launch

| # | Step | Done when |
|---|---|---|
| 8.2 ✋ | **Production** (Q4, Q24): environment, domain, email domain (SPF/DKIM), alerts, restore drill, release test scenarios (blueprint §8) | Launch checklist signed off |

## Open questions / waiting on others

Business decisions the build still needs, with the step each blocks. All are for the **project owner**; nothing is built on a guess. Answered questions move to [decisions.md](decisions.md) (the 2026-09-27 round is D45) and out of this table.

| # | Question | Blocks | Suggested default |
|---|---|---|---|
| Q4 | Staging and production domains, and the email sending domain | 2.1, 8.2 | |
| Q43 | The AI provider for production, and a monthly spending cap on its account (D107). **Staging answered (owner, 2026-09-30):** OpenAI, `gpt-5.4-mini`, key set as a Worker secret (first set up as Gemini by mistake: Google refused the OpenAI key) | Production launch of the assistant | OpenAI as on staging; the cap set on OpenAI's side |
| QT1 | The platform's name (working name "NUK Platform") and, later, its domain (D134) | T2 screens | "NUK Platform" until decided |
| QT2 | The commercial plan: prices, trial, what a plan limits (D134) | T3 | |
| Q24 | Acceptable data loss and downtime (RPO/RTO), who receives alerts and when, data retention and erasure periods; **the Workers plan** (the Free plan's 10 ms CPU per request stops the app under use: Error 1102 on staging, 10.5) | 8.2 | Workers Paid (5 USD a month): CPU, 30-day Time Travel. **The plan, deferred by the owner (2026-10-02):** staging stays on the Free plan while the app is still being built; upgrade before real use (Error 1102 under load is expected meanwhile) |
| QT3 | **One Bakong token for every cafe, managed by the platform** instead of each cafe's own (the owner, 2026-10-09: cafe owners aren't technical; one token renewed once, on one day). Idea: a Platform → Bakong page (one sealed token, its expiry, Test connection, Replace; reminders to the super admins), Payments shows "Automatic check: On (managed by the platform team)", the per-cafe token UI of D148 removed. The server already checks a payment went to the cafe's own account and amount, so a shared token can't confirm another cafe's payment. **To verify first:** (1) can one token look up payments to any Bakong account (test: give Brown Bean another Bakong account, pay a small order, see whether NUK's token confirms it); (2) Bakong's rate limits with many cafes on one token | Changing D148 | If (1) holds: one platform token. If tokens are tied to one account: keep a token per cafe, but the platform team pastes it from the cafe's page in the console and the reminders go to the platform |
| Q44 | The refund rule when an order paid by KHQR on the customer's phone is cancelled (who returns the money, how, and how it is recorded) | KHQR payment on the customer's phone | |
| QM1 | **Facebook posting for every cafe** (M2): a Meta app owned by the platform, its **App Review** (`pages_manage_posts`), **Business Verification**, a privacy policy page, and our own domain (Q4). Until then Facebook posting works only for the Meta app's testers (the owner's own Page) | M2 for other cafes | Telegram channels first (no approval needed), Facebook for NUK Cafe as a tester |

### Open questions from the docs reorganization

Raised by the docs reorganization (2026-10-13). The reorganization decided none of them; the owner's answers of 2026-10-13 are recorded under each item. The full record is in `docs/_reorg/` (untracked). Nothing here changed any code or any rule. This section is temporary: it takes this file to about 217 lines against the soft limit of 200, and it goes once the owner has answered.

1. **`expectedRevision`.** The reorganization brief names a rule "`expectedRevision`, 409 on stale edits". The repo has no such name (no match in `.md` or `.ts` files). Its rule is `version` with a 409 `VERSION_CONFLICT` ([architecture.md → Writing data](server/architecture.md#writing-data)), and AGENTS.md uses that wording. **Owner (2026-10-13): keep the repo's `version` and 409 `VERSION_CONFLICT` wording.** Closed.
2. **"No client-supplied policy; no role or email comparisons in endpoints or components."** Named in the brief, **not written in any doc**. **Owner (2026-10-13): not judged in this task.** What the docs do say: deny by default ([security.md](server/security.md)), the tenant never comes from the client, the branch comes from the path. Not added to AGENTS.md. Role comparisons found in non-test code (a plain search; not checked whether any is a violation):
   - `server/features/identity/identity.service.ts:85` `actor.role === 'customer' || !tenantRoles[actor.role].authorize(permissions).success`
   - `server/features/identity/identity.service.ts:108` `actor.role === 'owner'`
   - `server/features/identity/identity.auth.ts:145` `allowUserToCreateOrganization: user => user.role === 'superadmin'`
   - `server/features/identity/staff.repository.ts:110` `query.role === 'admin'` (a list filter)
   - Not app roles: `server/features/notifications/notifications.service.ts:220` (a Telegram chat member's status, `'creator'` / `'administrator'`) and `server/features/assistant/assistant.service.ts:110`, `112`, `113` (chat message roles).
   - **Correction to what this item said before** (about `isAdminPath()`). (a) `isAdminPath()` ([useAuth.ts:20](../app/features/auth/composables/useAuth.ts)) is a URL helper, not a role check, and it is true only for `/c/<slug>/admin…` paths (it calls `splitTenantUrl`, whose pattern is `/c/<slug>`; [tenant-path.ts:9](../app/utils/tenant-path.ts)): a bare `/admin/x` gives false. AGENTS.md ("every admin page (`/admin/**`)"), [auth.md](reference/auth.md) and [app-behavior.md](reference/app-behavior.md) ("every path outside `/admin`") use `/admin/**` as a shorthand for `/c/<slug>/admin/**`; only [app-conventions.md → Paths](app-conventions.md) says so. Left as written. (b) "In `app/` there is no `role ===`" is literally true, but `app/` does compare the strings `'admin'` and `'customer'`, never on the signed-in user's role: `workspace === 'admin'` (`CafesPage.vue:121`, `:122`, `CafeSwitcher.vue:24`, `app/utils/account-cafes.ts:25`: which workspace a link opens) and `by === 'customer'` / `by.kind === 'customer'` (`orders/utils/order.ts:113`, `counter/utils/finished.ts:37`, `:48`: who performed an order step). Searched in `app/` and `shared/`: `role ===`/`!==`, `=== 'owner'|'admin'|'superadmin'|'customer'|'manager'|'cashier'`, `.includes('owner'|'admin')`, `email ===`. **Not searched:** those other forms in `server/`; role checks written another way (a lookup table, `switch`).
3. **Add a clarifying-question rule?** The brief names "ask one clarifying question if the request lacks location or permission rules"; **no doc says it.** **Owner (2026-10-13): add no new rule; keep only the existing AGENTS.md wording** ("Settle any unresolved business or permission rule first, or defer that behavior; never encode a guess", under "Adding a full stack feature"). **Open question for the owner: should a clarifying-question rule be added?** If yes, say where it applies (every task, or only new features) and what counts as "lacking" location or permission rules.
4. **Statuses that disagree.** The rows below say "awaiting review" (so they stay under Next steps), while another source says the work is done and merged. **Owner (2026-10-13): not guessed; the rows are kept as written; the owner will decide.** Line numbers: `status.md` is this file; `progress.md` is `docs/_reorg/original/progress.md` (identical to `docs/progress.md` at commit `327e4cd`); `archive` is [archive/progress-2026.md](archive/progress-2026.md).

   | Row | The row says (`status.md` · `progress.md`) | The other source says | Git (full history fetched) |
   |---|---|---|---|
   | 5.1 | L68 · L156: "**5.1b the Branch pages** done, awaiting review (D92)" | `progress.md` L3 (archive L5): "step 5.1b, the Branch pages, D92, merged"; L82 (archive L72): "**done** (5.1b, D92, the owner's mockups)" | `ac9dc21` "Add the Branch pages…" (the row's last edit) entered `main` by merge `6088674`, PR #36, 2026-09-29 |
   | 5.3 | L69 · L158: "**5.3a** done, awaiting review (D93" | L3 (archive L5): "step 5.3a, the customer menu and the admin under `/admin`, D93, merged"; L83 (archive L73): "**done** (5.3a, D93, the owner's mockups)" | `8e54d00` (the row's last edit) and `91a9dc8` by merge `0794355`, PR #37, 2026-09-29 |
   | 6.3 | L75 · L166: "**6.3c the Sold out page** done, awaiting review (D105" (6.3a and 6.3b are ✅ in the same row) | L3 (archive L5): "step 6.3c, the counter's Sold out page, D105, merged"; L86 (archive L76): "**Sold out** (`/counter/<branchId>/sold-out`, 6.3c, D105)" | 6.3c `f0b0355` (the row's last edit) by merge `54a216c`, PR #47, 2026-09-30. For reference 6.3b `3e33350` by `0dc9a44`, PR #45 |
   | 6.5 | L76 · L168: "**6.5b the pages** done, awaiting review (D114" (6.5a is ✅) | L3 (archive L5): "step 6.5b, order tracking pages, D114, merged"; L85 (archive L75): "**Tracking** (6.5b, D114" | `eaa6f7a` "Add order tracking pages…" (the row's last edit) by merge `80deff9`, PR #60, 2026-10-01 |
   | 6.6 | L77 · L169: "done, awaiting review (D104: `orders:expire-unpaid` every minute" | L3 (archive L5): "step 6.6, the unpaid-order expiry task, D104, merged"; the Server row, L25 (archive L16), lists "the unpaid-order expiry task, D104" among what is built | `53339fb` "Cancel unpaid orders automatically after 30 minutes" (the row's last edit) by merge `c24b6ee`, PR #46, 2026-09-30 |

   What the history shows: in all five rows the last edit is the step's own commit, written before the merge, and nobody edited the row afterwards; the history paragraph's "merged" was added by later commits (5.1b: `8e54d00`; 5.3a: `ea207f3`; 6.3b: `53339fb`; 6.3c: `3a10151`; 6.5b: `ee77042`; 6.6: `f0b0355`). The same pattern holds for the other rows marked "awaiting review" (this table does not change them): 10.5 `24bb056` merged by `92079b3` (PR #65; the row itself also says "Merged (D120)"), 10.16 `0a48271` by `6ad0fdd` (PR #79), T2d `6c36486` by `1a06766` (PR #97), 10.26e `1592e9b` by `188ef2d` (PR #109), M2a `4253308` and `ac0e157` by `6a3c32b` (PR #111), 10.27 `d627b62` by `d27594d` (PR #112), 10.28 `9e4d0ed` by `327e4cd` (PR #113). A merge shows the code is in `main`; it does not show whether "awaiting review" also meant the owner's hand check on staging (several rows say "To check on staging"). Which meaning is true is the owner's call.
5. **"Start every session here" is a candidate for removal.** AGENTS.md "Resuming work", item 1 (retargeted from `progress.md` to this file) tells every session to start in `status.md`. **Owner (2026-10-13): kept as written for now; the real cost will be measured first.** Estimated cost: this file is about **9,700 tokens** now (characters ÷ 4; no tokenizer was run), of which about 3,600 are this temporary section and about 6,100 are the rest. That comes on top of the about 4,400 tokens that `CLAUDE.md` and `AGENTS.md` already load, so following item 1 makes a session's fixed reading about 2.4 times (without this section) to 3.2 times (with it) what the two entry files cost alone; the old `progress.md` cost about 32,000 on every session. Removal would leave the task-to-doc index to say when this file is needed ("Checking current status or next steps").
6. **Duplicated content, kept on purpose.** **Owner (2026-10-13): keep the duplicates; do not merge them in this task; a later task decides which copy wins.** Each duplicated rule, where it is, and whether the wording differs (L = line; "verbatim" means the same words; found by comparing every paragraph and table row of the docs, then reading the pairs):

   | Rule | Copies | Wording |
   |---|---|---|
   | The task-to-doc index (16 rows) | `CLAUDE.md` L15–32, `AGENTS.md` L11–28 | verbatim (the brief asks for both; a Claude Code session loads it twice, about 700 tokens) |
   | Deny by default; the actor; no tenant from a body; the branch id from the path; a `version` on every editable record | `AGENTS.md` L57–61, quoted from `security.md` L101, L99, L100, `architecture.md` L44, L217 | L57, L58, L61 verbatim; L59, L60 are excerpts of longer paragraphs (the originals add sentences) |
   | Concurrency engine in `app/utils/mutation.ts`, tested in `mutation.test.ts` | `app-conventions.md` L72, `reference/mutations.md` L12 | differs (same facts, different sentences) |
   | Calls are never cancelled on unmount | `app-conventions.md` L60, `reference/mutations.md` L321 | differs |
   | `useMutation` options (`key`, `lock`, `undo`, `batch`) | `app-conventions.md` L46–53, `reference/mutations.md` L84–184 | differs; mutations.md is the fuller version |
   | `executeMany`, bulk actions, Retry failed | `app-conventions.md` L58, `feature-standard.md` L178, `reference/mutations.md` | differs |
   | Form modals stay open while saving; Reopen with the draft | `app-conventions.md` L65, `feature-standard.md` L219 | differs |
   | Errors leave as soon as they're fixed (`useFormErrorRecheck`, D166) | `app-conventions.md` L67, `reference/README.md` L197, `reference/forms.md` L11 and L267, `reference/ui.md` L242, `ui-review-checklist.md` L63 | differs (five wordings) |
   | Reload after a 409 (`mergeFormChanges`, D153) | `reference/README.md` L188, `reference/forms.md` L10, `status.md` L51 | differs |
   | Query invalidation, other tabs, 30 ms merge | `app-conventions.md` L33, `reference/data-fetching.md` L280, `reference/app-behavior.md` L89 | differs |
   | Step back when the last item on a page is deleted | `app-conventions.md` L70, `feature-standard.md` L179, `reference/data-fetching.md` (recipe) | differs |
   | Thin route files (`definePageMeta` with `title` plus one page component) | `app-conventions.md` L20, `feature-standard.md` L116 | differs (short form in feature-standard) |
   | Dropdowns: `RecordSelect` for records, `USelect` for fixed sets (D126) | `app-conventions.md` L94, `reference/README.md` L201, `reference/ui.md` L206, `reference/ui-helpers.md` L524 | differs |
   | Icons bundled at build time, literal icon names (D18) | `app-conventions.md` L92, `reference/app-behavior.md` L387 | differs (app-behavior adds why a built name renders blank) |
   | Rendering: the customer site is server-rendered, the rest are SPAs (D95) | `app-conventions.md` L82, `reference/app-behavior.md` L228 | differs: app-behavior lists `/orders` and `/orders/**`, app-conventions only `/orders/**` |
   | A record's name opens it (stretched button, D152) | `app-conventions.md` L80, `reference/page-patterns.md` L78 | differs |
   | Page anatomy: a `UDashboardPanel` | `app-conventions.md` L85, `reference/responsive-layout.md` §5, `plans/ui-standardization.md` L68 | differs (the plan records that AGENTS.md only links to the anatomy) |
   | Light by default; semantic tokens only (D96) | `app-conventions.md` L83, `reference/ui.md` L56 | differs |
   | "Nuxt UI is the component design system; Tailwind tokens are the layout and styling language" | `AGENTS.md` L37, `ui-review-checklist.md` L5, `responsive-layout.md` L7, `page-patterns.md` L7 | near-verbatim (one sentence, four copies) |
   | The customer site never reads the admin session (`isAdminPath`, D93) | `AGENTS.md` L120, `reference/auth.md` L74, `reference/app-behavior.md` L187 | differs; also the `/admin` shorthand of item 2 |
   | Before a PR: lint, typecheck, tests | `workflow.md` L23, `feature-standard.md` L294 (definition of done) | **differs in substance**: workflow says `test:unit` plus the changed feature's e2e files, feature-standard says `pnpm test` and `pnpm build` for config changes |
   | Paths and surfaces | `app-conventions.md` L9, `server/architecture.md` L39 | **conflict**: app-conventions says pages live under `/c/<slug>/…`; architecture says the admin lives under `/admin`, the counter under `/counter` (written before D141, which put the cafe in the path) |
   | Roles and branches | `server/README.md` L24, `server/security.md` L30, `AGENTS.md` L119 | **conflict**: the README lists a platform `admin` plus branch `manager`/`staff`, and security.md says a branch is a Better Auth organization; D135 (`decisions.md` L1532, L1535) made the cafe the organization, replaced the global `admin` role with the tenant role `owner` and moved branch staff into our `branch_staff` table, and AGENTS.md follows D135 |
   | Library first (Better Auth, NuxtHub, Cloudflare before our own code) | `server/README.md` L44, `plans/system-blueprint.md` L50, `server/security.md` ("What the libraries do") | differs |

   The three rows marked **differs in substance** or **conflict** are not just duplicates: the copies disagree. Not fixed here.
7. **The task index appears in both `CLAUDE.md` and `AGENTS.md`** as the brief asks (see the first row of item 6). Kept.
8. **`docs/decisions-index.md` statuses (fixed, review the `unclear` list).** The first version marked every entry `active` unless it said "superseded by Dn". Now each of the 166 entries is `active`, `superseded` (with the replacing D-number when stated) or `unclear` (the text does not say; **not** `active`), judged only from the text of `decisions.md`. **Counts: 1 `active` (D96), 8 `superseded` (D1–D6 by D39, D32 and D33 by D41), 157 `unclear`.** Of the 157: 14 are partly replaced or amended by a named later entry (D27, D35, D36, D40, D41, D45, D51, D65, D72, D74, D77, D78, D100, D165); 124 are cited by at least one current doc; 2 are named only by a later entry (D20, D159); 17 are cited by no doc and named by no later entry (D7, D9, D10, D11, D12, D15, D17, D23, D24, D25, D26, D38, D56, D116, D118, D154, D161), the likeliest to be stale. The full list, the method and the signals are in `docs/_reorg/decision-status.md`; the index has a "Status basis" column. Spot-check of the summaries: faithful but mechanical (two start mid-thought; D22's was empty, now fixed). **Owner: review the `unclear` list.**
9. **`docs/_reorg/`** (inventory, coverage report, verification, decision-status, the original files) is untracked and not committed. **Owner (2026-10-13): keep it, untracked, for now; decide after the final report.**

## Verification evidence

- How each kind of evidence is labeled (unit, server, browser-mock, real-server, unverified) and the real-server recipe: [how-to-verify.md](how-to-verify.md).
- What was verified and how, per step and per feature (Foundation and Features tables, step rows): [archive/progress-2026.md](archive/progress-2026.md).
- A feature's decisions and their "Verified" lines: [decisions-index.md](decisions-index.md), then the entry in [decisions.md](decisions.md).
