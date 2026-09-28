# Categories and Menu items on the new API (step 3.8b, part 3; phase 4.1 and 4.4)

The last part of 3.8b (D66): the two remaining legacy screens move onto `/api/admin/menu/*`, then the legacy menu is removed. They move **together, in one pull request**: the old item form picks its category with `CategorySelect`, and legacy items reference `legacy_menu_categories`, so moving Categories alone would break the Menu items screen. Three commits, each passing lint, typecheck and tests on its own:

| Commit | What |
|---|---|
| 3a | **Categories** page and `CategorySelect` on the new API; the old Menu items screen keeps running on the legacy API with a legacy picker kept inside the products feature for that one commit |
| 3b | **Menu items** list and form on the new API: category, image, option sets and the price grid, add-on groups (with the item's own rules and prices), availability rules, draft / published / archived |
| 3c | **Remove the legacy menu**: `/api/v1`, `server/legacy`, the D41 tables (a migration drops them), `shared/contracts/menu.ts`, the Schedules screen (replaced by Availability, D66), the legacy upload route; docs |

## Choices [Choice]
- **Folder and route names stay** `categories` (`/categories`) and `products` (`/products`, shown as "Menu items", AGENTS.md rule 7): renaming would touch every import and test for no user benefit.
- **Categories keeps its tree, search, status tabs and drag order.** Status becomes Active / Archived; **Delete becomes Archive** (and Restore), because the API archives (archiving a main archives its sub-categories). The form gains a description and availability rules. Saving an order sends one request per changed level (the API orders one parent's children at a time), with each child's version.
- **`CategorySelect`** reads the new API. `level="main"` offers active top-level categories (for a parent); `level="leaf"` offers active categories without sub-categories (items go only in leaves, D44).
- **Menu items list:** grid and table, filters (search, category, status: draft / published / archived), paginated from `GET /api/admin/menu/items`. The old "grouped menu" view is dropped: the public menu (3.8a) is the grouped view customers see, and the admin list filters by category.
- **Menu items form:** a slide-over that saves the whole item at once (the API's PATCH takes the grid, add-ons and rules together, under one version). Option sets (up to 2) come from the Options library; the **price grid** has a row per value of the first set and a column per value of the second, each cell with a price and an on/off switch. Add-on groups come from the Add-ons library, each with "use this item's own rules" and own prices per add-on. Availability rules come from their library.
- **States are actions** (the API's): Publish (needs a version switched on and priced), Unpublish, Archive, Restore, from the list and the form.
- **Not built yet:** reordering items within a category (the API has it; no screen had it before either).

## Data on staging
Nothing is in production. The legacy tables' rows on staging (test categories, schedules and items) are **not carried over**: the new model differs (option sets, the price grid, library add-ons), so they'd be re-entered through the new screens. The drop migration runs on the next deploy after 3c merges.

## Verification
- Unit: form ↔ request mapping for both forms, the price-grid building (combinations, kept prices when sets change, missing cells).
- e2e (rewritten on new-API fixtures): Categories (tree, archive, restore, reorder per level, the parent and leaf pickers), Menu items (list filters, create with a 2×2 grid and add-ons, publish refused with nothing to sell, a version conflict keeps the form open).
- Real-server in headless Chromium on `pnpm dev`: create a category tree, an item with a grid, add-ons and a rule, publish it, and see it on `GET /api/public/menu`.
