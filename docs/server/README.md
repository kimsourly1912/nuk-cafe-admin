# Server standard

How the NUK Cafe server is designed and built. Every server change follows applicable rules in these pages. Start with architecture, the security route checklist and the affected data-model domain; read operations for migrations, jobs, configuration or deployment. Follow links to relevant sections, not every page; a change that needs to break a rule updates the page (and [decisions.md](../decisions.md)) in the same change.

| Page | Contents |
|---|---|
| [Architecture & conventions](./architecture.md) | Surfaces and routes, features and their layers (service, repository, errors, types…), the anatomy of a route, ids, money, time, errors, validation, archiving, versions, idempotency, tests |
| [Repository standard](./repositories.md) | How a feature's SQL is written (D194): Drizzle's query builder, names, the tenant rule, reads in one batch, conditions, guards, writes as statements, D1 limits, tests |
| [Security & hardening](./security.md) | Identity (Better Auth), roles and permissions, sessions, email verification, staff onboarding, CSRF, headers, rate limits, uploads, secrets, logging |
| [Data model](./data-model.md) | The tables per domain (identity, branch, menu, customers & loyalty, orders), their invariants and open questions |
| [Operations](./operations.md) | Environments, configuration, migrations, deploys, backups, scheduled jobs, email, monitoring |

**Status:** this is the current server standard. All server code follows it: identity, staff, customers and the platform tables since steps 1.1–1.7, the menu since step 3.8b removed the legacy `/api/v1` menu (D71). See [progress.md](../progress.md).

## Decisions this standard is built on

Initial standard agreed with the owner on 2026-09-27 (D43; menu model D44); the summary includes the later decisions cited below:

| Topic | Decision |
|---|---|
| Clients | One Nuxt app: customer website, admin workspace and cashier workspace share one origin, one session cookie and one deploy |
| Routes | Nuxt-native, **unversioned**: cafe routes `/api/c/<slug>/<surface>/<resource>`; platform routes remain outside (D140); response types inferred by Nuxt's typed `$fetch` |
| Code layout | **Features** in `server/features/<feature>/`, each with fixed layers: `index.ts`, `*.schema.ts`, `*.types.ts`, `*.repository.ts`, `*.service.ts`, `*.errors.ts`, optional `*.rules.ts` / `*.mappers.ts`, `tests/`; route files stay thin (revised 2026-09-27) |
| Validation | **Valibot** (shared with the app's forms) |
| Roles | Platform `superadmin` (`user.role`); cafe `owner`/`member` (`member.role`, organization = tenant); branch `manager`/`staff` in our `branch_staff` table (D135; [permissions](./security.md#roles-and-permissions)) |
| Staff onboarding | An admin creates the account with a **temporary password**; the password must be changed at first sign-in |
| Staff and customer | **One account can be both.** Staff never act on their own points or vouchers |
| Customer sign-up | Guests and unverified accounts may order (D156); sign-up sends a verification email; password reset by email ([Customers](./security.md#customers)) |
| Ids | **UUID v7** for our tables |
| Deleting | **Archive by default**; delete permanently only without history (D200) and for privacy erasure; orders and ledgers are never deleted |
| Errors | h3's standard error shape + our `data.code` (+ `data.fieldErrors`) |
| Concurrent edits | **Version check** on every edit (409 when stale); **idempotency keys** on money, points and voucher actions |
| Environments | Local, staging (every merge to `main`), production (manual deploy) |
| Email | **Cloudflare Email Sending** (D212) |

## Library first

Before writing server code, check whether Better Auth, `@nuxtjs/better-auth`, NuxtHub, Nitro or Cloudflare already does it ([security.md → What the libraries do](./security.md#what-the-libraries-do)). We write only the business domain: rules, services, contracts and their tests.

Use a library's API as its **current official documentation** describes, checked against the installed version (its types, or its changelog when the docs are newer), never from memory or an old example (D194). When code repeats across features, make it a shared helper instead of another copy ([repositories.md → Shared helpers](./repositories.md#shared-helpers) for queries).
