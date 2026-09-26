# List UI refresh plan

Approved by the user on 2026-09-26, after research on how admin products present lists. Sources: [Smart Interface Design Patterns](https://smart-interface-design-patterns.com/articles/cards-vs-lists-vs-tables-vs-data-grids/), [UX Patterns for Developers](https://uxpatterns.dev/pattern-guide/table-vs-list-vs-cards), [Setproduct 2026 table guide](https://www.setproduct.com/blog/data-table-ui-design), [Shopify index table](https://shopify.dev/docs/api/app-home/patterns/compositions/index-table), [Linear display options](https://linear.app/docs/display-options), Square/Toast menu management.

**Principle:** pick the layout by the job on that screen. Tables are for comparing across columns, lists for scanning, cards when pictures drive the decision. Grouping, manual order and view switching are what make lists feel modern.

## Per page

| Page | Before | After |
|---|---|---|
| Menu items | Table | **Card grid** (image, name, price, category, status) with a **Grid / List** switch (the table stays as List). **Group by category** in the grid, in the order customers see: loads the whole filtered menu (`/staff/products/all`), sections by category sort order. View and grouping remembered per viewer (`localStorage`) |
| Categories | Flat paginated table + sort mode per type | **Tree**: main categories as collapsible groups with their sub-categories nested. Loaded whole (`/all`, small set); search and status filter on the client. **Drag to sort per level**: mains among mains, subs within their main, numbered 1…n **per parent** (resolves Q20, user decision). Row menu adds **Add sub-category** |
| Schedules | Table | **Card list**: name + description, **7 day pills**, a **24 h time bar** (viewer's zone, overnight wraps), item count, status |

## Shared (root, used by all three)

| Building block | What |
|---|---|
| `StatusTabs` + `useStatusCounts` | Tabs "All 24 · Active 20 · Inactive 4" replace the status select. Counts respect the other filters. Paginated pages pay two tiny requests (`size=1`, `totalElements`); Categories counts on the client |
| `BulkActionsBar` | Floating at the bottom of the panel when rows are selected (Linear), instead of the toolbar corner |
| `ListSkeleton` | Skeleton rows/cards while loading, instead of "Loading…" text |
| `useTableSelection` | `isSelected`, `toggle`, `toggleAll`, `allSelected`, `someSelected`, so cards and trees select like table rows |

## Interaction rules (all pages)

- Click a row/card to open it; the checkbox and ⋮ menu don't open it. The ⋮ menu is **always visible**, not hover-only (keyboard and touch users).
- Numbers right-aligned in tables; status as a badge; inactive items visibly muted.
- Everything the tables did keeps working: busy rows, bulk delete (Stop, Retry failed, skipped rows stay selected), last-page step-back, URL filters, empty states, shortcuts.

## Tests

Several shared-behavior e2e tests used the paginated Categories table as their vehicle (pagination, last-page step-back, out-of-order responses, selection reset). They move to a page that stays paginated.

## Results (2026-09-26)

Built as planned (D37). `pnpm lint`, `pnpm typecheck`, `pnpm test` pass (251 tests). Evidence is **unit** + **browser-mock**; screenshots checked in light and dark mode.

| Page | Evidence |
|---|---|
| Menu items | e2e: cards (image, price, category, option groups, inactive badge), card click opens / checkbox doesn't, Grid ↔ List (row click opens, view remembered after reload), grouped sections in menu order from `/all`, status tabs with counts; unit: `menuSections` |
| Schedules | e2e: day pills named by their days, times in the viewer zone, item count, card click, status tabs with counts; unit: `timeBarSegments` |
| Categories | e2e: tree order, collapse, client search keeping the parent, status tabs and counts, row click, Add sub-category (parent prefilled), delete, bulk delete subs first, keyboard reorder of mains and of subs (subs can't leave their main), mouse drag, save sends only changed lists, discard, save failure, filters locked + leave prompt while unsaved, handles hidden while filtered; unit: `buildTree`, `filterTree`, `countStatuses`, `sortOrderChanges` |
| Shared | Every list e2e above exercises the floating bar, skeletons and selection helpers; `list-page.test.ts` (Schedules) and `list-bulk.test.ts` (Menu items) keep the shared list behaviors covered |

**Found and fixed:** empty-list query defaults hid the loading state (the empty state flashed); `UTabs` can't name its `tablist` (a labelled group wraps it); a wider "Inactive" badge shifted schedule cards (fixed-width column); schedule cards wrapped the ⋮ menu at 1280 px (tighter widths).

**Real API, pending a staff login:** per-parent sub-category numbering is accepted and shown by the apps (Q20 was decided, not verified).
