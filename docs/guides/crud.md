# Crud

Task-specific instructions extracted from the former root guide. Read applicable sections via [task routing](../../AGENTS.md#load-context-for-the-task); do not load all guides at startup. Linked reference pages own API signatures and detailed behavior.

## CRUD state: `useApiQuery` and `useMutation`

Every read goes through **`useApiQuery`** and every create/update/delete through **`useMutation`**. Never duplicate their request state: no hand-rolled request `loading` refs, in-flight tracking, try/catch or toasts for API calls. A form may keep **its own** submission state (e.g. `saving` in `CategoryFormModal`, for its disabled inputs and unsaved-change pause). See [feature-standard.md §5](../feature-standard.md#form-local-vs-shared-pending-state).

**Reads:** `useApiQuery(key, handler, useAsyncDataOptions)` is `useAsyncData` with `pending` (boolean), `loading` (first load, no data yet), `refreshing` (reloading while old data is shown) and `error` (already an `ApiError`). Its `watch` option **cancels** a running request instead of queueing behind it (D30), so a slow older response never replaces newer results. **A refresh that fails for the connection or the server keeps the last data** (`error` still set; never across keys or sessions, D150): show it with a note where it matters.

**Writes:** mutations are defined once per feature, in `use<Feature>Mutations()`, with `useMutation(fn, options)`:

| Option | Meaning |
|---|---|
| `id` | `'<feature>:<action>'`. **State is shared by id app-wide** (`useState`): a row sees "saving" even after the modal that started it was closed |
| `key` | Identifies the item (`c => c.id`). Different keys run **in parallel**. A call for a key already in flight is **skipped** (no double submit). Omit only if calls must run one at a time |
| `lock` | Record lock shared **across mutations** (e.g. `category:7` from both update and remove). Give every mutation that can conflict on a record (update, remove, status…) the same lock: a call whose lock is held is skipped when it would start (after confirmation, per batch item) with an explaining toast. **Required** for conflicting operations (D28) |
| `confirm` | Ask first (deletes). The dialog closes on answer and the work continues in the background |
| `undo` | Instead of asking: run at once and offer **Undo** on the toast (D152). Only where the reverse puts everything back the same (archive, unpublish); `execute(input, { undo: false, confirm })` inside a modal or slide-over, whose toast can't be reached |
| `successMessage` / `errorMessage` | Toast titles; name the item (`Category "Tea" deleted`). The error description is the `ApiError` message |
| `invalidate` | Features to refresh after success |
| `removes` | The row disappears on success (`isRemoved(key)`) before the refreshed list arrives |
| `batch` | Enables `executeMany`: `noun`, `verb`, `concurrency` (default 4), `confirm(items)`, `phases(items)` (e.g. children before parents) |

The returned object is **reactive (don't destructure it)**:

- `execute(input, { confirm?, errorActions? })` **never throws**. It resolves to `{ ok: true, data }`, `{ ok: false, status: 'error', error }`, or `{ ok: false, status: 'cancelled' | 'skipped' }`.
- `executeMany(items)` runs with one confirmation, limited concurrency, a progress toast with **Stop**, one summary toast ("3 categories deleted, 1 failed", reasons grouped, **Retry failed**) and one refresh. It resolves to `{ succeeded, failed, skipped, notStarted, cancelled }`. Busy items (same mutation in flight, or their `lock` held by another mutation, e.g. a pending update during a bulk delete) are skipped, checked again when each item starts, and reported in the summary.
- `isPending(key?)`, `pending`, `pendingCount()`, `errorOf(key?)`, `error`, `data`, `isRemoved(key)`, `reset(key?)`.
- Calls are **never cancelled on unmount**. `plugins/leave-guard.client.ts` warns before the tab closes while anything is in flight.

Rules the Categories reference follows:

- The feature exposes **`isBusy(id)`** (any mutation in flight for that item). The list dims the row and shows a spinner instead of its row actions. That is the display; the exclusion itself is `lock` ([mutations.md](../reference/mutations.md#concurrency-guarantee-and-current-limits)). After a bulk action, keep `failed`, `skipped` and `notStarted` rows selected.
- **Form modals stay open while saving** (backend errors need the input on screen) but **can be closed**: the save continues. If it then fails, the toast offers **"Reopen"** with the draft restored (`errorActions` + a `draft` prop).
- **Unsaved changes are guarded.** Every create/edit form uses `useModalUnsavedChanges` (modals) or `useUnsavedChanges` (pages), so closing the modal, changing route, logging out or reloading with changed input asks first. Pass `paused: saving` and call `markClean()` after a successful save (see [docs/reference/forms.md](../reference/forms.md)). A **long** form (minutes of input) also passes `draft` and shows `<FormDraftAlert>`, and calls `markSaved()` instead (D151); never for secrets.
- **Errors leave as soon as they're fixed:** every `UForm` calls `useFormErrorRecheck(form)` (D166). A checkbox or switch inside a group's `UFormField` gets its own `UFormField`. A control that saves when changed never blocks the others ([ui.md §17](../reference/ui.md#17-expected-behavior-owner-2026-10-13-d165-d166)).
- **Create is keyed by something that identifies the submission** (the name), so two different creates can run in parallel while a double submit is skipped.
- **Bulk actions:** a **Select mode** (a toolbar toggle: Select, then Cancel in the same place; `S` toggles, Escape leaves; no always-on checkboxes; on phones behind the toolbar's `⋯`, D129) with `useTableSelection(rows, getKey, { resetOn: [query] })` + `<BulkActionsBar>` (D89). Selection clears on filter or page change. After `executeMany`, keep only the `failed`, `skipped` and `notStarted` rows selected.
- If the current page becomes empty after deletes, step back to the last existing page.

The concurrency rules live in the framework-free engine `app/utils/mutation.ts` and are unit-tested in `test/unit/mutation.test.ts`. `useMutation` only wires it to Nuxt (state, toasts, confirm, invalidate).

