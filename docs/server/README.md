# Server standard

How the NUK Cafe server is designed and built. Every server change follows these pages; a change that needs to break a rule updates the page (and [decisions.md](../decisions.md)) in the same change.

| Page | Contents |
|---|---|
| [Architecture & conventions](./architecture.md) | Surfaces and routes, features and their layers (service, repository, errors, types…), the anatomy of a route, ids, money, time, errors, validation, archiving, versions, idempotency, tests |
| [Security & hardening](./security.md) | Identity (Better Auth), roles and permissions, sessions, email verification, staff onboarding, CSRF, headers, rate limits, uploads, secrets, logging |
| [Data model](./data-model.md) | The tables per domain (identity, branch, menu, customers & loyalty, orders), their invariants and open questions |
| [Operations](./operations.md) | Environments, configuration, migrations, deploys, backups, scheduled jobs, email, monitoring |

**Status (2026-09-27):** this is the target standard. The code built before it (`/api/v1`, the current `server/features/` without layers, `staff_profiles`, the menu tables of D41) does **not** follow it yet and is replaced step by step. See [progress.md](../progress.md).

## Decisions this standard is built on

Agreed with the project owner on 2026-09-27 (D43; the menu model in D44):

| Topic | Decision |
|---|---|
| Clients | One Nuxt app: customer website, admin workspace and cashier workspace share one origin, one session cookie and one deploy |
| Routes | Nuxt-native, **unversioned**: `/api/<surface>/<resource>` file routes; response types inferred by Nuxt's typed `$fetch` |
| Code layout | **Features** in `server/features/<feature>/`, each with fixed layers: `index.ts`, `*.schema.ts`, `*.types.ts`, `*.repository.ts`, `*.service.ts`, `*.errors.ts`, optional `*.rules.ts` / `*.mappers.ts`, `tests/`; route files stay thin (revised 2026-09-27) |
| Validation | **Valibot** (shared with the app's forms) |
| Roles | Platform `admin` (Better Auth `admin` plugin) + per-branch `manager` and `staff` (Better Auth `organization` plugin, a branch is an organization) |
| Staff onboarding | An admin creates the account with a **temporary password**; the password must be changed at first sign-in |
| Staff and customer | **One account can be both.** Staff never act on their own points or vouchers |
| Customer sign-up | **Verified email** before ordering; password reset by email |
| Ids | **UUID v7** for our tables |
| Deleting | **Archive by default**; hard delete only for never-used records and privacy erasure; orders and ledgers are never deleted |
| Errors | h3's standard error shape + our `data.code` (+ `data.fieldErrors`) |
| Concurrent edits | **Version check** on every edit (409 when stale); **idempotency keys** on money, points and voucher actions |
| Environments | Local, staging (every merge to `main`), production (manual deploy) |
| Email | **Resend** |

## Library first

Before writing server code, check whether Better Auth, `@nuxtjs/better-auth`, NuxtHub, Nitro or Cloudflare already does it ([security.md → What the libraries do](./security.md#what-the-libraries-do)). We write only the business domain: rules, services, contracts and their tests.
