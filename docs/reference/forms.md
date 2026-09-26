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
