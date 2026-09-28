# Forms: unsaved changes

Warn the user before input they haven't saved is lost.

- [`useUnsavedChanges`](#useunsavedchanges): page forms
- [`useModalUnsavedChanges`](#usemodalunsavedchanges): forms in `UModal` / `USlideover` / `UDrawer`
- [`useLeaveGuard`](#useleaveguard): the app-wide check
- [`isSameFormValue` and `cloneFormValue`](#issameformvalue-and-cloneformvalue)

Source: `app/composables/useUnsavedChanges.ts`, `app/utils/form-value.ts`, `app/middleware/unsaved-changes.global.ts`, `app/plugins/leave-guard.client.ts`. Decision: [D19](../decisions.md).

## How it works

Every form that uses one of these composables registers itself app-wide while it's mounted. A form is **unsaved** when its values differ from what it opened with. Typing and then undoing it doesn't count, and a form is never unsaved while its save is running (`paused`).

| The user… | What happens |
|---|---|
| Closes a modal (X, Esc, outside click, Cancel) | "Discard unsaved changes?" with **Keep editing** / **Discard** (`useModalUnsavedChanges`) |
| Changes route: sidebar link, `navigateTo`, back/forward, same page with other params | The same dialog (global middleware). On **Discard** every open form is discarded and modals close |
| Logs out | The same dialog, **before** the backend logout (`useAuth().logout`) |
| Reloads, closes the tab, types a URL | The browser's own "Leave site?" dialog (text can't be customized) |
| Loses the session (redirect to login) | Nothing: the redirect is forced |

However many forms are open (a modal over a page form, back pressed twice), the user sees **one** dialog.

## Where forms live, and what to use

This table only says **which guard** to use. Which surface a form belongs in (modal, slideover, route, full screen on compact) is decided in [page-patterns → Detail / editor](./page-patterns.md#4-detail--editor).

| Where | Examples | Use |
|---|---|---|
| Modal | Category form (reference) | `useModalUnsavedChanges` |
| Slideover / Drawer | Big forms (menu item with variants) | `useModalUnsavedChanges` (same `update:open` API) |
| Full page (`/x/new`, `/x/:id/edit`, settings) | Products, points settings, carbon settings | `useUnsavedChanges` |
| Tabs inside a page | Customer detail | Tabs switched by URL: covered. Tabs switched by local state: call `useLeaveGuard().confirmLeave()` before switching |
| Multi-step wizard | Vouchers, rewards | One `useUnsavedChanges` over the whole wizard state (not one per step) |
| Unsaved list reordering (drag and drop) | Category / product sort order | `useUnsavedChanges` over the ordered id array (order matters in `isSameFormValue`) |
| Inline actions that save at once | Status toggle, delete | Nothing: there is no unsaved state |
| List filters, search, login form | | Nothing: losing them costs nothing (filters are in the URL anyway) |

## Edge cases

Every case below is handled. **Keep this table and the tests in sync when changing the guard.** E2E tests: `test/e2e/unsaved-changes.test.ts`. Unit tests: `test/unit/form-value.test.ts`.

| # | Case | Behavior | How | Tested |
|---|---|---|---|---|
| 1 | Hard reload, close tab, type a URL, external link | Browser's own "Leave site?" (text can't be changed) | `beforeunload` in `leave-guard.client.ts` | e2e (dispatches `beforeunload`, since headless Chrome never shows it) |
| 2 | Nothing unsaved | No `beforeunload` listener at all | VueUse `useEventListener` with a reactive target. A permanent listener would disable the browser's back/forward cache | e2e |
| 3 | Sidebar link, `navigateTo`, browser back/forward | Our dialog. Keep editing: the URL is restored (Vue Router undoes the popstate) | Global middleware `unsaved-changes.global.ts` | e2e (back) |
| 4 | Same page, other params (`/products/1/edit` → `/2/edit`) | Our dialog (the middleware runs on every route change) | Global middleware | **Not tested**: no such page yet. The page must reset its form on param change (see caveats) |
| 5 | Modal open while the route changes (back button) | Asks. On Discard the modal **closes** too: overlay modals are app-level and would otherwise stay open over the next page | `onDiscard` → `close` | e2e |
| 6 | Logout | Asks **before** the backend call. Keep editing: stays logged in | `useAuth().logout` calls `confirmLeave()` first | **Not tested in a browser**: a modal blocks the user menu, and no page form exists yet. Logout **from another tab** with unsaved input: e2e (`session.test.ts`, no dialog) |
| 7 | Session expired → forced redirect to login | No dialog; the form modal closes and its input is discarded | Middleware skips when logged out; the session boundary discards forms and closes overlays | e2e (`session.test.ts`: expiry during a save) |
| 8 | Modal: X, Esc, outside click, Cancel | Our dialog | `update:open` → `onOpenChange`, Cancel → `requestClose` | e2e (all four) |
| 9 | Save running | Not unsaved: closing works, the save continues ("Reopen" if it fails). Tab close still warns until the save ends (in-flight guard) | `paused: saving` | e2e |
| 10 | Save failed | Form stays open with the input and the backend reason; unsaved again; can retry | `paused` goes back to false | e2e |
| 11 | Reopened draft (after a failed background save) | Unsaved at once (compared to the original record) | `initial: toXForm(record)` | Not in e2e |
| 12 | Typed then undone; `''` vs `undefined`; `[]` vs missing | Not unsaved | `isSameFormValue` | unit + e2e |
| 13 | List refetches while an edit form is open (invalidate, tab focus) | Input untouched; baseline unchanged | The form keeps its own copy (`reactive({...})`), the baseline is a snapshot | By design |
| 14 | Several forms (modal over a page form); back pressed twice | **One** dialog; Discard discards all | One registry, one in-flight `confirmLeave` promise | e2e (double back) |
| 15 | Esc / outside click on the discard dialog itself | Nothing (it's "Keep editing" only by button). Never discards by accident | `ConfirmDialog` is `dismissible: false` | By design |
| 16 | Successful save then redirect (page forms) | No dialog | Call `markClean()` before `navigateTo` | e2e (`products.test.ts`: the Menu item page saves and returns to the list, D90) |
| 17 | Filter/search change on a list (URL `replace`) | No dialog unless a form is unsaved (none can be: modals block the list) | Middleware runs but finds nothing dirty | e2e (list-page) |
| 18 | Same form in two browser tabs | Not handled (no cross-tab sync) | Out of scope | |
| 19 | Reordering rows (drag and drop or ↑/↓ on a handle: menu-item variants, the categories tree) | Unsaved, like any edit; moving back to the original order makes it clean again | Order matters in `isSameFormValue`; row keys come from ids, so a freshly opened form compares equal | e2e (`products.test.ts`) |
| 20 | Removing the last row of a list that needs one (variant options) | The "Add at least one option" message appears on the next save, not at once: validation runs per edited field | UForm `validate-on` input/change | e2e |
| 21 | An unsaved list order on a page (the categories tree) and a filter change | Filters are **locked** until the order is saved or discarded: a filter change is a route change the guard could only cancel after the filters had changed | `:disabled` on the filter inputs while dirty | e2e (`categories-sort.test.ts`) |
| 22 | A modal closed with **Discard** whose closing changes the URL (the Menu items slide-over removes `?item=`, D90) | **One** dialog: the route guard doesn't ask again | `requestClose` calls `markClean()` before `close`: the form stays registered until the overlay unmounts | e2e (`products.test.ts` "asks only once", checked to fail without it) |

Implementation traps (each one broke something once, see [D19](../decisions.md)):
- `isSameFormValue` must read **through** reactive proxies. `toRaw` makes the `computed` stop tracking, so `isDirty` never changes. A unit test guards this.
- The modal component **must declare the `update:open` emit**. Otherwise the overlay's own `v-model:open` listener closes the modal before we can ask.
- `useConfirm` creates one overlay per question with `destroyOnClose`. Calling it from middleware must not accumulate overlay entries.
- E2E: reach the page **through the sidebar**, not `page.goto`, before testing back/forward. `goto` loads a new document, so Back would leave the SPA (a full page load), not change the route.

---

## `useUnsavedChanges`

For forms that live on a page. Route changes, logout and tab close are covered by the global guard, so nothing else is needed.

```ts
function useUnsavedChanges<T extends object>(
  state: MaybeRefOrGetter<T>,
  options?: UnsavedChangesOptions<T>,
): { isDirty: ComputedRef<boolean>, markClean: () => void }

interface UnsavedChangesOptions<T> {
  initial?: T                          // what counts as saved; default: `state` when called
  paused?: MaybeRefOrGetter<boolean>   // treat as saved while true (e.g. while saving)
  onDiscard?: () => void               // user discarded from outside the form (route change, logout)
}
```

### Returns

| Field | Meaning |
|---|---|
| `isDirty` | `true` while the values differ from the baseline (and not `paused`) |
| `markClean()` | Makes the current values the new baseline. Call it after a save when the form stays open, or **before redirecting away after a save** |

### Example

```vue
<!-- features/products/components/ProductEditPage.vue (illustrative) -->
<script setup lang="ts">
const state = reactive(toProductForm(product.value))
const saving = ref(false)
const { markClean } = useUnsavedChanges(state, { paused: saving })

async function onSubmit() {
  saving.value = true
  const result = await update.execute({ id, body: toProductRequest(state, product.value) })
  saving.value = false
  if (!result.ok) return
  markClean() // otherwise the redirect below asks "Discard unsaved changes?"
  await navigateTo('/products')
}
</script>
```

### Caveats

- A route that reuses the same page component for different params (`/products/1/edit` → `/products/2/edit`) is guarded, but Vue **reuses the component**. Reset the form state when the param changes, or key the page (`<NuxtPage :page-key="route => route.fullPath" />`).
- Tabs that switch by local state (not the URL) unmount a form without any route change. Guard the tab switch yourself with `useLeaveGuard().confirmLeave()`.

---

## `useModalUnsavedChanges`

`useUnsavedChanges` plus asking before the modal closes. It works for `UModal`, `USlideover` and `UDrawer` (they share the `update:open` API).

```ts
function useModalUnsavedChanges<T extends object>(
  state: MaybeRefOrGetter<T>,
  options: { initial?: T, paused?: MaybeRefOrGetter<boolean>, close: () => void },
): { isDirty, markClean, requestClose: () => Promise<void>, onOpenChange: (open: boolean) => void }
```

`close` is how the modal really closes (`emit('close', false)`). On Discard from a route change, it's also called to close the modal.

### Wiring (three places)

```vue
<script setup lang="ts">
// 1. Declare `update:open` so the overlay's listener doesn't close the modal directly.
const emit = defineEmits<{ 'close': [saved: boolean], 'update:open': [open: boolean] }>()

const state = reactive<CategoryForm>({ ...(props.draft ?? toCategoryForm(props.category)) })
const saving = ref(false)
const unsaved = useModalUnsavedChanges(state, {
  initial: toCategoryForm(props.category), // a reopened draft counts as unsaved
  paused: saving,                          // closing mid-save keeps working (save continues)
  close: () => emit('close', false),
})

async function onSubmit() {
  // ...
  if (!result.ok) return
  unsaved.markClean()
  emit('close', true)
}
</script>

<template>
  <!-- 2. X, Esc and outside click arrive here -->
  <UModal title="Edit category" @update:open="unsaved.onOpenChange">
    <!-- ... -->
    <!-- 3. Cancel asks too -->
    <UButton label="Cancel" @click="unsaved.requestClose()" />
  </UModal>
</template>
```

`app/features/categories/components/CategoryFormModal.vue` is the reference.

---

## `useLeaveGuard`

The app-wide check. You rarely call it: the route middleware, the tab-close plugin and `logout()` already do.

```ts
function useLeaveGuard(): {
  hasUnsavedChanges: ComputedRef<boolean>
  confirmLeave: () => Promise<boolean> // true: nothing unsaved, or user chose Discard (forms are discarded)
  discardAll: () => void              // discard every form without asking: only for forced transitions (session boundary)
}
```

Call `confirmLeave()` before any other action that throws away open forms and isn't a route change, such as switching local-state tabs, or an action that calls the backend and then navigates (like logout):

```ts
const { confirmLeave } = useLeaveGuard()
async function switchTab(tab: string) {
  if (!await confirmLeave()) return
  activeTab.value = tab
}
```

Concurrent calls share one dialog and one answer.

---

## `isSameFormValue` and `cloneFormValue`

Pure helpers behind the composables (`app/utils/form-value.ts`, unit-tested in `test/unit/form-value.test.ts`).

- `isSameFormValue(a, b)`: deep comparison where `''`, `null`, `undefined`, `[]` and a missing key are all "empty". Array order matters, dates compare by time, files by identity. Reads through reactive proxies, so it can be used in a `computed`.
- `cloneFormValue(value)`: a deep copy of plain objects and arrays (unwrapping proxies). Files, blobs and dates are kept by reference.

Known limits: `1` and `'1'` are different (use numeric inputs for numbers), and multi-selects whose order can change without meaning anything should keep their array sorted.
