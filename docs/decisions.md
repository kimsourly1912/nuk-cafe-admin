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

### D22: Cross-tab invalidation + refetch stale data on return and reconnect, not polling, 2026-09-26 (amended the same day)
- **First version (replaced):** refetch everything when the tab had been **hidden ≥ 30s**. It failed a real case: create a category in tab 1, switch to tab 2 within 30s, and the old list is still there. Measuring "time away" was the wrong signal. It says nothing about whether *this browser* just changed the data, and it misses two windows side by side (no visibility change at all).
- **Research:** TanStack Query (`refetchOnWindowFocus` + `staleTime`, `visibilitychange` only since v5, experimental `broadcastQueryClient`), SWR (`revalidateOnFocus`, 5s focus throttle, `revalidateOnReconnect`) and Pinia Colada (`refetchOnWindowFocus`, 5s default `staleTime`). The common model: **staleness is measured from the last fetch, not from time away**, check on `visibilitychange`, refetch on reconnect, keep old data shown. TanStack's maintainers point to cross-tab broadcast for the side-by-side-windows case.
- **Decision (`plugins/data-freshness.client.ts`):**
  1. **Cross-tab invalidation:** `invalidate()` fires the runtime hook `app:data-changed` with the feature names. The plugin posts them on a `BroadcastChannel` (VueUse `useBroadcastChannel`), and receiving tabs call `invalidateInThisTab()` (never re-broadcast, so no ping-pong). Only names cross, never data: nothing to serialize (Vue proxies can't be cloned), nothing sensitive on the channel, and each tab refetches with its own cookies.
  2. **Return to tab:** on `visibilitychange` → visible, refetch queries whose last load (recorded per key by `useApiQuery`) is ≥ 5s old (`invalidateAll({ olderThanMs })`). Not the `focus` event: it also fires after dialogs, file pickers, iframes and DevTools.
  3. **Reconnect:** refetch everything loaded. Plus an offline banner.
- **Why 5s:** it matches SWR and Pinia Colada. With cross-tab invalidation covering this browser, the return refetch only has to catch other devices' changes. Data younger than 5s is fresh, so quick alt-tabs don't refetch.
- **Rejected:** syncing data between tabs (`broadcastQueryClient`: experimental, breaks on non-cloneable values); lowering the time-away threshold (still misses side-by-side windows).
- **Not polling or server push:** no screen needs live data yet, and the backend has no push endpoint. The orders pickup queue will likely need it; do it per screen (`useIntervalFn`), not globally.

### D23: Tab titles from route meta, 2026-09-26
- **Decision:** each route file declares `definePageMeta({ title })`, and `app.vue` applies `<title> · NUK Cafe Admin`. Titles sit next to the route (thin route files, rule 6), and there's no `useHead` in every page component. `error.vue` sets its own title because it renders instead of `app.vue`.

### D24: CI with GitHub Actions, following pnpm's recommended setup, 2026-09-26
- **Decision:** `.github/workflows/ci.yml` runs lint, typecheck, unit and e2e tests on pushes to `main` and on pull requests (ubuntu-24.04, Node 24). pnpm, Node and `pnpm install` come from `pnpm/setup` v2.0.0 pinned by commit hash, as in https://pnpm.io/continuous-integration. The pnpm version comes from `packageManager` in `package.json`.
- **Why not `actions/setup-node@v5` + `pnpm/action-setup`:** setup-node v5 has an open issue where pnpm setups fail immediately (actions/setup-node#1357). `pnpm/setup` does it all in one step.
- E2E uses the runner's preinstalled Google Chrome (`channel: 'chrome'`), and the backend is mocked, so the workflow needs no secrets.

### D25: Keyboard shortcuts through a guarded wrapper, 2026-09-26
- **Decision:** `usePageShortcuts` and `useSubmitShortcut` (`composables/useShortcuts.ts`) wrap Nuxt UI `defineShortcuts`. Keys: `/` search, `n` new, Ctrl/⌘+Enter save, `?` help (list in `SHORTCUTS`). Hints are shown where the action lives (`UTooltip :kbds`, `UKbd`).
- **Trap:** page shortcuts must not fire behind a dialog, menu or select. The list page's overlay is reused, so `n` over an open **Edit** form re-opened it as "New category". The wrapper skips when `[role=dialog|alertdialog|menu|listbox]` is on screen. `useSubmitShortcut` acts only when exactly one dialog is open, so it can't save a form behind "Discard unsaved changes?".
- Save goes through `UForm.submit()`, so validation runs exactly as with the button.

### D26: Login/logout across tabs, and a safe post-login redirect, 2026-09-26
- **Decision:** `useAuth().login/logout` fire the runtime hook `app:auth-changed`, and `plugins/auth-sync.client.ts` forwards it over a `BroadcastChannel` (VueUse `useBroadcastChannel`, same pattern as D22). On logout, other tabs `clearSession()`, and the existing watcher sends them to `/login?redirect=…`. On login, tabs waiting on `/login` continue, and logged-in tabs re-read the session (it may be another staff member). Received messages are never re-sent.
- A refresh failure is **not** broadcast: it may be one tab's network problem. The other tabs find out on their next request.
- **Security fix found on the way:** `LoginPage` accepted any `redirect` starting with `/`, including `//evil.example` (protocol-relative, so it leaves the site after login: an open redirect). `loginRedirectTarget` (exported from `~/features/auth`) now allows only same-site paths. Covered by e2e.

### D27: Bounded refresh, no hidden retries, expire once per identity, 2026-09-26
> **Partly superseded by D40:** there is no token refresh any more (Better Auth keeps its session cookie fresh; a 401 ends the session). "No hidden retries" and "expire once per identity" still hold (`app/utils/api-fetch.ts`).
- **Context:** the token refresh had no timeout. A 401 after a successful refresh+retry never expired the session, so the user was stuck. After expiry, every later 401 started a new refresh. ofetch retried GETs once by default, reusing the first attempt's `signal`: after a timeout the retry failed instantly, and after a network error it ran with **no** timeout.
- **Decision (`app/utils/api-fetch.ts`):**
  - `/staff/auth/refresh` gets its own 10 s timeout.
  - ofetch retries are off (`retry: 0`); the SDK's 30 s applies per attempt, and the only retry is our single post-refresh one (worst case 30 + 10 + 30 s).
  - A refresh **rejection**, or a still-unauthorized retry, expires the session **once per identity generation**. No further refreshes until the identity changes.
  - A refresh that times out or can't reach the server fails the request with that error and **keeps** the session. [Choice] A flaky connection shouldn't log staff out; the next request tries again.
- Tested in `test/unit/api-fetch.test.ts`, including against real ofetch.

### D28: Record locks across mutations; prototype-free state records, 2026-09-26
- **Context:** the engine only excluded repeats of the **same** mutation and key, so a bulk delete could overlap a pending update of the same category (select-all includes busy rows). Keys like `constructor` or `__proto__` broke `key in {}` lookups.
- **Decision:** an opt-in `lock` option. Mutations returning the same lock (`category:7`) exclude each other through a shared `mutation:locks` record. `run()` checks and reserves key and lock **synchronously** right before the request, so this holds after a confirmation and for queued batch items. Different records still run in parallel. Skips carry a reason (`in-flight`: silent double submit; `locked`: explained with a toast). Batch summaries count them ("1 skipped (another action on it was in progress)"), and the list keeps skipped rows selected.
- Opt-in, because only the feature knows which operations conflict. Categories locks update and remove.
- State records are `Object.create(null)`, and membership uses `in`. **Not** `hasOwnProperty`: Vue doesn't track `getOwnPropertyDescriptor`, and that version stopped busy rows from rendering (caught by an e2e test; a unit reactivity test now guards it).

### D29: Session-transition contract, 2026-09-26
- **Context:** after logout, expiry or an account change, the previous identity's query data, mutation errors, "removed" marks, toasts ("Reopen" drafts, "Retry failed"), open form modals and dirty-form registrations survived. A mutation response from the old session could toast and invalidate in the new one. After expiry, a form modal stayed open over `/login`.
- **Decision:** `useAuth` keeps an identity **generation**, which increments synchronously on any identity change and fires `app:session-changed`.
  - `createApiFetch` discards responses to requests started in an older generation (silent `aborted`).
  - `plugins/session-boundary.client.ts` discards unsaved forms without asking, closes overlays, clears toasts, resets mutation outcomes, and clears `<feature>:` query data (refetching only when someone is signed in).
  - Voluntary logout still asks about unsaved changes first; expiry and other-tab logout don't.
- Stale **query** responses were already safe: Nuxt ignores a response whose request was superseded, cleared or unmounted (promise identity). The generation check covers everything else (mutations, direct calls).

### D30: `useApiQuery` handles `watch` itself, with cancel semantics, 2026-09-26
- **Context:** in Nuxt 4.5, `useAsyncData`'s `watch` path goes through `debounceTick`, which returns the running promise and queues the new fetch until it settles. A slow response to an older filter blocked the newer request (up to 30 s), and was then shown first.
- **Decision:** `useApiQuery` strips `watch` from the options and calls `refresh({ dedupe: 'cancel' })` itself. The newer request starts at once and the older response is ignored. Feature code is unchanged (`watch: [...]` as before). Tested (fails without the fix).

### D31: Picker display vs eligibility; no blur validation in the Category form, 2026-09-26
- **Decision (`CategorySelect`):**
  - The current value always stays visible, labelled from the options, the record (`currentLabel`) or `#id`, marked "(inactive)" / "(unavailable)", and is never cleared.
  - Inactive categories are **not offered as new selections** while Q9 is open. That's the feature standard's deferral rule, not a business rule, and one filter line to change once answered.
  - A failed options load shows the error with Retry.
- **Form validation:** `CategoryFormModal` validates on input and change, not on blur. Blurring the empty, autofocused name showed "Name is required" between mousedown and mouseup, shifting the small Retry button in the form body so the click was lost (reproduced in e2e).

### D32: Unanswered contracts: safest encoding, verified on first login (Schedules), 2026-09-26
> **Superseded by D41:** we own the API now; the schedule contract is defined there.
- **Context:** the schedule contracts (request time format, timezone, PUT semantics for `items`, deleting a schedule products use) are unanswered, and the backend and project owner rarely reply. Deferring create/edit/delete would leave staff unable to manage schedules.
- **Decision (user, for Schedules):** build them, choosing per [Open] item the encoding that is **safe under every plausible backend meaning**, backed by whatever real evidence exists. The unauthenticated `/public/**` endpoints of the dev API show real response formats without a staff login. Each choice is listed in the plan as "verify on first staff login". Only what no encoding makes safe stays deferred.
- **Applied:** times round-trip as `HH:mm` (the format the API returns), shown with the record's `timezone`, never converted. Edit re-sends the existing product ids for `items` (keeps links under replace or merge; the form loads the detail first because the list has no `items`). Delete only for schedules not in use, re-checked with a fresh `GET /{id}` right before `DELETE`: the effect on linked menu items is unknown, so no encoding makes it safe. Details: [plans/schedules.md](plans/schedules.md).
- **Not a license to guess:** a restrictive, reversible form rule (days and times required) is a [Choice]; a semantic the backend decides (overnight ranges) gets no rule of our own.

### D33: Schedule times in the viewer's timezone, 12-hour, 2026-09-26
> **Superseded by D41:** times are local wall time in the cafe's zone and are shown as stored, not converted. 12-hour display stays.
- **Context:** schedules come back with `timezone: "UTC"` and 24-hour `HH:mm`. D32 first showed them unconverted with a "UTC" label. The user asked for 12-hour times in the viewer's timezone.
- **Decision (user):** treat stored times as being in the record's `timezone`; show and edit them in the **browser's** timezone, 12-hour (`UInputTime hour-cycle="12"`, "9:00 AM – 5:30 PM"); send them back as 24-hour `HH:mm` in the record's zone. The list's Time header names the viewer's zone ("Time (GMT+7)").
- **Weekdays move with the start time:** Monday 20:00 UTC is Tuesday 03:00 at UTC+7, so days are shifted when the start crosses midnight (`shiftWeekly`, exactly reversible). A range whose end crosses midnight is shown with "(next day)".
- **Limits:** offsets are taken at today's date, so zones with daylight saving time shift by the current offset all year (Cambodia has none). The list's day filter is sent to the API as-is, so it matches the stored (UTC) days, not the converted ones. New schedules assume `UTC` (the request has no zone field). A zone the browser doesn't know is not converted.
- **Risk:** if the backend actually stores local times labelled UTC (the dev descriptions hint at this), every schedule displays shifted. Q13 stays open; the conversion is one function to drop.

### D34: Products phase 1: slide-over form, USD, variants kept, pickers forward attributes, 2026-09-26
- **User decisions:** the variant editor is phase 2; prices are US dollars in major units (`UInputNumber` with currency format, rounded to cents before sending); images can be uploaded and replaced but not removed (clearing semantics unknown, Q19); the big form opens in a `USlideover` (same unsaved/Reopen behavior as the modals).
- **Encodings (D32 rule):** edit re-sends the existing variants unchanged with their ids in display order, the current image fields, the full `scheduleIds` list and the translations. Nothing relies on omission meaning "keep". Create sends `variants: []`.
- **Upload:** `POST /staff/products/upload` through `useMutation` (`products:upload`, keyed per form, 120 s timeout instead of 30 s). Type and size are checked first (JPEG/PNG/WebP ≤ 5 MB, our own limit). Save waits for a running upload. `ProductImageInput` stays in the feature until a second feature uploads (D16).
- **Pickers forward attributes to the select** (`inheritAttrs: false`): an `aria-label` on `CategorySelect` used to land on its wrapper `<div>`, leaving the combobox without an accessible name. `class` still sizes the wrapper, full width unless given. `CategorySelect` gained `includeInactive` for filters (no new relationship, so Q9 doesn't apply).

### D35: Variant editor: full list + reply check, drag and drop with a keyboard path, 2026-09-26
> **Reply check removed by D41:** our API defines full replacement with stable ids and is tested at the server, so the client no longer compares the reply. The editor and its keyboard path stay.
- **Context:** the request has no "delete" flag or sort field for variants, and how the backend treats an omitted variant is unknown (Q18).
- **Encoding (only one exists):** save sends the **complete** list in the order shown: kept groups/options with their ids, new ones without, removed ones left out. Translations are copied by id.
- **Safety net (user decision):** after a save, the server's reply is compared with what was sent (`variantMismatches`), **by name and order, not by id**, since a backend that replaces all variants would give kept ones new ids. Any difference (a removed row still there, a row missing, an order not kept) shows a warning toast that stays until dismissed (`useNotify().warning`). A backend that silently ignores removals can't go unnoticed.
- **Reordering (user decision: drag and drop):** `useSortable` from `@vueuse/integrations` (+ `sortablejs`), bound to a ref of the array so the state updates. Drag alone locks out keyboard users, so every handle also moves its row with ↑/↓ and keeps focus on it. That path is also what makes reordering testable; mouse dragging has one e2e test too.
- **Rows are keyed** by `variant:<id>` / `option:<id>` (new rows `…:new:<n>`), never sent. Keys from ids keep a freshly opened form clean in the unsaved-changes check.
- **Also fixed:** `roundPrice` rounded `1.005` down to `1.00` (`1.005 * 100` is `100.4999…`); it now shifts the decimal point in text.

### D36: Category sort order: one type, whole list, explicit save, 2026-09-26
- **Request (user):** drag to sort only with the type filter on Main or Sub, a `UBanner` guide, and `PUT /staff/categories/sort-order` with the whole list numbered from 1.
- **Also off with a search or status filter** [Choice]: the table would show part of a list whose whole order is saved. The banner says so and clears just those two filters.
- **Explicit Save order / Discard** [Choice] instead of saving each drop: no request per drag, mistakes are undone before anything is sent. The unsaved order is guarded like a form (`useUnsavedChanges` over the id list), and the filters are locked meanwhile, because a filter change is a route change the guard could cancel only after the filters had already changed.
- **Sort mode lists the whole type unpaginated** (`/all`), all statuses. Rows move by their **visible** position (a deleted row is hidden before the refetch), and the list is merged with fresh data (`mergeOrder`), so a save never sends a partial or stale list.
- **Drag and drop on `UTable`:** `useSortable` on the table body with a custom `onUpdate` that puts the DOM row back and moves the data, so Vue owns the rows. ↑/↓ on a focused handle is the keyboard path (and the reliable test path), as in the variant editor (D35).
- **Banner look:** the hints use a quiet panel style and may wrap; `UBanner` defaults to a solid one-line bar that truncates its title, and a white bar was loud in dark mode.

### D37: List UI refresh: layout per screen, Categories as a tree, shared list pieces, 2026-09-26
- **Context:** the three list pages were tables; the user found them dated. Research (Smart Interface Design Patterns, UX Patterns for Developers, Setproduct's 2026 table guide, Shopify's index table, Linear, Square/Toast menus; sources in [plans/list-ui-refresh.md](plans/list-ui-refresh.md)) agrees: pick the layout by the job. Tables for comparing columns, lists for scanning, cards when pictures drive the decision.
- **Menu items: card grid** (default) with a **Grid / List** switch (the table stays as List), and **group by category** in menu order, which loads the whole filtered menu (`/staff/products/all`). View and grouping are per viewer (`localStorage`), filters stay in the URL.
- **Schedules: card list** with the week as 7 day pills and the time on a 24-hour bar (overnight ranges draw two segments). Converted to the viewer's zone as before (D33).
- **Categories: a tree**, loaded whole (small set), searched, filtered and counted on the client. **Drag to sort per level** (mains among mains, subs within their main), numbered 1…n **per parent**: this **supersedes D36's per-type sort mode** and answers Q20 (user decision). Save sends only the lists that changed, each whole (`sortOrderChanges`). A search or status filter hides the handles (the whole tree is needed); an unsaved order locks the filters, as in D36. Row menu adds **Add sub-category** (the form's `parentId` prop).
- **Shared (root):** `StatusTabs` + `useStatusCounts` (counts via `size=1` requests on paginated lists; on the client for Categories), a **floating** `BulkActionsBar`, `ListSkeleton`, and `useTableSelection` helpers for cards and trees. Clicking a row/card opens it; the ⋮ menu is always visible (keyboard and touch users can't hover).
- **Found while building:** a list query with `default: () => []` never reports `loading` (the default counts as data), so the empty state flashed during the first load. List queries don't get an empty default.
- **Tests moved:** the shared list-behavior e2e tests (pagination, URL state, out-of-order responses, bulk Stop/Retry, last-page step-back) ran on the paginated Categories table; they now run on Schedules (`list-page.test.ts`) and the Menu items grid (`list-bulk.test.ts`).

### D38: Full stack target and new data model, 2026-09-26

- **User direction:** build a Nuxt full stack backend with `@nuxtjs/better-auth`, `@nuxthub/core`, Drizzle, SQLite, Cloudflare D1 and R2. It must serve the admin, customer and cashier apps. Start with a new data design; no Spring Boot data migration is planned.
- **Current state:** the backend plan of that time (`plans/fullstack-backend.md`, deleted 2026-09-27: superseded by the server standard, D43) was a proposal, not a deployed architecture. D1-D6 describe the former Spring integration and are superseded by D39. The plan's detailed schema, business rules, and API contracts remain open until agreed.
- **Launch scope confirmed later the same day:** [the greenfield system blueprint](plans/system-blueprint.md) starts from the new cafe journeys. The customer website, pickup and dine-in ordering with table QR, points, vouchers, USD, one branch, email/password accounts with no guest ordering, and pay at counter before preparation are required for launch. Native app, delivery, and online payment are outside that confirmed scope. Existing frontend behavior is a reference, not a backend contract.
- **Loyalty direction confirmed:** an order earns 1 point per USD after completion, points can be exchanged for vouchers, and staff can issue vouchers. The earning base/rounding, point exchange actor, voucher type, expiry, and redemption policy are still open; no code should guess them.

### D39: Remove the external API integration before building the new API, 2026-09-26

- **Context:** The Spring OpenAPI generator, generated SDK, browser client, cookie refresh wrapper, and proxy still connected the project to the external API. The owner wants to design the new API from scratch and keep the existing admin screens as UI references, even while their imports are unresolved.
- **Decision:** remove the Spring integration now: `@hey-api/openapi-ts`, `openapi-ts.config.ts`, `app/generated/api`, `app/plugins/api.ts`, the old envelope/refresh helpers, and the dev proxy. The admin feature components and composables remain for later integration with our own routes. They are intentionally not build-ready until their contracts and auth flow are replaced. D1-D6 describe the former system, not current instructions.
- **Setup:** `@nuxthub/core` precedes `@nuxtjs/better-auth`; NuxtHub provides SQLite locally and D1/R2 on Cloudflare. Better Auth uses database-backed rate limits so Worker instances share state. Generate and apply Drizzle migrations before using auth routes. Set a distinct `NUXT_BETTER_AUTH_SECRET` per environment and `NUXT_PUBLIC_SITE_URL` on Cloudflare.
- **Boundary:** `/api` belongs to Nitro and Better Auth. Do not restore a Spring proxy or generated Spring types to make the preserved screens compile; replace each screen's data adapter when the new API contract is implemented.

### D40: Our own API: identity, access, errors, ids, 2026-09-26

- **Context:** D39 removed the Spring integration. The owner agreed to the proposed defaults for the first milestone on 2026-09-26.
- **Identity:** Better Auth (email/password) owns accounts and sessions under `/api/auth`. Customers sign up through the same routes, so **having a login is not staff access**: access comes only from an active `staff_profiles` row. `requireStaff(event, permission)` (`server/utils/staff.ts`) is the first line of every admin route: 401 UNAUTHENTICATED, 403 NOT_STAFF, 403 FORBIDDEN.
- **Roles:** one role, `admin`, with every permission (`ROLE_PERMISSIONS` in `shared/contracts/identity.ts`). Manager and cashier rights wait for the role matrix (Q6). No branch scoping until a second branch exists. Better Auth's own `admin` plugin roles are not used, so there is one source of truth.
- **First admin:** `POST /api/v1/bootstrap/admin` with `{ token, email }` promotes an existing account. Enabled only while `NUXT_BOOTSTRAP_TOKEN` (at least 32 characters) is set; refused once any admin exists, checked again inside the write so two calls can't create two admins. Chosen over a Nitro task because it works the same locally and on Workers.
- **CSRF:** writes to `/api/v1` must carry this site's `Origin` (or `Referer`), checked in `server/middleware/origin-check.ts`. SameSite=Lax alone would accept a sibling subdomain.
- **Errors:** the HTTP status gives the kind; the body `{ statusCode, message, data: { code, message, fieldErrors? } }` (`ApiErrorBody`) gives the reason. `message` is user-safe for 4xx; the client shows 5xx generically. No HTTP-200 failures.
- **Ids:** UUID v4 text generated by the app (`crypto.randomUUID()`, available on Workers). Timestamps are ISO strings in responses.
- **Client:** `apiFetch` (`app/utils/api.ts`, `api-fetch.ts`): `/api/v1` base, 30 s timeout, no retries, `ApiError` for every failure, responses from a previous identity discarded (D29), and a 401 or 403 NOT_STAFF clears the session. `useAuth` signs in with Better Auth, then reads `GET /api/v1/admin/me`; an account without staff access is signed out again with a clear message.
- **Rejected:** a separate staff login system (two identity stores); treating every Better Auth user as staff; a token-refresh wrapper (Better Auth refreshes its own cookie).

### D41: Menu API contract, 2026-09-26

- **Shape:** `/api/v1/admin/{categories,schedules,products,media}`. Contracts are in `shared/contracts/menu.ts`: types plus the Valibot request schemas the server validates with; the client imports the types. Reference: [docs/reference/api.md](reference/api.md).
- **Writes:** create is POST; update is PATCH with only the fields to change (**absent keeps, `null` clears**). Every update and delete names the `version` it read and gets 409 VERSION_CONFLICT when it's stale. A multi-statement write is one D1 `batch` with a guard statement (`requireOneChange`, `requireCount` in `server/db/types.ts`), so nothing applies when the check fails. Every privileged write adds an `audit_events` row in the same batch.
- **Categories:** two levels (a parent must be a main category). Order is saved per sibling list, whole (`PUT /categories/order`); a list that no longer matches the children gets 409 ORDER_STALE. Reordering doesn't bump `version`. A category with sub-categories or menu items can't be deleted (409).
- **Schedules:** days as a bitmask and times as minutes, **local wall time in the schedule's IANA zone**. New schedules get `NUXT_PUBLIC_CAFE_TIME_ZONE` (default `Asia/Phnom_Penh`: the cafe is in Cambodia, which has no DST). Shown as stored, never converted (supersedes D33). **Overnight ranges are refused** (end must be after start) until their rule is decided (Q14). Menu items are linked only from the menu-item side (`scheduleIds`), so saving a schedule can't drop links (resolves Q15). A schedule in use can't be deleted (409 SCHEDULE_IN_USE, also enforced by the foreign key) until Q16 is decided.
- **Products:** price in integer cents (`priceMinor`, USD only). Variants are replaced as a full list with stable ids: an id updates in place, no id creates, a group or option left out is deleted, and ids of another item are rejected. The form's two switches map to `minSelect`/`maxSelect`; a stored limit the form can't show is kept while the switches are unchanged. `imageAssetId: null` removes the image. Flat lists sort by name; `sortOrder` is the position within a category.
- **Media:** `POST /media` (multipart `file`): JPEG, PNG or WebP checked by their first bytes, at most 5 MB, stored in R2 as `menu/<uuid>.<ext>` and recorded `temporary`. Saving a menu item attaches it; replacing or deleting the item sets it back to `temporary`. Served publicly at `/media/menu/…` (random keys; menu images are public content). No cleanup job for temporary assets yet.
- **Eligibility (Q9) is still open:** the server accepts inactive parents, categories and schedules; the pickers still don't offer them (D31).
- **Rejected:** PUT with full bodies (the old ambiguity about omitted fields, Q7); editing links from the schedule side too (two writers for one link); UTC storage with viewer conversion (a 9 AM schedule would move with DST and with the viewer's zone).

### D42: Tests for the full stack, 2026-09-26

- **Server:** a `server` Vitest project runs the services against an in-memory libsql database built from the **checked-in migrations** with foreign keys on (`test/server/support/db.ts`), so every run also checks the migrations. This works because services take the database as a parameter and use explicit imports (no Nitro auto-imports). The concurrency tests race two writes from one version; they were checked to fail with the guard removed.
- **Browser:** the e2e harness (D20) mocks `/api/v1` and `/api/auth` in the new format (`test/e2e/support/mock-api.ts`), with fixtures typed by the shared contracts.
- **Nuxt project:** created only when a `*.nuxt.test.ts` exists. Loading Nuxt for it runs NuxtHub's module setup, which rewrites `.data/db/migrations` and raced with a running dev server on Windows, failing whole runs.
- **Route smoke test:** the real routes are exercised against `pnpm dev` (sign-up, bootstrap, CRUD, upload, sign-out); see progress.md for how to repeat it.

### D43: Server standard, rebuilt from scratch, 2026-09-27

- **Context:** the first server slice (D40–D42) inherited the old external API's conventions (`/api/v1`, main/sub categories, one price per item) and hand-built what Better Auth already offers (staff roles, bootstrap, permissions). The owner asked to design the server as a fresh project.
- **Decision (owner's answers, 2026-09-27):** one Nuxt app for all clients; Nuxt-native **unversioned** routes `/api/<surface>/<resource>` (surfaces `public`, `shop`, `counter/{branchId}`, `admin`); **features** in `server/features/` with fixed layers (service, repository, errors, types, schema; revised by the owner the same day, first drafted as `server/modules/`); Valibot; platform `admin` + branch `manager`/`staff` on Better Auth's `admin` and `organization` plugins; staff created by an admin with a temporary password; one account can be staff and customer; verified email before ordering; UUID v7; archive by default; h3 errors + `data.code`; version checks + idempotency keys; local/staging/production; Resend.
- **The standard:** [docs/server/](server/README.md) (architecture, security, data model, operations). It supersedes the conventions and data model of D40/D41 (a same-day draft plan was folded into it and deleted); the existing code is replaced step by step, in the phases listed in progress.md.
- **Rejected:** a versioned API (no outside clients yet); folders layered by type across the whole server (spreads one feature across the tree; layers live inside each feature instead); handlers without services (untestable, not reusable across surfaces); prefixed ids and Better Auth ids for our tables.

### D44: Menu model: option sets, add-on groups, two-level categories, 2026-09-27

- **Context:** the first draft of the fresh data model (D43) kept variations per item and flat categories. The owner wanted reusable variant presets selectable in the item form, and sub-categories. Researched how Square, Toast, Uber Eats and Loyverse model menus.
- **Decision (owner, 2026-09-27):** two library pages. **Options** are reusable option sets (Size, Temperature) with names only; an item uses **up to 2** and gets a price grid, one priced variation per combination (Square's model: the price lives on the variation). **Add-ons** are reusable modifier groups with default prices and optional per-item overrides (Toast/Uber/Loyverse's shared modifier groups). **Categories go two levels deep, and a category holds either sub-categories or items, never both.**
- **Why:** options and add-ons behave differently. The version of an item is priced per item and needs per-version reports and sold-out; extras are priced alike everywhere. The "items only in leaves" rule avoids the breakage Square users report when items sit on a parent category.
- **Rejected:** one kind of preset for everything (Toast's size-as-modifier: vaguer prices and reports); unlimited option sets (large price grids, not needed for a cafe); unlimited category depth; items on parent categories.
- **Details:** [docs/server/data-model.md → Menu](server/data-model.md#menu).

### D45: Business rules for launch, 2026-09-27

- **Context:** the owner answered the open product questions in one round (former Q6, Q9, Q14, Q19, Q21–Q23, Q25–Q35). Each answer is now written into the server standard; this entry is the record.
- **Roles:** staff may cancel orders and mark items sold out, but not issue vouchers. Managers may issue vouchers and adjust points, but not create staff or refund. Refunds, staff management, voucher templates, media and settings are admin only. Sessions last 7 days for everyone.
- **Menu:** archived records are never offered in pickers; draft items are invisible to customers. Availability windows may run overnight. No rule means available whenever the branch is open; several rules mean available when any matches. English only at launch. Images: JPEG/PNG/WebP up to 5 MB, unused uploads deleted after 24 hours.
- **Customer site:** server-rendered public pages; admin and counter stay SPAs.
- **Orders:** accepted only while the branch is open, pickup as soon as possible. No tax or service charge: menu prices are final. No accept step: recording the payment starts preparation. Customers cancel only while unpaid. Unpaid orders are cancelled after 30 minutes. Payments: cash in USD, cash in riel at an admin-set KHR rate (each payment records the rate), and KHQR.
- **Loyalty:** points = the amount paid after the voucher discount, rounded down to whole USD, on completion. Customers exchange points for vouchers on the website. Vouchers: $ off or a free item, valid 30 days, one per order, no minimum spend. A refund or cancellation after completion reverses the points and restores an unexpired voucher.
- **Reports at launch:** sales per day, sales per item, points and vouchers, staff activity.
- **Still open:** Q4 (domains), Q24 (RPO/RTO, alerts, retention), Q36 (cancelling a paid order).
- **Where it lives:** [security.md → roles](server/security.md#roles-and-permissions), [data-model.md](server/data-model.md), [operations.md → scheduled jobs](server/operations.md#scheduled-jobs), [architecture.md](server/architecture.md#shape-of-the-system).

### D46: Server skeleton (step 1.1), 2026-09-27

- **Error responses:** our Nitro error handler (`server/error-handler.ts`) is put **first** in `nitroConfig.errorHandler` from the `nitro:config` hook; Nuxt sets its own handler before that hook, so it stays second and still renders page errors. Ours answers only `/api/**`: h3's shape + `data.code` + `data.requestId`; 5xx always become a fixed `INTERNAL` message and the cause is logged. Registered by an absolute path with forward slashes: Nitro writes it into a generated import, and Windows backslashes broke the build silently (the handler became a missing external).
- **Unknown API paths:** `server/api/[...].ts` answers 404 `NOT_FOUND`. Before, `/api/<unknown>` fell through to the SPA and returned the app's HTML with 200. Specific routes (Better Auth's `/api/auth/**`, features) still win.
- **Request ids:** `00.request-id.ts` runs first (middleware run in file-name order), reuses `cf-ray` when present, else a UUID v7; sent back as `X-Request-Id`.
- **Legacy code:** the pre-standard services moved to `server/legacy/` so `server/features/` contains only standard-compliant features; ESLint forbids new code from importing `legacy/` and forbids deep imports into a feature from routes or other features.
- **Test harness:** `server/tests/support/` (SQLite from the migrations); shared-util tests in `server/tests/`, feature tests in `server/features/*/tests/`; the legacy tests stay in `test/server/` until their code is replaced.
- **Tooling quirk, libsql native binary:** libsql loads `@libsql/<platform>` through a computed `require()` that Nitro's file tracer can't follow, so the node-server build crashed at startup once pnpm stopped placing the binary in the root `node_modules` (the built server had been finding it by walking up the folders). A `compiled` Nitro hook copies the installed binary into `.output/server/node_modules/@libsql/` for node builds. Including the `.node` file through `externals.traceInclude` was tried and fails (the tracer chokes on the raw import). Cloudflare builds use D1 and aren't affected.
- **e2e hygiene:** `openTabs` contexts are closed after each test; accumulated contexts made two-tab tests time out under full-suite load.

### D47: Identity configuration (step 1.2), 2026-09-27

- **One place:** the Better Auth configuration is `identityAuthOptions()` in `server/features/identity/identity.auth.ts`; `server/auth.config.ts` only passes it the site URL. The tests run the same function against the real migration through Better Auth's Drizzle adapter, so config and migration are checked together.
- **Permissions extend Better Auth's own statements** (`admin` and `organization` plugin `defaultStatements`), so its endpoints keep working and our roles decide them too. Admin has every admin-plugin action except impersonation; branch roles get **no** organization/member/invitation/ac action, so staff management only happens through our admin routes (D45). Manager and staff also get `menu:read` (the counter shows the menu) and managers `audit:read` (own branch reports).
- **`creatorRole: 'manager'`:** Better Auth always makes a branch's creator a member, with role `owner` by default, which isn't one of our roles. Branches are created by platform admins, who hold every branch permission anyway.
- **Branches are never deleted** (`disableOrganizationDeletion`), archived through `organization.status` (`input: false`: changed by our routes only).
- **`mustChangePassword` is `input: false`:** Better Auth silently drops it from sign-up bodies (it doesn't refuse); server-side `admin.createUser` can still set it.
- **Rate limits** apply in production only (Better Auth default) with database storage, per-route `customRules` (security.md).
- **Origin check** now covers every `/api/**` write except `/api/auth/**` (Better Auth checks its own) and `/api/webhooks/**`, not only `/api/v1`; it and Better Auth trust the same origin.
- **Fresh migration:** `0000_initial` replaces `0000_flawless_maginty` + `0001_identity_and_menu` (no deployed database exists). The legacy tables are unchanged (checked statement by statement); the local `.data/db` must be recreated. Better Auth's tables now use UUID v7 too (D48).
- **Not yet:** `requireEmailVerification` waits for step 1.6 (email), so the legacy admin login keeps working; client plugins (`adminClient`, `organizationClient`) are added when the app first calls those endpoints.

### D48: Access helpers and security headers (step 1.3), 2026-09-27

- **Two layers:** `requirePermission` / `requireBranchPermission` / `requireCustomer` / `requireSignedIn` (`server/utils/access.ts`) are the check every route makes, and they return the actor. The decisions themselves are plain functions in the identity service (`authorize*`), tested without Nitro against the real migration. `@nuxtjs/better-auth` `routeRules` add a session gate per surface as a second line; it can't see permissions or branches.
- **Permissions are checked locally** with our role objects (`role.authorize`), not through `auth.api.userHasPermission` / `hasPermission`: the same definitions, no extra queries, and a single query (branch + membership) on the counter. A comma-separated `user.role` grants if any listed role grants; unknown roles count as `customer`.
- **404 over 403 for branches:** an unknown or archived branch, a branch the caller isn't a member of, and an unknown membership role all answer 404, so callers learn nothing about branches they can't use. A member without the action gets 403. Archived branches are closed on the counter surface even to admins (they're managed from `/api/admin`).
- **`mustChangePassword` and bans** are refused by every helper, before any permission or branch lookup (401 for a banned user, 403 `PASSWORD_CHANGE_REQUIRED`).
- **UUID v7 for Better Auth's ids** (`advanced.database.generateId`): one id format in the whole schema, and `readIdParam` works for users and branches.
- **Tooling quirks:** `server/auth.config.ts` imports `identity.auth.ts` directly, not the feature's index: the module loads it at build time, before `hub:db:schema` exists. Better Auth's plugin tables reach our code through `hub:db:schema` (`'#auth/schema'` is typed for the core tables only); a `prepare:types` hook adds that module's declaration to the node tsconfig, and Vitest aliases it to `.nuxt/hub/db/schema.mjs` (generated by `nuxt prepare`).
- **Security headers in production builds only** (the Vite dev server needs inline scripts and a websocket). The e2e suite runs a production build, so every browser test runs under the CSP. Scripts keep `'unsafe-inline'` because the SPA shell's inline config and color-mode scripts vary per environment; nonces come with SSR (step 5.2).
- **e2e images:** fixtures used `https://img.example/…`, which the CSP blocks; they now use same-origin `/media/…` like the real server, and `mockApi` answers `/media/**` with a 1×1 PNG. (The old tests passed only because the external image's DNS failure came after the assertion.)

### D49: Staff management and the seed task (step 1.4), 2026-09-27

Owner answers (2026-09-27): **admins may grant and remove admin**, with safeguards; **an email that already has a customer account gets the access on that account** (one account per person); **one person may work in several branches**, one role per branch.

- **One batch per change:** creating staff writes `user`, the credential `account`, `member` rows and `audit_events` directly (our repository) instead of `auth.api.createUser` + `addMember`, so nothing is left half-done: D1 has no transactions, and a user created without its membership would come back as an "existing customer" on retry, with a temporary password nobody knows. The hash is Better Auth's `hashPassword` and the account row uses its credential format (`providerId: 'credential'`, `accountId = userId`); a test signs in through Better Auth with the result. Consequence: Better Auth's database hooks don't run for these writes. When step 1.6 adds the customer-profile hook, staff creation must call the same function.
- **Version = `user.updated_at` (ms):** Better Auth's `user` table has no version column; our writes set `updated_at` to a strictly larger value and update only where it still matches (`requireOneChange`). Better Auth's own updates (name, flag) also move it, which makes a pending edit 409, and that's intended.
- **Safeguards:** an admin can't remove their own admin role or disable themselves (409 `OWN_ACCESS`); a guard statement in the same batch keeps at least one active admin (409 `LAST_ADMIN`), which is what stops two admins demoting each other at once. After a guard failure the service reads the account again to tell a stale version from the last-admin case.
- **Sessions:** changing someone's access or disabling them deletes their sessions in the same batch (the access checks read memberships per request, so this is belt and braces against a cached role); an admin editing their own branches keeps their session.
- **"Disabled" is not a state:** it's an account with no access. Staff lists show accounts with access only; a disabled person can be re-added through create (their existing account is reused).
- **Temporary password clearing:** a Better Auth `hooks.after` on `/change-password`, only on success. Database hooks were considered: `account.update` fires for `updateMany` without the row, so it can't tell whose password changed, and it would also clear passwords an admin sets.
- **`staff:read`** added to the platform statements (admin only) for the list and detail routes.
- **Seed:** a Nitro task (`experimental.tasks`), run in dev through `/_nitro/tasks/db:seed` (Nitro's dev preset only; not in production builds). It creates the first admin and a demo branch, each only when none exists. The demo branch starts `server/features/branches/`, which step 5.1 extends.
- **Validation status:** an unknown or archived branch in a membership is 400 `VALIDATION_FAILED` with field errors, like any other invalid input.
- **Not built:** staff password reset by an admin (the person can change their own; email reset comes with step 1.6), renaming staff, audit `branch_id`/`request_id` columns (step 1.5).

### D50: Platform tables: audit, idempotency, outbox (step 1.5), 2026-09-27

- **One `platform` feature** owns `audit_events`, `idempotency_keys` and `outbox_messages` (`server/features/platform/platform.schema.ts`), and other features use them only through its index: `auditStatement`, `outboxStatement` (statements for the caller's batch), `withIdempotency`, `deliverOutbox`, `expireIdempotencyKeys`. Feature schema files are registered with NuxtHub by a `hub:db:schema:extend` hook that picks up every `server/features/<f>/<f>.schema.ts`.
- **Audit:** the columns of data-model.md (`actor_id`, `branch_id`, `request_id`, `at`). The access helpers' actor now carries `requestId` (from `00.request-id.ts`), so an audit row leads to the request's logs. Staff management writes through it; the legacy services keep writing the table directly (renamed fields) until they're replaced.
- **Idempotency:** the key row goes in the same batch as the action (so a crash can't leave one without the other), and the unique index settles two identical requests at once: the loser's batch fails entirely and replays the winner's stored response. The stored response is returned as it was, and a key counts until the daily task removes it (24 h minimum).
- **Outbox:** a conditional claim (`locked_until`, `UPDATE … RETURNING`, which libsql and D1 both support) keeps overlapping runs from sending the same message at once; delivery is at least once, and handlers must tolerate a repeat. Backoff doubles from 1 minute to at most 6 h; after 8 attempts the message is `failed` and logged as an error. A kind with no handler is treated as a failure, so a deploy that forgets a handler shows up in the logs instead of dropping mail.
- **Migrations before the first deployment:** the audit column renames made `drizzle-kit` ask interactively. With no deployed database yet, `0000_initial` was regenerated (only the intended changes, checked by diff); local databases are recreated. From step 2.1 on, every change is a new migration.
- **Tests make the races happen:** the first versions of the concurrent-request and overlapping-run tests passed with their guards removed (the calls ran one after the other, or another filter hid the missing guard). They now hold both calls at the critical point; each of the 8 guards was removed in turn and fails a test.

### D51: Customer accounts, account emails and customer profiles (step 1.6), 2026-09-27

- **Verification doesn't gate sign-in** (`requireEmailVerification: false`): an unverified customer can sign in and see their profile, but every shop write (`requireCustomer`) is refused with `EMAIL_NOT_VERIFIED`, as security.md says. It also keeps the legacy admin login working until step 1.7.
- **Account emails through the outbox**, not sent inside Better Auth's callback: the callback only inserts a message, so a Resend outage doesn't fail sign-up and the email is retried. Cost: up to a minute before it arrives (the task's schedule); a "send now" kick can be added if that proves too slow. Resend gets the outbox message id as its idempotency key (delivery is at least once).
- **No console mail in production:** without a Resend key only the dev server prints mail; a production build throws, so messages stay queued and the failure shows in the logs, rather than one-time links landing in logs.
- **Sent messages drop their payload** (platform-wide): the links are secrets once sent.
- **Password reset:** 1-hour single-use link, signs out everywhere, clears `mustChangePassword` (a `before` hook reads the token's user into a `WeakMap` keyed by the request's context, because the token is deleted before the `after` hook runs). Timing: an unknown email skips one outbox insert; accepted.
- **Customer profiles** (`server/features/customers/`): one per account, staff included (they can be customers too, D45). Created by the sign-up hook, in the staff-creation batch (Better Auth's hooks don't run there, D49), and by `ensureProfile` on first use if the hook failed (D1 has no transactions, so the hook runs after the account is committed). The hook imports the customers feature lazily, because the auth config is loaded at build time before the schema's `#auth/schema` import resolves.
- **Member code** [Choice]: 8 random Crockford base32 characters, `XXXX-XXXX`: short to read out, unguessable from a neighbour's, no ambiguous letters; typed codes are normalized. Reversible while no customer has one printed.
- **Migrations:** `customer_profiles` is migration `0001_customer_profiles`, added on top of `0000_initial` (local databases keep working). Regenerating `0000_initial` (D50) is kept for changes `drizzle-kit` would ask about, and only until step 2.1.

### D52: The admin app on the new identity (step 1.7), 2026-09-27

- **Admins only, for now:** the admin app's session is `GET /api/admin/me` (`AdminSession`: user, `permissions` as `resource:action`, `mustChangePassword`). A customer or branch-staff account is refused at login ("no access to the admin app") and signed out again. Branch managers and staff have no screens here yet (their work is the counter app); opening the admin app to them is a change to `adminSession` and the `/api/admin/**` route gate once manager screens exist. [Choice], reversible.
- **`/api/admin/me` answers on a temporary password** (every other admin route refuses with `PASSWORD_CHANGE_REQUIRED`), so the app can show the change-password page. A route rule lets it answer non-admins itself (403 `NOT_ADMIN` instead of the gate's generic `FORBIDDEN`); the app treats any 403 there as "no access".
- **Forced password change** in the app: the route middleware sends every page to `/change-password` while `mustChangePassword`; `apiFetch` reports `PASSWORD_CHANGE_REQUIRED` (not a lost session) and the app goes there too. The same page is in the user menu. It calls Better Auth's `/change-password` with `revokeOtherSessions`; the server clears the flag (D49).
- **`apiFetch`'s base is `/api`:** the standard's routes are `/admin/…`, the legacy menu routes `/v1/admin/…` until step 3.8. The e2e mock strips `/api` or `/api/v1` before `/admin`, so handler keys didn't change.
- **Removed:** `staff_profiles` (migration `0002_drop_staff_profiles`), the bootstrap route and `NUXT_BOOTSTRAP_TOKEN`, `requireStaff`, `GET /api/v1/admin/me`, `StaffSession`/`ROLE_PERMISSIONS`, the legacy identity service and its tests. The legacy menu routes check `requirePermission` (`menu:read`/`menu:write`, `media:upload`); their services keep a minimal `Actor` type (`server/legacy/actor.ts`). The first admin comes from the seed task.
- **Staff page:** list (search, role and branch filters in the URL), add (temporary password shown once in a modal that can't be dismissed by accident, with Copy), change access (admin switch + one role per branch; your own admin switch is locked), disable (confirmed; the row disappears). `GET /api/admin/branches/options` feeds the branch pickers (`branch:read`).
- **Not built:** resetting a staff member's password by an admin (a lost temporary password can't be re-issued yet), renaming staff.

### D53: Cloudflare staging (step 2.1), 2026-09-27

- **Where:** a `workers.dev` address for now (owner, 2026-09-27; the domain is still Q4), in the account that already hosts the owner's other Workers (confirmed by the owner). Resources: Worker `nuk-cafe-staging`, D1 `nuk-cafe-staging` (Asia-Pacific), R2 `nuk-cafe-staging-media`. No KV yet: nothing uses it.
- **Config lives in `nuxt.config.ts`** (`$env.staging`), not a separate wrangler file: NuxtHub derives the `DB` and `BLOB` bindings and the D1 migrations settings from `hub.db` / `hub.blob`, Nitro writes `.output/server/wrangler.json`. The site URL is a plain var (public); the Better Auth secret is a Worker secret. Cron triggers are listed explicitly (the same keys as `scheduledTasks`); Nitro runs the tasks when Cloudflare calls the Worker.
- **Found on the way (each would have broken the first deploy or the first guarded write):**
  - the step 1.1 `nitro.hooks.compiled` (libsql binary copy) replaced the Cloudflare preset's `compiled` hook, so no `wrangler.json` was written; it's now added from `nitro:init`;
  - `--envName staging` skips `$production`, so the security headers were missing; they're repeated in `$env.staging`;
  - drizzle's D1 driver crashes on a raw `db.run` with bound parameters inside `batch` (`requireCount` always had one), so every access change failed with 500 on D1. The guards are now query-builder `select`s; a test runs them through the D1 driver with a stand-in client and fails on the old form.
- **Verified on staging:** migrations applied remotely; pages and API with the security headers; sign-up (breached password refused), profile hook, `NOT_ADMIN`; staff creation (one D1 batch); three simultaneous saves of one version → one 200, two 409 `VERSION_CONFLICT`; two admins demoting each other at once → one 200, one 409 `LAST_ADMIN`, one admin left; D1 raises `malformed JSON` for the guard (what `isStaleWrite` matches); legacy category create/delete; cron runs the outbox (retries while no Resend key is set). The smoke accounts were deleted afterwards.
- **First admin on staging:** sign up, then promote with `wrangler d1 execute … UPDATE user SET role = 'admin'` (no seed endpoint on deployed Workers). Documented in operations.md.

### D54: CI deploy to staging (step 2.2), 2026-09-27

- **One workflow:** `ci.yml` keeps its checks on every push and pull request, and gets a `deploy-staging` job that runs only for pushes to `main`, after the checks, in the GitHub environment `staging` (which holds the secrets the owner added: Cloudflare token and account id, Resend key). One deploy at a time, never cancelled halfway, so migrations and the Worker can't get out of step.
- **Order:** build → migrations → Worker → Resend key → smoke check. Migrations go first because they're backwards compatible (operations.md → Migrations); the Resend key is re-sent on every deploy from the environment secret, so rotating it is a GitHub change plus a deploy.
- **Smoke check without accounts:** `GET /api/public/health` (new: 200 when the database answers, 503 otherwise, no details), the CSP header on `/login`, JSON 404 for an unknown `/api` path, 401 on `/api/admin/me`. Signing in and a test order join once there's a staging test account strategy and orders.
- **Audit gate:** `pnpm audit --audit-level high`. Today: one low and one moderate advisory, both dev-server-only (esbuild on Windows, through `@nuxt/fonts`); accepted and reviewed with dependency updates.
- **Staging mail:** `NUXT_MAIL_FROM = NUK Cafe <onboarding@resend.dev>`, Resend's test sender, which only delivers to the Resend account's own address. Staging can't email anyone else until the domain (Q4) is verified in Resend. Mail to other addresses fails at Resend and is retried, then marked `failed` (the outbox logs it).
- **First staging admin** (2026-09-27): `admin@gmail.com`, created by sign-up, promoted and marked verified with one D1 command; its queued verification email was deleted so staging never mails that address (a public Gmail address the team may not own).
- **Not possible yet:** WAF rate limits (need a custom domain zone, Q4).

### D55: Menu categories API (step 3.1), 2026-09-27

- **The name `menu_categories` goes to the new feature;** the pre-standard table is renamed `legacy_menu_categories` (the legacy screens keep working until step 3.8; SQLite and D1 retarget the foreign keys on rename, checked on both). Migration `0003` is written by hand because drizzle-kit asks interactively about renames (procedure in progress.md → How to verify).
- **Names unique among active siblings, case-insensitive,** enforced by two partial unique indexes (top level; per parent), so two simultaneous creates can't both win. Archived categories don't hold their name. Two indexes rather than `coalesce(parent_id, '')`: a unique index treats NULL parents as all different, and drizzle-kit breaks expressions with commas. [Choice]: the data model didn't say; duplicates would be confusing in pickers.
- **Moves:** `PATCH` with a new `parentId` moves a category to the end of its new siblings. A category with sub-categories can't move under another (two levels). Guards in the batch re-check the parent (still active and top-level) and "still no children".
- **Archive cascades down, restore doesn't:** archiving a top-level category archives its active sub-categories in the same batch; restoring brings back only that category (the sub-categories still wanted are restored one by one, after their parent). [Choice], avoids reviving sub-categories that were archived on purpose earlier.
- **Order:** `sortOrder` is relative (gaps after archiving, ties after simultaneous creates sort by name); a reorder must list every active sibling with its version, and rewrites them 1…n.
- **Errors:** business-rule refusals are 422 (`CATEGORY_DEPTH`, `PARENT_NOT_AVAILABLE`), conflicts with current data 409 (`CATEGORY_NAME_TAKEN`, `PARENT_ARCHIVED`, `INVALID_STATE`, `VERSION_CONFLICT`), per architecture.md → Errors.
- **Deferred to 3.5:** the item side of "items only in leaf categories".
- **Tests:** 24, including four races made deterministic with an interleaving database wrapper (another write lands between the service's check and its batch); 7 of 9 guards fail a test when removed, and the other two are early checks backed by an in-batch guard that covers the same case. Verified on staging (D1): the migration, the routes, the unique indexes under simultaneous creates.

### D56: Parallel e2e shards in CI, 2026-09-27

- **Cause of the slow CI:** the repository is private, and GitHub's standard runner for private repos has 2 cores. Vitest's default worker count (cores minus one) is then 1, so the 14 e2e files ran one after another: about 300 s of a 410 s run. Locally (12 cores) the same files run side by side, which is why the full suite takes about 2 minutes on a laptop.
- **Change:** `check` (lint, typecheck, audit, unit + server) and three `e2e` shards (`pnpm test:e2e --shard=N/3`, `fail-fast: false`) run as parallel jobs; `deploy-staging` needs all of them. First run: **198 s** (was 410 s), all green.
- **Why not more workers on one runner:** Chrome on 2 cores under full load is where our timing-sensitive tests flaked before (progress.md → e2e pitfalls); separate runners keep each shard's load the same as one file at a time.
- **Balance:** Vitest shards by file count, not duration: shard 1 got products, schedules and unsaved-changes (194 s vs 101 s for shard 3). Accepted: a hand-kept file list per shard would silently skip a new file someone forgets to add. If the slowest shard passes about 2 minutes, add a fourth shard or split the biggest file (`products.test.ts`).
- **Cost:** four runners per run instead of one (each e2e shard installs dependencies and builds the app, about 45 s), which counts against the private repository's Actions minutes.

### D57: Media uploads (step 3.2), 2026-09-27

- **Same move as D55:** the `media` feature owns `media_assets` (with `sha256` and `state_changed_at`); the pre-standard table is renamed `legacy_media_assets` (hand-written migration `0004`), so the legacy menu screens and their upload route keep working until step 3.8.
- **The object store is a parameter** (`ObjectStore`: `put`, `del`): routes and the task pass NuxtHub's `blob`, tests an in-memory store that can fail. The service stays free of Nitro.
- **Checks:** size (by `Content-Length` first, then the bytes), then the type from the first bytes, which must match the claimed type. `ensureBlob` isn't used: it only checks the claimed type and size, with a generic 400, both covered here with 413/415.
- **Consistency without transactions:** upload = put the object, then one batch (row + audit); if the batch fails, the object is deleted. Purge = conditional row delete first (still temporary, still expired), then the object; so no record ever points at a missing object, and a failed object delete only leaves an orphan object (logged).
- **Attach/release for other features:** `attachStatements` (check now + guard in the caller's batch: temporary → attached, one record per asset) and `releaseStatement` (attached → temporary, 24 hours from then). Menu items use them in step 3.5.
- **Tests:** 15, including three races (two attaches at once; cleanup between check and write; attach between the purge's find and delete). 8 of 9 guards fail a test when removed; the ninth ("bytes must be an image") is covered by the claimed-type match. Checked over HTTP on the dev server (upload, serve with `nosniff` and a year's cache, SVG-as-PNG refused, 6 MB refused, no session 401, purge task). **R2 on Cloudflare is still unverified**: it's checked on staging once this is merged (only `main` is deployed, D55).
