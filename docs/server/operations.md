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

---

## Environments

| | Local | Staging | Production |
|---|---|---|---|
| Runs | `pnpm dev` | Cloudflare Worker | Cloudflare Worker |
| Database | SQLite in `.data/db` | its own D1 | its own D1 |
| Files | `.data/blob` | its own R2 bucket | its own R2 bucket |
| Cache | local | its own KV | its own KV |
| Deployed | | on every merge to `main` | manually, from a commit that passed staging |
| Data | disposable, seeded | test data only, reset freely | real |
| Email | logged to the console, not sent | Resend, delivered only to an allowlist of team addresses | Resend |

Nothing crosses environments: no production data in staging, no shared secrets, no shared buckets.

## Configuration

Runtime config comes from environment variables (`NUXT_…`); secrets are Cloudflare secrets, never committed. `.env.example` lists every name.

| Variable | Purpose | Local | Staging / production |
|---|---|---|---|
| `NUXT_BETTER_AUTH_SECRET` | Signs sessions and tokens | `.env` | secret |
| `NUXT_PUBLIC_SITE_URL` | The app's origin (trusted origins, links in emails) | `http://localhost:3000` | the environment's URL |
| `NUXT_RESEND_API_KEY` | Sending email | unset (console mail) | secret |
| `NUXT_MAIL_FROM` | Sender address | | e.g. `NUK Cafe <no-reply@…>` |
| `NUXT_MAIL_ALLOWLIST` | Staging: only these recipients receive mail | | staging only |

Bindings (D1, R2, KV) are configured per environment in the NuxtHub / Wrangler config, not as variables.

## Migrations

1. Change the feature's `*.schema.ts`.
2. `pnpm nuxt db generate`; **read the SQL**; rename the file to say what it does (update its tag in `meta/_journal.json`).
3. Local dev applies pending migrations on start. Tests build their database from the same files.
4. CI applies migrations to the environment's D1 **before** deploying the Worker (exact command set up in the staging phase).

Rules:
- **Expand, then contract.** The new Worker starts after the migration, and the old one may still serve requests for a moment, so a migration must work with both: add columns/tables first, move the code, remove old columns in a later release.
- No destructive change (dropping a column or table, narrowing a type) without an export of the affected data first.
- Migrations are never edited after they reached staging; fix forward with a new one.
- Seed data (the first admin, a demo branch and menu locally) comes from a **Nitro task** (`pnpm nuxt task run db:seed`), never from migrations.

## Deploys

CI on every push and pull request: lint, typecheck, unit + server tests, e2e, `pnpm audit`.

On merge to `main`: the same checks, then apply staging migrations, deploy to staging, run a smoke check (sign in, read the menu, place and complete a test order once orders exist).

Production: manual workflow from a commit that is live on staging: export the database (Time Travel bookmark), apply migrations, deploy, smoke check. Rollback = redeploy the previous Worker version (possible because migrations are backwards compatible).

## Backups and restore

- **D1 Time Travel**: point-in-time restore for the retention window of the Cloudflare plan. Note the bookmark before every production migration.
- **R2**: menu images are re-uploadable; no separate backup at launch.
- **Restore drill** on staging before launch and then yearly: restore to a bookmark, check the app works, write down how long it took.
- [Open]: acceptable data loss and downtime (RPO/RTO) and the Cloudflare plan (Time Travel window).

## Scheduled jobs

Nitro tasks in `server/tasks/`, triggered by Cloudflare cron (`nitro.scheduledTasks`). Every task is **idempotent** (safe to run twice) and logs what it did.

| Task | Schedule | Does |
|---|---|---|
| `media:purge-temporary` | hourly | Deletes temporary assets older than 24 h and their R2 objects |
| `platform:expire-idempotency-keys` | daily | Removes expired idempotency keys |
| `platform:deliver-outbox` | every minute | Sends pending outbox messages with retries and backoff |
| `loyalty:expire-vouchers` | daily | Marks vouchers past `expires_at` as expired |
| `orders:expire-unpaid` | [Open] | Cancels unpaid orders after the agreed time |

## Email

- **Resend**, called only from the `identity` feature's mail sender (verification, password reset) and later the outbox.
- A sending domain with SPF, DKIM and DMARC set up before launch.
- Templates: plain, short, the app's name, one link; no tracking pixels. English only until translations are decided (Q21).
- Locally, mail is printed to the console (with the link) instead of sent.

## Monitoring

- **Workers Logs** for structured logs (see [security.md → Logging](./security.md#logging-and-privacy)); every error log has the request id.
- `GET /api/public/health` answers 200 when the Worker can reach D1 (no details).
- Alerts (Cloudflare notifications) on a spike of 5xx responses and on Worker exceptions.
- [Open]: who receives alerts, and during which hours.
