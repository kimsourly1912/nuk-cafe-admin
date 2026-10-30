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

**Accounts and cafes:** see [Setting up an empty environment](#setting-up-an-empty-environment-d220). The existing staging database needs nothing: migration `0024_tenants` made its data the cafe "NUK Cafe" (`nuk`) and its admins its owners.

**Super admins (the platform console, `/platform`, D142):** the first one is made by hand, once per environment ([below](#setting-up-an-empty-environment-d220)). The console then asks them to set up **two-step sign-in** (D188): an authenticator app's code after the password at every sign-in (the console, and also a cafe's admin, counter or customer account with that account), with ten backup codes shown once. **A super admin who lost both the app and the backup codes** is reset by hand, by another person on the team, after checking it's them; the next sign-in asks for setup again:

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

**Live since 2026-10-26** (CI run 431, commit `91bdf1d`, the same as staging).

| | |
|---|---|
| URL | https://angder.app (Workers Custom Domain; `workers_dev` and preview URLs off) |
| Worker | `nuk-cafe-production`, same Cloudflare account (Workers Paid) |
| D1 | `nuk-cafe-production` (`1ba21c84-75fa-4498-aacc-44ea6b53ea95`, Asia-Pacific), binding `DB` |
| R2 | `nuk-cafe-production-media` (Asia-Pacific), binding `BLOB` |
| Rate limits | namespaces 2001–2003 (staging's are 1001–1003) |
| Config | `$env.prod` in `nuxt.config.ts`, built with `--envName prod` (`pnpm build:production`). **Not** named `production`: without `--envName`, c12 uses `NODE_ENV`, so a `production` block would turn every plain production build (the e2e suite's Node server) into this Worker. `--envName prod` replaces `$production`, so the security headers are repeated there, as for staging. No Sample data variables, ever. The AI assistant's `NUXT_AI_PROVIDER` = `openai` and `NUXT_AI_MODEL` = `gpt-5.4-mini`, like staging (D230) |
| Telegram | `@angders_bot` |
| Secrets | each set once with `npx wrangler secret put <NAME> --name nuk-cafe-production`, generated on the owner's machine, **never copied from staging**: `NUXT_BETTER_AUTH_SECRET`, `NUXT_QR_SECRET` (before any QR is printed), `NUXT_BAKONG_ENCRYPTION_KEY` (kept in a password manager), the three `NUXT_TELEGRAM_…`; `NUXT_AI_API_KEY` when the assistant should be on: a production-only OpenAI key with a $20 monthly limit in OpenAI's billing settings (D230; without it the assistant is off). Email needs none: the `EMAIL` binding (D212) |

**Setting it up once** (the owner):
1. `npx wrangler d1 create nuk-cafe-production --location apac` and `npx wrangler r2 bucket create nuk-cafe-production-media --location apac`; the D1 id goes into `PRODUCTION.d1DatabaseId` in `nuxt.config.ts`.
2. The secrets above, with Wrangler or in the dashboard (how production was set up): Workers & Pages → Create application → **Start with Hello World!** (never "Import a repository": that starts Cloudflare's own builds beside ours) → name `nuk-cafe-production` → Deploy; then the Worker → Settings → Variables and Secrets → Add, type **Secret** for every one (a Text variable set there is replaced by the next deploy) → Deploy. The first CI deploy replaces the placeholder's code and keeps the secrets; add nothing else there (bindings, domain, crons and vars come from `nuxt.config.ts`). A deploy before the secrets works, but sign-in, table QRs, Bakong tokens and Telegram stay off or refuse until they're set.
3. GitHub → Settings → Environments → `production`: **Required reviewers** (the owner), deployment branches `main` only, secrets `CLOUDFLARE_API_TOKEN` (its own token: "Edit Cloudflare Workers" plus **Account → D1 → Edit**, zone `angder.app`), `CLOUDFLARE_ACCOUNT_ID`.
4. Email (once, for both environments): Cloudflare dashboard → Compute → Email Service → Email Sending → **Onboard Domain** → `mail.angder.app`. Cloudflare adds its `cf-bounce` MX, SPF, DKIM and DMARC records itself. Until it's verified, sends fail with `E_SENDER_DOMAIN_NOT_AVAILABLE` and the messages stay queued.
5. After the first deploy: the first super admin and cafe ([Setting up an empty environment](#setting-up-an-empty-environment-d220), with `nuk-cafe-production`), and the Telegram webhook of `@angders_bot` pointed at `https://angder.app/api/webhooks/telegram` ([Telegram](#telegram)).

**Custom domains:** a deploy creates the domain's DNS record and certificate itself; the API token needs the zone `angder.app` (Workers Routes edit). The intended zone baseline is SSL **Full (strict)**, Always Use HTTPS, minimum TLS **1.2** with TLS 1.3 enabled, DNSSEC with a valid registrar DS chain, and no Rocket Loader or script minification that rewrites the CSP-protected scripts. Full (strict) controls external origin connections; the app itself is Worker-hosted. Modern browsers already require HTTPS on `.app`. Zone settings are outside the Worker build: use the [Cloudflare plan](../plans/cloudflare-improvements.md) and its [dated live evidence](../progress.md#cloudflare-security-baseline-d215-2026-10-26), not a source comment, to establish their actual state. If staging is put behind Cloudflare Access, `/api/health` (the deploy's smoke check) and `/api/webhooks/telegram` must stay reachable without it.

**Bot Fight Mode stays off on `angder.app` (D214).** It challenges every request that looks automated, across the whole zone, and on the Free zone plan it can't be skipped by any rule. Turned on, it answered 403 to the deploys' smoke checks from GitHub (production launch, 2026-10-26) and would do the same to Telegram's webhook calls and the platform health check. DDoS protection stays on regardless; the app limits its public API itself (D121). If bot protection is ever needed: Super Bot Fight Mode (Pro zone plan) with a skip rule for `/api/health` and `/api/webhooks/telegram`. A deploy whose smoke check gets 403 while a browser gets `ok`: look in Security → Events for the blocking service.

## Setting up an empty environment (D220)

The order is the same everywhere: infrastructure, one super admin made by hand, then everything else in the app. Only the first step differs.

| | Local | Staging / production |
|---|---|---|
| Infrastructure | `pnpm dev` (migrations run on start; delete `.data/` for a fresh start) | [Staging](#staging-step-21-d53) / [Production → Setting it up once](#production-step-82-d211): D1, R2, secrets, a deploy (it applies the migrations) |
| Accounts | `pnpm dev:accounts`: every role, two cafes with a branch each, one known password ([auth → Test accounts](../reference/auth.md#test-accounts-local-dev)). Stop here locally | the steps below |
| Test data | Admin → **Sample data** | staging: Admin → **Sample data**; production: none, the owner enters their menu |

Nobody types passwords into a deployed database: Better Auth stores them hashed in its own `account` table, so every account is made by signing up or by the app. No seed, setup page or bootstrap endpoint exists there (D49, D220): the first super admin is the one step done by hand.

1. **The first super admin.** Sign up on the site (`/sign-up`) and **follow the confirmation email** (sign-up doesn't require it, D156, so an unconfirmed account with your address could be someone else's). Then in the Cloudflare dashboard → Storage & databases → D1 → `nuk-cafe-production` (or `nuk-cafe-staging`) → **Console**, or with `npx wrangler d1 execute <database> --remote --command "…"`:
   ```sql
   UPDATE user SET role = 'superadmin' WHERE email = 'you@example.com' AND email_verified = 1;
   ```
   It must report **1 row** changed; 0 means the email isn't confirmed yet (or is spelled differently). Sign in at `/platform/sign-in`; two-step sign-in is set up first (D188). Further super admins: the same, for an account that person made and confirmed. Taking it away: `UPDATE user SET role = 'customer' WHERE email = '…';`.
2. **A cafe and its owner.** The platform console → Cafes → **New cafe**: the cafe, its address, its first branch, its owner and the audit in one batch (D142). A new owner's temporary password is shown once, to hand over privately; an existing account is made the owner instead (D146). Never by hand with SQL.
3. **The owner sets up the cafe** at `/c/<slug>/admin`: their own password at first sign-in, then the menu, branch hours and tables (table QRs need `NUXT_QR_SECRET`), Payments (riel rate, KHQR; Bakong needs `NUXT_BAKONG_ENCRYPTION_KEY`), Telegram, and **Staff** for managers and cashiers.
4. **Customers** sign up themselves, or order as guests.

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
| `NUXT_DEV_ACCOUNTS_PASSWORD` | The password `pnpm dev:accounts` gives the test accounts (D209) | unset (`nuk-dev-password`) | not used: the dev tasks refuse outside the dev server |

Bindings (D1, R2, KV) are configured per environment in `nuxt.config.ts` (`$env.<name>`: NuxtHub turns `hub.db.connection.databaseId` and `hub.blob.bucketName` into the Worker's `DB` and `BLOB` bindings), not as variables. **`--envName staging` replaces `$production`**: settings every deployed build needs (the security headers) are repeated in each environment block.

| Variable | Use | Default | Configuration |
|---|---|---|---|
| `NUXT_MAINTENANCE_OUTBOX_RETENTION_DAYS` | Sent outbox metadata retention (D168) | `0` (keep) | Positive integer days opts in; does not delete audit, orders or failed work |
| `NUXT_MAINTENANCE_NOTIFICATION_MAX_AGE_SECONDS` | Optional notification-generation success requirement | `0` (off) | Set e.g. `300` only with Telegram and the minute cron configured; missing/stale useful success makes health 503 (D169), including sustained all-failed generation. After `0039_job_success`, the job must run to establish fresh success. **Production: `300`** (D221), a plain var in `$env.prod`. Staging: not set |
| `NUXT_MAINTENANCE_DELIVERY_MAX_AGE_SECONDS` | Optional overdue-delivery health requirement (D169) | `0` (off) | Positive seconds rejects pending outbox/notification work whose due time is older than this threshold, across cafes. Future retries and sent/failed history are excluded. **Production: `900`** (D221), a plain var in `$env.prod`. Staging: not set |

## Migrations

1. Change the feature's `*.schema.ts`.
2. `pnpm nuxt db generate`; **read the SQL**; rename the file to say what it does (update its tag in `meta/_journal.json`).
3. Local dev applies pending migrations on start. Tests build their database from the same files.
4. Before deploying the Worker: `wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json` (`pnpm db:migrate:staging`). NuxtHub copies the migrations into the build and names the table `_hub_migrations`.

Rules:
- **Expand, then contract.** The new Worker starts after the migration, and the old one may still serve requests for a moment, so a migration must work with both: add columns/tables first, move the code, remove old columns in a later release.
- No destructive change (dropping a column or table, narrowing a type) without an export of the affected data first.
- Migrations are never edited after they reached staging; fix forward with a new one.
- Seed data never comes from migrations. Locally, `pnpm dev:accounts` (a dev-only Nitro task, D209) creates the cafes, their branches and an account for every role; it's safe to repeat ([auth → Test accounts](../reference/auth.md#test-accounts-local-dev)). Deployed environments have no seed: see [Setting up an empty environment](#setting-up-an-empty-environment-d220) (D220). Test data beyond that comes from the admin's **Sample data** page (D94), not from a task: a sample menu in three sizes, branch hours and tables, and a reset, where `NUXT_PUBLIC_SAMPLE_DATA_ENABLED` is on.

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
- **Nightly backups (D225)**: production's database, encrypted for the owner's key, every night in the R2 bucket `angder-backups`; kept 30 nights and 12 months, and no key can delete them early. For what Time Travel can't undo: a deleted database, damage found after 30 days. **For now the bucket is in the production account (owner, 2026-10-29), so the backups don't survive losing that account**; a separate account comes later. [Below](#nightly-backups-d225).
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
- Q24 answered (D229, 2026-10-30): back within **4 hours** (RTO); orders and payments kept 5 years; guest accounts deleted after 90 days unused (cleanup not built yet). Earlier parts: Workers Paid (D211), alerts (D223), backups (D225).

### Nightly backups (D225)

`angder-backup` (`ops/backup`), a Worker beside the app, runs a Cloudflare Workflow every night at **03:17 Cambodia time**: it exports production's D1 database as SQL, encrypts it with **age** for the owner's public key, and stores it in the R2 bucket **`angder-backups`**, for now **in the production account** (owner, 2026-10-29; [moving it later](#moving-the-backups-to-a-separate-account-later)):

- `daily/angder-<YYYY-MM-DD>.sql.age` every night, kept **30 days**;
- `monthly/angder-<YYYY-MM>.sql.age` on the 1st, kept **365 days**.

The bucket's **lock rules** stop a key, the Worker's own included, from deleting or overwriting a copy before then (an account administrator can still remove the rules: that's the gap a separate account closes); its **lifecycle rules** delete them a day after. The Worker holds only the public key: **only the owner's private key can read a backup.** Lose that key and every backup is unreadable. A failed night sends **🔴 Angder backup FAILED** to Angder Ops (D223's bot); every Monday it sends **🟢 Angder backups are running**: a Monday without it means the backup has stopped. Runs: Workers & Pages → Workflows → `angder-backup` (production account).

#### Setting it up

Once, by the owner, about 20 minutes, all in the **production account** except step 4.

1. **Protect the login**, since it now guards the backups too: two-step sign-in with an **authenticator app** (not SMS) on Cloudflare **and** on the email it uses, a unique password in the password manager, nobody else invited.
2. **The bucket:** R2 → Create bucket → `angder-backups`. Then its **Settings**:
   - **Bucket lock rules → Add rule:** name `daily-30-days`, prefix `daily/`, retain **30 days**; and `monthly-365-days`, prefix `monthly/`, retain **365 days**.
   - **Object lifecycle rules → Add rule:** prefix `daily/`, delete objects after **31 days**; prefix `monthly/`, delete after **366 days**.
3. **Its R2 key:** R2 → Manage API tokens → Create API token: **Object Read & Write**, applied to **`angder-backups` only**. Note the **Access Key ID**, the **Secret Access Key** and the **S3 endpoint** (`https://<account id>.r2.cloudflarestorage.com`, shown on the same page).
4. **The owner's key** (on the owner's computer, with [age](https://age-encryption.org): `brew install age`, `winget install FiloSottile.age`, or the `age` package on Linux): `age-keygen -o angder-backup-key.txt`. It prints the **public key** (`age1…`). Keep `angder-backup-key.txt` in the password manager **and** an offline copy (USB stick or printed): it is the only way to read the backups, and it must not be lost with the laptop. Optionally make a second key the same way for a trusted spare; both public keys go in the secret below, separated by a space.
5. **The export token** (production account): My Profile → API Tokens → Create Custom Token → permission **Account · D1 · Read**, account resources: the production account. (Cloudflare doesn't say which permission the export needs: if the test backup fails with an authentication or permission error, edit the token to **D1 · Edit**.)
6. **GitHub → Settings → Secrets and variables → Actions → New repository secret:** `BACKUP_D1_EXPORT_TOKEN` (step 5), `BACKUP_R2_ENDPOINT`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` (step 3), `BACKUP_AGE_RECIPIENTS` (step 4's public key or keys). `CLOUDFLARE_ACCOUNT_ID` and the `OPS_TELEGRAM_*` secrets already exist.
7. **Actions → Deploy backup → Run workflow** (on main), and approve it. Its last step takes a backup: **🟢 Angder backup stored** arrives in Angder Ops within a few minutes, and the file appears under R2 → `angder-backups` → `daily/`.
8. **Check the key works:** download that file (R2 → `angder-backups` → `daily/`) and run `age -d -i angder-backup-key.txt angder-<date>.sql.age | head`: the first lines of SQL prove the key reads it.

#### When "Angder backup FAILED" arrives

Earlier copies are untouched; the next run is the following night. A setup mistake (a refused token or key, a missing bucket, a bad public key) fails at once, so after **Deploy backup** it arrives within about a minute (D227); a busy or unreachable service is retried first, for up to about 15 minutes (the export) or 8.5 hours (storing the copy). No message at all a few minutes after Deploy backup: Workers & Pages → Workflows → `angder-backup` → the newest instance shows each step, its tries and its error. Read the **Reason**:

- *D1's export answered HTTP 401/403*: the export token was revoked, expired or lacks permission (setup step 5); replace `BACKUP_D1_EXPORT_TOKEN`.
- *The backup bucket refused … HTTP 403*: the bucket's R2 key changed (step 3); replace the three `BACKUP_R2_*` secrets.
- *D1's export failed: Not currently exporting anything*: the backup code before D228 (2026-10-30) asked about the export too slowly; deploy the current main with **Deploy backup**.
- *Settings not set*: a secret is missing; add it.
- *larger than 40 MB*: the database outgrew the in-memory backup: the code needs a streamed upload (D225).
- Anything else (a Cloudflare or Telegram outage): wait for the next night, or take one now.

After fixing, **Deploy backup** again: it redeploys and takes a backup now (a night already stored stays as it was).

#### Restoring from a backup

Into a **new** database first, never over production:

1. **Download** the night's file: R2 → `angder-backups` → `daily/` (or `monthly/`) → Download.
2. **Decrypt:** `age -d -i angder-backup-key.txt -o angder.sql angder-<date>.sql.age`.
3. **Load it into a new D1 database** (production account): `npx wrangler d1 create angder-restore`, then `npx wrangler d1 execute angder-restore --remote --file angder.sql`.
4. **Check** it: `npx wrangler d1 execute angder-restore --remote --command "select count(*) from orders"`, and the newest order's time.
5. **Use it:** to replace production (the database is gone or ruined), set `PRODUCTION.d1DatabaseId` in `nuxt.config.ts` (and `ops/backup/wrangler.jsonc`) to the new database's id and deploy. To recover a few rows, copy them from it instead. Anything written after that night's backup is lost; Time Travel may still have it if the old database exists.

This restore is not drilled yet (next step): until it is, treat these steps as untested.

#### Moving the backups to a separate account (later)

The owner's plan once the app has many users (D225 follow-up). No code changes: the Worker uploads through R2's S3 address, so only the bucket and three secrets move.

1. A new Cloudflare account for backups only: a **new mailbox** used for nothing else (not a `+alias` of the current one: a password reset would reach the same inbox), its own unique password, two-step sign-in with an authenticator app on both, nobody else invited.
2. In it, setup steps 2 and 3 above (bucket `angder-backups` with the same lock and lifecycle rules, its R2 key).
3. Replace `BACKUP_R2_ENDPOINT`, `BACKUP_R2_ACCESS_KEY_ID` and `BACKUP_R2_SECRET_ACCESS_KEY`, then **Deploy backup**: 🟢 means the new bucket works.
4. Leave the old bucket until its copies expire (30 days for `daily/`, a year for `monthly/`), then remove its lock rules and delete it.

## Scheduled jobs

Nitro tasks in `server/tasks/`, scheduled in `shared/scheduled-tasks.ts` (`SCHEDULED_TASKS`, given to `nitro.scheduledTasks` by `nuxt.config.ts`, cron in UTC; D192). Each run's outcome is recorded in `job_runs` by `runJob` (a success at most every 5 minutes) and shown in the console's **System health** (`/platform/health`), which lists every scheduled job, one that never ran too: Cloudflare cron triggers in deployed environments; the dev server runs them itself. Every task is **idempotent** (safe to run twice) and logs what it did. Every scheduled task runs its work through `runJob` (`server/utils/jobs.ts`, D150): a failure is logged with its stack, recorded for System health, then thrown again. Jobs belong to no cafe, so no cafe's Telegram chats hear about them (D221; until then they went to the oldest cafe's). An outbox message given up on is logged as an error. Until the platform has an alert channel of its own (Q24), the [independent health check](#independent-platform-health-d168) reports work that stops moving **only where `NUXT_MAINTENANCE_NOTIFICATION_MAX_AGE_SECONDS` / `NUXT_MAINTENANCE_DELIVERY_MAX_AGE_SECONDS` are set**. **Production sets both** (300 s and 900 s, plain vars in `$env.prod`, so every deploy keeps them): health turns 503 when notification generation hasn't succeeded for 5 minutes or outbox/Telegram work is overdue by 15. The generation check needs production's three Telegram secrets: without a bot, `notifications:deliver` never generates and health stays 503. Staging sets neither. Locally a task runs on demand with `curl http://localhost:3000/_nitro/tasks/<name>` (dev only).

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

Both environment builds keep Workers Logs enabled and set `observability.redact_query_string: true` (D215). Cloudflare invocation metadata is separate from our logger: query redaction prevents query parameters in its request URL logs/traces, not path tokens or custom log messages. It is prospective; existing logs retain their original contents until retention expires. Verify ingestion with a harmless staging query marker as described in the [Cloudflare plan](../plans/cloudflare-improvements.md#verification-and-rollback). Current sampling is unchanged; measure volume before tuning it.

- **Scheduled job failures** (D150, D221): in Workers Logs under "Scheduled job failed" and in System health; never sent to a cafe (see [Scheduled jobs](#scheduled-jobs)). **Server errors** reach Telegram only for the cafe whose API the request was in; the platform's own routes stay in the logs.
- **Workers Logs** for structured logs (see [security.md → Logging](./security.md#logging-and-privacy)); every error log has the request id.
- `GET /api/health` answers 200 when the Worker can reach D1 (no details).
- **Browser errors** (D149): an error nobody caught in a customer's, cashier's or admin's browser is posted to `/api/client-errors` and logged as **"Browser error"** with the page (no query), the build id, the message and stack and the browser. Search Workers Logs for that message; the build id tells whether it started with a deploy. Not sent to Telegram (the text comes from the browser).
- **After a deploy**, open tabs of the admin, the counter and the platform console say "A new version of the app is ready" within about 5 minutes (D149); to check it on staging, keep a tab open across a deploy.
- **Server error alerts on Telegram** (step 10.4, D119): Admin → Telegram → Notifications → **Server errors**, per chat. Every unexpected failure (a 500 on `/api/**`) queues an alert with the route, the status and the request id (never the error's text: it stays in Workers Logs, found by the request id); at most one per route and chat every 15 minutes; sent by `notifications:deliver` within a minute. Not covered: a failure the Worker can't answer at all (it never reaches the handler). Scheduled tasks have their own alert since D150.
- **Platform alerts** (D223, D224): who is told when production breaks, and what to do: [Alerts](#alerts-d223-d224).

### Independent platform health (D168)

`.github/workflows/platform-health.yml` checks HTTPS health every five minutes from GitHub Actions, independently of the Worker/D1/Telegram alert path (D216). It defaults to `https://angder.app/api/health`; `PLATFORM_HEALTH_URL` can override that address, and `PLATFORM_HEALTH_ENABLED=false` explicitly pauses the job. A manual run can choose staging. The check requires HTTP 200 and JSON `status: ok`, bounds the body to 4 KB and records elapsed time in the run summary. It becomes scheduled only after the workflow reaches main. Select/verify the responsible owner's existing GitHub Actions notification preferences; no new recipient or chat is selected by the workflow. Scheduled runs can be delayed, so this is not an uptime/paging guarantee. Q24 still owns alert delivery and recovery targets.


**On in production since D221's follow-up (2026-10-27):** both ages; a red run of the health workflow means the database, generation or delivery is stuck. Enable `NUXT_MAINTENANCE_NOTIFICATION_MAX_AGE_SECONDS` after the notification cron is running to detect missing/stale useful generation success (D169), as well as a database outage. Configure `NUXT_MAINTENANCE_DELIVERY_MAX_AGE_SECONDS` separately to detect overdue pending outbox/notification work; generation success alone does not prove delivery. Defaults preserve database-only health. Test total generation failure, dispatcher backlog and database outage before enabling production traffic. Worker exception alerts and a platform-owned operational destination still require Cloudflare/account configuration under Q24; the app's existing tenant Telegram alerts remain supplemental.

### Alerts (D223, D224)

Q24's alert part, answered by the owner (2026-10-29): the owner alone receives them for now (add a second person to the chat when there is one); a private Telegram group **Angder Ops** with its own small bot, never `@angders_bot` (a leaked ops token can only post alerts); email as the backup; always sent (silence the phone at night: cafes are closed). Nothing here may depend on the repository being public (D224). Data loss/downtime targets (RPO/RTO) and retention stay open in Q24.

| Level | What | Where it comes from | Channel | Look within |
|---|---|---|---|---|
| Critical | Production down: `/api/health` fails (the Worker, D1, stuck jobs or deliveries) | The **watchdog** Worker `angder-watchdog`, every minute (below) | Telegram **Angder Ops**: one DOWN, one RECOVERED | 15–30 minutes in cafe hours |
| Critical | All of Cloudflare down (the watchdog with it) | **cloudflarestatus.com** subscription, sent from outside Cloudflare | Email | When it arrives |
| Warning | Server errors rising while health is OK | Cloudflare **Monitor** (Beta) on production 5xx, when the account's datasets allow it (below) | Email | The same day |
| Warning | Cloudflare has an incident in a product we use | Cloudflare **Incident Alerts** | Email | The same day (nothing of ours to fix: check before debugging) |
| Info | Usage spend crosses a threshold | Cloudflare **Budget alerts** | Email | This week |
| Info | The watchdog is alive | The watchdog's **weekly** message, Mondays 09:00 Cambodia time | Telegram | No Monday message: the watchdog itself is broken |

**The watchdog** (`ops/watchdog`, D224) is a separate Worker with no database, no app code and no public address, so it keeps running when the app breaks. A Cron Trigger every minute asks one Durable Object to check `https://angder.app/api/health` (HTTP 200 with `{"status":"ok"}`, 10-second timeout). Two failed checks in a row send **DOWN** with the reason (one failure is a blip and says nothing); the first good check after that sends **RECOVERED** with how long it lasted; nothing is sent while nothing changes. A message Telegram doesn't take is sent again a minute later: the state only moves on once the chat has been told. It also says **"Watchdog started"** after every deploy (the delivery test) and sends the weekly message. The Durable Object keeps the up/down state, because cron runs land in different Cloudflare locations and KV could hand the next run an old state. Cost: included in Workers Paid (about 43,000 checks a month against 10 million requests and 1 million Durable Object requests included). It runs on Cloudflare, so a Cloudflare-wide outage silences it: that is the status page subscription's job.

**The GitHub check** ([Platform health](#independent-platform-health-d168)) stays as a free second opinion from outside Cloudflare while the repository is public; a red run only sends GitHub's email. If the repository becomes private (each run would then use paid minutes), pause it: repository variable `PLATFORM_HEALTH_ENABLED` = `false`. GitHub also disables scheduled workflows in a public repository after 60 days without activity: Actions shows a banner; Enable to restart it.

#### Setting it up (owner)

1. **The ops bot and group** (done 2026-10-29, D223): @BotFather → `/newbot`; a private group **Angder Ops** with the bot; the group's chat id from `https://api.telegram.org/bot<TOKEN>/getUpdates`. If the token ever leaks: @BotFather → `/revoke`, then update the GitHub secret and run **Deploy watchdog** again.
2. **Repository secrets** (done): Settings → Secrets and variables → Actions → **Repository secrets** (not an environment's): `OPS_TELEGRAM_BOT_TOKEN`, `OPS_TELEGRAM_CHAT_ID`.
3. **Deploy the watchdog** (done 2026-10-29: "Watchdog started" arrived, the owner confirmed it working): Actions → **Deploy watchdog** → Run workflow (branch `main`) → approve the `production` environment → within about a minute **Angder Ops** gets "Watchdog started: checking angder.app every minute…". That message is the test. Run it again whenever `ops/watchdog` changes, the secrets change, or you want to re-check delivery; a deploy takes about a minute of GitHub Actions time.
4. **Cloudflare status by email** (done 2026-10-29, owner): `https://www.cloudflarestatus.com` → **Subscribe to updates** → email; choose Workers, D1, R2 and DNS if it asks for components.
5. **Cloudflare alerts** (done 2026-10-29, owner; Observability → Alerts; email destination is your account email):
   - **Platform Notifications → Incident Alerts**: add, filter to Workers, D1, R2 and DNS.
   - **Budget alerts** (Manage Account → Billing → Billable Usage): keep the default one Cloudflare may have created and add one at $25. Budget alerts are daily and informational: they never cap usage.
   - **Monitors** (Beta): **Create a Monitor → Threshold**. If a Workers dataset is listed for the account: production script `nuk-cafe-production`, HTTP status ≥ 500, count over 15 minutes, alert at **10 or more**, email. If no Workers dataset is listed, skip it and record that here; the fallback is a platform-level server-error alert from the app to the ops chat (a code change).

**Check it's alive:** the Monday message. **Its logs:** Workers & Pages → `angder-watchdog` → Observability: one line per minute, **Watchdog: checked** (a warning when a message didn't go through), never the token or the chat id:

| In the line | Meaning |
|---|---|
| `health: 'ok'`, `healthMs: 120` | Production answered healthy in 120 ms; otherwise the reason (`it answered HTTP 503`, `it did not answer within 10 seconds`) |
| No `messages` field (Cloudflare leaves out an empty list) | Nothing to say this minute: the normal line |
| `result: 'sent'` | Telegram took the message |
| `result: 'refused 400: Bad Request: chat not found'` | Wrong chat id (the group became a supergroup: new id from getUpdates) — `401`: wrong token — `403`: the bot was removed from the group. Update the secret, run **Deploy watchdog** |
| `result: 'no answer (TimeoutError)'`, `ms: 10000` | Telegram didn't answer within 10 seconds; it's retried next minute |
| "OPS_TELEGRAM_BOT_TOKEN or OPS_TELEGRAM_CHAT_ID is not set" | The secrets didn't reach it: run **Deploy watchdog** again |

#### Routine checks (owner)

| When | What | Normal |
|---|---|---|
| Every Monday | The **Weekly check** message in Angder Ops (09:00 Cambodia time) | It arrives. **No message by Monday noon:** the watchdog itself is broken: open its Observability and read the newest line |
| Every few months, and after any change to `ops/watchdog` or the secrets | The fire drill below | DOWN, then RECOVERED |
| Monthly | Cloudflare → Manage Account → Billing → **Billable Usage** | Nothing unexpected; the $25 budget alert stays quiet |
| Any time you wonder | Workers & Pages → `angder-watchdog` → **Observability**, newest **Watchdog: checked** line | `secrets: true`, `health: "ok"`, no `messages` |

#### Fire drill: test DOWN and RECOVERED without affecting customers

The drill points only the watchdog at an address that doesn't exist; the site keeps working. About 5 minutes.

1. Cloudflare → Workers & Pages → `angder-watchdog` → **Settings → Variables and Secrets** → `HEALTH_URL` → Edit → `https://angder.app/api/health-drill` → Deploy (a warning that Wrangler manages the Worker is expected).
2. Within 2–3 minutes Angder Ops gets "Watchdog started…" (a setting change is a new version), then one **DOWN** "…2 times in a row…: it answered HTTP 404…" (HTTP 404 is the drill; a real outage reads `HTTP 500`/`503` or `did not answer within 10 seconds`). Then nothing more while it stays "down".
3. Restore from the repository: Actions → **Deploy watchdog** → Run workflow → approve. Within 1–2 minutes: "Watchdog started…" and **RECOVERED** "…after about N minutes".
4. Check `HEALTH_URL` is `https://angder.app/api/health` again.

No DOWN after 5 minutes, several DOWNs, or no RECOVERED: read the Observability lines (table above). Never test by breaking production itself.

#### Changing things later

| To… | Do |
|---|---|
| Re-test delivery | Actions → **Deploy watchdog** → Run → approve: a new "Watchdog started" message |
| Add a second person | Add them to the **Angder Ops** group; nothing else changes |
| Move alerts to another group | Add the bot there, `/start@<bot>` in it, its id from getUpdates → update `OPS_TELEGRAM_CHAT_ID` (repository secret) → **Deploy watchdog** |
| The token leaked | @BotFather → `/revoke` → update `OPS_TELEGRAM_BOT_TOKEN` → **Deploy watchdog** |
| Silence it at night | Mute the group in Telegram (messages still arrive; nothing in the watchdog changes) |
| Make the repository private | Repository variable `PLATFORM_HEALTH_ENABLED` = `false` (stops the GitHub check, which would use paid minutes); the watchdog is unaffected. A **Deploy watchdog** run uses about a minute of the private quota |
| Stop the watchdog for planned maintenance | Workers & Pages → `angder-watchdog` → Settings → Triggers → remove the cron (or expect one DOWN and one RECOVERED); **Deploy watchdog** restores it |
| Change the check or the messages | Edit `ops/watchdog/src/watchdog.ts` (tests in `ops/watchdog/tests`), PR, merge, **Deploy watchdog** |

#### What it costs

Included in Workers Paid; nothing extra (checked against Cloudflare's pricing on 2026-10-29). About 43,200 checks a month use roughly 0.4% of the included Worker requests and CPU, 4% of the included 1 million Durable Object requests, under 2% of their included duration, and under 1% of the included log events (20 million a month; from 1 December 2026, logs are counted in GB: 50 GB included, the watchdog writes about 0.1 GB). The included amounts are shared with the app's Workers; the app itself uses no Durable Objects. Calls to Telegram and to the site are not billed.

#### Where everything lives

| What | Where |
|---|---|
| The check and its messages | `ops/watchdog/src/watchdog.ts` (`runCheck`, the report) |
| The cron handler, the Durable Object, the log line | `ops/watchdog/src/index.ts` |
| Name, schedule, health address, bindings | `ops/watchdog/wrangler.jsonc` (Worker `angder-watchdog`, cron `* * * * *`, Durable Object `Watchdog` named `production`) |
| Tests | `ops/watchdog/tests/watchdog.test.ts` (unit project); `pnpm typecheck` runs `tsc -p ops/watchdog` |
| Deploy | `.github/workflows/watchdog.yml` (by hand, `production` environment; deploys, then `wrangler secret bulk`) |
| Secrets | GitHub repository secrets `OPS_TELEGRAM_BOT_TOKEN`, `OPS_TELEGRAM_CHAT_ID` → copied to the Worker's secrets by each deploy |
| The free outside check | `.github/workflows/platform-health.yml` (email only) |
| Why it's built this way | [D223](../decisions.md#d223-platform-alerts-one-down-and-one-recovered-message-to-a-private-ops-chat-2026-10-29), [D224](../decisions.md#d224-the-alarm-is-a-watchdog-worker-not-a-github-schedule-2026-10-29) |

#### When an alert arrives

1. **Is it real?** Open `https://angder.app/api/health`. `{"status":"ok"}` with a RECOVERED message soon after: a blip; note it.
2. **Is it Cloudflare?** Check `https://www.cloudflarestatus.com`. A Cloudflare incident: wait and tell cafes if it lasts; nothing to deploy.
3. **Was there a deploy just before?** Roll back: Cloudflare dashboard → Workers & Pages → `nuk-cafe-production` → **Deployments** → the three-dot menu on the previous version → **Rollback** (or `wrangler rollback`). Migrations are expand-only, so the previous Worker works with the current database. Then find the cause on staging.
4. **Otherwise,** Workers Logs (`nuk-cafe-production`) around the alert's time: errors carry a request id; "Scheduled job failed" and System health show stuck jobs.
5. **Data looks wrong or lost:** stop and follow [Backups and restore](#backups-and-restore) (a restore rewinds the whole database: decide the moment first).
6. Afterwards, write one line in progress (what happened, how long, what changed) so the next alert is easier.

### Public image delivery (D218)

`GET /media/<key>` serves only the existing public JPEG/PNG/WebP key shapes, including legacy keys. Workers use `public-menu-images-v1` with a one-hour edge TTL; responses retain the one-year immutable browser policy because edits create new object keys. Private photo sources stay on the authorized, no-store API. No bucket is made public and no paid image service is enabled.

`X-Media-Cache: HIT` means a cached representation was returned without NuxtHub's R2 body/metadata reads. `MISS` means the successful image was returned and a cache write scheduled; the write may fail or the entry be evicted. `BYPASS` marks eligible requests without a usable cache or cacheable response. Query, conditional, range, authorization and non-GET requests bypass without this diagnostic. Cookies do not fragment deliberately public images; keys include the complete origin and tenant path. Only content metadata is stored; Nitro applies the current security headers and request id on every request. Warnings report read/write cache unavailability without recording URLs or credentials.

After staging deployment, request the exact same existing public image twice without a browser's local cache, waiting for the first write to finish. Record body hashes, ETag, `X-Media-Cache`, response security headers and distinct request ids. Inspect `cf-ray` to distinguish data centers; a miss at another location is normal. Repeat for a second cafe and a new replacement key, then probe an invented missing key and `/media/t/<tenant>/source/<key>`: no positive cache entry or public/immutable error lifetime. Unit fixtures prove logic; Node e2e bypasses the Workers cache, and neither substitutes for this deployed read-back.

This is a per-data-center cache without tiered caching. It saves R2 work on hits, not Worker invocations, and makes no capacity or latency guarantee. Deleting R2 does not revoke existing browser downloads; an old edge copy may last one hour. For an urgent public-image withdrawal, remove its menu references and use Cloudflare's supported URL purge if available for the deployed cache; do not claim that a local `cache.delete` purges every data center. Roll back the feature commit through the normal release process to return reads to NuxtHub; do not publish private buckets as a workaround. See [the plan](../plans/cloudflare-improvements.md#step-4-public-image-edge-delivery-d218) and [evidence](../progress.md#cloudflare-public-image-delivery-d218-2026-10-27).

### Account browser verification (D217)

Deployed staging/production builds enable `humanCheck` and their own public sitekey. Each existing Worker holds `NUXT_HUMAN_CHECK_SECRET` as a private binding; never copy it into vars, CI logs, source or chat. `NUXT_HUMAN_CHECK_ENABLED` and `NUXT_PUBLIC_HUMAN_CHECK_ENABLED` must agree. Local/e2e defaults off; test keys/fixtures are not accepted as a production bypass. The backend validates the exact hostname from `NUXT_PUBLIC_SITE_URL`, never a client-provided host allowlist.

Only password sign-in, sign-up, reset-email requests and verification-email resends require a token. A failed/blocked/expired browser challenge can be retried or cancelled without losing input. A missing key or unavailable Siteverify fails closed; submit again to generate a new single-use token. Do not retry a token-bearing auth write automatically. Existing guest ordering, 2FA, OAuth, callbacks, health and polling are unchallenged. Existing per-IP auth/guest limits remain and can affect a shared Wi-Fi connection; challenge verification is not a capacity guarantee.

Verify real challenge success and token replay rejection on deployed staging before production release. Binding-name read-back only confirms configuration. Roll back feature code through the normal release process if needed; restoring matching client/server configuration is preferable to leaving one side enabled. Bot Fight Mode remains off (D214). See [D217 evidence](../progress.md#cloudflare-account-bot-protection-d217-2026-10-27).

### Browser performance and usage (D216)

Use the existing Cloudflare Web Analytics automatic installation; do not add a second manual beacon. Public menu documents permit only the official beacon file/version path, and collection stays at same-origin `/cdn-cgi/rum`. Direct account/workspace/order pages retain the restrictive CSP. Token entry documents (`/table/**`, `/reset-password`, `/verify-email`) use `no-store, no-transform` to prevent automatic injection; `strict-origin` referrers omit prior paths. These are document controls, not an SPA route firewall: an already loaded beacon can still observe subsequent SPA paths. Never put secrets or PII into analytics dimensions; review future internal navigation to token-bearing routes.

The live free analytics rule was narrowed from `*` to `/c/*`, but a rule read-back alone did not prove HTML exclusion. Verify both the beacon and response headers after deployment. See the [dated baseline](../reviews/cloudflare-monitoring-baseline-2026-10-26.md) for actual observations, sampling semantics, SQL examples, budget limits and rollout checks. Keep Worker logging sampling unchanged until measured volume justifies tuning it. Early RUM samples are not a capacity or mobile performance verdict.


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
