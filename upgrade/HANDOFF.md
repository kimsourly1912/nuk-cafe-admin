# Upgrade handoff — nuxt-ui-latest

> Single source of truth between sessions for THIS upgrade run.
> Every session reads this first and updates it before it ends.
> Created from `.claude/upgrade/HANDOFF.template.md` by `/upgrade-0-setup`.

Run: nuxt-ui-latest
Targets: nuxt@latest @nuxt/ui@latest
Branch: chore/upgrade-nuxt-ui-latest
Package manager: pnpm (12.3.4, from lockfile + packageManager)
Started: 2026-10-16

Current phase: 0 in progress
Next: /upgrade-1-inventory (Sonnet session — this one is fine)

## Versions

Node 24.17.0.

| Package | Current | Target | Notes |
|---|---|---|---|
| nuxt | 4.5.2 | 4.6.1 | TARGET. Requires vue-router ^5.4.0, vue ^3.5.43 |
| @nuxt/ui | 4.11.2 | 4.12.0 | TARGET. Peer ranges OK (tailwindcss ^4, vue-router ^4.5 or ^5, valibot ^1, typescript ^5.6/^6/^7, @internationalized/date ^3, ai ^6 or ^7, all optional) |
| vue | 3.5.43 | ^3.5.43 (no change) | nuxt 4.6.1 needs ^3.5.43 |
| vue-router | 5.3.1 | >=5.4.0 | Direct dep; nuxt 4.6.1 depends on ^5.4.0, so must be bumped |
| nitropack | 2.13.4 (transitive) | via @nuxt/nitro-server 4.6.1 | Check resolved version after install |
| h3 | 1.15.11 (pinned) | unchanged | |
| vite | 8.3.1 (transitive) | via @nuxt/vite-builder 4.6.1 | nuxt 4.6.1 has optional peer rolldown ~1.2.1 (not required) |
| tailwindcss | 4.3.3 | ^4.3.3 (@nuxt/ui dep) | no change |
| typescript | 6.0.3 | unchanged | in @nuxt/ui peer range |
| vue-tsc | 3.3.11 | unchanged | |
| @nuxthub/core | 0.10.8 | 0.10.8 (latest) | no newer release |
| @nuxtjs/better-auth | 0.3.5 | 0.3.10 (latest) | Not a target; peer range already OK |
| better-auth | 1.7.3 | unchanged | |
| drizzle-orm | 0.45.3 | unchanged | |
| drizzle-kit | 0.31.11 | unchanged | |
| wrangler | 4.141.0 | unchanged | |
| @nuxt/eslint | 1.17.0 | 1.17.0 (latest) | peer eslint ^9 or ^10 OK |
| @nuxt/test-utils | 4.3.2 | 4.3.3 latest | peer nuxt ^3.21 or ^4 or ^5-0 OK |
| @nuxt/icon | 2.5.1 (transitive) | ^2.5.1 | from @nuxt/ui |
| @nuxt/fonts | 0.14.0 (transitive) | ^0.14.0 | from @nuxt/ui |
| @nuxt/kit | 4.5.2 | 4.6.1 | transitive |

Module peer check against targets: no installed module has a peer range that rejects nuxt 4.6.1 or @nuxt/ui 4.12.0.
@nuxthub/core 0.10.8 declares no nuxt peer (only optional @vercel/blob), so compatibility with nuxt 4.6.1 is `Needs verification` at build time.
@nuxtjs/better-auth 0.3.5 has no pinned nuxt peer; latest 0.3.10 also accepts it.

## Baseline (before any change)

| Check | Result | Notes |
|---|---|---|
| typecheck | pending | |
| lint | pending | |
| test | pending | |
| build | pending | |

## Decisions

<!-- Q1: question — answer (or `pending`) — decided on <date> -->

## Done

## Blocked

## Plan issues

## Manual tests to do
