# Feature development standard

> **Transition note (2026-09-26):** this standard describes the preserved Spring-backed UI. Its generated SDK and network layer have been removed. For new full stack features, define local data and route contracts first using [the system blueprint](plans/system-blueprint.md); apply the UI patterns here when those routes are ready.

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
| **[Choice]** | A reversible presentation or implementation choice, made by the developer within existing requirements and recorded in the plan (e.g. server order with no sort UI) |
| **[Open]** | An unresolved backend, business or authorization contract. **Developers don't decide these**: see [Open questions: choices vs contracts](#open-questions-choices-vs-contracts) |

### Open questions: choices vs contracts

Not every unknown is the same kind.

**A. Reversible choices [Choice].** Presentation or implementation details that existing requirements leave open, and that can be changed later without migrating data or breaking an agreement. Pick a reasonable option, record it in the plan, and keep it easy to change (a constant, a prop). Examples: server ordering with no sort UI; a configurable size threshold for switching a picker to remote search; the order in which parts of a feature are built.

**B. Unresolved contracts [Open].** Backend semantics, business rules and authorization. **Don't invent behavior for these.** Examples:
- omitted vs `null` vs empty values in updates;
- removing a relationship or an image, and cleaning up uploads;
- currency units and rounding;
- schedule timezone, time format and whether overnight ranges are valid;
- whether inactive records may be selected;
- roles and permissions;
- whether translations may be edited.

For each [Open] item:
1. **Record the exact question and who can answer it** (backend team for API semantics, project owner for business rules and permissions) in the plan and in [progress.md → Open questions](progress.md#open-questions--waiting-on-others).
2. **Settle it with authoritative evidence or a decision.** Evidence means the API contract (OpenAPI spec, backend documentation) or a verified real-API check. Existing frontend code and unit tests are **not** evidence of backend behavior.
3. **Continue the work that doesn't depend on it.** One open question doesn't stop a feature.
4. **Defer the affected behavior**: don't offer it in the UI, or leave it visibly incomplete, and say so in progress.md.

An illustrative proposal may be written down, labelled **awaiting approval**. It is not an implementation instruction.

Evidence levels follow [progress.md → Verification levels](progress.md#verification-levels). Note that **e2e tests are browser-mock evidence** (real Chrome, mocked API). **No authenticated flow has been verified against the real API yet.**

---

## 1. Feature planning template

**[Required]** Before writing code, fill this in as `docs/plans/<feature>.md`. Keep it short: a line per item is fine. Mark each unknown as **[Choice]** (with the choice made) or **[Open]** (with the exact question and who can answer it), following [choices vs contracts](#open-questions-choices-vs-contracts). Add every [Open] item to [progress.md → Open questions](progress.md#open-questions--waiting-on-others).

```markdown
# <Feature> plan

## Purpose and scope
- Purpose: who uses it and for what.
- In scope / acceptance criteria: a numbered list, each one testable.
- Out of scope: what this iteration will not do.

## API contract (shared/contracts/<domain>.ts, docs/reference/api.md)
- Routes: METHOD /api/v1/admin/... (list, options, get, create, update, delete, extras), with the permission each needs.
- Request schemas (Valibot) and response types, written before the screen.
- Business rules the server enforces (and which are [Open]: decide or defer, never guess).
- Updates follow the API conventions: PATCH, absent keeps, null clears, `version` required (D41). Lists that replace (links, child rows) say so.

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
- Who can view, create, edit and delete. [Open] until the role matrix exists (Q6). Don't guess role rules in the meantime.

## Freshness
- Anything beyond the defaults (cross-tab invalidation, refetch on return/reconnect)? e.g. screen-specific polling for a live screen, with the reason (D22).

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
- API contracts live in `shared/contracts/`; the server validates with them and the UI imports their types. There is no generated SDK (D39).

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
| `useMutation` | Writes: the request lifecycle, per-key in-flight state and double-submit skip, confirm, toasts, `removes`, batch (`executeMany`, Stop, Retry failed), invalidation | duplicate its request or concurrency state (their own in-flight maps, double-submit guards, try/catch-and-toast). **Form-local submission state is allowed** ([§5](#form-local-vs-shared-pending-state)) | [mutations](reference/mutations.md#usemutation) |
| `usePaginatedQuery` | List filters and page, URL state, page reset on filter change, `isFiltered`, `clearFilters` | keep their own page/filter refs or sync the URL | [data-fetching](reference/data-fetching.md#usepaginatedquery) |
| `<SearchInput>` | Debounced search, Enter/Clear, `/` shortcut | debounce search themselves | [ui](reference/ui.md#searchinput) |
| `<ListEmptyState>` | "No X yet" vs "No X match your filters" | write their own empty text | [ui](reference/ui.md#listemptystate) |
| `<ApiErrorAlert>` | Load-failure alert with Retry | show `error.message` from non-`ApiError`s | [errors](reference/errors.md#apierroralert) |
| `useTableSelection` + `<BulkActionsBar>` | Row selection, reset on query change, the "N selected" bar | keep selection state themselves | [ui](reference/ui.md#usetableselection) |
| `useConfirm` | Confirmation dialogs | build ad-hoc confirm modals (deletes use `useMutation`'s `confirm`) | [ui](reference/ui.md#useconfirm) |
| `useModalUnsavedChanges` / `useUnsavedChanges` / `useLeaveGuard` | "Discard unsaved changes?" on close, route change, logout and reload | add their own `beforeunload` or route guards | [forms](reference/forms.md) |
| `invalidate` (+ `invalidateAll`, `invalidateInThisTab`, freshness plugin) | Refetching affected features in this tab and other tabs, on return and on reconnect | refetch other features' data directly, add global polling, or add a second refresh mechanism. **Screen-specific polling is allowed** when a screen needs live data (e.g. the Orders queue), per D22 | [data-fetching](reference/data-fetching.md#invalidate), [app-behavior](reference/app-behavior.md#data-freshness) |
| `<StatusBadge>`, `STATUS_ITEMS`, `STATUS_FILTER_ITEMS` | ACTIVE/INACTIVE display, form select and filter select | redefine status labels or colors | [ui](reference/ui.md#statusbadge-and-status-constants) |
| `ApiError`, `getErrorMessage`, `useNotify` | Error classification, user-safe messages, toasts for non-mutation actions | compare HTTP statuses or message strings, or call `useToast()` for API results | [errors](reference/errors.md) |
| `usePageShortcuts`, `useSubmitShortcut` | Keyboard shortcuts, suppressed behind dialogs | call `defineShortcuts` directly for page keys | [ui](reference/ui.md#keyboard-shortcuts) |

---

## 4. List-page behavior

**[Required]** Every list page gets this behavior by composing the building blocks the way [`CategoryListPage.vue`](../app/features/categories/components/CategoryListPage.vue) does. The last column states **what is actually verified today**. Being built is not the same as being proven.

| Situation | Required behavior | Provided by | Current evidence and limitations |
|---|---|---|---|
| Layout | Chosen by the job: cards when pictures drive it, a card list for scanning, a table for comparing columns, a tree for nested data (D37). Row/card click opens the item; the ⋮ menu is always visible | the feature | e2e per page |
| Status filter | `<StatusTabs>` with counts | `useStatusCounts` (or client counts) | e2e |
| First load | `<ListSkeleton>` placeholders, never the empty state. **No empty-list `default`** on the list query (it hides `loading`) | `ListSkeleton` + `useApiQuery().loading` | e2e |
| Refetch with rows shown | Rows stay, small spinner (`refreshing`) | `useApiQuery` | e2e checks that the refetch happens, not the spinner |
| No records | "No <items> yet" + create button | `ListEmptyState` | e2e |
| Filters match nothing | "No <items> match your filters" + Clear filters | `ListEmptyState` + `isFiltered` | e2e |
| Load fails | Alert with the safe message + Retry | `ApiErrorAlert` | e2e |
| Search, filters, page | Search as you type, page resets on filter change, state in the URL (reload, Back and shared links work) | `usePaginatedQuery`, `SearchInput` | e2e. **Limits:** page size fixed (20) and not in the URL; string/number filters only; one URL-synced list per page |
| Responses out of order | A slower response to an older filter never replaces newer results, and never delays the newer request | `useApiQuery` (`watch` → cancel, D30) | e2e (fails without the fix) |
| Ordering | Server order | none | **[Choice]**: server order, no sort UI. Categories' list API has no sort parameter. Schedules' `sortBy`/`sortDir` values are undocumented (**[Open]**, backend team), so no sort UI until they're known |
| Filter or page change with rows selected | Selection clears | `useTableSelection({ resetOn: [query] })` | e2e |
| Conflicting actions on one item | **Required:** actions that conflict on the same item (update vs delete, delete vs delete) never overlap. Eligibility is **checked and reserved immediately before each request starts**, with no asynchronous gap between check and reservation. So an item that became busy while a confirmation was open, or while it waited in a batch queue, is not sent. Independent items still run concurrently. Prefiltering (e.g. by `isBusy`) before confirming is only a preliminary UX check | **Existing:** the engine checks and reserves the key **and the record `lock`** synchronously right before each request, so conflicting mutations that share a lock never overlap, and different records run in parallel ([details](reference/mutations.md#concurrency-guarantee-and-current-limits), D28). `isBusy(id)` is the row display (dimmed, spinner). Skipped bulk items are reported and stay selected | **Fixed in Categories (2026-09-26):** update and remove share `category:<id>`. Unit tests (lock taken during confirmation, while queued); e2e: bulk delete during a pending edit skips that row (fails without `lock`). **Every new feature must declare `lock`** on mutations that can conflict |
| Bulk action | Floating `<BulkActionsBar>`. One confirmation, limited concurrency, progress toast with **Stop**, one summary ("3 deleted, 1 failed", reasons grouped), **Retry failed**, failed, skipped and unstarted rows stay selected | `useMutation` `batch` + `executeMany` | e2e: partial failure, Stop (running deletes finish, no more start), Retry failed (no second confirmation) |
| Last item on a page deleted | Step back to the last existing page | A `watch` on `totalPages` in each list page ([recipe](reference/data-fetching.md#recipe-step-back-when-the-last-page-empties)) | e2e (Categories). **[Proposed]**: move into `usePaginatedQuery` when the second list needs it |
| Another staff member changed the data | Picked up by the freshness rules | Freshness plugin | e2e. Another device's change appears only on return to the tab or on navigation (no backend push) |
| Two staff edit the same item | Not agreed | none | **No client-side conflict handling is implemented.** Category responses carry no version or `updatedAt` in the generated types. How the backend handles concurrent updates is **unverified** (**[Open]**, backend team) |

---

## 5. Form behavior and request mapping

**[Required]** The pattern, as in [`category-form.ts`](../app/features/categories/schemas/category-form.ts) and [`CategoryFormModal.vue`](../app/features/categories/components/CategoryFormModal.vue):

1. `<feature>FormSchema`: a Valibot schema with user-facing messages for required fields, lengths and formats.
2. `to<Feature>Form(existing?)`: the initial state. It holds defaults for create and the record's values for edit.
3. `to<Feature>Request(form, existing?)`: the request body. It **copies fields the form doesn't edit** from `existing` (`nameI18n`, `sortOrder`, …). It is the only place that encodes the backend's update semantics.
4. The form component uses the feature's mutations and `useModalUnsavedChanges` / `useUnsavedChanges`. There is no generic form engine: each resource's update semantics may differ.

### Values: omitted, `undefined`, `null`, empty

Possible encodings, whose meaning is set by each resource's contract:

| In the request body | What is sent | Meaning to the backend |
|---|---|---|
| key absent / `undefined` | nothing (JSON drops `undefined`) | per resource: "keep" or "clear"? |
| `null` | `null` | per resource: accepted as "clear"? |
| `''` / `[]` | empty value | per resource: accepted, and does it mean "clear"? |

**[Required]**
- **Intent first.** Where the form offers clearing, form state distinguishes "left unchanged" from "cleared by the user".
- **Map intent through the established contract.** `to<Feature>Request` turns each intent into the request value the resource's contract defines. The plan records the evidence (spec, backend docs, verified real-API check).
- **Preserve untouched fields per the verified semantics**: copy them from `existing`, or omit them only where omission is verified to mean "keep".
- **Unknown semantics: defer, don't guess.** If a resource's clearing semantics are unknown, don't pick `null`, omission or an empty value. Record the [Open] question, and leave the clear operation out of the UI (or visibly unavailable) until it's settled. The rest of the form ships.
- **Unit tests pin down the agreed mapping only.** They don't show how the backend interprets it: that takes real-API evidence.

> **Unverified contract risk in the reference feature (not fixed):** the Category form, which predates this rule, offers clearing a parent and maps it to `mainCategoryId: undefined`, which is **omitted** from the PUT body. Whether the backend then clears or keeps the parent is unverified (Q7). Check this first when real-API testing becomes possible. A new feature would defer such a clear until its contract is known.

Images follow the same rule: "remove the image" and "keep the image" are different intents, and their encoding (and any upload cleanup) is **[Open]** until the contract is known (see [image upload](#7-upcoming-reusable-capabilities)).

### Save lifecycle

| Phase | Behavior | Provided by |
|---|---|---|
| Validation fails | Field-level messages, no request | the Valibot schema (via `UForm`) |
| Saving | Submit button loading, inputs disabled, the form doesn't count as unsaved (`paused: saving`) | the form's own `saving` state + `useModalUnsavedChanges` |
| Double submit | Skipped: create is keyed by what identifies the submission (e.g. the name), update by id | `useMutation` `key` |
| Backend rejects | Toast with the backend reason. The modal stays open with the input intact, and the form is unsaved again | `useMutation`. Backend validation is one string, not per field |
| User closes during save | The save continues. If it fails, the toast offers **Reopen** with the draft (compared against the original record, so it counts as unsaved) | `errorActions` + `draft` prop ([D13](decisions.md)) |
| Save succeeds | `markClean()`, close (`emit('close', true)`), affected features refresh here and in other tabs | the feature form + `useMutation` `invalidate` |
| Leave with changed input | "Discard unsaved changes?" | [forms.md → Edge cases](reference/forms.md#edge-cases) |

### Form-local vs shared pending state

[`CategoryFormModal.vue`](../app/features/categories/components/CategoryFormModal.vue) keeps its own `saving` ref around `create.execute` / `update.execute`. It drives **this form's** disabled inputs, loading button, `paused` unsaved-change guard and "saving continues in the background" hint. That's allowed and expected.

Don't replace it with the mutation's shared state (`create.pending`, `update.isPending(id)`). That state also reflects **other** submissions: another create in flight, or an update of the same row started elsewhere. It would disable or pause the wrong form.

What features must not do is **duplicate the engine**: no in-flight maps, double-submit guards, retry logic or try/catch-and-toast of their own. `useMutation` owns those.

---

## 6. Resource picker conventions

**[Required]** for new pickers (`ScheduleSelect`, `ProductSelect`, …), and for `CategorySelect` when it's next touched. **[Proposed]**: no generic picker component. Each feature owns its picker and its data.

| Contract | Rule | `CategorySelect` today |
|---|---|---|
| Model | IDs only: `number \| undefined` (single) or `number[]` (multiple). Never objects | Single `number \| undefined` ✔ |
| Single vs multiple | Explicit: a separate component or a `multiple` prop, never inferred | Single only |
| Optional value | A `noneLabel` option that sets `undefined` (`USelect` can't hold `undefined`). Required fields don't offer "none" | ✔ |
| Loading / disabled | `loading` while options load. `disabled` passes through | Loading ✔, disabled via attrs |
| Load error | Shows the failure with a retry, not an empty list | ✔ (e2e) |
| Existing value (display) | An existing relationship **stays visible** with a label (from the record, e.g. `product.category.name`, or "Unknown category (unavailable)"), whether the related record is inactive, deleted, filtered out or not selectable. The picker never silently clears or replaces it. Keeping an existing value visible is **separate from** allowing it as a new selection | ✔ `currentLabel` prop, "(inactive)" / "(unavailable)" (e2e) |
| New selections (eligibility) | Offered only per the relationship's **established** eligibility rules. An options or listing endpoint returning a record is **not** evidence that it may be selected, unless that endpoint's documented contract says so. Where eligibility for a class of records (e.g. inactive ones) is **[Open]**, defer that part of the selection behavior: don't offer those records as new selections yet, and record it as incomplete. This is a temporary deferral, **not** a rule that they're forbidden. The standard sets no permanent "always allowed" or "always forbidden" rule. A status marker next to an option is a [Choice] | Inactive categories are **not offered** as new selections while Q9 is open (deferral per this rule, D31); an inactive current value stays visible and selectable (e2e) |
| Domain exclusions | Props named for the rule (`excludeId`: an item can't be its own parent) | ✔ |
| Data source | Small sets: an unpaginated list or `/options` route, keyed per filter (`<feature>:options:<filter>`). Large sets: remote search against the paginated route (`USelectMenu` with search) | `/admin/categories`, `/admin/schedules/options` ✔ |
| Where it lives | `use<Feature>Options` + `<Feature>Select`, exported from `index.ts`, importing no other feature | ✔ |

**[Choice]**: when a set is "large". Make it a configurable threshold (a constant or prop), and switch a picker to remote search when its resource can realistically exceed it. Products are the likely first case.

---

## 7. Upcoming reusable capabilities

**[Proposed]** None of these exist. Build each **inside its first consumer**, and promote it to the root on the second real use ([D16](decisions.md)). Everything in "Needs agreement" is an **[Open]** contract ([category B](#open-questions-choices-vs-contracts)): record the question and who answers it, build the parts that don't depend on it, and defer the rest.

| Capability | First consumer | Needs agreement | Feature vs shared | Extract when |
|---|---|---|---|---|
| Image upload | **[Exists]** in Products: `ProductImageInput` (`useFileDialog`, type/size check, upload on pick, Save waits; D34) | Upload response shape; size and type limits; replacing vs removing (what the request sends); whether an abandoned upload must be cleaned up | Upload endpoint and field mapping: feature. Picker, preview and progress UI: shared once extracted | Rewards, banners or vouchers need it |
| Translation fields | Any feature, only if editing translations is approved (Q5) | Whether admins edit `en` / `zh-HK` / `km`, which are required, fallbacks | Field list: feature. The locale tabs component: shared | Approved **and** the second form needs it. Until then, forms edit the main field and preserve the maps |
| Money display and input | **[Exists]** in Products: USD major units, `formatPrice` / `PRICE_FORMAT` + `UInputNumber` (D34) | Currency, decimal precision, rounding, and whether the API uses major or minor units | Which fields are money: feature. Formatting and parsing: shared | The second feature shows prices (schedules' items, rewards) |
| Date/time display | Lists with `createdAt`/`updatedAt`. Schedules already convert **times of day** to the viewer's zone (`app/features/schedules/utils/timezone.ts`, D33): the model for promotion | Timezone (`ScheduleResponse` has a `timezone`), format, date-only vs timestamp | Shared formatter once agreed | The second feature displays dates |
| Weekday + time-range inputs | **[Exists]** in Schedules: `UCheckboxGroup` + Every day/Weekdays/Weekends, `UInputTime` (12-hour, viewer's timezone; `Time` ↔ `HH:mm` via `utils/time.ts`, zone conversion via `utils/timezone.ts`, D33), `formatDays`/`formatTimeRange` (`app/features/schedules/utils/days.ts`) | Time format, timezone and overnight ranges: see [plans/schedules.md](plans/schedules.md) S1–S3 (safest encodings, unverified) | Schedules-specific | A second feature has weekly availability |
| Ordering controls | **[Exists]** in Categories (D36): sort mode per type, `useSortable` on `UTable` + keyboard, explicit save. Products (per category) next: no route yet | The request shape; whether ordering is global or per parent/category; how conflicts are handled | Endpoint call: feature. A drag-and-drop list: shared once extracted | Both Categories and Products get ordering |
| Permission helpers | All features, after the role/action matrix (Q6) | Which role may view and do what; whether the backend enforces it (the UI hides, the backend must refuse) | A shared `can(action)` + route meta, once the matrix exists | Immediately when the matrix exists (every feature needs it) |

**Test fixtures** (built 2026-09-26, in `test/e2e/support/mock-api.ts`): `deferred()` (hold a response, release or fail it on demand), `paginatedHandler(rows)` (search + 0-based pagination, rows may be a function), `failures.*` (validation, not found, technical, unauthorized). Unmocked requests fail the test.

---

## 8. Verification recipes and definition of done

Test by **risk**: pick the scenarios that can actually break in this feature, instead of applying every row to every feature. Helpers: `mockApi` (strict: unmocked requests fail the test), `MockFailure`, `failures`, `deferred`, `paginatedHandler`, `pageOf`, `toast`, `gotoViaSidebar`, `beforeUnloadPrevented`, `openTabs`, `gotoHydrated` in [`test/e2e/support/mock-api.ts`](../test/e2e/support/mock-api.ts), and the pitfalls in [progress.md → How to verify](progress.md#how-to-verify).

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
- Clearing a parent is offered and encoded as an omitted field, but the backend meaning is unverified (§5, Q7).
- Fixed 2026-09-26 (see [the hardening plan](plans/admin-foundation-hardening.md)): cross-operation conflicts (`lock`), `CategorySelect` error and unavailable-value states, tests for row blocking, selection reset, Stop, Retry failed and last-page step-back.
- There is no plan document, because the feature predates this standard.
- There is no real-API evidence.

## Worked example: Schedules

Planned and built 2026-09-26: [plans/schedules.md](plans/schedules.md). The draft that stood here listed its [Open] questions (time format, timezone, overnight ranges, PUT semantics for `items`, deleting a schedule in use, sort values, `price`). The plan records how each was handled.

By user decision ([D32](decisions.md)), unanswered contracts were **not** all deferred. Each got the encoding that is safe under every plausible backend meaning, backed by real evidence where possible (the dev API's unauthenticated `/public/**` endpoints), and is marked "verify on first staff login". Only deleting a schedule in use stays deferred, because no encoding makes an unknown destructive effect safe.

New patterns worth reusing:
- **Detail before edit:** the list has no `items`, so `ScheduleFormModal` fills the fields from the row, loads `GET /{id}`, and keeps Save disabled until it has loaded.
- **Refuse at request start:** the delete mutation re-reads the record and throws an `ApiError` (`conflict`) if it's in use, so single and bulk deletes both respect the rule even when the list is stale.
- **Bulk action with ineligible rows:** only eligible rows are sent, the confirmation says how many were kept, and the kept rows stay selected.
