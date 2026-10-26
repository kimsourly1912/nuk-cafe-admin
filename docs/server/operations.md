# Operations

← [Server standard](./README.md)

- [Environments](#environments)
- [Configuration](#configuration)
- [Migrations](#migrations)
- [Deploys](#deploys)
- [Backups and restore](#backups-and-restore)
- [Scheduled jobs](#scheduled-jobs)
- [Email](#email)
- [Monitoring](#monitoring)
- [Platform facts](#platform-facts): what the stack does and doesn't do for us

---

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| Runs | `pnpm dev` | Cloudflare Worker | Cloudflare Worker |
| Database | SQLite in `.data/db` | its own D1 | its own D1 |
| Files | `.data/blob` | its own R2 bucket | its own R2 bucket |
| Cache | local | its own KV (when a feature needs it) | its own KV |
| Deployed | | on every merge to `main` | manually, from a commit that passed staging |
| Data | disposable, seeded | test data only, reset freely | real |
| Address | `http://localhost:3000` | https://staging.angder.app | https://angder.app |
| Email | logged to the console, not sent | Cloudflare Email Sending from `staging@mail.angder.app` (any recipient: staging holds test accounts only) | Cloudflare Email Sending from `no-reply@mail.angder.app` |

Nothing crosses environments: no production data in staging, no shared secrets, no shared buckets.

### Build toolchain

`package.json` declares patched Node 24 (`engines.node: ^24.22.1`) and exact pnpm (`packageManager: pnpm@12.15.0`). The checked-in staging pipeline builds in **GitHub Actions**, using both declarations, then uploads the Worker through Wrangler. No Cloudflare dashboard Node setting is needed for this pipeline. Workers runs Cloudflare's runtime, not the build machine's Node binary; upgrading build-time Node is not a Workers runtime security patch. Keep `compatibilityDate` and Workers compatibility flags independent of the Node upgrade.

If an additional **Workers Builds** project is enabled in the dashboard, its Node selection does not inherit `engines.node`. Under **Settings → Build → Build Variables and Secrets**, set the nonsecret build variable `NODE_VERSION=24.22.1` (or a later patched Node 24 satisfying the manifest), for each applicable build environment. Workers Builds reads exact pnpm from `packageManager`; remove any conflicting `PNPM_VERSION` override, or align it with the manifest if that integration requires one. This is a build setting, not a Worker runtime variable in `nuxt.config.ts` or Wrangler `vars`. Recheck these external overrides when changing the manifest.

For a separately configured Pages build, inspect its own build-image configuration and set `NODE_VERSION` and, where needed, `PNPM_VERSION` to the manifest's versions. This repository's deploy target is Workers, not Pages. Live dashboard settings were not inspected or changed in this audit; the dashboard actions above are conditional on those additional build integrations existing.

Sources: [Workers build image and overrides](https://developers.cloudflare.com/workers/ci-cd/builds/build-image/), [Pages build image](https://developers.cloudflare.com/pages/configuration/build-image/), [toolchain audit](../reviews/toolchain-audit-2026-10-25.md).

### Staging (step 2.1, D53)

| | |
|---|---|
| URL | https://staging.angder.app (a Workers Custom Domain, D211; the old `nuk-cafe-staging.kimsur61.workers.dev` is turned off) |
| Worker | `nuk-cafe-staging`, account `Kimsur61@gmail.com's Account` |
| D1 | `nuk-cafe-staging` (`33752107-bc40-4c31-8ff0-d3c50dc6a3a2`, Asia-Pacific), binding `DB` |
| R2 | `nuk-cafe-staging-media` (created in eastern North America: the tool had no location option), binding `BLOB` |
| Config | `$env.staging` in `nuxt.config.ts` (preset `cloudflare_module`, bindings, `NUXT_PUBLIC_SITE_URL` as a plain var, cron triggers, Workers Logs, security headers) |
| Telegram | `@nuk_cafe_bot` (production has its own bot) |
| Secrets | `NUXT_BETTER_AUTH_SECRET` (set once with `wrangler secret put`; generated, never written down); Email needs no secret: the Worker's `EMAIL` binding sends (D212); `NUXT_MAIL_FROM` and `NUXT_MAIL_FROM_NAME` are plain vars. The AI assistant: `NUXT_AI_API_KEY` (a Worker secret the owner sets; an OpenAI key), `NUXT_AI_PROVIDER` = `openai` and `NUXT_AI_MODEL` = `gpt-5.4-mini` as plain vars in `nuxt.config.ts` (owner, 2026-09-30, D108) |

**Deploy by hand only what is on `main`** (or the branch about to be merged next): a branch deploy runs its migrations ahead of `main`, and the next deploy from `main` then runs older code against a newer database. (Happened in step 3.1: fixed by merging it right after.)

**Deploys** (step 2.2, D54, D133): every push to `main` deploys itself (its pull request ran the checks) (`.github/workflows/ci.yml` → `deploy-staging`). By hand, with Wrangler logged in (`npx wrangler login`): `pnpm deploy:staging` = `pnpm build:staging` (`nuxt build --envName staging`) → `pnpm db:migrate:staging` (`wrangler d1 migrations apply DB --remote`, tracked in `_hub_migrations`) → `wrangler deploy`.

**First owner on staging** (D135): there's no seed endpoint on a deployed Worker (`/_nitro/tasks` is dev only). On the existing staging database nothing is needed: migration `0024_tenants` made the data the tenant "NUK Cafe" (`nuk`) and its admins its owners. On an empty database: sign up on the site, then create the cafe and make the account its owner:

```bash
npx wrangler d1 execute nuk-cafe-staging --remote --command "INSERT INTO organization (id, name, slug, created_at, status, version) VALUES (lower(hex(randomblob(16))), 'NUK Cafe', 'nuk', unixepoch() * 1000, 'active', 1)"
npx wrangler d1 execute nuk-cafe-staging --remote --command "INSERT INTO member (id, organization_id, user_id, role, created_at) SELECT lower(hex(randomblob(16))), o.id, u.id, 'owner', unixepoch() * 1000 FROM organization o, user u WHERE o.slug = 'nuk' AND u.email = 'you@example.com'"
```

Everyone else is added from the Staff page; branches come from the seed locally, or an insert into `branches` with the tenant's id. The global `admin` role is gone (D135): `superadmin` is the platform team's (below). Since `0030` a cafe made by hand also needs its address in the history: `INSERT INTO tenant_slugs (slug, tenant_id) SELECT slug, id FROM organization WHERE slug = 'nuk'`. Any further cafe is made in the platform console, which does all of it.

**Super admins (the platform console, `/platform`, D142):** an account on the platform team. Locally the seed task makes its first owner one. On staging (and later production) it's set by hand on an existing account, once, in the D1 console (Cloudflare dashboard → D1 → `nuk-cafe-staging` → Console) or with Wrangler:

```bash
npx wrangler d1 execute nuk-cafe-staging --remote --command "UPDATE user SET role = 'superadmin' WHERE email = 'you@example.com'"
```

Then sign in at `/platform/sign-in`. The console first asks them to set up **two-step sign-in** (D188): an authenticator app's code after the password at every sign-in (the console, and also a cafe's admin, counter or customer account with that account), with ten backup codes shown once. **A super admin who lost both the app and the backup codes** is reset by hand, by another person on the team, after checking it's them; the next sign-in asks for setup again:

```bash
npx wrangler d1 execute nuk-cafe-staging --remote --command "DELETE FROM two_factor WHERE user_id = (SELECT id FROM user WHERE email = 'you@example.com'); UPDATE user SET two_factor_enabled = 0 WHERE email = 'you@example.com'; DELETE FROM session WHERE user_id = (SELECT id FROM user WHERE email = 'you@example.com')"
```

A super admin sees each cafe's usage numbers, never its menu, orders or customers. To take it away: `SET role = 'customer'`. Keep the team small: a super admin can create cafes with owners, pause any cafe and change its address. To give an owner another cafe, use **New cafe for this owner** on one of their cafes' pages, or New cafe → **An existing owner** (D146): they keep their own account and find the cafe under Your cafes.

**Migration `0024_tenants` (D135)** rebuilds the branch and order tables. Before the deploy that carries it, note the time for a D1 Time Travel restore (Restore drill below); after it, admin sign-in, the menu, a dine-in order and the counter are checked by hand.

**Migration `0025_menu_tenants` (D136)** rebuilds the menu tables and `media_assets` the same way. Same routine: note the time before the deploy; after it, the admin menu screens, an item's photo, a new upload (its URL under `/media/t/…`), sold out at the counter and a checkout are checked by hand.

**Migration `0026_tenant_settings` (D137)** rebuilds `customer_profiles`, `khqr_settings` and `exchange_rates` with the tenant. Same routine; afterwards: the account menu's member code (unchanged), Payments (the riel rate and the KHQR settings as before), a riel cash payment and a KHQR at the counter.

**Migration `0027_telegram_tenants` (D138)** rebuilds the Telegram tables with the tenant and names the tenant on the orders' outbox events. Same routine; afterwards: the Telegram page (chats, switches, delivery history as before), Send test, and an order placed and paid: its new-order and payment alerts arrive.

**Migration `0030_platform_console` (D142)** adds `tenant_slugs` (every cafe's current address copied in), `organization.suspended_reason` and an index on orders by cafe and time. Nothing is rebuilt; afterwards `/c/nuk` and the admin work as before.

**Migration `0028_platform_tenants` (D139)** rebuilds `idempotency_keys`, `assistant_usage` and `sample_data_runs` with the tenant and gives `audit_events` a tenant column (every existing event NUK Cafe's). Same routine; afterwards: an admin change (a menu item saved), the assistant (a question, "used today" as before), Sample data (the page's state as before), and an order placed and paid at the counter.

### Production (step 8.2, D211)

| | |
|---|---|
| URL | https://angder.app (Workers Custom Domain; `workers_dev` and preview URLs off) |
| Worker | `nuk-cafe-production`, same Cloudflare account (Workers Paid) |
| D1 | `nuk-cafe-production` (`1ba21c84-75fa-4498-aacc-44ea6b53ea95`, Asia-Pacific), binding `DB` |
| R2 | `nuk-cafe-production-media` (Asia-Pacific), binding `BLOB` |
| Rate limits | namespaces 2001–2003 (staging's are 1001–1003) |
| Config | `$env.production` in `nuxt.config.ts`; `--envName production` also applies `$production` (c12 merges both), so the security headers come from there. No Sample data variables, ever. No AI variables until Q43 |
| Telegram | `@angders_bot` |
| Secrets | each set once with `npx wrangler secret put <NAME> --name nuk-cafe-production`, generated on the owner's machine, **never copied from staging**: `NUXT_BETTER_AUTH_SECRET`, `NUXT_QR_SECRET` (before any QR is printed), `NUXT_BAKONG_ENCRYPTION_KEY` (kept in a password manager), the three `NUXT_TELEGRAM_…`. Email needs none: the `EMAIL` binding (D212) |

**Setting it up once** (the owner):
1. `npx wrangler d1 create nuk-cafe-production --location apac` and `npx wrangler r2 bucket create nuk-cafe-production-media --location apac`; the D1 id goes into `PRODUCTION.d1DatabaseId` in `nuxt.config.ts`.
2. The secrets above. A deploy before them works, but sign-in, table QRs, Bakong tokens and Telegram stay off or refuse until they're set.
3. GitHub → Settings → Environments → `production`: **Required reviewers** (the owner), deployment branches `main` only, secrets `CLOUDFLARE_API_TOKEN` (its own token: "Edit Cloudflare Workers" plus **Account → D1 → Edit**, zone `angder.app`), `CLOUDFLARE_ACCOUNT_ID`.
4. Email (once, for both environments): Cloudflare dashboard → Compute → Email Service → Email Sending → **Onboard Domain** → `mail.angder.app`. Cloudflare adds its `cf-bounce` MX, SPF, DKIM and DMARC records itself. Until it's verified, sends fail with `E_SENDER_DOMAIN_NOT_AVAILABLE` and the messages stay queued.
5. After the first deploy: the first super admin and cafe owner as for staging (First owner, Super admins above, with `nuk-cafe-production`), and the Telegram webhook of `@angders_bot` pointed at `https://angder.app/api/webhooks/telegram` ([Telegram](#telegram)).

**Custom domains:** a deploy creates the domain's DNS record and certificate itself; the API token needs the zone `angder.app` (Workers Routes edit). The zone uses SSL **Full (strict)**, Always Use HTTPS and no Rocket Loader or Auto Minify (they rewrite scripts and break the CSP). `.app` is HTTPS-only for every browser anyway. If staging is put behind Cloudflare Access, `/api/health` (the deploy's smoke check) and `/api/webhooks/telegram` must stay reachable without it.

## Configuration

Runtime config comes from environment variables (`NUXT_…`); secrets are Cloudflare secrets, never committed. `.env.example` lists every name.

| Variable | Purpose | Local | Staging / production |
|---|---|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Signs sessions and tokens | `.env` | secret |
| `NUXT_PUBLIC_SITE_URL` | The app's origin (trusted origins, links in emails) | `http://localhost:3000` | the environment's URL |
| `NUXT_MAIL_FROM` / `NUXT_MAIL_FROM_NAME` | Sender address on the onboarded sending domain, and its display name (D212) | unset (console mail: no `EMAIL` binding) | plain vars from `nuxt.config.ts`; the `EMAIL` binding may send only from that address |
| `NUXT_MAIL_APP_NAME` | The platform's name in account emails' subject and text (D213) | `Angder` | the same default; set it to rename the emails |
| `NUXT_PUBLIC_SAMPLE_DATA_ENABLED` / `_ENVIRONMENT` | The Sample data page and its routes (D94), and the environment's name on it | on (`Local`, the dev server only) | `true` / `Staging` (`wrangler.vars` in `nuxt.config.ts`); **never set in production** (the routes answer 404) |
| `NUXT_QR_SECRET` | Signs table QR tokens (D91). **Changing it invalidates every printed QR** | unset (the dev server uses a local secret) | secret, set once per environment (`wrangler secret put NUXT_QR_SECRET`); without it the table routes answer 500 `QR_NOT_CONFIGURED` |
| `NUXT_AI_PROVIDER`, `NUXT_AI_MODEL`, `NUXT_AI_API_KEY`, `NUXT_AI_BASE_URL`, `NUXT_AI_DAILY_LIMIT` | The AI assistant (D107, D108): the provider (`anthropic` \| `openai` \| `google` \| `openai-compatible`), its model id, the key, a base URL (required for `openai-compatible`; optional for a proxy), requests per admin per day (default 100) | unset (the assistant is off: its routes answer 404) | the key is a secret (`wrangler secret put NUXT_AI_API_KEY`), the rest plain variables; a key with an unknown provider, no model or (for `openai-compatible`) no URL answers 500 `AI_NOT_CONFIGURED`. Set a spending cap on the provider's account (Q43) |
| `NUXT_TELEGRAM_BOT_TOKEN`, `NUXT_TELEGRAM_BOT_USERNAME`, `NUXT_TELEGRAM_WEBHOOK_SECRET` | Telegram (D112): the bot's token from @BotFather, its name without `@`, and the secret Telegram sends with every webhook call (32–256 letters, digits, `_` or `-`) | unset (Telegram is off: its routes answer 404, the Telegram page says it isn't set up) | all three are Worker secrets (`wrangler secret put …`; the name isn't secret, but a secret survives every deploy: see [Telegram](#telegram)); a token without a valid name or secret answers 500 `TELEGRAM_NOT_CONFIGURED`. Then point the webhook at the site once: [Telegram](#telegram) |
| `NUXT_BAKONG_ENCRYPTION_KEY`, `NUXT_BAKONG_API_URL` | Checking counter KHQRs with Bakong (D131): the key that seals each cafe's own Bakong token in the database (32 random bytes, base64; D148) and Bakong's address (default `https://api-bakong.nbc.gov.kh`; a relay can stand in front of it) | unset (no cafe can save a token; cashiers confirm KHQR payments by hand) | the key is a Worker secret, set once (`wrangler secret put NUXT_BAKONG_ENCRYPTION_KEY`): see [KHQR](#khqr). The tokens are the cafes' own, saved on Payments |
| `NUXT_SEED_ADMIN_EMAIL` / `_NAME` | The seed task's first owner of the cafe | `.env` | not used (see Staging → First owner) |

Bindings (D1, R2, KV) are configured per environment in `nuxt.config.ts` (`$env.<name>`: NuxtHub turns `hub.db.connection.databaseId` and `hub.blob.bucketName` into the Worker's `DB` and `BLOB` bindings), not as variables. **`--envName staging` replaces `$production`**: settings every deployed build needs (the security headers) are repeated in each environment block.

| Variable | Use | Default | Configuration |
|---|---|---|---|
| `NUXT_MAINTENANCE_OUTBOX_RETENTION_DAYS` | Sent outbox metadata retention (D168) | `0` (keep) | Positive integer days opts in; does not delete audit, orders or failed work |
| `NUXT_MAINTENANCE_NOTIFICATION_MAX_AGE_SECONDS` | Optional notification-generation success requirement | `0` (off) | Set e.g. `300` only with Telegram and the minute cron configured; missing/stale useful success makes health 503 (D169), including sustained all-failed generation. After `0039_job_success`, the job must run to establish fresh success |
| `NUXT_MAINTENANCE_DELIVERY_MAX_AGE_SECONDS` | Optional overdue-delivery health requirement (D169) | `0` (off) | Positive seconds rejects pending outbox/notification work whose due time is older than this threshold, across cafes. Future retries and sent/failed history are excluded; choose the threshold with monitoring policy |

## Migrations

1. Change the feature's `*.schema.ts`.
2. `pnpm nuxt db generate`; **read the SQL**; rename the file to say what it does (update its tag in `meta/_journal.json`).
3. Local dev applies pending migrations on start. Tests build their database from the same files.
4. Before deploying the Worker: `wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json` (`pnpm db:migrate:staging`). NuxtHub copies the migrations into the build and names the table `_hub_migrations`.

Rules:
- **Expand, then contract.** The new Worker starts after the migration, and the old one may still serve requests for a moment, so a migration must work with both: add columns/tables first, move the code, remove old columns in a later release.
- No destructive change (dropping a column or table, narrowing a type) without an export of the affected data first.
- Migrations are never edited after they reached staging; fix forward with a new one.
- Seed data comes from a **Nitro task**, never from migrations. `db:seed` (`server/tasks/db/seed.ts`) creates the cafe (the tenant "NUK Cafe", D135), its first owner (from `NUXT_SEED_ADMIN_EMAIL` / `NUXT_SEED_ADMIN_NAME`, with a temporary password printed once) and a "Main branch" (in `NUXT_PUBLIC_CAFE_TIME_ZONE`); each part is skipped once it exists, so it's safe to repeat. Locally, with the dev server running: `curl http://localhost:3000/_nitro/tasks/db:seed` (the Nuxt CLI has no `task` command; that endpoint exists only in dev). Deployed environments don't run it: see Staging → First owner. Test accounts for every role, with one known password: `pnpm dev:accounts` (dev server only, [auth → Test accounts](../reference/auth.md#test-accounts-local-dev), D209). Test data beyond that comes from the admin's **Sample data** page (D94), not from a task: a sample menu in three sizes, branch hours and tables, and a reset, where `NUXT_PUBLIC_SAMPLE_DATA_ENABLED` is on.

## Deploys

CI on every pull request and on demand (`.github/workflows/ci.yml`, Actions → CI → Run workflow), as parallel jobs: `check` (lint, typecheck, `pnpm audit --audit-level high`, unit + server tests) and `e2e (1/3)` to `e2e (3/3)` (`vitest --shard`, each builds the app once). Lower advisories are reviewed with dependency updates.

On push to `main` (a merged pull request, already checked there: D133), the `deploy-staging` job runs straight away (GitHub environment `staging`, one deploy at a time, never cancelled halfway):
1. `pnpm build:staging`;
2. `pnpm db:migrate:staging` (migrations before the Worker: expand, then contract);
3. `wrangler deploy`;
4. smoke check: `GET /api/health` is ok (the database answers), NUK Cafe's `/c/nuk/admin/login` has the CSP header and `/admin/login` redirects there (D141), an unknown `/api` path is 404, NUK Cafe's `/api/c/nuk/admin/me` without a session is 401 (D140). Later: sign in, read the menu, place and complete a test order once orders exist.

GitHub environment `staging` secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" plus **Account → D1 → Edit**, this account only, and the zone `angder.app` for the custom domain, D211), `CLOUDFLARE_ACCOUNT_ID`. The old `NUXT_MAIL_RESEND_API_KEY` (GitHub secret and Worker secret) is no longer read since D212: delete both.

Production (D211): Actions → CI → Run workflow on `main` with **production** ticked. After `check` and all `e2e` shards pass, `verified-release` publishes `verified-release-<sha>`, then `deploy-production` waits for the `production` environment's reviewer. Approve only after that same revision is on staging and the release checklist holds. The job: `pnpm build:production` → records the D1 Time Travel bookmark in the run's summary → `pnpm db:migrate:production` → `wrangler deploy` → smoke check (health, CSP and HSTS headers, the JSON 404; no cafe-specific address, since production may have no cafe yet). Without **production** ticked, the run only checks and records the candidate, as before.

Never deploy production by hand from a laptop: the job above is the one path. Rollback = redeploy the previous Worker version (possible because migrations are backwards compatible).

## Backups and restore

- **D1 Time Travel**: point-in-time restore for the retention window of the Cloudflare plan (checked on staging: `wrangler d1 time-travel info nuk-cafe-staging` gives the current bookmark). Note the bookmark before every production migration.
- **R2**: menu images are re-uploadable; no separate backup at launch.
- **Restore drill** on staging before launch and then yearly: restore to a bookmark, check the app works, write down how long it took. Runbook below (step 10.4, D119).

### Restore drill (staging)

D1 Time Travel is Cloudflare's, always on, no code of ours: every change is kept for the plan's window (**7 days on the free plan**, as the dashboard says; 30 on Workers Paid). It covers **only the D1 database**: R2 images and Worker secrets aren't rolled back. Run by the owner, about 10 minutes. **It puts the whole staging database back**: anything written on staging after the chosen moment (orders, menu changes, Telegram links) is undone. Staging holds test data only; tell anyone testing on it first.

**In the dashboard** (the usual way): Storage & databases → D1 → `nuk-cafe-staging` → **Time Travel**.

1. **Note the time now** (the dashboard shows times in your browser's zone, GMT+7 in Phnom Penh).
2. **A minute later, make a change you can see:** on staging, Admin → Categories → add a category named **Restore drill**.
3. **Restore, and time it:** Restore database → **Date** → the time from step 1 (a minute or two before the change) → **Restore database**. The page then shows the bookmark from just before the restore, **once**: copy it; **Undo** (or Bookmark → that id) puts the change back.
4. **Check the app:**
   - `https://staging.angder.app/api/health` answers 200;
   - the **Restore drill** category is gone;
   - you can sign in to the admin, the customer menu loads, and the counter queue opens.
5. **Write it down** in `docs/progress.md` (step 10.4): the date, how long step 3 took, and anything that didn't work.

**With Wrangler** (the same, from a terminal; also what a script would use): `npx wrangler d1 time-travel info nuk-cafe-staging` prints the current bookmark; `npx wrangler d1 time-travel restore nuk-cafe-staging --bookmark=<bookmark>` restores to it and prints the one from before the restore.

**Done 2026-10-01 by the owner** (dashboard, by date): restored in about 2 seconds; afterwards admin sign-in, the customer menu and the counter worked with their data.

For production (8.2): note the bookmark before every migration (see Deploys); a restore there loses real orders written after the bookmark, so it's the last resort after redeploying the previous Worker.
- [Open] Q24: acceptable data loss and downtime (RPO/RTO) and the Cloudflare plan (Time Travel window).

## Scheduled jobs

Nitro tasks in `server/tasks/`, scheduled in `shared/scheduled-tasks.ts` (`SCHEDULED_TASKS`, given to `nitro.scheduledTasks` by `nuxt.config.ts`, cron in UTC; D192). Each run's outcome is recorded in `job_runs` by `runJob` (a success at most every 5 minutes) and shown in the console's **System health** (`/platform/health`), which lists every scheduled job, one that never ran too: Cloudflare cron triggers in deployed environments; the dev server runs them itself. Every task is **idempotent** (safe to run twice) and logs what it did. Every scheduled task runs its work through `runJob` (`server/utils/jobs.ts`, D150): a failure is logged with its stack and alerted on Telegram ("Scheduled job failed · <task>", to the default cafe's chats with **Server errors and reminders** on, at most once per task every 15 minutes, never the error's text), then thrown again. Locally a task runs on demand with `curl http://localhost:3000/_nitro/tasks/<name>` (dev only).

Built so far: `platform:deliver-outbox`, `orders:expire-unpaid` and `notifications:deliver` (every minute), `platform:expire-idempotency-keys`, `assistant:purge-usage` and `notifications:purge-deliveries` (daily at 03:15 UTC) and `media:purge-temporary` (hourly at :05).

| Task | Schedule | Does |
|---|---|---|
| `media:purge-temporary` | hourly | Deletes temporary assets older than 24 h and their R2 objects |
| `platform:expire-idempotency-keys` | daily | Removes expired idempotency keys |
| `assistant:purge-usage` | daily | Removes AI assistant usage rows older than 90 days (D108) |
| `platform:deliver-outbox` | every minute | Sends pending outbox messages with retries and backoff. An order's own request already sends its new-order and payment alerts right after answering (D150); this run sends the rest and retries. A message given up on after its last try is alerted |
| `notifications:deliver` | every minute | Queues the closing summaries that are due and sends due Telegram deliveries, with retries (D113) |
| `notifications:purge-deliveries` | daily | Removes Telegram deliveries older than 90 days |
| `loyalty:expire-vouchers` | daily | Marks vouchers past `expires_at` as expired |
| `orders:expire-unpaid` | every minute | Cancels orders still unpaid 30 minutes after placing (D45, D104): 100 a run, each guarded by status and version (a payment at that moment wins), an event with no actor and an audit entry |

`platform:maintain-outbox` runs hourly at :05: at most 500 expired email payloads are redacted and, if explicitly configured, 500 old sent metadata rows removed. Pending/failed non-mail work and financial history are retained. The idempotency expiry task deletes 500-row batches for at most five seconds per run. Monitor backlog and run again if a large cleanup exceeds that budget.

Notification generation uses a persistent 25-cafe page, catches per-cafe errors, and wraps after the last page. Existing deliveries run first, so a summary failure cannot block the queue. Delivery loops stop starting work after their budget; immediate order dispatch names its tenant, order and event. A claim token fences stale workers (D168).

## Email

- **Cloudflare Email Sending** (D212, beta; Workers Paid: 3,000 emails a month included, then 0.35 USD per 1,000), through the Worker's `EMAIL` binding, called only by outbox handlers (`identity.mail.ts`: verification, password reset), never inside a request. Each send has a 10-second deadline; a refusal throws with Cloudflare's code only (never the address), so the outbox retries.
- **At least once:** Cloudflare takes no idempotency key, so a send whose answer was lost can arrive twice (the same link; both work until one is used).
- Config: `NUXT_MAIL_FROM` and `NUXT_MAIL_FROM_NAME` in `nuxt.config.ts` (`mailConfig`), the `send_email` binding allowed only that sender. The domain `mail.angder.app` is onboarded once in Email Service (Production → Setting it up once); new accounts start with a small daily quota that grows with good sending. Delivery, bounces and suppressions are in the dashboard's Email Sending logs.
- **Locally** there is no binding: the dev server prints each email (with its link) to the console. A deployed build without the binding **refuses** to send (the messages stay queued and are logged as failing), so one-time links never land in production logs.
- Delivery takes up to a minute (the outbox task's schedule).
- Templates: plain, short, the platform's name (`NUXT_MAIL_APP_NAME`, default "Angder", D213: account emails are the platform's, never a cafe's), one link; no tracking pixels. English only until translations are decided (Q21).

## Telegram

The bot sends reports and (from 8.1d) alerts to the chats connected on **Admin → Telegram** (D112). Telegram calls our webhook, `POST /api/webhooks/telegram`, which checks the secret header before reading anything.

**Setting up an environment** (the owner, on their own machine; the token is never pasted into a chat or a file in the repository):

1. In Telegram, talk to **@BotFather**: `/newbot`, choose a name (e.g. "NUK Cafe") and a username ending in `bot` (e.g. `NukCafeBot`). It answers with the **token**. `/setjoingroups` → Enable (so it can join the staff group); `/setprivacy` → Enable (it only sees commands in groups).
2. Make a webhook secret: 48 random characters, e.g. `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
3. Set all three on the Worker as secrets: `wrangler secret put NUXT_TELEGRAM_BOT_TOKEN`, `… NUXT_TELEGRAM_WEBHOOK_SECRET` and `… NUXT_TELEGRAM_BOT_USERNAME` (the name without `@`, e.g. `nuk_cafe_bot`; not secret, but a secret survives every deploy, while a plain variable set in the dashboard is replaced by the deploy's, and the same name as both a variable in `nuxt.config.ts` and a secret makes the deploy fail). Staging: `@nuk_cafe_bot`, set by the owner on 2026-09-30.
4. Point the webhook at the site, once (and again if the address or the secret changes):
   `curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://<site>/api/webhooks/telegram -d secret_token=<SECRET> -d 'allowed_updates=["message","my_chat_member","channel_post"]'`
   Telegram answers `{"ok":true,…}`. `…/getWebhookInfo` shows the last error, if any.
   `channel_post` lets cafes connect their Telegram channel (Marketing → Channels, D164). A webhook set before it is fixed by itself: making a channel code adds `channel_post` with the same address and secret (a warning "could not check the webhook for channel posts" in Workers Logs means it couldn't: run the command above).
   On Windows, PowerShell mangles the quotes `curl.exe` gets; this asks for the token and the secret without showing them (staging was set up this way):
   ```powershell
   $t = Read-Host 'Bot token' -AsSecureString; $s = Read-Host 'Webhook secret' -AsSecureString
   $token = [Net.NetworkCredential]::new('', $t).Password; $secret = [Net.NetworkCredential]::new('', $s).Password
   $body = @{ url = 'https://<site>/api/webhooks/telegram'; secret_token = $secret; allowed_updates = @('message', 'my_chat_member', 'channel_post') } | ConvertTo-Json
   Invoke-RestMethod -Method Post -ContentType 'application/json' -Uri "https://api.telegram.org/bot$token/setWebhook" -Body $body
   Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo" | Select-Object -ExpandProperty result
   Remove-Variable token, secret, t, s
   ```
   Cloudflare never shows a secret again: if the webhook secret wasn't kept, make a new one and set it on the Worker and here. A 401 or 403 in `last_error_message` means the two differ.
5. Open **Admin → Telegram** and connect your private chat and the staff group.

Locally Telegram can't reach the dev server, so connecting is tested against staging; the server tests use a fake Telegram (grammY's `Api` with its `fetch` replaced).

**Notifications (8.1d, D113):** on the Telegram page, each chat can get **new orders**, **payments** and the **closing summary** (with its CSV as a second message). Orders write `orders.placed` / `orders.paid` outbox events in their own batches; `platform:deliver-outbox` turns them into deliveries (one per chat and order) and sends them at once. `notifications:deliver` (every minute) queues each branch's closing summary 30 minutes after the business day's last opening window ends (not on a closed day; skipped if more than 12 hours late) and sends whatever is due: Telegram's wait is respected, other failures back off 1, 2, 4 … minutes, and after 8 tries a delivery is **Failed** (Retry on the page). The history is kept 90 days (`notifications:purge-deliveries`). A lost answer after Telegram accepted a message can repeat it (Telegram has no idempotency key).

**Customers (D157):** from their order page a customer can ask the same bot to tell them when the order is ready (a one-time `t.me/<bot>?start=o_…` link, Start in their private chat). Mark ready writes `orders.ready`; the message goes right after the counter's answer and is retried by `platform:deliver-outbox`; a catch-up that failed or a worker that stopped is recovered by `notifications:deliver` (one claim with a 2-minute lease, D182; at least once, never exactly once). Nothing to set up beyond the bot itself; the bot's name is what customers see, so pick one that fits every cafe on the platform. Their chat ids are cleared once the message is sent and the rows deleted after 2 days.

**How it behaves:** connect links work once, for 10 minutes, and only their hash is stored; a group is connected only after an admin of that group added the bot and a portal admin confirmed it. A chat that removed or blocked the bot is marked **Blocked**; a group upgraded to a supergroup keeps working (its new id is followed). A send that fails says why (blocked, Telegram's wait, or refused) and can be tried again with the same idempotency key, so a lost answer never sends twice.

## KHQR

The counter shows a KHQR made for each order (D130), set up on **Admin → Payments → KHQR at the counter**. With the cafe's own Bakong token saved there (D148), the counter also asks the server every 5 seconds whether the QR was paid, and the server asks the **Bakong Open API** (`check_transaction_by_md5`, by the QR text's MD5) with that cafe's token: paid to the cafe's account in the QR's currency and amount, the payment is recorded as the cashier whose screen asked (D131). Without a token, or when Bakong doesn't answer, cashiers confirm by hand as before.

**The server's key, once per environment (the platform team):** each cafe's token is stored sealed (AES-256-GCM) with `NUXT_BAKONG_ENCRYPTION_KEY`, a Worker secret. Without it, Payments says tokens can't be saved yet.

1. Make 32 random bytes, base64, on your own computer: `openssl rand -base64 32` (or in PowerShell: `[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])`). Don't paste it anywhere else.
2. Set it on the Worker: `npx wrangler secret put NUXT_BAKONG_ENCRYPTION_KEY --name <worker>` (staging: `nuk-cafe-staging`) and paste it when asked; or in the dashboard: Workers → the Worker → Settings → Variables and Secrets → Add → type **Secret**.
3. Keep the key: **changing or losing it makes every saved token unreadable** (Payments and the counter then say the token needs saving again; each cafe pastes its token again). Nothing else is encrypted with it.
4. The old server-wide `NUXT_BAKONG_TOKEN` (before D148) is no longer read: delete it (`npx wrangler secret delete NUXT_BAKONG_TOKEN --name <worker>`) once NUK Cafe's token is saved on Payments.

**Each cafe's token (the cafe's owner):**

1. Get the token from Bakong's developer portal (`api-bakong.nbc.gov.kh`, registered with the cafe's email). It lasts **90 days**.
2. **Admin → Payments → Automatic check with Bakong → Add token**, paste it, **Save token**. It's sealed before it reaches the database and never shown again; the page shows when it expires and who saved it. **Automatic check** says **On**.
3. Press **Test connection**:
   - **Connected**: Bakong answered. Try one real order at the counter (a small one: the money goes to the cafe's own account).
   - **Bakong didn't accept the token**: it was mistyped or has expired: **Replace token**.
   - **The saved token can't be read on this server any more**: the server's key changed: **Replace token** with the same token.
   - **Bakong refused this server**: Bakong reportedly answers only servers in Cambodia in production, and a Worker runs in Cloudflare's data center nearest the request (often Singapore for Phnom Penh). Cashiers confirm by hand meanwhile. The free way around it is a small relay inside Cambodia (a Cloudflare Tunnel to a device at the cafe, on a subdomain of `angder.app`) with `NUXT_BAKONG_API_URL` pointing at it.

**Renewing:** **Replace token** on Payments before the 90 days end. The app reads the expiry date from the token (D132): **Payments** shows it ("Token expires 21 Dec 2026 · 80 days left", amber within 14 days), and Telegram reminds that cafe's chats with **Server errors and reminders** on 14, 7, 3 and 1 days before and on the day; a new token's date replaces the old one by itself. An expired token shows at the counter as "Automatic check unavailable" and on Payments as "Bakong didn't accept the token"; payments are never lost meanwhile, they are confirmed by hand. **Remove token** turns the check off.

## Monitoring

- **Scheduled job failures** (D150): alerted on Telegram (see [Scheduled jobs](#scheduled-jobs)); the stack is in Workers Logs under "Scheduled job failed".
- **Workers Logs** for structured logs (see [security.md → Logging](./security.md#logging-and-privacy)); every error log has the request id.
- `GET /api/health` answers 200 when the Worker can reach D1 (no details).
- **Browser errors** (D149): an error nobody caught in a customer's, cashier's or admin's browser is posted to `/api/client-errors` and logged as **"Browser error"** with the page (no query), the build id, the message and stack and the browser. Search Workers Logs for that message; the build id tells whether it started with a deploy. Not sent to Telegram (the text comes from the browser).
- **After a deploy**, open tabs of the admin, the counter and the platform console say "A new version of the app is ready" within about 5 minutes (D149); to check it on staging, keep a tab open across a deploy.
- **Server error alerts on Telegram** (step 10.4, D119): Admin → Telegram → Notifications → **Server errors**, per chat. Every unexpected failure (a 500 on `/api/**`) queues an alert with the route, the status and the request id (never the error's text: it stays in Workers Logs, found by the request id); at most one per route and chat every 15 minutes; sent by `notifications:deliver` within a minute. Not covered: a failure the Worker can't answer at all (it never reaches the handler). Scheduled tasks have their own alert since D150.
- Alerts (Cloudflare notifications) on a spike of 5xx responses and on Worker exceptions: set up with production (8.2).
- [Open] Q24: who receives alerts, and during which hours.

### Independent platform health (D168)

`.github/workflows/platform-health.yml` checks HTTPS health every five minutes from GitHub Actions, independently of the Worker/D1/Telegram alert path. **Disabled until repository variable `PLATFORM_HEALTH_URL` is configured**, e.g. the production `/api/health` URL. Select the platform's recipients in GitHub Actions notification settings; verify a deliberately failed manual run reaches the responsible person. Scheduled GitHub runs can be delayed: use a dedicated uptime/paging provider if Q24 requires a tighter guarantee. No destination or account setting was changed by D168.

Enable `NUXT_MAINTENANCE_NOTIFICATION_MAX_AGE_SECONDS` after the notification cron is running to detect missing/stale useful generation success (D169), as well as a database outage. Configure `NUXT_MAINTENANCE_DELIVERY_MAX_AGE_SECONDS` separately to detect overdue pending outbox/notification work; generation success alone does not prove delivery. Defaults preserve database-only health. Test total generation failure, dispatcher backlog and database outage before enabling production traffic. Worker exception alerts and a platform-owned operational destination still require Cloudflare/account configuration under Q24; the app's existing tenant Telegram alerts remain supplemental.

## Platform facts

Verified behavior of the stack that the rest of the standard relies on. Re-check when upgrading NuxtHub, Better Auth or Wrangler.

| Fact | Consequence |
|---|---|
| In `nuxt.config.ts`, `@nuxthub/core` must come **before** `@nuxtjs/better-auth` in `modules` | Better Auth then generates its tables into NuxtHub's schema and migrations |
| Better Auth on Workers needs `NUXT_BETTER_AUTH_SECRET` and `NUXT_PUBLIC_SITE_URL` | Set both in every deployed environment |
| NuxtHub KV lacks the atomic operations Better Auth's secondary storage needs | Sessions and auth rate limits stay in the database (`rateLimit.storage: 'database'`) |
| Workers builds **don't** apply D1 migrations | CI applies them as its own step before deploying ([Deploys](#deploys)) |
| D1 **always enforces foreign keys** | Every `ON DELETE` is chosen on purpose: `restrict` for referenced records, `cascade` only for private children |
| D1 has **no interactive transactions**; a `batch` is atomic, but a conditional `UPDATE` matching no row does **not** fail it | Multi-statement writes are one batch with explicit guard statements ([architecture.md → Atomic writes](./architecture.md#atomic-writes)) |
| D1 refuses a statement with **more than 100 bound parameters** ("too many SQL variables"); local SQLite allows 32,766 | Growing lists are split into several statements; the test database enforces the limit (D62) |
| An R2 upload and a D1 write can't share a transaction | Uploads start `temporary` and are attached by a later write; orphans are cleaned by a task |
| D1 has per-database size and throughput limits | Check query plans and rows read before adding caches; index every filter used by a list |
| Drizzle-kit quoted the JSON expression in `outbox_messages_order_idx` as malformed column names (D168) | `0038_delivery_reliability` uses inspected SQL `json_extract(payload, '$.orderId')`; retain the expression in the snapshot and verify future generated SQL before applying |
| libsql loads its native binary through a computed `require()` that Nitro's tracer can't follow | A `compiled` hook in `nuxt.config.ts` copies it into node builds (local and e2e); see D46 |
| A production build (`NODE_ENV=production`) refuses to serve auth without `NUXT_PUBLIC_SITE_URL` | Set it for every built server, including local smoke runs of `.output` |
| Local dev uses libsql; the server tests use in-memory libsql built from the migrations | The batch guards are proven on libsql; staging (step 2.2) proves them on D1 |

Sources: [NuxtHub database](https://hub.nuxt.com/docs/database), [NuxtHub migrations](https://hub.nuxt.com/docs/database/migrations), [Nuxt Better Auth + NuxtHub](https://better-auth.nuxt.dev/integrations/nuxthub), [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
