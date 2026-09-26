# Feature public APIs

← [API Reference](./README.md)

What each feature exports from its `index.ts` for **other features and the app shell**. Import only from `~/features/<name>`: deep imports are lint errors.

A feature's public API contains **building blocks only** (pickers, option data, types, navigation), never pages or forms. That's what lets features that reference each other (products ↔ schedules) use each other's pickers without import cycles. See `docs/decisions.md` D8.

| Feature | Exports |
|---|---|
| `auth` | [`useAuth`](./auth.md#useauth), [`loginRedirectTarget`](./auth.md#loginredirecttarget), `SessionUser` |
| `categories` | [`CategorySelect`](#categoryselect), [`useCategoryOptions`](#usecategoryoptions), `CategoryOptionsFilter`, `categoriesNavigation` |
| `schedules` | [`ScheduleSelect`](#scheduleselect), [`useScheduleOptions`](#usescheduleoptions), `schedulesNavigation` |
| `products` | `productsNavigation` ("Menu items"). A `ProductSelect` waits for its first consumer |

When you add a feature, add its section here. Pickers follow the contract in [feature-standard.md → Resource picker conventions](../feature-standard.md#6-resource-picker-conventions).

---

## categories

### `CategorySelect`

A category picker for forms: the product form's category field, or a category's parent field.

```ts
import { CategorySelect } from '~/features/categories'
```

```vue
<!-- required category (any level), with the edited record's name as a fallback label -->
<CategorySelect v-model="state.categoryId" :current-label="product?.category.name" />

<!-- optional parent, with a "none" option; the edited category can't be its own parent -->
<CategorySelect
  v-model="state.parentId"
  level="main"
  :exclude-id="category?.id"
  none-label="None (main category)"
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `v-model` | `string \| undefined` | | Category id. Choosing the `noneLabel` option sets `undefined`. |
| `level` | `'main' \| 'sub'` | all | Which categories to list. |
| `excludeId` | `string` | | Hide one category. |
| `noneLabel` | `string` | | Adds an option that clears the value. `USelect` can't hold `undefined`, and this handles that internally. |
| `placeholder` | `string` | `'Select a category'` | |
| `currentLabel` | `string` | | Name of the current value from the edited record (e.g. `product.category.name`), shown if the value isn't among the options. |
| `includeInactive` | `boolean` | `false` | Also offer inactive categories. **Only for filters**, where no new relationship is made (Q9 doesn't apply). |

Other attributes (`aria-label`, `id`, …) go to the select itself, so they name it for screen readers and tests. `class` sizes the wrapper (full width by default).

It loads its options through `useCategoryOptions` and shows a loading state while fetching. Behavior (D31, e2e `test/e2e/pickers.test.ts`):
- **Current value stays visible**, never cleared: labelled from the options, `currentLabel` or "Unknown category", marked "(inactive)" or "(unavailable)".
- **Inactive categories aren't offered as new selections** while their eligibility is open (Q9). This is a deferral, not a rule.
- **Load error:** shows the message with **Retry** instead of an empty list.

### `useCategoryOptions`

Unpaginated categories for pickers.

```ts
function useCategoryOptions(filter?: MaybeRefOrGetter<{ level?: 'main' | 'sub' }>)
// → useApiQuery result, `data`: Category[] (default [])
```

```ts
const { data: mainCategories, loading } = useCategoryOptions({ level: 'main' })
```

- Key: `categories:options:<level>`. Each filter is cached separately, and all of them refresh on `invalidate('categories')`.
- Calls `GET /api/v1/admin/categories?level=`.

### `categoriesNavigation`

The sidebar entry (`NavigationMenuItem`), grouped in `app/utils/navigation.ts`.

---

## schedules

### `ScheduleSelect`

A multiple-schedule picker, e.g. the menu-item form's `scheduleIds`.

```ts
import { ScheduleSelect } from '~/features/schedules'
```

```vue
<ScheduleSelect v-model="state.scheduleIds" />
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `v-model` | `string[]` | `[]` | Schedule ids. |
| `placeholder` | `string` | `'No schedule'` | |

Behavior (e2e `test/e2e/products.test.ts`), the same contract as `CategorySelect`:
- **Selected schedules stay visible**, never cleared: "(inactive)" when inactive, "Unknown schedule (unavailable)" when it no longer exists.
- **Inactive schedules aren't offered as new selections** while Q9 is open.
- **Load error:** the message with **Retry**.
- Attributes go to the select, `class` to the wrapper (as `CategorySelect`).

### `useScheduleOptions`

```ts
function useScheduleOptions() // → useApiQuery result, `data`: ScheduleOption[] (default [])
```

- Key: `schedules:options`, refreshed by `invalidate('schedules')`.
- Calls `GET /api/v1/admin/schedules/options` (all statuses).
