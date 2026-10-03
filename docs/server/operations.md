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
| Email | logged to the console, not sent | Resend's test sender `onboarding@resend.dev`: delivers only to the Resend account's own address (until the domain, Q4) | Resend, from our domain |

Nothing crosses environments: no production data in staging, no shared secrets, no shared buckets.

### Staging (step 2.1, D53)

| | |
|---|---|
| URL | https://nuk-cafe-staging.kimsur61.workers.dev (a `workers.dev` address until a domain is chosen, Q4) |
| Worker | `nuk-cafe-staging`, account `Kimsur61@gmail.com's Account` |
| D1 | `nuk-cafe-staging` (`33752107-bc40-4c31-8ff0-d3c50dc6a3a2`, Asia-Pacific), binding `DB` |
| R2 | `nuk-cafe-staging-media` (created in eastern North America: the tool had no location option), binding `BLOB` |
| Config | `$env.staging` in `nuxt.config.ts` (preset `cloudflare_module`, bindings, `NUXT_PUBLIC_SITE_URL` as a plain var, cron triggers, Workers Logs, security headers) |
| Secrets | `NUXT_BETTER_AUTH_SECRET` (set once with `wrangler secret put`; generated, never written down); `NUXT_MAIL_RESEND_API_KEY` (from the GitHub environment `staging`, re-sent by every deploy). `NUXT_MAIL_FROM` is a plain var. The AI assistant: `NUXT_AI_API_KEY` (a Worker secret the owner sets; an OpenAI key), `NUXT_AI_PROVIDER` = `openai` and `NUXT_AI_MODEL` = `gpt-5.4-mini` as plain vars in `nuxt.config.ts` (owner, 2026-09-30, D108) |

**Deploy by hand only what is on `main`** (or the branch about to be merged next): a branch deploy runs its migrations ahead of `main`, and the next deploy from `main` then runs older code against a newer database. (Happened in step 3.1: fixed by merging it right after.)

**Deploys** (step 2.2, D54, D133): every push to `main` deploys itself (its pull request ran the checks) (`.github/workflows/ci.yml` → `deploy-staging`). By hand, with Wrangler logged in (`npx wrangler login`): `pnpm deploy:staging` = `pnpm build:staging` (`nuxt build --envName staging`) → `pnpm db:migrate:staging` (`wrangler d1 migrations apply DB --remote`, tracked in `_hub_migrations`) → `wrangler deploy`.

**First owner on staging** (D135): there's no seed endpoint on a deployed Worker (`/_nitro/tasks` is dev only). On the existing staging database nothing is needed: migration `0024_tenants` made the data the tenant "NUK Cafe" (`nuk`) and its admins its owners. On an empty database: sign up on the site, then create the cafe and make the account its owner:

```bash
npx wrangler d1 execute nuk-cafe-staging --remote --command "INSERT INTO organization (id, name, slug, created_at, status, version) VALUES (lower(hex(randomblob(16))), 'NUK Cafe', 'nuk', unixepoch() * 1000, 'active', 1)"
npx wrangler d1 execute nuk-cafe-staging --remote --command "INSERT INTO member (id, organization_id, user_id, role, created_at) SELECT lower(hex(randomblob(16))), o.id, u.id, 'owner', unixepoch() * 1000 FROM organization o, user u WHERE o.slug = 'nuk' AND u.email = 'you@example.com'"
```

Everyone else is added from the Staff page; branches come from the seed locally, or an insert into `branches` with the tenant's id. The global `admin` role is gone (D135): `superadmin` is the platform team's, set the same way on `user.role` when the platform console exists (T2).

**Migration `0024_tenants` (D135)** rebuilds the branch and order tables. Before the deploy that carries it, note the time for a D1 Time Travel restore (Restore drill below); after it, admin sign-in, the menu, a dine-in order and the counter are checked by hand.

**Migration `0025_menu_tenants` (D136)** rebuilds the menu tables and `media_assets` the same way. Same routine: note the time before the deploy; after it, the admin menu screens, an item's photo, a new upload (its URL under `/media/t/…`), sold out at the counter and a checkout are checked by hand.

**Migration `0026_tenant_settings` (D137)** rebuilds `customer_profiles`, `khqr_settings` and `exchange_rates` with the tenant. Same routine; afterwards: the account menu's member code (unchanged), Payments (the riel rate and the KHQR settings as before), a riel cash payment and a KHQR at the counter.

**Migration `0027_telegram_tenants` (D138)** rebuilds the Telegram tables with the tenant and names the tenant on the orders' outbox events. Same routine; afterwards: the Telegram page (chats, switches, delivery history as before), Send test, and an order placed and paid: its new-order and payment alerts arrive.

**Migration `0028_platform_tenants` (D139)** rebuilds `idempotency_keys`, `assistant_usage` and `sample_data_runs` with the tenant and gives `audit_events` a tenant column (every existing event NUK Cafe's). Same routine; afterwards: an admin change (a menu item saved), the assistant (a question, "used today" as before), Sample data (the page's state as before), and an order placed and paid at the counter.

## Configuration

Runtime config comes from environment variables (`NUXT_…`); secrets are Cloudflare secrets, never committed. `.env.example` lists every name.

| Variable | Purpose | Local | Staging / production |
|---|---|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Signs sessions and tokens | `.env` | secret |
| `NUXT_PUBLIC_SITE_URL` | The app's origin (trusted origins, links in emails) | `http://localhost:3000` | the environment's URL |
| `NUXT_MAIL_RESEND_API_KEY` | Sending email | unset (console mail) | secret |
| `NUXT_MAIL_FROM` | Sender address | | e.g. `NUK Cafe <no-reply@…>` |
| `NUXT_PUBLIC_SAMPLE_DATA_ENABLED` / `_ENVIRONMENT` | The Sample data page and its routes (D94), and the environment's name on it | on (`Local`, the dev server only) | `true` / `Staging` (`wrangler.vars` in `nuxt.config.ts`); **never set in production** (the routes answer 404) |
| `NUXT_QR_SECRET` | Signs table QR tokens (D91). **Changing it invalidates every printed QR** | unset (the dev server uses a local secret) | secret, set once per environment (`wrangler secret put NUXT_QR_SECRET`); without it the table routes answer 500 `QR_NOT_CONFIGURED` |
| `NUXT_AI_PROVIDER`, `NUXT_AI_MODEL`, `NUXT_AI_API_KEY`, `NUXT_AI_BASE_URL`, `NUXT_AI_DAILY_LIMIT` | The AI assistant (D107, D108): the provider (`anthropic` \| `openai` \| `google` \| `openai-compatible`), its model id, the key, a base URL (required for `openai-compatible`; optional for a proxy), requests per admin per day (default 100) | unset (the assistant is off: its routes answer 404) | the key is a secret (`wrangler secret put NUXT_AI_API_KEY`), the rest plain variables; a key with an unknown provider, no model or (for `openai-compatible`) no URL answers 500 `AI_NOT_CONFIGURED`. Set a spending cap on the provider's account (Q43) |
| `NUXT_TELEGRAM_BOT_TOKEN`, `NUXT_TELEGRAM_BOT_USERNAME`, `NUXT_TELEGRAM_WEBHOOK_SECRET` | Telegram (D112): the bot's token from @BotFather, its name without `@`, and the secret Telegram sends with every webhook call (32–256 letters, digits, `_` or `-`) | unset (Telegram is off: its routes answer 404, the Telegram page says it isn't set up) | all three are Worker secrets (`wrangler secret put …`; the name isn't secret, but a secret survives every deploy: see [Telegram](#telegram)); a token without a valid name or secret answers 500 `TELEGRAM_NOT_CONFIGURED`. Then point the webhook at the site once: [Telegram](#telegram) |
| `NUXT_BAKONG_TOKEN`, `NUXT_BAKONG_API_URL` | Checking counter KHQRs with Bakong (D131): the Bakong Open API token (90 days) and its address (default `https://api-bakong.nbc.gov.kh`; a relay can stand in front of it) | unset (cashiers confirm KHQR payments by hand) | the token is a Worker secret (`wrangler secret put NUXT_BAKONG_TOKEN`), renewed every 90 days: see [KHQR](#khqr) |
| `NUXT_SEED_ADMIN_EMAIL` / `_NAME` | The seed task's first owner of the cafe | `.env` | not used (see Staging → First owner) |

Bindings (D1, R2, KV) are configured per environment in `nuxt.config.ts` (`$env.<name>`: NuxtHub turns `hub.db.connection.databaseId` and `hub.blob.bucketName` into the Worker's `DB` and `BLOB` bindings), not as variables. **`--envName staging` replaces `$production`**: settings every deployed build needs (the security headers) are repeated in each environment block.

## Migrations

1. Change the feature's `*.schema.ts`.
2. `pnpm nuxt db generate`; **read the SQL**; rename the file to say what it does (update its tag in `meta/_journal.json`).
3. Local dev applies pending migrations on start. Tests build their database from the same files.
4. Before deploying the Worker: `wrangler d1 migrations apply DB --remote --config .output/server/wrangler.json` (`pnpm db:migrate:staging`). NuxtHub copies the migrations into the build and names the table `_hub_migrations`.

Rules:
- **Expand, then contract.** The new Worker starts after the migration, and the old one may still serve requests for a moment, so a migration must work with both: add columns/tables first, move the code, remove old columns in a later release.
- No destructive change (dropping a column or table, narrowing a type) without an export of the affected data first.
- Migrations are never edited after they reached staging; fix forward with a new one.
- Seed data comes from a **Nitro task**, never from migrations. `db:seed` (`server/tasks/db/seed.ts`) creates the cafe (the tenant "NUK Cafe", D135), its first owner (from `NUXT_SEED_ADMIN_EMAIL` / `NUXT_SEED_ADMIN_NAME`, with a temporary password printed once) and a "Main branch" (in `NUXT_PUBLIC_CAFE_TIME_ZONE`); each part is skipped once it exists, so it's safe to repeat. Locally, with the dev server running: `curl http://localhost:3000/_nitro/tasks/db:seed` (the Nuxt CLI has no `task` command; that endpoint exists only in dev). Deployed environments don't run it: see Staging → First owner. Test data beyond that comes from the admin's **Sample data** page (D94), not from a task: a sample menu in three sizes, branch hours and tables, and a reset, where `NUXT_PUBLIC_SAMPLE_DATA_ENABLED` is on.

## Deploys

CI on every pull request and on demand (`.github/workflows/ci.yml`, Actions → CI → Run workflow), as parallel jobs: `check` (lint, typecheck, `pnpm audit --audit-level high`, unit + server tests) and `e2e (1/3)` to `e2e (3/3)` (`vitest --shard`, each builds the app once). Lower advisories are reviewed with dependency updates.

On push to `main` (a merged pull request, already checked there: D133), the `deploy-staging` job runs straight away (GitHub environment `staging`, one deploy at a time, never cancelled halfway):
1. `pnpm build:staging`;
2. `pnpm db:migrate:staging` (migrations before the Worker: expand, then contract);
3. `wrangler deploy`;
4. re-sends `NUXT_MAIL_RESEND_API_KEY` from the environment's secret (skipped when unset);
5. smoke check: `GET /api/health` is ok (the database answers), NUK Cafe's `/c/nuk/admin/login` has the CSP header and `/admin/login` redirects there (D141), an unknown `/api` path is 404, NUK Cafe's `/api/c/nuk/admin/me` without a session is 401 (D140). Later: sign in, read the menu, place and complete a test order once orders exist.

GitHub environment `staging` secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" plus **Account → D1 → Edit**, this account only), `CLOUDFLARE_ACCOUNT_ID`, `NUXT_MAIL_RESEND_API_KEY`.

Production: manual workflow from a commit that is live on staging: export the database (Time Travel bookmark), apply migrations, deploy, smoke check. Rollback = redeploy the previous Worker version (possible because migrations are backwards compatible).

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
   - `https://nuk-cafe-staging.kimsur61.workers.dev/api/health` answers 200;
   - the **Restore drill** category is gone;
   - you can sign in to the admin, the customer menu loads, and the counter queue opens.
5. **Write it down** in `docs/progress.md` (step 10.4): the date, how long step 3 took, and anything that didn't work.

**With Wrangler** (the same, from a terminal; also what a script would use): `npx wrangler d1 time-travel info nuk-cafe-staging` prints the current bookmark; `npx wrangler d1 time-travel restore nuk-cafe-staging --bookmark=<bookmark>` restores to it and prints the one from before the restore.

**Done 2026-10-01 by the owner** (dashboard, by date): restored in about 2 seconds; afterwards admin sign-in, the customer menu and the counter worked with their data.

For production (8.2): note the bookmark before every migration (see Deploys); a restore there loses real orders written after the bookmark, so it's the last resort after redeploying the previous Worker.
- [Open] Q24: acceptable data loss and downtime (RPO/RTO) and the Cloudflare plan (Time Travel window).

## Scheduled jobs

Nitro tasks in `server/tasks/`, scheduled in `nuxt.config.ts` (`nitro.scheduledTasks`, cron in UTC): Cloudflare cron triggers in deployed environments; the dev server runs them itself. Every task is **idempotent** (safe to run twice) and logs what it did. Locally a task runs on demand with `curl http://localhost:3000/_nitro/tasks/<name>` (dev only).

Built so far: `platform:deliver-outbox`, `orders:expire-unpaid` and `notifications:deliver` (every minute), `platform:expire-idempotency-keys`, `assistant:purge-usage` and `notifications:purge-deliveries` (daily at 03:15 UTC) and `media:purge-temporary` (hourly at :05).

| Task | Schedule | Does |
|---|---|---|
| `media:purge-temporary` | hourly | Deletes temporary assets older than 24 h and their R2 objects |
| `platform:expire-idempotency-keys` | daily | Removes expired idempotency keys |
| `assistant:purge-usage` | daily | Removes AI assistant usage rows older than 90 days (D108) |
| `platform:deliver-outbox` | every minute | Sends pending outbox messages with retries and backoff |
| `notifications:deliver` | every minute | Queues the closing summaries that are due and sends due Telegram deliveries, with retries (D113) |
| `notifications:purge-deliveries` | daily | Removes Telegram deliveries older than 90 days |
| `loyalty:expire-vouchers` | daily | Marks vouchers past `expires_at` as expired |
| `orders:expire-unpaid` | every minute | Cancels orders still unpaid 30 minutes after placing (D45, D104): 100 a run, each guarded by status and version (a payment at that moment wins), an event with no actor and an audit entry |

## Email

- **Resend**, called only by outbox handlers (`identity.mail.ts`: verification, password reset), never inside a request. Each send passes the outbox message id as Resend's `Idempotency-Key`, so a repeated delivery isn't sent twice.
- Config: `NUXT_MAIL_RESEND_API_KEY` and `NUXT_MAIL_FROM` (`"NUK Cafe <no-reply@…>"`, a domain verified in Resend, with SPF, DKIM and DMARC; the domain waits on Q4).
- **Locally**, without a key, the dev server prints each email (with its link) to the console. A production build without a key **refuses** to send (the messages stay queued and are logged as failing), so one-time links never land in production logs.
- Delivery takes up to a minute (the outbox task's schedule).
- Templates: plain, short, the app's name, one link; no tracking pixels. English only until translations are decided (Q21).

## Telegram

The bot sends reports and (from 8.1d) alerts to the chats connected on **Admin → Telegram** (D112). Telegram calls our webhook, `POST /api/webhooks/telegram`, which checks the secret header before reading anything.

**Setting up an environment** (the owner, on their own machine; the token is never pasted into a chat or a file in the repository):

1. In Telegram, talk to **@BotFather**: `/newbot`, choose a name (e.g. "NUK Cafe") and a username ending in `bot` (e.g. `NukCafeBot`). It answers with the **token**. `/setjoingroups` → Enable (so it can join the staff group); `/setprivacy` → Enable (it only sees commands in groups).
2. Make a webhook secret: 48 random characters, e.g. `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
3. Set all three on the Worker as secrets: `wrangler secret put NUXT_TELEGRAM_BOT_TOKEN`, `… NUXT_TELEGRAM_WEBHOOK_SECRET` and `… NUXT_TELEGRAM_BOT_USERNAME` (the name without `@`, e.g. `nuk_cafe_bot`; not secret, but a secret survives every deploy, while a plain variable set in the dashboard is replaced by the deploy's, and the same name as both a variable in `nuxt.config.ts` and a secret makes the deploy fail). Staging: `@nuk_cafe_bot`, set by the owner on 2026-09-30.
4. Point the webhook at the site, once (and again if the address or the secret changes):
   `curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://<site>/api/webhooks/telegram -d secret_token=<SECRET> -d 'allowed_updates=["message","my_chat_member"]'`
   Telegram answers `{"ok":true,…}`. `…/getWebhookInfo` shows the last error, if any.
   On Windows, PowerShell mangles the quotes `curl.exe` gets; this asks for the token and the secret without showing them (staging was set up this way):
   ```powershell
   $t = Read-Host 'Bot token' -AsSecureString; $s = Read-Host 'Webhook secret' -AsSecureString
   $token = [Net.NetworkCredential]::new('', $t).Password; $secret = [Net.NetworkCredential]::new('', $s).Password
   $body = @{ url = 'https://<site>/api/webhooks/telegram'; secret_token = $secret; allowed_updates = @('message', 'my_chat_member') } | ConvertTo-Json
   Invoke-RestMethod -Method Post -ContentType 'application/json' -Uri "https://api.telegram.org/bot$token/setWebhook" -Body $body
   Invoke-RestMethod "https://api.telegram.org/bot$token/getWebhookInfo" | Select-Object -ExpandProperty result
   Remove-Variable token, secret, t, s
   ```
   Cloudflare never shows a secret again: if the webhook secret wasn't kept, make a new one and set it on the Worker and here. A 401 or 403 in `last_error_message` means the two differ.
5. Open **Admin → Telegram** and connect your private chat and the staff group.

Locally Telegram can't reach the dev server, so connecting is tested against staging; the server tests use a fake Telegram (grammY's `Api` with its `fetch` replaced).

**Notifications (8.1d, D113):** on the Telegram page, each chat can get **new orders**, **payments** and the **closing summary** (with its CSV as a second message). Orders write `orders.placed` / `orders.paid` outbox events in their own batches; `platform:deliver-outbox` turns them into deliveries (one per chat and order) and sends them at once. `notifications:deliver` (every minute) queues each branch's closing summary 30 minutes after the business day's last opening window ends (not on a closed day; skipped if more than 12 hours late) and sends whatever is due: Telegram's wait is respected, other failures back off 1, 2, 4 … minutes, and after 8 tries a delivery is **Failed** (Retry on the page). The history is kept 90 days (`notifications:purge-deliveries`). A lost answer after Telegram accepted a message can repeat it (Telegram has no idempotency key).

**How it behaves:** connect links work once, for 10 minutes, and only their hash is stored; a group is connected only after an admin of that group added the bot and a portal admin confirmed it. A chat that removed or blocked the bot is marked **Blocked**; a group upgraded to a supergroup keeps working (its new id is followed). A send that fails says why (blocked, Telegram's wait, or refused) and can be tried again with the same idempotency key, so a lost answer never sends twice.

## KHQR

The counter shows a KHQR made for each order (D130), set up on **Admin → Payments → KHQR at the counter**. With a Bakong token on the Worker, the counter also asks the server every 5 seconds whether the QR was paid, and the server asks the **Bakong Open API** (`check_transaction_by_md5`, by the QR text's MD5): paid to the cafe's account in the QR's currency and amount, the payment is recorded as the cashier whose screen asked (D131). Without the token, or when Bakong doesn't answer, cashiers confirm by hand as before.

**Setting the token** (the owner, on their own machine; the token is never pasted into a chat or a file in the repository):

1. Get the token from Bakong's developer portal (`api-bakong.nbc.gov.kh`, registered with the cafe's email). It lasts **90 days**.
2. Set it on the Worker: `npx wrangler secret put NUXT_BAKONG_TOKEN --name <worker>` (staging: `nuk-cafe-staging`) and paste it when asked; or in the Cloudflare dashboard: Workers → the Worker → Settings → Variables and Secrets → Add → type **Secret**. The Worker restarts with it; no deploy is needed.
3. Open **Admin → Payments**: **Automatic check with Bakong** says **On**. Press **Test connection**:
   - **Connected**: Bakong answered. Try one real order at the counter (a small one: the money goes to the cafe's own account).
   - **Bakong didn't accept the token**: it was mistyped or has expired: set it again.
   - **Bakong refused this server**: Bakong reportedly answers only servers in Cambodia in production, and a Worker runs in Cloudflare's data center nearest the request (often Singapore for Phnom Penh). Cashiers confirm by hand meanwhile. The free way around it is a small relay inside Cambodia (a Cloudflare Tunnel to a device at the cafe, which needs a domain, Q4) with `NUXT_BAKONG_API_URL` pointing at it.

**Renewing:** set the new token the same way before the 90 days end. The app reads the expiry date from the token (D132): **Payments** shows it ("Token expires 21 Dec 2026 · 80 days left", amber within 14 days), and Telegram reminds the chats with **Server errors and reminders** on 14, 7, 3 and 1 days before and on the day; a new token's date replaces the old one by itself. An expired token shows at the counter as "Automatic check unavailable" and on Payments as "Bakong didn't accept the token"; payments are never lost meanwhile, they are confirmed by hand.

## Monitoring

- **Workers Logs** for structured logs (see [security.md → Logging](./security.md#logging-and-privacy)); every error log has the request id.
- `GET /api/health` answers 200 when the Worker can reach D1 (no details).
- **Server error alerts on Telegram** (step 10.4, D119): Admin → Telegram → Notifications → **Server errors**, per chat. Every unexpected failure (a 500 on `/api/**`) queues an alert with the route, the status and the request id (never the error's text: it stays in Workers Logs, found by the request id); at most one per route and chat every 15 minutes; sent by `notifications:deliver` within a minute. Not covered: a failure the Worker can't answer at all (it never reaches the handler), and scheduled tasks (their failures are logged).
- Alerts (Cloudflare notifications) on a spike of 5xx responses and on Worker exceptions: set up with production (8.2).
- [Open] Q24: who receives alerts, and during which hours.

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
| libsql loads its native binary through a computed `require()` that Nitro's tracer can't follow | A `compiled` hook in `nuxt.config.ts` copies it into node builds (local and e2e); see D46 |
| A production build (`NODE_ENV=production`) refuses to serve auth without `NUXT_PUBLIC_SITE_URL` | Set it for every built server, including local smoke runs of `.output` |
| Local dev uses libsql; the server tests use in-memory libsql built from the migrations | The batch guards are proven on libsql; staging (step 2.2) proves them on D1 |

Sources: [NuxtHub database](https://hub.nuxt.com/docs/database), [NuxtHub migrations](https://hub.nuxt.com/docs/database/migrations), [Nuxt Better Auth + NuxtHub](https://better-auth.nuxt.dev/integrations/nuxthub), [D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/), [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).
