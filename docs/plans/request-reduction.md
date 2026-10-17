# Fewer API requests, data still fresh

The owner asked for fewer requests when admin pages open (the Menu item editor reads its option sets, add-on groups and availability rules every time), without showing stale data after any change. Admin first, then the customer site and the platform. Follows [D170](../decisions.md#d170-tenant-scoped-admin-pricing-and-fresh-counter-batches-2026-10-14), which left cross-request caching for "a measured workload and a complete freshness/invalidation design".

## Why every visit reads again

`useApiQuery` is `useAsyncData`. In Nuxt 4 a key's data lives only while a component uses it: `purgeCachedData` (on by default) deletes it when the last user unmounts, and the default `getCachedData` returns data only while hydrating, which admin pages (`ssr: false`) never do. Leaving a page or closing a slide-over throws its data away; the next visit reads everything again. [D22](../decisions.md)'s freshness model (`invalidate()` after writes, other tabs told, refetch on tab return and reconnect) is sound; what's missing is keeping data **between** visits.

A second, separate waste: Nuxt's first fetch uses `dedupe: 'cancel'`. When a second component mounts a key whose first request is still running, Nuxt cancels it and starts another, so shared keys read twice.

## Baseline (measured, 2026-10-17)

`test/e2e/request-budget.test.ts` (browser-mock) counts the API reads; its expectations are today's numbers.

| Step | Reads |
|---|---|
| First load of the admin (shell + Dashboard) | 18: session ×2 (Better Auth's client), `/admin/me`, cafe profile, `/me/cafes`, assistant ×2, and the Dashboard's 11 (setup checks read each feature's endpoint, the items endpoint 3 times) |
| Menu items list | 6: the page, 3 status counts, the missing-photo count, categories |
| Open an item (slide-over), each time | 5: the item, option sets, availability rules, add-on groups **×2** |
| Categories / Options / Add-ons / Availability / Branch | 1–2 each, again on every visit |
| Staff | 2 (its own copy of branch options) |
| Back to the Dashboard | 11 |

## Steps (one PR each)

1. **Measure.** The request-budget test above. Done on this branch.
2. **One query per resource.** `/admin/branches/options` is read under three keys (`branches:options`, `staff:branch-options`, `promotions:branches`); branch writes invalidate only `branches`, so the other two never learn of a rename. Staff and promotions use the branches feature's public query; availability rules share one key like option sets do. Test: rename a branch, then the staff page shows the new name.
3. **Keep data between visits, `useApiQuery` `staleTime` (opt-in).** A new decision amending D22:
   - opted-in keys keep their data after unmount (a custom `getCachedData`, which also stops Nuxt purging them);
   - younger than `staleTime`: shown, no request; older: shown at once and refetched in the background;
   - `invalidate()`/`invalidateAll()` also mark kept, unmounted keys, so after our own write (this tab or another) the next visit loads fresh instead of showing the old copy;
   - the first fetch joins a request already running for the key instead of restarting it, while refreshes after a write still cancel (a request started before the write must not count as fresh);
   - opt in: reference data (categories, option sets, add-on groups, availability rules, branch options, cafe settings, rates and KHQR, report branches and destinations), `staleTime` 60 s. Not: records opened for editing (forms send the version they read) and paginated lists (one key across filters);
   - session changes already clear every key; changing cafes is a full page load.
   Tests: no repeated reference reads in the budget test; create an option set, then the item editor offers it; another tab's change reaches a kept key; nothing kept after sign-out; removing the invalidation mark makes the freshness test fail.
4. **Menu item counts in one read.** `GET /admin/menu/items/counts` (status counts and missing photos, same filters) replaces 4 reads per list load and filter change; two-cafe isolation test.
5. **Dashboard** (if still worth it after 3): setup checks and today's summaries in fewer reads, through each feature's service.
6. Customer site (`/public/branches` is also read under two keys), then the platform.

Not planned: a server-side cache (KV) — reads are cheap, the cost is round trips, and it would add a tenant-isolation and invalidation risk; ETag/304 — still a round trip and a query; replacing `useApiQuery` with TanStack Query or Pinia Colada.

**Open:** Better Auth's client reads the session twice at startup (module behavior, not ours); look at it with the `@nuxtjs/better-auth` upgrade.
