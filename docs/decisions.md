# Decisions

Why the project is built the way it is. Each entry covers the context, the decision, why, and the alternatives rejected. **Read the relevant entry before changing one of these patterns.** Most of them work around a verified backend or tooling quirk. To change a decision, amend its entry (or add a new one that supersedes it) in the same change.

Dates are when the decision was made. All of these were agreed with the project owner.

---

### D1: Frontend-only SPA (`ssr: false`), 2026-09-26
- **Context:** The backend sets HttpOnly auth cookies on its own domain. A Nuxt server can't see them, so SSR would need cookie forwarding and a shared parent domain.
- **Decision:** A pure SPA. Every API call runs in the browser with `credentials: 'include'`. No server routes.
- **Rejected:** SSR with cookie forwarding (more moving parts, no SEO need for an admin tool).

### D2: Dev proxy with `Origin` rewrite, 2026-09-26
- **Context (verified):** Cookies are `SameSite=Lax`, `Secure`, `HttpOnly`, with no `Domain`, so browsers drop them on cross-site requests from `localhost`. The backend's CORS allowlist accepts only `http://localhost:3000` (other ports get 403 "Invalid CORS request").
- **Decision:** In dev, all calls go through a Nitro `devProxy` at `/api` → `API_PROXY_TARGET`, with `origin` rewritten to the target's origin. In production, the portal must be same-site with the API (progress Q4).
- **Rejected:** Calling the API directly from localhost (cookies never stick).

### D3: Hey API codegen with the ofetch client, 2026-09-26
- **Context:** The backend publishes OpenAPI 3.1 (Springdoc). The owner wanted generated types and as Nuxt-native as possible.
- **Decision:** `@hey-api/openapi-ts` with plugins `@hey-api/client-ofetch` (`throwOnError: true`), `@hey-api/typescript`, `@hey-api/sdk` (flat functions) and `valibot`. Output goes to `app/generated/api/`, committed and never edited. Nuxt's `$fetch` is ofetch, so the engine is the same.
- **Rejected:** `@hey-api/client-nuxt`: beta, and its composable types **fail to compile against Nuxt 4.5** (verified). `nuxt-open-fetch`: types only, no validation schemas.

### D4: SDK scope and naming, 2026-09-26
- **Decision:** Generate only `/staff/**` and `/admin/**`. Use flat SDK functions named by the backend's `operationId`. Find a function by its URL (`url: '/staff/...'` in `sdk.gen.ts`).
- **Why:** Grouping by tag produces class instances and still carries the auto-suffixed names (`update_2`). The real fix is backend-side (progress Q2).

### D5: API wrapper `createApiFetch`, 2026-09-26
- **Context (verified):** Every response is an envelope `{ data, success, msg, reason }`. Most failures are **HTTP 200 + `success: false`**. 401 is a real status.
- **Decision:** One ofetch wrapper (`app/utils/api-fetch.ts`) throws `ApiError` for any failure and handles unauthorized errors with a **single-flight** `/staff/auth/refresh` plus one retry. Feature code never checks `success`.

### D6: `ApiError` classification, 2026-09-26
- **Decision:** Classify by **backend code first, HTTP status second** (`API_ERROR_CODES`). `message` is always user-safe: the backend `reason` only for user-facing kinds, never for `NC0000` (a raw Spring message), 5xx or non-envelope bodies.
- **Tooling quirks (verified in the browser):**
  - `useAsyncData`'s NuxtError replaces its cause with the ApiError's *own* cause, so `ApiError.from` walks the whole cause chain.
  - `instanceof FetchError` fails because Vite loads two copies of ofetch, so ofetch errors are detected by `name`.
  - Network errors are detected from the fetch `TypeError` message, so programming TypeErrors aren't mistaken for them.

### D7: Nuxt-native state and data fetching, 2026-09-26
- **Decision:** No Pinia or TanStack Query. Reads use `useAsyncData` (wrapped as `useApiQuery`). Shared state uses `useState`.
- **Why:** The owner asked for Nuxt-native first, and add a library only when something doesn't fit.

### D8: Feature-based architecture, 2026-09-26
- **Decision:** Code lives in `app/features/<feature>/`, and the root `components/composables/utils` hold only shared code.
  - A feature's `index.ts` is its public API and exports **building blocks only** (pickers, option composables, types, navigation), never pages or forms.
  - Inside a feature, use relative imports. Feature code is not auto-imported.
  - Route files in `app/pages/` stay thin (render `<Feature>…Page.vue`).
  - ESLint `no-restricted-imports` enforces the boundaries.
- **Why:** Products and schedules reference each other (a product has `scheduleIds`, a schedule has product `items`). Exporting only building blocks lets each use the other's picker without import cycles.
- **Rejected:**
  - Nuxt layers per feature (more config, harder routing, global auto-imports).
  - Auto-importing feature folders (everything becomes global).
  - A separate `entities/` layer (splits a domain across two folders, which the owner didn't want).

### D9: Feature names follow backend resources, 2026-09-26
- **Decision:** Folder names match backend resources (`products`, not `menu-items`). UI labels can differ ("Menu items"). Reward categories live inside `rewards` because they're unrelated to menu categories.

### D10: Data freshness by feature-prefixed keys, 2026-09-26
- **Decision:** Query keys are `<feature>:<name>`. Mutations declare which features they affect, and `invalidate()` refreshes every loaded key with those prefixes. Calls within 30ms are merged into one refresh.
- **Why:** A feature can refresh another feature's lists without importing its internals.

### D11: `useMutation`: per-item concurrency and shared state, 2026-09-26
- **Decision:**
  - Every write goes through `useMutation`.
  - It's keyed per item: different items run in parallel, and a repeat for an item already in flight is skipped.
  - State is shared app-wide by mutation `id` (`useState`), so a list row knows a closed modal's save is still running.
  - `execute` **never throws**; it resolves to `{ ok, status, … }`.
  - Calls are **never cancelled on unmount**, and a `beforeunload` guard warns while any are pending.
  - Create is keyed by name, so two different creates can run in parallel.
- **Why:** The owner required async flows such as "delete A, close the dialog, delete B while A is in flight". The logic lives in a framework-free engine (`app/utils/mutation.ts`) so it's unit-tested in Node.
- **Rejected:** Blocking all calls while one is pending (it would drop B). Optimistic updates (not needed, and they complicate failures).

### D12: Batch actions run client-side, 2026-09-26
- **Context (verified):** The API has **no bulk endpoints**. Every delete is a single `DELETE /{id}`.
- **Decision:**
  - `executeMany` asks for one confirmation, then runs **at most 4 requests at a time**.
  - Optional ordered phases, e.g. sub-categories before their parent.
  - A progress toast with Stop. Stop never cancels requests already in flight.
  - One summary toast with the reasons grouped and "Retry failed", then one refresh.
  - Afterwards, only the failed and not-started rows stay selected.
  - Selection clears on filter or page change, so users never act on rows they can't see.

### D13: Form modals while saving, 2026-09-26
- **Decision:** The modal stays open with a loading button (backend validation errors need the input on screen), but it can be closed. The save continues. If it then fails, the toast offers "Reopen" with the draft restored.

### D14: Form schemas are handwritten, 2026-09-26
- **Context:** The generated Valibot request schemas carry no validation rules (the backend doesn't declare them).
- **Decision:** Each feature has `schemas/<feature>-form.ts` with the rules and messages, plus `to<Feature>Form` / `to<Feature>Request`. The request mapping **copies over fields the form doesn't edit** (`nameI18n`, `sortOrder`) so a PUT doesn't wipe them.

### D15: Tests, 2026-09-26
- **Decision:** Pure logic (engines, schemas, mapping) lives in files that use explicit imports and is unit-tested in Node. Feature tests sit in `features/<x>/tests/`, and shared-code tests in `test/`. `*.nuxt.test.ts` runs in the Nuxt environment.

### D16: Promote shared code on the second use, 2026-09-26
- **Decision:** Build a component or composable inside the feature that needs it. Move it to the root when a second feature needs it. `ImageUpload` and `I18nFields` are expected to be promoted once products and rewards exist.

### D17: English-only UI, 2026-09-26
- **Decision:** No i18n setup for the UI. Translatable content fields (`nameI18n`, …) are data: they're preserved, and not yet editable (progress Q5).

### D18: Icons are bundled into the client, 2026-09-26
- **Context:** With `ssr: false`, `@nuxt/icon` (installed by Nuxt UI) defaults to `provider: 'iconify'` and fetches every icon from `api.iconify.design` at runtime: a third-party dependency and a flash of missing icons.
- **Decision:** `icon.provider: 'none'` + `icon.clientBundle.scan` in `nuxt.config.ts`. The build scans `app/**/*.{vue,ts}` for literal icon names and bundles them from the local `@iconify-json/lucide`. Nuxt UI adds its own icons through the `icon:clientBundleIcons` hook. Nothing is fetched at runtime.
- **Consequence:** Icon names must be literal strings (`'i-lucide-tags'`), never built (`` `i-lucide-${name}` ``), or they won't render. Using another collection means installing its `@iconify-json/<collection>` package.

### D19: Unsaved-changes guard, 2026-09-26
- **Context:** Users lose typed input by closing a form modal, navigating (sidebar, back button), logging out or reloading.
- **Decision:** One app-wide registry of open forms (`useUnsavedChanges`), a modal variant (`useModalUnsavedChanges`) that intercepts `UModal`'s `update:open`, one global route middleware and one `beforeunload` listener (merged with the in-flight-save guard into `plugins/leave-guard.client.ts`). Two separate, independent composables per form type were rejected: each would add its own route guard and listener, so a modal over a page form would ask twice, and a modal left open during a back navigation would fall between them.
- **"Unsaved"** means the values differ from what the form opened with (`isSameFormValue`: deep, `''`/`null`/`undefined`/`[]` are equal). Touched-but-unchanged doesn't count. A form is never unsaved while it saves (`paused`), so closing mid-save still works (D13).
- **Details that are easy to break:**
  - `isSameFormValue` must not `toRaw` its input, or the `computed` stops tracking the form.
  - The modal must declare the `update:open` emit, otherwise the overlay's listener closes it before we can ask.
  - Overlay modals are app-level: they survive route changes. On Discard every registered form's `onDiscard` runs, which closes modals.
  - `logout()` asks **before** calling the backend: after the call, staying on the page is impossible.
  - The session-expiry redirect doesn't ask (the middleware skips when logged out).
  - `beforeunload` is attached only while needed (a permanent listener disables bfcache).
  - `useConfirm` now creates one overlay per question with `destroyOnClose`, so calling it from middleware doesn't accumulate overlay entries.
- **VueUse:** `useEventListener` (reactive target attaches/detaches the listener) and `tryOnScopeDispose`. `useCloned` was tried for the baseline but dropped: its `sync()` can only snapshot the current state, and a reopened draft needs a different baseline (`initial`).

### D20: E2E tests build once and mock the backend in the browser, 2026-09-26
- **Decision:** `test/e2e/support/global-setup.ts` runs `nuxt build`, serves `.output` on a free port and `provide`s the URL. Each file calls `setup({ host })` (via `setupE2e()`). `@nuxt/test-utils` would otherwise build once **per file** (~35s each).
- The backend is mocked with Playwright `page.route` (`mockApi`), not a fake server: no backend or credentials needed, and each test sets exactly the responses it needs, including `success: false` envelopes and slow saves.
- Real Chrome (`channel: 'chrome'`), no Playwright browser download.

### D21: List state lives in the URL, updated with `replace`, 2026-09-26
- **Context:** A reload or a back navigation reset the search, filters and page. Staff also want to send a link to a filtered view.
- **Decision:** `usePaginatedQuery` reads and writes filters + page to the query string (defaults left out). It uses `router.replace`, not `push`: one history entry per list, so Back leaves the list instead of stepping through every keystroke. The URL is the source of truth: the sidebar link to the bare list resets the filters.
- **Why not `@vueuse/router`'s `useRouteQuery`:** it isn't installed, it syncs one key at a time (a filter change needs the page reset in the same update), and the typed round-trip (`fromUrlQuery`/`toUrlQuery`) is small and unit-tested.
- **Trap:** the composable must not write while navigating away (the route already points to the next page), so both watchers check that the current path is still its own.

### D22: Refresh on return and reconnect, not polling, 2026-09-26
- **Decision:** refetch every loaded query when the tab becomes visible after ≥ 30s hidden, or when the browser comes back online (`plugins/data-freshness.client.ts`, VueUse `useDocumentVisibility` + `useOnline`). Plus an offline banner.
- **Why 30s:** staff alt-tab constantly. Refetching on every switch would spam the API and flicker spinners. After 30s, other staff may have changed the menu.
- **Not polling:** no screen needs live data yet. The orders pickup queue will likely need it; do it per screen (`useIntervalFn`), not globally.

### D23: Tab titles from route meta, 2026-09-26
- **Decision:** each route file declares `definePageMeta({ title })`, and `app.vue` applies `<title> · NUK Cafe Admin`. Titles sit next to the route (thin route files, rule 6), and there's no `useHead` in every page component. `error.vue` sets its own title because it renders instead of `app.vue`.
