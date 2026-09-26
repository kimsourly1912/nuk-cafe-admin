# Feature development standard

How every new feature (Schedules, Products, Rewards, …) is planned, built and verified, so they behave the same way. This page **links** to the rules and APIs rather than repeating them:

- [AGENTS.md](../AGENTS.md): the rules (architecture, boundaries, conventions). It wins if this page disagrees.
- [docs/reference/](reference/README.md): the shared APIs, with types and examples.
- [docs/decisions.md](decisions.md): why things are built this way.
- [docs/progress.md](progress.md): what's done and how it was verified.

Every statement here is labelled:

| Label | Meaning |
|---|---|
| **[Exists]** | Built and in use by Categories. The evidence level is stated where it matters |
| **[Required]** | A convention every feature must follow |
| **[Proposed]** | Not built. Build it when the first feature needs it, following [the roadmap](#7-upcoming-reusable-capabilities) |
| **[Open]** | A product or backend decision nobody has made. Features record a working default and keep it easy to change (a constant, a prop, one mapping function) |

Evidence levels follow [progress.md → Verification levels](progress.md#verification-levels). Note that **e2e tests are browser-mock evidence** (real Chrome, mocked API). **No authenticated flow has been verified against the real API yet.**

---

## 1. Feature planning template

**[Required]** Before writing code, fill this in as `docs/plans/<feature>.md`. Keep it short: a line per item is fine. Mark anything unknown **[Open]** with the working default you'll build to, and add it to [progress.md → Open questions](progress.md#open-questions--waiting-on-others).

```markdown
# <Feature> plan

## Purpose and scope
- Purpose: who uses it and for what.
- In scope / acceptance criteria: a numbered list, each one testable.
- Out of scope: what this iteration will not do.

## API contract (from app/generated/api)
- Endpoints: METHOD /staff/... → sdkFunction (list, all/options, get, create, update, delete, extras).
- Request types / response types.
- Update semantics: is PUT a full replace? What does an omitted field mean (keep or clear)? How is a value cleared (null, '', [])? Verified or [Open]?

## List
- Columns.
- Filters (API params) and their defaults. Search param?
- Ordering: does the API sort (sortBy/sortDir values)? Default order.
- Pagination: page size.
- URL state: which filters go in the URL (usePaginatedQuery: strings and numbers only).

## Form
- Fields: type, required, default, validation message.
- Fields the form doesn't edit, which must be preserved (copied from the existing record).
- Clearing: for each optional field or relationship, how the user clears it and what is sent.

## Relationships
- Pickers needed (from other features' index.ts), single or multiple, exclusions.
- Pickers this feature must export for others.

## Mutations
- create / update / remove / extras: mutation id, key, confirmation, success/error messages.
- Which operations conflict on the same item (e.g. update while delete). isBusy covers them.
- invalidate: own feature + every feature that displays this data.
- Bulk actions: which ones, phases (order), what "partial failure" means.

## Permissions
- Who can view, create, edit and delete. [Open] until the role matrix exists (Q6).

## Freshness
- Anything beyond the defaults (cross-tab invalidation, refetch on return/reconnect)? e.g. polling for live screens.

## Edge cases and verification
- Risks specific to this feature, and the test that covers each (unit / e2e / real-API).
```

---

## 2. Feature structure and boundaries

**[Required]** Follow [AGENTS.md → Feature architecture](../AGENTS.md#feature-architecture). ESLint enforces the import boundaries. The short version:

- Business-specific code lives in `app/features/<feature>/`.
- Route files in `app/pages/` stay thin: `definePageMeta({ title })` plus one page component.
- Other features are imported only through `~/features/<name>` (their `index.ts`).
- `index.ts` exports building blocks (pickers, option composables, display components, types, navigation), never pages or forms.
- Shared code moves to the root when a **second real consumer** needs it ([D16](decisions.md)).
- `app/generated/api/` is never edited. Regenerate it with `pnpm api:generate`.

Where each concern belongs:

| Concern | Where | Notes |
|---|---|---|
| Screens and presentation | `components/<Feature>ListPage.vue`, `<Feature>FormModal.vue` (or a page form) | Private. Only compose building blocks, with no request or error logic of their own |
| Form rules (validation, messages) | `schemas/<feature>-form.ts`: Valibot schema | Pure. The generated request schemas carry no rules ([D14](decisions.md)) |
| Form ↔ request mapping | the same file: `to<Feature>Form`, `to<Feature>Request` | Pure and unit-tested. The one place that knows the backend's update semantics |
| Feature behavior (reads, writes, keys, busy state) | `composables/use<Feature>s.ts`: `use<Feature>List`, `use<Feature>Mutations` | Private |
| Data for other features' pickers | `composables/use<Feature>Options.ts` + `components/<Feature>Select.vue` | **Public** (exported). Must not import other features |
| Sidebar entry | `navigation.ts`, grouped in `app/utils/navigation.ts` | |
| Shared infrastructure | root `components/`, `composables/`, `utils/` (auto-imported) | Only with two or more consumers, or the app shell |
| App-wide behavior | `layouts/`, `middleware/`, `plugins/` | Features don't re-implement it ([app-behavior.md](reference/app-behavior.md)) |

Not wanted: generic CRUD engines, repository or service layers over the SDK, new state libraries, or wrappers that only rename Nuxt UI components.

---

## 3. Standard building blocks

**[Exists]** Features compose these and must **not** re-implement what they own. Full APIs: [reference/](reference/README.md).

| Building block | Owns | Features must not | Reference |
|---|---|---|---|
| `useApiQuery` | Reads: `loading` / `refreshing` / `error` as `ApiError`, load time for freshness | hand-roll loading refs or try/catch around reads | [data-fetching](reference/data-fetching.md#useapiquery) |
| `useMutation` | Writes: per-key concurrency, double-submit skip, confirm, toasts, `removes`, batch (`executeMany`, Stop, Retry failed), invalidation | toast, catch or track pending for writes themselves | [mutations](reference/mutations.md#usemutation) |
| `usePaginatedQuery` | List filters and page, URL state, page reset on filter change, `isFiltered`, `clearFilters` | keep their own page/filter refs or sync the URL | [data-fetching](reference/data-fetching.md#usepaginatedquery) |
| `<SearchInput>` | Debounced search, Enter/Clear, `/` shortcut | debounce search themselves | [ui](reference/ui.md#searchinput) |
| `<ListEmptyState>` | "No X yet" vs "No X match your filters" | write their own empty text | [ui](reference/ui.md#listemptystate) |
| `<ApiErrorAlert>` | Load-failure alert with Retry | show `error.message` from non-`ApiError`s | [errors](reference/errors.md#apierroralert) |
| `useTableSelection` + `<BulkActionsBar>` | Row selection, reset on query change, the "N selected" bar | keep selection state themselves | [ui](reference/ui.md#usetableselection) |
| `useConfirm` | Confirmation dialogs | build ad-hoc confirm modals (deletes use `useMutation`'s `confirm`) | [ui](reference/ui.md#useconfirm) |
| `useModalUnsavedChanges` / `useUnsavedChanges` / `useLeaveGuard` | "Discard unsaved changes?" on close, route change, logout and reload | add their own `beforeunload` or route guards | [forms](reference/forms.md) |
| `invalidate` (+ `invalidateAll`, `invalidateInThisTab`, freshness plugin) | Refetching affected features in this tab and other tabs, on return and on reconnect | refetch other features' data directly or poll | [data-fetching](reference/data-fetching.md#invalidate), [app-behavior](reference/app-behavior.md#data-freshness) |
| `<StatusBadge>`, `STATUS_ITEMS`, `STATUS_FILTER_ITEMS` | ACTIVE/INACTIVE display, form select and filter select | redefine status labels or colors | [ui](reference/ui.md#statusbadge-and-status-constants) |
| `ApiError`, `getErrorMessage`, `useNotify` | Error classification, user-safe messages, toasts for non-mutation actions | compare HTTP statuses or message strings, or call `useToast()` for API results | [errors](reference/errors.md) |
| `usePageShortcuts`, `useSubmitShortcut` | Keyboard shortcuts, suppressed behind dialogs | call `defineShortcuts` directly for page keys | [ui](reference/ui.md#keyboard-shortcuts) |

---

## 4. List-page behavior

**[Required]** Every list page gets this behavior by composing the building blocks the way [`CategoryListPage.vue`](../app/features/categories/components/CategoryListPage.vue) does. The last column states **what is actually verified today**. Being built is not the same as being proven.

| Situation | Required behavior | Provided by | Current evidence and limitations |
|---|---|---|---|
| First load | Table shows "Loading <items>…" (`#loading` slot), never the empty state | `UTable :loading` + `#loading` | Built. No test asserts the loading text |
| Refetch with rows shown | Rows stay, small spinner (`refreshing`) | `useApiQuery` | e2e checks that the refetch happens, not the spinner |
| No records | "No <items> yet" + create button | `ListEmptyState` | e2e |
| Filters match nothing | "No <items> match your filters" + Clear filters | `ListEmptyState` + `isFiltered` | e2e |
| Load fails | Alert with the safe message + Retry | `ApiErrorAlert` | e2e |
| Search, filters, page | Search as you type, page resets on filter change, state in the URL (reload, Back and shared links work) | `usePaginatedQuery`, `SearchInput` | e2e. **Limits:** page size fixed (20) and not in the URL; string/number filters only; one URL-synced list per page |
| Ordering | Server order | none | **[Open]**: Categories' list API has no sort parameter. Schedules has free-form `sortBy`/`sortDir` with undocumented values. No sort UI exists |
| Filter or page change with rows selected | Selection clears | `useTableSelection({ resetOn: [query] })` | Built. **No committed test** (checked ad hoc earlier) |
| Action on an item already in flight | Row dimmed, spinner instead of actions, new actions blocked | `isBusy(id)` from the feature | Built. **No committed test.** The engine only skips a repeat of the **same** mutation and key. Blocking *different* mutations on one item (update while deleting) relies on the UI's `isBusy` |
| Bulk action | One confirmation, limited concurrency, progress toast with **Stop**, one summary ("3 deleted, 1 failed", reasons grouped), **Retry failed**, failed and unstarted rows stay selected | `useMutation` `batch` + `executeMany` | Partial failure and "failed stays selected": e2e. Stop and Retry failed: unit (engine) only |
| Last item on a page deleted | Step back to the last existing page | A `watch` on `totalPages` in each list page ([recipe](reference/data-fetching.md#recipe-step-back-when-the-last-page-empties)) | Built in Categories only, **not shared, not tested**. **[Proposed]**: move into `usePaginatedQuery` when the second list needs it |
| Another staff member changed the data | Picked up by the freshness rules | Freshness plugin | e2e. Another device's change appears only on return to the tab or on navigation (no backend push) |
| Two staff edit the same item | – | none | **[Open]**: the last save silently wins. The API has no version or `updatedAt` for conflict detection on most resources |

---

## 5. Form behavior and request mapping

**[Required]** The pattern, as in [`category-form.ts`](../app/features/categories/schemas/category-form.ts) and [`CategoryFormModal.vue`](../app/features/categories/components/CategoryFormModal.vue):

1. `<feature>FormSchema`: a Valibot schema with user-facing messages for required fields, lengths and formats.
2. `to<Feature>Form(existing?)`: the initial state. It holds defaults for create and the record's values for edit.
3. `to<Feature>Request(form, existing?)`: the request body. It **copies fields the form doesn't edit** from `existing` (`nameI18n`, `sortOrder`, …). It is the only place that encodes the backend's update semantics.
4. The form component uses the feature's mutations and `useModalUnsavedChanges` / `useUnsavedChanges`. There is no generic form engine: each resource's update semantics may differ.

### Values: omitted, `undefined`, `null`, empty

| In the request body | What is sent | Meaning to the backend |
|---|---|---|
| key absent / `undefined` | nothing (JSON drops `undefined`) | **[Open]** per resource: "keep" or "clear"? |
| `null` | `null` | **[Open]**: accepted as "clear"? |
| `''` / `[]` | empty value | **[Open]**: accepted, and does it mean "clear"? |

**[Required]** Until a resource's semantics are verified against the real API:
- `to<Feature>Request` produces the **same body for "unchanged" and "cleared"** only if the plan explicitly says so. Otherwise it encodes clearing explicitly, and the plan marks the choice **[Open]**.
- Its unit test covers both **preserving** and **clearing** each optional field and relationship.

> **Known risk in the reference feature:** clearing a category's parent maps to `mainCategoryId: undefined`, which is **omitted** from the PUT body. Whether the backend then clears the parent or keeps it is unverified. Check this first when real-API testing becomes possible.

Images follow the same rule: "remove the image" and "keep the image" must be distinct in the request (see [image upload](#7-upcoming-reusable-capabilities)).

### Save lifecycle

| Phase | Behavior | Provided by |
|---|---|---|
| Validation fails | Field-level messages, no request | the Valibot schema (via `UForm`) |
| Saving | Submit button loading, inputs disabled, the form doesn't count as unsaved (`paused: saving`) | the feature form + `useModalUnsavedChanges` |
| Double submit | Skipped: create is keyed by what identifies the submission (e.g. the name), update by id | `useMutation` `key` |
| Backend rejects | Toast with the backend reason. The modal stays open with the input intact, and the form is unsaved again | `useMutation`. Backend validation is one string, not per field |
| User closes during save | The save continues. If it fails, the toast offers **Reopen** with the draft (compared against the original record, so it counts as unsaved) | `errorActions` + `draft` prop ([D13](decisions.md)) |
| Save succeeds | `markClean()`, close (`emit('close', true)`), affected features refresh here and in other tabs | the feature form + `useMutation` `invalidate` |
| Leave with changed input | "Discard unsaved changes?" | [forms.md → Edge cases](reference/forms.md#edge-cases) |

---

## 6. Resource picker conventions

**[Required]** for new pickers (`ScheduleSelect`, `ProductSelect`, …), and for `CategorySelect` when it's next touched. **[Proposed]**: no generic picker component. Each feature owns its picker and its data.

| Contract | Rule | `CategorySelect` today |
|---|---|---|
| Model | IDs only: `number \| undefined` (single) or `number[]` (multiple). Never objects | Single `number \| undefined` ✔ |
| Single vs multiple | Explicit: a separate component or a `multiple` prop, never inferred | Single only |
| Optional value | A `noneLabel` option that sets `undefined` (`USelect` can't hold `undefined`). Required fields don't offer "none" | ✔ |
| Loading / disabled | `loading` while options load. `disabled` passes through | Loading ✔, disabled via attrs |
| Load error | Shows the failure with a retry, not an empty list | **Gap**: an error shows as an empty list |
| Current value not in the options (inactive, deleted, filtered out) | Still shows a label (from the record, e.g. `mainCategory.categoryName`, or "#12 (unavailable)"), never a blank field | **Gap**: shows blank |
| Inactive options | **[Open]**: may inactive items be chosen? Default: show them marked "(inactive)" | Listed without marking |
| Domain exclusions | Props named for the rule (`excludeId`: an item can't be its own parent) | ✔ |
| Data source | Small sets: the unpaginated `/all` endpoint, keyed per filter (`<feature>:options:<filter>`). Large sets: remote search against the paginated endpoint (`USelectMenu` with search) | `/staff/categories/all` ✔ |
| Where it lives | `use<Feature>Options` + `<Feature>Select`, exported from `index.ts`, importing no other feature | ✔ |

**[Open]**: when is a set "large"? The working default is remote search once a resource can exceed a few hundred records. Products are the likely first case.

---

## 7. Upcoming reusable capabilities

**[Proposed]** None of these exist. Build each **inside its first consumer**, and promote it to the root on the second real use ([D16](decisions.md)). Don't assume the behavior that needs agreement: record it as **[Open]** with a working default.

| Capability | First consumer | Needs agreement | Feature vs shared | Extract when |
|---|---|---|---|---|
| Image upload | Products (`/staff/products/upload`; `imageUrl`, `imageUuid`) | Upload response shape; size and type limits; replacing vs removing (what the request sends); whether an abandoned upload must be cleaned up | Upload endpoint and field mapping: feature. Picker, preview and progress UI: shared once extracted | Rewards, banners or vouchers need it |
| Translation fields | Any feature, only if editing translations is approved (Q5) | Whether admins edit `en` / `zh-HK` / `km`, which are required, fallbacks | Field list: feature. The locale tabs component: shared | Approved **and** the second form needs it. Until then, forms edit the main field and preserve the maps |
| Money display and input | Products (`price: number`) | Currency, decimal precision, rounding, and whether the API uses major or minor units | Which fields are money: feature. Formatting and parsing: shared | The second feature shows prices (schedules' items, rewards) |
| Date/time display | Lists with `createdAt`/`updatedAt` | Timezone (`ScheduleResponse` has a `timezone`), format, date-only vs timestamp | Shared formatter once agreed | The second feature displays dates |
| Weekday + time-range inputs | Schedules (`days[]`, `startTime`, `endTime`) | Time string format; overnight ranges (end < start); whether times are in the cafe's timezone | Schedules-specific until another feature needs them | A second feature has weekly availability |
| Ordering controls | Categories / Products (`…/sort-order` endpoints) | The request shape; whether ordering is global or per parent/category; how conflicts are handled | Endpoint call: feature. A drag-and-drop list: shared once extracted | Both Categories and Products get ordering |
| Permission helpers | All features, after the role/action matrix (Q6) | Which role may view and do what; whether the backend enforces it (the UI hides, the backend must refuse) | A shared `can(action)` + route meta, once the matrix exists | Immediately when the matrix exists (every feature needs it) |

**[Proposed] test fixtures** (in `test/e2e/support/`, when the second feature needs them):
- A **deferred response** helper: resolve or fail a mocked request on demand. The freshness and unsaved-changes tests hand-roll this today.
- A **paginated handler** with search: the `listHandler` in `test/e2e/list-page.test.ts`, generalized.
- **Failure presets**: validation, not found and technical (`MockFailure` codes) with realistic `reason` texts.

---

## 8. Verification recipes and definition of done

Test by **risk**: pick the scenarios that can actually break in this feature, instead of applying every row to every feature. Helpers: `mockApi`, `MockFailure`, `pageOf`, `toast`, `gotoViaSidebar`, `beforeUnloadPrevented`, `openTabs`, `gotoHydrated` in [`test/e2e/support/mock-api.ts`](../test/e2e/support/mock-api.ts), and the pitfalls in [progress.md → How to verify](progress.md#how-to-verify).

| Scenario | When | How |
|---|---|---|
| Schema rules, `to<Feature>Form` defaults and edit values | Always | Unit (`app/features/<f>/tests/`) |
| Preserving un-edited fields, and **explicit clearing** of each optional field and relationship | Always for update | Unit |
| List: loading, empty, filtered-empty, load failure + Retry | Every list | e2e |
| Create and edit succeed (the list refreshes, no discard prompt after save) | Always | e2e |
| Save fails: backend reason shown, input kept | Always | e2e (`MockFailure`) |
| Double submit / action on a busy row | Features with slow or destructive actions | Unit engine rules exist. e2e with a delayed response |
| Unsaved input; close mid-save + Reopen | Every form. Reopen for forms with long saves | e2e (see `unsaved-changes.test.ts`) |
| Bulk: partial failure, failed stays selected. Stop / Retry failed where the feature adds phases or special rules | Features with bulk actions | e2e + engine unit tests |
| Relationships: picker loads, exclusions, current value not in the options | Features with pickers | e2e |
| Permissions: hidden actions, refused requests | Once Q6 exists | e2e + real-API |
| **Real API:** every endpoint's happy path, and the clearing semantics from §5 | Before calling a feature "done" in progress.md | Manual with a staff login. Record as **real-API** evidence |

**Definition of done** **[Required]**:
- [ ] Plan in `docs/plans/<feature>.md`, with **[Open]** items listed in progress.md.
- [ ] Structure per §2. The public `index.ts` exports building blocks only.
- [ ] Lists and forms behave per §4–§5. Pickers per §6.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass. Run `pnpm build` too when touching config, plugins or modules (e2e also builds).
- [ ] Tests chosen per the table above. For each important test, it was checked to fail when the behavior is removed.
- [ ] Docs: `features.md` (public API), `progress.md` (status plus **evidence level per item**, browser-mock vs real-API kept apart), case tables for new edge cases, `decisions.md` if a decision was made.

---

## 9. Worked example: Categories

How the reference feature maps to this standard:

| Standard | Categories |
|---|---|
| Structure | [`app/features/categories/`](../app/features/categories/), route [`app/pages/categories/index.vue`](../app/pages/categories/index.vue) |
| Public API | [`index.ts`](../app/features/categories/index.ts): `CategorySelect`, `useCategoryOptions`, `categoriesNavigation` |
| Behavior | [`useCategories.ts`](../app/features/categories/composables/useCategories.ts): `useCategoryList`, `useCategoryMutations` (create keyed by name, update/remove by id, `invalidate: ['categories', 'products']`, batch delete with sub-categories first), `isBusy` |
| Form rules + mapping | [`category-form.ts`](../app/features/categories/schemas/category-form.ts) (preserves `nameI18n`, `sortOrder`), tests in [`category-form.test.ts`](../app/features/categories/tests/category-form.test.ts) |
| Form | [`CategoryFormModal.vue`](../app/features/categories/components/CategoryFormModal.vue): unsaved guard, Reopen draft, Ctrl/⌘+Enter |
| List | [`CategoryListPage.vue`](../app/features/categories/components/CategoryListPage.vue) |
| Picker | [`CategorySelect.vue`](../app/features/categories/components/CategorySelect.vue) + [`useCategoryOptions.ts`](../app/features/categories/composables/useCategoryOptions.ts) |
| Tests | [`test/e2e/categories.test.ts`](../test/e2e/categories.test.ts), plus shared-behavior e2e on Categories (`list-page`, `unsaved-changes`, `shortcuts`, `freshness`) |

**Gaps against this standard** (not fixed by this document):
- The tests don't cover clearing the parent (§5), and the backend semantics are unverified.
- `CategorySelect` lacks the error and unavailable-value states (§6).
- There is no committed test for busy rows, selection reset or stepping back to the last page (§4).
- There is no plan document, because the feature predates this standard.
- There is no real-API evidence.

## Planning example: Schedules (next feature)

A first pass at `docs/plans/schedules.md`, from the generated SDK only. **Not implemented.**

- **Purpose:** staff define when menu items are available (days + time range) and which items each schedule covers.
- **Endpoints:** `GET /staff/schedules` (`getPage`: `search`, `status`, `dayOfWeek`, `page`, `size`, `sortBy`, `sortDir`), `GET /staff/schedules/all` (`getAll1`, for `ScheduleSelect`), `GET/PUT/DELETE /staff/schedules/{id}` (`getById1`, `update1`, `delete1`), `POST /staff/schedules` (`create1`), `GET /staff/schedules/days-of-week`, `GET /staff/schedules/available` (`dayOfWeek`, `time`).
- **Types:** `ScheduleCreateRequest` / `ScheduleUpdateRequest`: `name`, `nameI18n`, `description`, `descriptionI18n`, `status`, `startTime`, `endTime`, `days[]` (MONDAY…SUNDAY), `items[]` (product ids). `ScheduleResponse` adds `id` and `timezone`, and returns `items[]` as `{ id, productId, productName, price }`.
- **List:** name, days, time range, status, item count. Filters: search, status, day of week. All three fit the URL state.
- **Form:** name (required), description, status, days (at least one?), start and end time, items. Preserve `nameI18n` and `descriptionI18n`. `items` in the request is product ids, derived from `existing.items[].productId`.
- **Relationships:** exports `ScheduleSelect` (multiple) + `useScheduleOptions` for Products. Needs a `ProductSelect` (multiple) from Products, which doesn't exist yet.
- **Mutations:** `schedules:create` (keyed by name), `schedules:update` / `schedules:remove` (by id). Invalidate `['schedules']`, plus `'products'` if the Products screens end up showing schedule data (decide when Products is planned).

**Contract questions [Open]** (resolve with the real API when possible, otherwise build to the working default):

1. **Time format** of `startTime` / `endTime` (`HH:mm`? `HH:mm:ss`?). The spec only says `string`.
2. **Timezone:** the response has `timezone`, the request doesn't. Are times the cafe's local time?
3. **Overnight ranges** (22:00–02:00): allowed? Default: reject `end ≤ start` in the form until confirmed.
4. **Update semantics:** does PUT replace `days` and `items`, or merge? Does omitting `items` keep or clear them?
5. **`sortBy` / `sortDir`:** allowed values. Default: no sort UI, server order.
6. **Ordering Schedules before Products:** the form needs `ProductSelect`, which belongs to Products. Options: (a) build a minimal public `useProductOptions` + `ProductSelect` in `app/features/products/` first; (b) ship Schedules with items read-only and preserved, editing them once Products exists. The working default is **(a)**, because it's the cleaner fit for the boundary rules (D8).
7. **`/days-of-week`:** does it return labels and order worth using over the enum?
8. **Deleting a schedule that products reference:** refused or cascaded? This shapes the confirmation text and failure handling.
9. **Is the `price` in `items`** the product price or a schedule-specific price? This touches the money capability in §7.
