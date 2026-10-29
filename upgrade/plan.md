# Upgrade plan — nuxt-4-6-2
Targets: nuxt@4.6.2, vue@3.5.44 | Based on breaking-changes.md (C1..C15)

## Strategy
A patch release with no breaking changes, deprecations, codemods or required config (C1–C15): no code should change. The work is evidence. S1 records today's behavior for the advisory (C1) on the current version, so the fix can be shown, not assumed. S2 is the only dependency change: `nuxt` and `vue` together (nuxt 4.6.2 requires `vue ^3.5.44`; bumping one without the other risks two Vue copies). S3 re-runs the S1 probe and every check, including the profile's high-risk #8 (Cloudflare entry), and the full e2e suite because the framework is app-wide. S4 records the evidence in the project docs. Risky: route-rule matching changes for case-variant paths (auth gates, security and cache headers: C1), the Worker bundle (C7) and SSR params (C2). Not changed: other packages (no `@nuxt/ui`, NuxtHub, better-auth or wrangler updates), nuxt 4.6.3 (Q1, later run), and the app's own case-sensitive path checks (C1 observation, out of scope).

## Steps

### S1 — Record the advisory's behavior on 4.6.1 (no code change)
- status: done (ac67917)
- covers: C1
- executor: sonnet
- risk: low (read-only probe; nothing committed except evidence in HANDOFF)
- files: none changed; `upgrade/logs/S1/` (git-ignored)
- change: `pnpm build` (production node build: `$production` applies `deployedSecurityRules()`), start `node .output/server/index.mjs` on a local port with a temporary local database, and record status and headers (`cache-control`, `content-security-policy`, `x-frame-options`) for: `/table/abc` vs `/TABLE/abc`; `/reset-password` vs `/Reset-Password`; `/api/health` vs `/API/health`; `/api/c/x/admin/me` vs `/API/c/x/admin/me` without a session. Save the outputs as `upgrade/logs/S1/probe.txt`; copy the table into HANDOFF → Done.
- verify: the probe runs; results recorded. Expected (advisory): case-variant paths miss their specific rule (e.g. `/TABLE/abc` without `no-store, no-transform`).
- done when: the before-table is in HANDOFF.

### S2 — Bump nuxt to 4.6.2 and vue to 3.5.44
- status: done (93531ac)
- covers: C1–C15 (all arrive with the bump)
- executor: sonnet
- risk: high (framework runtime: route rules/auth gates C1, server bundle C7)
- files: `package.json`, `pnpm-lock.yaml`
- change: `pnpm add nuxt@4.6.2 vue@3.5.44` (writes `^4.6.2`, `^3.5.44`; lockfile resolves exactly 4.6.2 / 3.5.44). Then confirm: `node_modules/nuxt` and `@nuxt/nitro-server` are 4.6.2; the lockfile has one `vue@3.5.44` and no `vue@3.5.43`; no other direct dependency changed version (`git diff package.json`; lockfile changes limited to nuxt's tree and vue's). `pnpm install --frozen-lockfile` succeeds afterwards.
- verify: `bash scripts/upgrade-verify.sh S2` (typecheck, lint, test:unit, build) equals the baseline (all PASS; build's font-provider warnings are environment-only).
- done when: verify matches baseline and the version checks above hold.

### S3 — Prove the fix and the Worker (no code change)
- status: done
- covers: C1, C2, C4, C7, C11, C14
- executor: sonnet
- risk: high (profile #1, #5, #8)
- files: none changed; logs in `upgrade/logs/S3/`
- change / checks:
  1. Re-run the S1 probe on the 4.6.2 production build: case-variant paths now carry their rule (`/TABLE/abc` → `no-store, no-transform`); normal paths unchanged from S1 (same status and headers).
  2. Profile #8: `pnpm build:staging`; diff `.output/server/wrangler.json` against `upgrade/logs/baseline/wrangler.staging.json` (expected: no difference); `wrangler deploy --dry-run --config .output/server/wrangler.json` (bundle size close to baseline 10209.45 KiB); local `wrangler dev` smoke test of the staging build: `/api/health` answers, `/c/<unknown>` gives the cafe-not-found page, `/TABLE/abc` header as in check 1.
  3. Full e2e locally (framework change is app-wide): `E2E_BROWSER_PATH=<Playwright Chromium> pnpm test:e2e`. Compare with CI's last green run (all passing).
- verify: all three checks pass; any difference from expectations stops the run (Blocked).
- done when: results recorded in HANDOFF → Done.

### S4 — Record the upgrade in the project docs
- status: todo
- covers: —
- executor: sonnet
- risk: low
- files: `docs/progress.md` (new entry: what changed, evidence, the C1 observation as a follow-up), `docs/current-state.md` (active line)
- change: documentation only; no decision entry (a patch upgrade, no architecture change).
- verify: `pnpm lint`
- done when: committed.

## Manual test checklist
Profile smoke test, on staging after merge (main deploys to staging): login, logout, session refresh, expired session, one protected route as an unauthorized user (expect 401/403), one CRUD flow (e.g. a menu item edit), one stale edit (expect 409), main dashboard pages, one form with validation, dark mode.

Specific to this upgrade:
- `https://staging.angder.app/TABLE/<any>` answers with `cache-control: no-store, no-transform` (C1).
- The customer menu `/c/<slug>` loads server-rendered and fast on a second visit (swr, C1/C2).
- A deep link such as `/c/<slug>/admin/products` opens after sign-in (C2, C11).
- The counter queue reorders with its motion (TransitionGroup, C14).

## Open questions (must be answered before execution)
- None. Q1 (4.6.2 vs 4.6.3) is decided: 4.6.2. The owner delegated the remaining judgment (2026-10-29: "continue with what you think it should go").

## Not in scope
- nuxt 4.6.3 (later small run), other dependency updates (`@nuxthub/core` 0.10.12, `@nuxtjs/better-auth` 0.3.14, `@nuxt/test-utils` 4.3.4).
- Making the app's own path checks case-insensitive (`server/middleware/31.cafe-pages.ts:14` and others; C1 observation): a separate step with its own tests.
- The `/c/%E0` 500 (malformed percent-encoding in `31.cafe-pages.ts`), noted in the 2026-10-29 review.
- `scripts/upgrade-verify.sh` file mode (run with `bash`).
