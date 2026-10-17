# Upgrade: Nuxt 4.6.1 and Nuxt UI 4.12.0 (2026-10-17)

Branch `chore/upgrade-nuxt-ui-latest` (run name `nuxt-ui-latest`, started 2026-10-16). A record, not a rule: the conventions it changed live in their guides. Progress entry: [progress.md](../progress.md).

## Versions

| Package | Before | After |
|---|---|---|
| nuxt | 4.5.2 | 4.6.1 |
| vue-router | 5.3.1 | 5.4.0 (Nuxt 4.6 needs ^5.4.0) |
| @nuxt/ui | 4.11.2 | 4.12.0 |
| unchanged | vue 3.5.43, nitropack 2.13.4, h3 1.15.11, tailwindcss 4.3.3, @nuxthub/core 0.10.8, @nuxtjs/better-auth 0.3.5 | |

## What affected this app

- **C1** Nuxt UI 4.12 imports Reka UI by name, so `modules/reka-namespaced.ts` did nothing: removed with its test; [D123](../decisions.md) amended; the shop-menu e2e guard stays.
- **C11** Nuxt 4.6 typed fetch overloads: `serverFetch` in `app/utils/api.ts` names the overload and casts its options to the 4.6 types. No runtime change.
- **C25** Slide-over theme now caps width with `sm:max-w-md`: `ProductFormSlideover` uses `sm:max-w-2xl` (e2e test; it failed before the fix).
- **C14** Sign-in redirect keeps a percent-encoded query: new e2e test (no code change).
- **C12** `useApiQuery` vs 4.6 `useAsyncData`: read the source, the 4.5 watch workaround is still needed; kept.
- **C17** Cloudflare entry: `wrangler.json` identical before and after; dry-run and a local `wrangler dev` smoke test pass.
- Checked, no change: C3, C4, C6, C15, C20-C24, C27-C29 (forms, selects, theme overrides, overlays, toasts, drawer, labels).

## Decisions

Q1 retire the Reka module (revised to do it in this run); Q2 no `@nuxtjs/better-auth` bump; Q3 split unit and e2e checks, e2e only at milestones; Q4 the `routes.test.ts` failure is a known, explained baseline failure; Q5 wait for the release-age rule, no exclusions (nothing was refused); Q6 keep the `useApiQuery` workaround; Q7 prove the Cloudflare entry before merge; Q8 the unrelated D171 commit moved to its own PR (#120).

## Lessons for the next upgrade

- Run e2e serially with a 4 GB heap (as CI). The full parallel run died with out-of-memory on this machine; the baseline was only trustworthy after splitting `scripts/upgrade-verify.sh`.
- A Nuxt UI theme default can start to use a breakpoint prefix; an app override without the prefix then no longer wins (tailwind-merge sees no conflict). Diff the generated theme for every slot the app overrides, not only the components it uses.
- Cloudflare proof is not optional: it was first downgraded and had to be restored (review R1). Build `build:staging`, diff `wrangler.json`, `wrangler deploy --dry-run`, then a local `wrangler dev` run. The Worker only trusts `NUXT_PUBLIC_SITE_URL` as an auth origin, so set it locally through `--env-file`. Stopping `wrangler dev` leaves `workerd` processes on the port; kill them.
- Keep the branch upgrade-only: an unrelated commit sat on it for the whole run.
- Environment traps on Windows: a stale `.data/db` (old migration numbering) fails the build; stale e2e servers hold `.data/e2e/db`; a worker crash (exit 3221225477) hits a different unit file each run and passes alone.
- Nuxt 4.6's error handler adds `Vary: accept, sec-fetch-mode` to the 404 render (harmless).

## Left for later

- `routes.test.ts` fails on Windows path separators (a test portability issue).
- `@nuxtjs/better-auth` 0.3.5 to 0.3.10: its own run.
- No unit test covers `useApiQuery` itself (review I2).
- The sidebar centring in PR #120 should be rechecked if Nuxt UI changes its lazy phone sidebar.
- After merge: confirm the staging deploy and one staging request; rollback is `wrangler rollback`. Owner may delete `.data/db-stale-2026-09-27`.
