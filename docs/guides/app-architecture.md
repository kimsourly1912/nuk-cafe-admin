# App Architecture

Task-specific instructions extracted from the former root guide. Read applicable sections via [task routing](../../AGENTS.md#load-context-for-the-task); do not load all guides at startup. Linked reference pages own API signatures and detailed behavior.

## Feature architecture

```
app/
├── features/<feature>/          # everything specific to one business area
│   ├── index.ts                 # PUBLIC API: the only file other code may import
│   ├── navigation.ts            # this feature's sidebar entry (exported via index.ts)
│   ├── components/
│   │   ├── <Feature>ListPage.vue    # private screen, rendered by a route file
│   │   ├── <Feature>FormModal.vue   # private
│   │   └── <Feature>Select.vue      # public building block (picker for other features)
│   ├── composables/
│   │   ├── use<Feature>s.ts         # private: list + mutations
│   │   └── use<Feature>Options.ts   # public: data for pickers
│   ├── schemas/<feature>-form.ts    # Valibot form schema + form<->request mapping (pure, unit-tested)
│   └── tests/*.test.ts
├── pages/                       # THIN route files: definePageMeta + render <Feature>Page
├── components/ composables/ utils/   # SHARED across features only (auto-imported)
├── layouts/ middleware/ plugins/ types/   # app shell
server/                          # our API, per docs/server/architecture.md
shared/contracts/                # API contracts: request schemas + response types, used by server and app
```

### Rules (the boundary rules are enforced by ESLint in `eslint.config.mjs`)

1. **Everything specific to one feature lives in `app/features/<feature>/`.** Only code used by two or more features, or by the app shell, goes in the root `components/`, `composables/` or `utils/`. Build it inside the feature first, and move it to the root when a second feature needs it.
2. **`index.ts` exports only building blocks:** pickers (`CategorySelect`), display components, option composables (`useCategoryOptions`), types and `navigation`. **Never export pages or forms from `index.ts`.** Otherwise features that use each other (a menu item picks categories; a category could list its items) would import each other's screens and create cycles.
3. **Cross-feature imports go through the public API only:** `import { CategorySelect } from '~/features/categories'`. Deep imports (`~/features/x/composables/...`) and relative paths that leave the feature (`../../x`) are lint errors.
4. **Public building blocks must not import other features.** This keeps the dependency graph one level deep, so no cycles can form. Screens (pages, forms) may import other features' public APIs.
5. **Inside an app feature, use relative imports** (`../composables/useCategories`). Feature code is *not* auto-imported. Root shared code *is* auto-imported everywhere (`apiFetch`, `getErrorMessage`, `invalidate`, `usePaginatedQuery`, `useConfirm`, `StatusTabs`, `ANY`, `formatMinor`, ...).
6. **Route files in `app/pages/` stay thin.** They hold `definePageMeta` (always with a `title` for the browser tab) plus one `<Feature>…Page.vue` from the feature (the only deep import pages are allowed). Routes stay discoverable in one place.
7. **Name feature folders after the resource they manage**, so a folder maps to its routes (`/api/admin/<resource>`) and contracts: `categories`, `products` (shown as "Menu items" in the UI), `availability-rules` (shown as "Availability"), `option-sets` (shown as "Options"), `modifier-groups` (shown as "Add-ons"), `menu` (the customer menu, `/api/public/menu`), `account` (the customer's own account: its pages and the header's account button, on Better Auth and `/api/shop/me`, D97), `orders` (the customer's orders: the order page with tracking, Your orders and the menu's order bar, `/api/shop/orders`, D100, D114), `counter` (the cashier's workspace: its session, queue and commands on `/api/counter/{branchId}`, D102), `exchange-rates` (shown as "Payments", D102), `reports` (the admin's Summary, Sales by item and Order history, with CSV and Print, on `/api/admin/reports`, D110, D111), `notifications` (shown as "Telegram": connected chats and sending there, on `/api/admin/telegram`, D112), `sample-data` (test data, D94), `platform` (the platform console for super admins: Cafes, New cafe, a cafe's page, on `/api/platform/tenants`, D142; server feature `tenants`), `assistant` (the AI help assistant's panel, on `/api/admin/assistant`, D107, D109; its help guide is `server/features/assistant/help/*.md`: **a change to an admin screen updates its page there**), `cafe` (shown as "Cafe profile": the cafe's name and logo, on `/api/admin/cafe`, D143; Your cafes `/cafes` and the `<CafeSwitcher>`, on `/api/me/cafes`, D144), `dashboard` (the admin's home: today and "Set up your cafe", D155), `promotions` (Marketing → Promotions: discounts on the menu, on `/api/admin/menu/promotions`, D163; server code in the menu feature, since promotions change menu prices; its posts to channels, D164), `marketing` (Marketing → Channels: the cafe's social channels, on `/api/admin/marketing`, D164; posts are made from a promotion's page), `rewards` (reward categories live inside it: they're not menu categories), `vouchers`, `banners`, `customers`, `staff`, `auth`.

### Cross-feature relationships (from the API)

- A menu item has a leaf `categoryId` (required, D44), option sets with a price grid, add-on groups and availability rules, so the item form uses `CategorySelect level="leaf"`, `useOptionSetOptions`, `useModifierGroupOptions` and `AvailabilityRuleSelect` (D70). Pickers forward attributes (`aria-label`) to their select and take `class` on the wrapper (D34).
- An item's links to libraries (option sets, add-on groups, rules) are written **only from the item**, which sends the whole list; the library pages show "used by N items" read-only (D60, D61, D63).
- A category has an optional `parentId` (main vs sub, two levels). The category form uses its own `CategorySelect level="main"`.
- Every update names the `version` it read; a stale one is refused with 409 (D41). Forms keep the record they opened and send its version.

### Data freshness

- Query keys are **namespaced by feature**: `<feature>:<name>` (`categories:all`, `availability-rules:list`). `useApiQuery` warns in dev when a key isn't namespaced.
- Mutations declare `invalidate: ['<own feature>', '<affected feature>']`. The same invalidation reaches the app's **other open tabs** (feature names over a `BroadcastChannel`, never data), so they refresh too. Data from **other devices** is picked up when the user returns to the tab. `invalidate()` (`app/utils/invalidate.ts`) refetches every loaded key with those prefixes, so a feature never imports another feature's keys. Calls within 30ms are merged into one refresh per list (batches, parallel deletes). Example: category mutations invalidate `['categories', 'products']` because product lists show category names.

