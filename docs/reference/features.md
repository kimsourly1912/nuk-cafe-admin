# Feature public APIs

← [API Reference](./README.md)

What each feature exports from its `index.ts` for **other features and the app shell**. Import only from `~/features/<name>`: deep imports are lint errors.

A feature's public API contains **building blocks only** (pickers, option data, types, navigation), never pages or forms. That's what lets features that reference each other (products ↔ schedules) use each other's pickers without import cycles. See `docs/decisions.md` D8.

| Feature | Exports |
|---|---|
| `auth` | [`useAuth`](./auth.md#useauth), [`loginRedirectTarget`](./auth.md#loginredirecttarget), `SessionUser` |
| `categories` | [`CategorySelect`](#categoryselect), [`useCategoryOptions`](#usecategoryoptions), `categoriesNavigation` |
| `option-sets` | [`useOptionSetOptions`](#useoptionsetoptions), `optionSetsNavigation` ("Options") |
| `modifier-groups` | [`useModifierGroupOptions`](#usemodifiergroupoptions), [`describeRules`, `formatDelta`](#describerules-formatdelta), `modifierGroupsNavigation` ("Add-ons") |
| `availability-rules` | [`AvailabilityRuleSelect`](#availabilityruleselect), [`useAvailabilityRuleOptions`](#useavailabilityruleoptions), `availabilityRulesNavigation` |
| `schedules` | [`ScheduleSelect`](#scheduleselect), [`useScheduleOptions`](#usescheduleoptions), `schedulesNavigation` |
| `products` | `productsNavigation` ("Menu items"). A `ProductSelect` waits for its first consumer |

When you add a feature, add its section here. Pickers follow the contract in [feature-standard.md → Resource picker conventions](../feature-standard.md#6-resource-picker-conventions).

---

## categories

### `CategorySelect`

A category picker for forms and filters: a category's parent, a menu item's category, or a list filter. Reads the new API (`/api/admin/menu/categories`, D69).

```ts
import { CategorySelect } from '~/features/categories'
```

```vue
<!-- a menu item's category: only leaves (items go only in categories without sub-categories, D44) -->
<CategorySelect v-model="state.categoryId" level="leaf" :current-label="item?.categoryName" />

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
| `level` | `'main' \| 'leaf'` | all | `main`: top-level categories. `leaf`: categories without sub-categories (one with only archived sub-categories isn't a leaf either). |
| `excludeId` | `string` | | Hide one category. |
| `noneLabel` | `string` | | Adds an option that clears the value. `USelect` can't hold `undefined`, and this handles that internally. |
| `placeholder` | `string` | `'Select a category'` | |
| `currentLabel` | `string` | | Name of the current value from the edited record, shown if the value isn't among the options. |
| `includeArchived` | `boolean` | `false` | Also offer archived categories. **Only for filters**, where no new relationship is made. |

Other attributes (`aria-label`, `id`, …) go to the select itself, so they name it for screen readers and tests. `class` sizes the wrapper (full width by default).

Sub-categories are labelled "Parent › Child". Behavior (D31, D69, e2e `test/e2e/pickers.test.ts`):
- **Current value stays visible**, never cleared: labelled from the options, `currentLabel` or "Unknown category", marked "(archived)", "(has sub-categories)" or "(unavailable)".
- **Archived categories aren't offered as new selections** (the server refuses them, D45).
- **Load error:** shows the message with **Retry** instead of an empty list.

### `useCategoryOptions`

Every category, archived ones included, for pickers. The picker decides what's selectable.

```ts
function useCategoryOptions()
// → useApiQuery result, `data`: MenuCategory[] (`[]` until loaded)
```

- Key: `categories:all`, **shared with the Categories tree** (D69): a page with both makes one request and refreshes once on `invalidate('categories')`.
- Calls `GET /api/admin/menu/categories?status=all`.

### `categoriesNavigation`

The sidebar entry (`NavigationMenuItem`), grouped in `app/utils/navigation.ts`.

---

## availability-rules

### `AvailabilityRuleSelect`

Picks the availability rules of a category or menu item (`availabilityRuleIds`, at most 5).

```ts
import { AvailabilityRuleSelect } from '~/features/availability-rules'
```

```vue
<AvailabilityRuleSelect v-model="state.availabilityRuleIds" aria-label="Availability" />
```

| Prop | Type | Default | Description |
|---|---|---|---|
| `v-model` | `string[]` | `[]` | Rule ids. |
| `placeholder` | `string` | | |

Behavior (e2e `test/e2e/categories.test.ts`), the picker contract:
- **Chosen rules stay visible**, never cleared: "(archived)" (a record keeps an archived rule until it's removed, D63), "Unknown rule (unavailable)" when it no longer exists.
- **Only active rules are offered** as new selections; no more once 5 are chosen.
- **Load error:** the message with **Retry**.

### `useAvailabilityRuleOptions`

```ts
function useAvailabilityRuleOptions() // → useApiQuery result, `data`: AvailabilityRule[] (default [])
```

- Key: `availability-rules:options`, refreshed by `invalidate('availability-rules')`.
- Calls `GET /api/admin/menu/availability-rules?status=all`.

### `availabilityRulesNavigation`

The sidebar entry ("Availability").

---

## option-sets

### `useOptionSetOptions`

Every option set with its values, archived ones included (an item may still use one), for the menu-item form. The form offers only active sets and builds the price grid from their active values.

```ts
function useOptionSetOptions() // → useApiQuery result, `data`: OptionSet[] (`[]` until loaded)
```

- Key: `option-sets:list`, **shared with the Options page** (like D69), refreshed by `invalidate('option-sets')`.
- Calls `GET /api/admin/menu/option-sets?status=all`.

---

## modifier-groups

### `useModifierGroupOptions`

Every add-on group with its add-ons, archived ones included, for the menu-item form (which offers only active groups).

```ts
function useModifierGroupOptions() // → useApiQuery result, `data`: ModifierGroup[] (`[]` until loaded)
```

- Key: `modifier-groups:list`, **shared with the Add-ons page**, refreshed by `invalidate('modifier-groups')`.
- Calls `GET /api/admin/menu/modifier-groups?status=all`.

### `describeRules`, `formatDelta`

```ts
describeRules(1, 1)     // "Required · choose 1"
describeRules(0, 2)     // "Optional · up to 2"
formatDelta(50)         // "+$0.50"; 0 → "Free"
```

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
