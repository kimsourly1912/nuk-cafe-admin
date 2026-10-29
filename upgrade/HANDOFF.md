# Upgrade handoff — nuxt-4-6-2

> Single source of truth between sessions for THIS upgrade run.
> Every session reads this first and updates it before it ends.
> Created from `.claude/upgrade/HANDOFF.template.md` by `/upgrade-0-setup`.

Run: nuxt-4-6-2
Targets: nuxt@4.6.2
Branch: ccr-ef1e4d51-15633w (this cloud session may push only to its own branch, so not `chore/upgrade-nuxt-4-6-2`; every other rule in RULES.md applies)
Package manager: pnpm 12.15.0
Started: 2026-10-29

Current phase: 3 done (approved)
Next: /upgrade-4-execute S1-S4 (Sonnet; this Opus session continues, owner's choice)

## Why

`pnpm audit` (2026-10-29) lists GHSA "Nuxt: server-side route rules (`redirect`, `headers`, `proxy`, `ssr`) are skipped for case-variant paths when routing is case-insensitive", moderate, nuxt and @nuxt/nitro-server `>=4.2.0 <4.6.2`, patched in 4.6.2. This app's route rules carry the security headers and the `auth: 'user'` session gates. Owner asked for 4.6.2 (2026-10-29).

## Versions

Installed versions read from `node_modules`; registry checked 2026-10-29. Local Node is v22.22.0 while `engines.node` is `^24.22.1` (this container; CI uses 24).

| Package | Current | Target | Notes |
|---|---|---|---|
| nuxt | 4.6.1 | **4.6.2** | Released 2026-10-16. 4.6.3 also exists (2026-10-27): see Decisions Q1. Peer deps: rolldown ~1.2.1, @types/node >=18.12.0, @parcel/watcher ^2.1.0 (optional) |
| @nuxt/nitro-server | 4.6.1 (via nuxt) | 4.6.2 (via nuxt) | Pinned to nuxt's version; carries the advisory fix |
| @nuxt/vite-builder, @nuxt/kit, @nuxt/schema | 4.6.1 (via nuxt) | 4.6.2 (via nuxt) | Pinned to nuxt's version |
| vue | 3.5.43 | ≥3.5.44 (required by nuxt 4.6.2) | package.json range `^3.5.43`; lockfile will move |
| vue-router | 5.4.0 | unchanged | nuxt 4.6.2 asks `^5.4.0` |
| nitropack | 2.13.4 (transitive) | Needs verification after install | |
| h3 | 1.15.11 | unchanged | |
| vite | 8.3.4 (transitive) | Needs verification after install | |
| tailwindcss | 4.3.3 | unchanged | |
| typescript | 6.0.3 | unchanged | |
| vue-tsc | 3.3.11 | unchanged | |
| @nuxt/ui | 4.12.0 | unchanged | Latest; no nuxt peer range (uses @nuxt/kit) |
| @nuxthub/core | 0.10.8 | unchanged | Latest 0.10.12 (not in scope); no nuxt peer range |
| @nuxtjs/better-auth | 0.3.7 | unchanged | Latest 0.3.14 (not in scope); peers @nuxt/test-utils ^4.1.0, @nuxthub/core >=0.10.5, no nuxt range |
| @nuxt/eslint | 1.17.0 | unchanged | Latest; no nuxt peer range |
| @nuxt/test-utils | 4.3.2 | unchanged | Latest 4.3.4 (not in scope); no nuxt peer range |
| better-auth | 1.7.7 | unchanged | |
| drizzle-orm | 0.45.3 | unchanged | |
| drizzle-kit | 0.31.11 | unchanged | |
| wrangler | 4.141.0 | unchanged | |

No installed module declares a nuxt peer range that excludes 4.6.2.

## Baseline (before any change)

`bash scripts/upgrade-verify.sh baseline` on `9fe5f71`, 2026-10-29 (the script is committed as mode 100644, so `bash` is needed; `NODE_OPTIONS=--max-old-space-size=4096` set).

| Check | Result | Notes |
|---|---|---|
| typecheck | PASS (161 s) | Nuxt app, `ops/watchdog`, `ops/backup` |
| lint | PASS (8 s) | |
| test | PASS (106 s) | `test:unit`: 153 files, 2104 passed, 1 skipped |
| build | PASS (127 s) | 14 error-like lines, all `@nuxt/fonts`/unifont failing to reach font providers through this sandbox's proxy (403): environment only |
| build:staging (high-risk #8) | PASS | `.output/server/wrangler.json` saved as `upgrade/logs/baseline/wrangler.staging.json` (1984 bytes, git-ignored: rebuild it from `9fe5f71` in a new session); `wrangler deploy --dry-run`: 10209.45 KiB / gzip 2043.07 KiB |

## Decisions

Q1: target 4.6.2 (owner's request, the advisory's fixed version, 13 days old) or 4.6.3 (released 2026-10-27, 2 days old)? — **4.6.2** (owner approved the recommendation; 4.6.3 later in its own small run) — decided on 2026-10-29
Q2: review of breaking-changes.md and approval of plan.md — the owner delegated both ("I rely on you to help me decide and continue with what you think it should go"); plan approved as written (S1–S4), no open questions — decided on 2026-10-29

## Done

S1 (ac67917): probe of the 4.6.1 production node build (`E2E_HUB_DIR=.data/upgrade-probe`, `node .output/server/index.mjs`; script in `upgrade/logs/S1/`, output `upgrade/logs/S1/probe.txt`). Confirms the advisory here: case-variant **page** paths are served (Vue's router matches any case) without their specific rule; case-variant **API** paths are 404 (Nitro's handler router is case-sensitive), so the `auth: 'user'` gates were not reachable that way. `/**` headers apply to every path.

| Path | 4.6.1 status | CSP | X-Frame-Options | cache-control |
|---|---|---|---|---|
| `/table/abc` | 200 | yes | DENY | `no-store, no-transform` |
| `/TABLE/abc` | 200 | yes | DENY | **none** |
| `/reset-password` | 200 | yes | DENY | `no-store, no-transform` |
| `/Reset-Password` | 200 | yes | DENY | **none** |
| `/api/health` | 200 | yes | DENY | `no-store` |
| `/API/health` | 404 | yes | DENY | `no-cache` |
| `/api/c/x/admin/me` (no session) | 401 | yes | DENY | `no-store` |
| `/API/c/x/admin/me` | 404 | yes | DENY | `no-cache` |
| `/api/me/cafes` (no session) | 401 | yes | DENY | `no-store` |
| `/API/ME/cafes` | 404 | yes | DENY | `no-cache` |

S2 (pending hash): `pnpm add nuxt@4.6.2 vue@3.5.44`, then the ranges set back to the repo's caret style (`^4.6.2`, `^3.5.44`; pnpm 12 saved exact). Lockfile: one `nuxt@4.6.2`, one `vue@3.5.44`, no 4.6.1/3.5.43 left; no direct dependency changed. Nuxt's own tree moved too: `@nuxt/devtools` 3.4.2 → 3.4.4 (no longer uses `simple-git`), `@vitejs/plugin-vue` 6.0.9 → 6.0.10, `diff` 8 → 9, `image-meta` 0.2 → 0.3, `ws` added. `bash scripts/upgrade-verify.sh S2` = baseline (typecheck, lint, test:unit 2104 passed/1 skipped, build on "Nuxt 4.6.2 with Nitro 2.13.4, Vite 8.3.4 and Vue 3.5.44"). `pnpm audit --audit-level high` passes; `--prod` advisories 8 → 5: all three nuxt/@nuxt/nitro-server ones gone (route rules, server-island `useHeadSafe`). Follow-up (not in scope): the four `simple-git` audit exemptions in `pnpm-workspace.yaml` (D54) are no longer needed.

## Blocked

## Plan issues

## Manual tests to do

From S2 (risk: high), on staging after merge: the profile's smoke test (login, logout, session refresh, expired session, a protected route without a session, one CRUD flow, one stale edit → 409, dashboard pages, one form's validation, dark mode); `https://staging.angder.app/TABLE/<any>` answers with `cache-control: no-store, no-transform`; the customer menu `/c/<slug>` loads server-rendered; a deep link like `/c/<slug>/admin/products` opens after sign-in; the counter queue's reorder motion.
