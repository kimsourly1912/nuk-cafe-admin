# Category sort order plan

> **Superseded by [list-ui-refresh.md](list-ui-refresh.md) (D37):** Categories is now a tree, sorted per level with sub-categories numbered per main category. The notes below describe the earlier per-type sort mode.

Planned with [feature-standard.md](../feature-standard.md). Labels as there: **[Choice]** reversible; **[Open]** a backend/owner contract.

## Request (user, 2026-09-26)

- Drag to sort on the Categories page, **only when the type filter is Main or Sub**.
- A `UBanner` guides the user into sort mode.
- `PUT /staff/categories/sort-order` with the **whole list** of that type, `sortOrder` numbered from 1.

## Evidence

| Fact | Evidence |
|---|---|
| Body: `{ items: [{ id, sortOrder }] }`, at least one item (`CategorySortOrderUpdateRequest`) | spec |
| The list endpoints have no sort parameter; `/all` returns categories by `sortOrder` ascending | spec + real-API (public `/public/categories/all`, GET only) |
| Sub-categories are numbered **per main category** today (1–5 under one, 1 under another) | real-API (public) |

## Behavior

| Situation | Behavior |
|---|---|
| Type "All" | Banner: "To change the order customers see, show only main or only sub-categories." + **Main categories** / **Sub-categories** buttons that set the filter |
| Type set, but a search or status filter is on | [Choice] **no sorting**: the table shows part of the list, but the whole list is saved. Banner: "Clear the search and status filter…" + a button that clears only those two |
| Sort mode | The **whole list of the type**, unpaginated (`/staff/categories/all?type=`), all statuses, in server order (`sortOrder`, then id). A drag handle per row; ↑/↓ on a focused handle moves the row and keeps focus. Banner explains; for Sub: "Each main category shows its sub-categories in this order." |
| Order changed | [Choice] **Save order / Discard** in the banner, not a save per drop (no request per drag; a mistake can be undone). The order counts as **unsaved** (route change, logout, reload ask). The filters are **locked** until it's saved or discarded, so the list can't change under it |
| Save | `PUT` with every id of the list, `sortOrder` 1…n. Success toast; the list refetches. Failure: toast with the backend reason; the new order stays, still unsaved |
| Another tab adds/deletes a category while the order is unsaved | Merged: new ones appended, deleted ones dropped (`mergeOrder`), so a save never sends a partial or stale list |
| Sub-categories | Numbered 1…n across **all** sub-categories, as requested. Within each main category the relative order is exactly what's on screen, so the per-parent order customers see follows the list. [Open] whether the backend or the apps expect per-parent numbering (they only need relative order within a parent for this to be equivalent) |

## Mutation

`categories:sort`, keyed by type (main and sub can save independently), invalidates `['categories', 'products']`.

## Verification

| Risk | Test |
|---|---|
| Request numbering, ordering, merge, move bounds | unit (`category-sort.test.ts`) |
| Banner states and entry into sort mode; whole list unpaginated (22 > page size) | e2e (`categories-sort.test.ts`) |
| Keyboard reorder + focus; mouse drag; exact whole-list body | e2e |
| Discard (no request); save failure keeps the order; filters locked while unsaved; leave-page prompt | e2e |
| Backend accepts the body and the apps show the new order | **real-API, pending a staff login** |

## Results (2026-09-26)

All of the above done; evidence unit + browser-mock (8 e2e tests). Dark-mode screenshots checked: the hint banners use a quiet panel style (a solid white bar was loud in dark mode) and wrap instead of truncating (`UBanner`'s title truncates by default).
