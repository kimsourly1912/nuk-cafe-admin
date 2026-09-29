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
| Secrets | `NUXT_BETTER_AUTH_SECRET` (set once with `wrangler secret put`; generated, never written down); `NUXT_MAIL_RESEND_API_KEY` (from the GitHub environment `staging`, re-sent by every deploy). `NUXT_MAIL_FROM` is a plain var |

**Deploy by hand only what is on `main`** (or the branch about to be merged next): a branch deploy runs its migrations ahead of `main`, and the next deploy from `main` then runs older code against a newer database. (Happened in step 3.1: fixed by merging it right after.)

**Deploys** (step 2.2, D54): every push to `main` that passes the checks deploys itself (`.github/workflows/ci.yml` → `deploy-staging`). By hand, with Wrangler logged in (`npx wrangler login`): `pnpm deploy:staging` = `pnpm build:staging` (`nuxt build --envName staging`) → `pnpm db:migrate:staging` (`wrangler d1 migrations apply DB --remote`, tracked in `_hub_migrations`) → `wrangler deploy`.

**First admin on staging:** there's no seed endpoint on a deployed Worker (`/_nitro/tasks` is dev only). Sign up on the site (`POST /api/auth/sign-up/email`, or the customer sign-up page once it exists), then promote the account:

```bash
npx wrangler d1 execute nuk-cafe-staging --remote --command "UPDATE user SET role = 'admin' WHERE email = 'you@example.com'"
```

Everyone else is added from the Staff page. The demo branch was inserted the same way ("Main branch").

## Configuration

Runtime config comes from environment variables (`NUXT_…`); secrets are Cloudflare secrets, never committed. `.env.example` lists every name.

| Variable | Purpose | Local | Staging / production |
|---|---|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Signs sessions and tokens | `.env` | secret |
| `NUXT_PUBLIC_SITE_URL` | The app's origin (trusted origins, links in emails) | `http://localhost:3000` | the environment's URL |
| `NUXT_MAIL_RESEND_API_KEY` | Sending email | unset (console mail) | secret |
| `NUXT_MAIL_FROM` | Sender address | | e.g. `NUK Cafe <no-reply@…>` |
| `NUXT_QR_SECRET` | Signs table QR tokens (D91). **Changing it invalidates every printed QR** | unset (the dev server uses a local secret) | secret, set once per environment (`wrangler secret put NUXT_QR_SECRET`); without it the table routes answer 500 `QR_NOT_CONFIGURED` |
| `NUXT_SEED_ADMIN_EMAIL` / `_NAME` | The seed task's first admin | `.env` | not used (see Staging → First admin) |

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
- Seed data comes from a **Nitro task**, never from migrations. `db:seed` (`server/tasks/db/seed.ts`) creates the first admin (from `NUXT_SEED_ADMIN_EMAIL` / `NUXT_SEED_ADMIN_NAME`, with a temporary password printed once) and a "Main branch" (in `NUXT_PUBLIC_CAFE_TIME_ZONE`); each part is skipped once it exists, so it's safe to repeat. Locally, with the dev server running: `curl http://localhost:3000/_nitro/tasks/db:seed` (the Nuxt CLI has no `task` command; that endpoint exists only in dev). Deployed environments don't run it: see Staging → First admin. A demo menu comes with the menu steps.

## Deploys

CI on every push and pull request (`.github/workflows/ci.yml`), as parallel jobs: `check` (lint, typecheck, `pnpm audit --audit-level high`, unit + server tests) and `e2e (1/3)` to `e2e (3/3)` (`vitest --shard`, each builds the app once). Lower advisories are reviewed with dependency updates.

On push to `main`, after those pass, the `deploy-staging` job (GitHub environment `staging`, one deploy at a time, never cancelled halfway):
1. `pnpm build:staging`;
2. `pnpm db:migrate:staging` (migrations before the Worker: expand, then contract);
3. `wrangler deploy`;
4. re-sends `NUXT_MAIL_RESEND_API_KEY` from the environment's secret (skipped when unset);
5. smoke check: `GET /api/public/health` is ok (the database answers), `/login` has the CSP header, an unknown `/api` path is 404, `/api/admin/me` without a session is 401. Later: sign in, read the menu, place and complete a test order once orders exist.

GitHub environment `staging` secrets: `CLOUDFLARE_API_TOKEN` (template "Edit Cloudflare Workers" plus **Account → D1 → Edit**, this account only), `CLOUDFLARE_ACCOUNT_ID`, `NUXT_MAIL_RESEND_API_KEY`.

Production: manual workflow from a commit that is live on staging: export the database (Time Travel bookmark), apply migrations, deploy, smoke check. Rollback = redeploy the previous Worker version (possible because migrations are backwards compatible).

## Backups and restore

- **D1 Time Travel**: point-in-time restore for the retention window of the Cloudflare plan (checked on staging: `wrangler d1 time-travel info nuk-cafe-staging` gives the current bookmark). Note the bookmark before every production migration.
- **R2**: menu images are re-uploadable; no separate backup at launch.
- **Restore drill** on staging before launch and then yearly: restore to a bookmark, check the app works, write down how long it took.
- [Open] Q24: acceptable data loss and downtime (RPO/RTO) and the Cloudflare plan (Time Travel window).

## Scheduled jobs

Nitro tasks in `server/tasks/`, scheduled in `nuxt.config.ts` (`nitro.scheduledTasks`, cron in UTC): Cloudflare cron triggers in deployed environments; the dev server runs them itself. Every task is **idempotent** (safe to run twice) and logs what it did. Locally a task runs on demand with `curl http://localhost:3000/_nitro/tasks/<name>` (dev only).

Built so far: `platform:deliver-outbox` (every minute), `platform:expire-idempotency-keys` (daily at 03:15 UTC) and `media:purge-temporary` (hourly at :05).

| Task | Schedule | Does |
|---|---|---|
| `media:purge-temporary` | hourly | Deletes temporary assets older than 24 h and their R2 objects |
| `platform:expire-idempotency-keys` | daily | Removes expired idempotency keys |
| `platform:deliver-outbox` | every minute | Sends pending outbox messages with retries and backoff |
| `loyalty:expire-vouchers` | daily | Marks vouchers past `expires_at` as expired |
| `orders:expire-unpaid` | every 5 minutes | Cancels orders still unpaid 30 minutes after placing (D45) |

## Email

- **Resend**, called only by outbox handlers (`identity.mail.ts`: verification, password reset), never inside a request. Each send passes the outbox message id as Resend's `Idempotency-Key`, so a repeated delivery isn't sent twice.
- Config: `NUXT_MAIL_RESEND_API_KEY` and `NUXT_MAIL_FROM` (`"NUK Cafe <no-reply@…>"`, a domain verified in Resend, with SPF, DKIM and DMARC; the domain waits on Q4).
- **Locally**, without a key, the dev server prints each email (with its link) to the console. A production build without a key **refuses** to send (the messages stay queued and are logged as failing), so one-time links never land in production logs.
- Delivery takes up to a minute (the outbox task's schedule).
- Templates: plain, short, the app's name, one link; no tracking pixels. English only until translations are decided (Q21).

## Monitoring

- **Workers Logs** for structured logs (see [security.md → Logging](./security.md#logging-and-privacy)); every error log has the request id.
- `GET /api/public/health` answers 200 when the Worker can reach D1 (no details).
- Alerts (Cloudflare notifications) on a spike of 5xx responses and on Worker exceptions.
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
