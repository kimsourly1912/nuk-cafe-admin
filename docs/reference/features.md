# Feature public APIs

← [API Reference](./README.md)

What each feature exports from its `index.ts` for **other features and the app shell**. Import only from `~/features/<name>`: deep imports are lint errors.

A feature's public API contains **building blocks only** (pickers, option data, types, navigation), never pages or forms. That's what lets features that reference each other (products ↔ schedules) use each other's pickers without import cycles. See `docs/decisions.md` D8.

| Feature | Exports |
|---|---|
| `auth` | [`useAuth`](./auth.md#useauth), [`loginRedirectTarget`](./auth.md#loginredirecttarget), `SessionUser` |
| `categories` | [`CategorySelect`](#categoryselect), [`useCategoryOptions`](#usecategoryoptions), `CategoryOptionsFilter`, `categoriesNavigation` |
| `schedules` | `schedulesNavigation`. `ScheduleSelect` (multiple) + `useScheduleOptions` (`GET /staff/schedules/all`) are added with their first consumer, the menu-item form ([plan](../plans/schedules.md#relationships)) |

When you add a feature, add its section here. Pickers follow the contract in [feature-standard.md → Resource picker conventions](../feature-standard.md#6-resource-picker-conventions).

---

## categories

### `CategorySelect`

A category picker for forms: the product form's category field, or a category's parent field.

```ts
import { CategorySelect } from '~/features/categories'
```

```vue
<!-- required category, sub-categories only -->
<CategorySelect v-model="state.categoryId" type="SUB" />

<!-- optional parent, with a "none" option; the edited category can't be its own parent -->
<CategorySelect
  v-model="state.mainCategoryId"
  type="MAIN"
  :exclude-id="category?.id"
  none-label="None (main category)"
/>
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `v-model` | `number \| undefined` | | Category id. Choosing the `noneLabel` option sets `undefined`. |
| `type` | `'MAIN' \| 'SUB'` | all | Which categories to list. |
| `excludeId` | `number` | | Hide one category. |
| `noneLabel` | `string` | | Adds an option that clears the value. `USelect` can't hold `undefined`, and this handles that internally. |
| `placeholder` | `string` | `'Select a category'` | |
| `currentLabel` | `string` | | Name of the current value from the edited record (e.g. `category.mainCategory?.categoryName`), shown if the value isn't among the options. |

It loads its options through `useCategoryOptions` and shows a loading state while fetching. Behavior (D31, e2e `test/e2e/pickers.test.ts`):
- **Current value stays visible**, never cleared: labelled from the options, `currentLabel` or `#id`, marked "(inactive)" or "(unavailable)".
- **Inactive categories aren't offered as new selections** while their eligibility is open (Q9). This is a deferral, not a rule.
- **Load error:** shows the message with **Retry** instead of an empty list.

### `useCategoryOptions`

Unpaginated categories for pickers.

```ts
function useCategoryOptions(filter?: MaybeRefOrGetter<{ type?: 'MAIN' | 'SUB', mainCategoryId?: number }>)
// → useApiQuery result, `data` defaults to []
```

```ts
const { data: mainCategories, loading } = useCategoryOptions({ type: 'MAIN' })
```

- Key: `categories:options:<type>:<mainCategoryId>`. Each filter is cached separately, and all of them refresh on `invalidate('categories')`.
- Calls `GET /staff/categories/all`.

### `categoriesNavigation`

The sidebar entry (`NavigationMenuItem`), grouped in `app/utils/navigation.ts`.
