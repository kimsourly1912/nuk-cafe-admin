# UI standardization plan (temporary)

_Started 2026-09-28. A rollout plan: delete it when the migration below is done and its lasting content lives in the reference documents._

**Canonical rules** (this plan doesn't restate them):
- [ui.md](../reference/ui.md): visual foundation
- [responsive-layout.md](../reference/responsive-layout.md): width classes, shell, navigation, page anatomy, behavior matrix
- [page-patterns.md](../reference/page-patterns.md): page blueprints, editing surfaces, gestures, states
- [ui-review-checklist.md](../reference/ui-review-checklist.md): the pre-merge checklist

**Source:** the owner's "NUK Cafe Admin — Responsive UI standardization" request (2026-09-28) and the owner's review of the first draft (same day), which approved eight directions and asked for the open items to be collected here. Approved rules are marked **owner-directed** in the reference pages. The owner then approved the four remaining decisions (settings, filters, the shared bottom bar, Menu item URLs). Every decision is in [§6](#6-owner-decisions); none is open.

**Nuxt UI is the component design system; Tailwind CSS tokens are the layout and styling language.** Every step below changes Nuxt UI configuration (`app/app.config.ts`, theme variables) or composes Nuxt UI components with Tailwind utilities. None adds a component library, a re-skin or arbitrary values.

---

## 1. Phase A: documentation (this change)

- Audited the routes, shell, shared components and docs (below).
- Moved the old `docs/reference/ui.md` (a helper API reference) to [ui-helpers.md](../reference/ui-helpers.md) and updated every link, so `ui.md` can be the visual foundation.
- Wrote the four reference pages and this plan; added a pointer in AGENTS.md; recorded D77.
- Revised after the owner's review: container queries for constrained surfaces, the compact row composition, one save model at every width for settings, the approved directions, and this plan's owner-decision table.
- **No application code changed.**

## 2. Route inventory

| Route | Pattern | Surfaces today | Gap against the standard |
|---|---|---|---|
| `/login` | Task flow | Centered `UCard`; full screen on phones | **Reference (D84)** |
| `/change-password` | Task flow | Centered `UCard`; full screen on phones | **Reference (D84)** |
| `/` Dashboard | Placeholder | Welcome text | No pattern until reports (8.1) |
| `/products` Menu items | Resource index (paginated; grid + table) | Editor: `USlideover` (`ProductFormSlideover`), `?item=` deep link | **List done (D89):** rows on phones and the table from `sm`, the name the record target (card and table), the grid's columns by its container, a Select mode for bulk archive, the toolbar full width on phones. **Editor done (D90):** `/products/[id]` (and `/products/new`) is a page at every width, one section at a time on phones (A6); `?item=<id>` opens the slide-over at every width; the list opens the route on phones and `?item=` from `sm` (decision 4) |
| `/categories` | Resource index (tree) | Editor: `UModal` (full screen <640); Select/Reorder modes with a bottom mode bar | **Done (D85):** mode bars on `BottomActionBar`; the tree lays out by its container (`@2xl`); the name block is the row's button; token widths |
| `/options` | Resource index (library cards) | Editor: `USlideover` with save-each-change | **Done (D86):** cards are containers (chips counted by the card's width); the editor stays a slideover whose rows have no width switches, and "Done reordering" moves between its header and its own `#footer` by viewport (thumb reach on phones) |
| `/add-ons` | Resource index (library cards) | Opens a route | **Done (D88):** cards are containers (rows counted by the card's width) |
| `/add-ons/[id]` | Detail / editor route | Two columns → tabs <1024; add-on dialog; bottom sheet row actions <640 | **Reference (D82):** add-on rows lay out by their column (`@container`), the name opens Edit, reorder actions in `BottomActionBar`, no arbitrary grid values |
| `/availability` | Resource index (agenda cards) | Editor: `UModal` (full screen <640); archived read-only | **Done (D87):** cards are containers (one row from a 56rem card, stacked beside the sidebar at 1024px); conforms otherwise |
| `/staff` | Resource index (table) | Editor: `UModal` (full screen <640) | **Reference (D79):** rows on compact, the name as the record's button at every width. The "Temporary password" badge's `warning` contrast is fixed app-wide (D80) |

**Settings pattern:** no instance. The first settings page (branch settings, step 5.1) proves it.

## 3. Shell and shared building blocks

- **Shell:** `UDashboardGroup` + `UDashboardSidebar` (collapsible, resizable, a drawer below 1024px) + `UDashboardPanel` pages; the navigation is grouped in `app/utils/navigation.ts`; the user menu is in the sidebar footer. Global config: `app.config.ts` sets only `primary: amber`, `neutral: stone`; `app/assets/css/tailwind.css` imports Tailwind and Nuxt UI and adds pointer cursors.
- **Shared behavior components** (keep; they're not a component library): `SearchInput`, `StatusTabs`, `ListSkeleton`, `ListEmptyState`, `ApiErrorAlert`, `BulkActionsBar`, `ConfirmDialog`, `OfflineBanner`, `ShortcutsHelp`.
- **Feature-local layout pieces** that repeat a decision: `CategoryModeBar` (a fixed bottom bar), the Add-on page's Save bar, the Options editor's reorder footer, `BulkActionsBar` (sticky). That's **four bottom-bar implementations**.

## 4. Inconsistencies found

1. **Breakpoints:** compact detection uses `useMediaQuery('(max-width: 639px)')` in four components, while layouts switch at `sm` (Options/Add-ons chips), `md` (Categories rows and mode bar) and `lg` (Add-on page, Availability cards). → Standard: 640 and 1024 only ([responsive-layout §1](../reference/responsive-layout.md#1-width-classes-owner-directed)).
2. **Editing surfaces** were chosen per feature (modal, slideover, route) without a rule. → [page-patterns §4](../reference/page-patterns.md#4-detail--editor).
3. **Tables on compact:** `/staff` and `/products` (List) scroll sideways. → Grouped rows.
4. **Touch targets:** D72/D73 used per-component `min-h-11` overrides; D74 removed them in favor of defaults (~32px icon buttons); the owner then required 44px on compact (D78), and after trying it on a phone chose Nuxt UI's default sizes at every width (D81). → Defaults; invisible hit areas only for checkboxes, radios and switches ([ui §6](../reference/ui.md#6-density-and-touch-targets)).
5. **Bottom bars:** four implementations with different safe-area, padding and blur handling. → One pattern ([responsive-layout §5–6](../reference/responsive-layout.md#5-page-anatomy)); one shared bottom action bar component (decision 3).
6. **Full-screen overlays:** `fullscreen` detection is repeated in each modal (a `useMediaQuery` per component). `StaffFormModal` doesn't go full screen. → One layout-context composable ([responsive-layout §1](../reference/responsive-layout.md#constrained-surfaces-container-queries)).
7. **Row actions on compact:** a dropdown everywhere except Add-on rows (a bottom sheet). How a record opens varies between pages (a Manage/View button on library cards, other patterns elsewhere). → The [compact row composition](../reference/page-patterns.md#compact-row-composition): one record target, a sibling actions trigger.
8. **Save models:** save-each-change (Options, Add-on rows) vs a draft (every modal, Add-on settings); both are valid but need the rule in [page-patterns → Save models](../reference/page-patterns.md#save-models).
9. **Decorative styling left:** `backdrop-blur` on the Categories mode bar and the Add-on Save bar. → Removed in the foundations step.
10. **Contrast:** amber-500 primary text on white is below 4.5:1 (links, active tabs, selected toggles, outline badges). → Light mode's `--ui-primary` set to a darker shade (approved); measured in the foundations PR.
11. **Container vs viewport:** content inside the Options slideover (`OptionSetEditor`) and the add-on rows in the Add-on page's main column (`AddOnRow`) switch on the **viewport** (`sm:`), although they have much less room than the viewport. → `@container` on the surface body and container variants inside. Done for `AddOnRow` (D82); the Options editor is its own step.

## 5. Documentation conflicts resolved

| Conflict | Resolution |
|---|---|
| `docs/reference/ui.md` was a helper API reference; the visual foundation needs that name | Moved to `ui-helpers.md`; links updated in README, mutations, data-fetching and feature-standard |
| AGENTS.md held detailed styling rules (the D74 bullet) | Kept as a one-line principle plus a pointer; details live in `ui.md` |
| AGENTS.md's page anatomy line ("Every page component renders a `UDashboardPanel`…") | Canonical home is [responsive-layout §5](../reference/responsive-layout.md#5-page-anatomy); AGENTS links to it |
| D74 "Nuxt UI default sizes, no `min-h`/`min-w` overrides" vs the owner's 44px compact targets | D77 added a central compact minimum; D81 (owner) removed it again: D74 holds, Nuxt UI's default sizes at every width |
| First draft: "a slideover is compact-width, so its content uses the compact rules" vs viewport-only breakpoints | Viewport classes decide the shell, pages and which surface is used; a surface's contents follow its own width through `@container` and container variants; JavaScript choices use the layout-context composable or an explicit `compact` prop ([responsive-layout §1](../reference/responsive-layout.md#constrained-surfaces-container-queries)) |
| First draft: "a row is one tap target" vs a `⋮` drawn inside it | Two sibling targets: the record link/content and the actions trigger; nothing nested ([page-patterns](../reference/page-patterns.md#compact-row-composition)) |
| First draft: settings saved page-wide on expanded but per section on compact | One save model at every width: one shared draft and one final Save, also across pushed compact sections ([decision 1](#6-owner-decisions)) |
| feature-standard §4 "Layout" row chose collections informally | Links to [page-patterns §2](../reference/page-patterns.md#2-resource-index) |
| forms.md "Where forms live" named surfaces with outdated examples (products as a full page, points and carbon settings) | forms.md stays canonical for **which guard** to use; the surface choice links to page-patterns |
| ui-helpers documented a `StatusTabs` `size` prop removed in D74 | Row removed |

## 6. Owner decisions

The complete list. Every approved item is a rule in the reference pages.

### Approved (owner, 2026-09-28)

| # | Direction | Where it lives |
|---|---|---|
| A1 | Compact and medium admin navigation use the existing Nuxt UI dashboard app bar and drawer; **no admin bottom navigation** | [responsive-layout §3–4](../reference/responsive-layout.md#3-application-shell) |
| A2 | Medium navigation stays a Nuxt UI drawer, **not a custom icon rail** | [responsive-layout §3](../reference/responsive-layout.md#3-application-shell) |
| A3 | ~~Compact targets are at least 44px, configured centrally~~ **Replaced (owner, 2026-09-28, D81):** Nuxt UI's default sizes at every width, WCAG AA's 24px as the floor; invisible hit areas for checkboxes, radios and switches only | [ui §6](../reference/ui.md#6-density-and-touch-targets) |
| A4 | Light-mode primary-text contrast corrected with Nuxt UI semantic theme variables (`--ui-primary`) | [ui §12](../reference/ui.md#12-accessibility-baseline-owner-directed-wcag-22-aa-minimum) |
| A5 | Dark-mode-token-compatible implementation; **no color-mode switch yet** | [ui §2](../reference/ui.md#2-color-tokens) |
| A6 | A focused route for the long Menu item editor on compact | [page-patterns §4](../reference/page-patterns.md#4-detail--editor) |
| A7 | The Options editor stays a Nuxt UI slideover; its inner layout adapts with Tailwind responsive and container utilities | [page-patterns §4](../reference/page-patterns.md#4-detail--editor), [responsive-layout §1](../reference/responsive-layout.md#constrained-surfaces-container-queries) |
| A8 | The current 4px spacing system and semantic Nuxt UI color roles are preserved | [ui §2–3](../reference/ui.md#2-color-tokens) |
| 1 | **Settings blueprint:** one page-wide draft and one final Save at every width; on compact, pushed sections edit the same shared draft; moving between sections neither saves nor discards; Save sends the complete draft in one request; the unsaved-changes warning only when leaving the settings page; Nuxt UI form components and Tailwind layout tokens | [page-patterns §3](../reference/page-patterns.md#3-settings) |
| 2 | **More than two filters on compact:** one labelled Filters `UButton` (with the active-filter count) opening a `UDrawer` bottom sheet with Clear and Apply; the same filter meaning, values and URL/query state at every width; one or two simple filters may stay visible; no custom-styled filter panel | [responsive-layout §5](../reference/responsive-layout.md#5-page-anatomy) |
| 3 | **One shared bottom action bar** replacing the four implementations. It owns only positioning by width, safe-area padding, matching body padding, focus and on-screen-keyboard handling, and one-bar-at-a-time; it renders the Nuxt UI buttons each feature supplies, with no styling of its own. **Built (D78)** for the three page bars; an overlay's footer (the Options editor's Done reordering) stays Nuxt UI's `#footer` slot (owner, 2026-09-28) | [responsive-layout §5–6](../reference/responsive-layout.md#5-page-anatomy) |
| 4 | **Menu item editor URLs:** `/products/[id]` (canonical, preferred for sharing) and `/products?item=<id>` both open the same item at every width; compact lists open the route, medium and expanded lists the slideover; direct links in either format work; nothing about permissions, validation, data or actions depends on width; Back and the list's query are preserved; resizing never changes the URL | [page-patterns §4](../reference/page-patterns.md#menu-item-editor-urls-owner-directed-decision-4-approved-2026-09-28) |

### Open

None. A new question goes here as **Open (blocked, not implementable)** with a recommendation, an alternative and what it blocks, and the reference pages mark it **Open** where it appears.

## 7. Phase B: migration sequence (after this documentation is merged into `main`)

Each step is its own PR: build, e2e at the [verification widths](../reference/ui-review-checklist.md#verification-widths), update this plan, stop for review.

1. ✅ **Foundations (global configuration, no page redesign; D78):** the compact 44px minimum in each Nuxt UI component's `app.config.ts` configuration (A3; **removed again in D81**, only the invisible hit areas stay); the light-mode `--ui-primary` at the **800** shade in `tailwind.css` (A4; 700 measured 4.4:1 on its own tint); `useLayoutContext()` replacing the **six** `useMediaQuery('(max-width: 639px)')` copies; `<BottomActionBar>` (decision 3) for the Categories mode bars, the Add-on page's Save bar and `BulkActionsBar` (`CategoryModeBar` removed); `backdrop-blur` gone. The Options editor's Done reordering stays the slideover's own Nuxt UI `#footer` (see decision 3 below). Verified: unit, e2e (`ui-foundations.test.ts`: every Nuxt UI control measured at 375px and unchanged at 1024px, the checkbox hit area, primary contrast measured in light and dark, the bar's room for the last row; the size tests fail with the configuration removed), screenshots at 390 and 1440px, light and dark.
2. ✅ **Reference: resource index with a table → `/staff` (D79).** The [compact row composition](../reference/page-patterns.md#compact-row-composition) on compact (a `v-if` on `useLayoutContext().isCompact`: one tree in the DOM), the name as the record's button on the table too (the row no longer opens on click), a full-screen modal, the toolbar wrapping on phones (set once for every `UDashboardToolbar` in `app.config.ts`), the table no longer squeezed into its own scroll box. Two filters, so they stay in the toolbar (decision 2). Verified: e2e `staff.test.ts` (13: rows at 320 and 390 px, nothing scrolls sideways, the toolbar wraps, the row target ≥ 44px by its content, actions beside the row, the full-screen form), screenshots at 320, 390 (light and dark), 768, 1024, 1440 and 844×390.
3. ✅ **Reference: detail / editor route → `/add-ons/[id]` (D82).** The add-ons list is an `@container`: its rows switch at `@md` (the column's width), so beside the settings column at 1024px they stack instead of squeezing four columns; column widths are spacing tokens (`w-24`, `w-36`, `w-12`) and the page's two columns are flex with a `lg:w-88` settings column (both arbitrary grids gone). An add-on's name is its row's button (opens Edit, the pencil button is gone; Edit stays in the ⋮ menu). Reorder's Cancel and Save order moved from a sticky top bar (negative margins) into `BottomActionBar` (bottom of the screen below `lg`, inline above the list from `lg`). Tabs below `lg`, Back and breadcrumb, the Save bar and bottom-sheet row actions already met the standard. Verified: e2e `modifier-groups.test.ts` (35, 4 new), screenshots at 390, 768, 1024, 1440 and 844×390, reorder at 390 and 1440.
4. ✅ **Reference: task flow → `/change-password` and `/login` (D84).** `AuthFrame` (auth feature): a centered `UCard` from `sm`, the full screen on phones with the actions at the bottom; focus moves to the first invalid field or the server's error. Verified: e2e `auth.test.ts`, `password.test.ts` (21, 5 new), screenshots at 390 and 1440.
5. **Bring the rest to the references** (one PR per page; ✅ 5a Categories, D85; ✅ 5b Options, D86; ✅ 5c Availability, D87; ✅ 5d Add-ons library, D88; ✅ 5e part 1 Menu items list, D89; ✅ 5e part 2 Menu item editor route, D90): `/categories` (breakpoints, the shared bar), `/options`, `/availability`, `/add-ons`, then `/products` (List view rows; the compact editor route `/products/[id]` per A6, with both URLs working at every width per decision 4). `/options` gets `@container` on the slideover body (A7).
6. **Settings reference:** the first settings page (step 5.1) is built to the approved blueprint (decision 1).
7. **Close:** fold anything still useful into the reference pages, and delete this plan.
