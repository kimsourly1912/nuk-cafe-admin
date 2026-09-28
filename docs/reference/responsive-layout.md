# Responsive layout

← [API Reference](./README.md) · Visual rules: [ui.md](./ui.md) · Patterns: [page-patterns.md](./page-patterns.md) · Review: [ui-review-checklist.md](./ui-review-checklist.md)

How the admin adapts to width: the three width classes, the application shell and navigation, page anatomy, and what each part of a page becomes at each width. Page-type blueprints are in [page-patterns.md](./page-patterns.md); visual tokens are in [ui.md](./ui.md).

Nuxt UI is the component design system; Tailwind CSS tokens are the layout and styling language ([ui.md](./ui.md)). Every responsive rule below is expressed with Nuxt UI components and Tailwind's standard breakpoint and container-query variants.

Status labels: **owner-directed** (stated or approved by the owner) and **Open** (waiting on an owner decision, not implementable). Every decision is in [the owner-decision table](../plans/ui-standardization.md#6-owner-decisions); none is open at present.

---

## 1. Width classes (owner-directed)

The **viewport** width class decides the shell and the page layout:

| Class | Viewport width | Tailwind variant | Typical use |
|---|---|---|---|
| **Compact** | < 640px | unprefixed (mobile first), `max-sm:` | Phones |
| **Medium** | 640–1023px | `sm:` … `max-lg:` | Tablets, small laptop windows, split screen |
| **Expanded** | ≥ 1024px | `lg:` | Laptops and desktops |

- **Width-based, never device-based (owner-directed).** Decide with Tailwind's breakpoint variants (`sm`, `lg`). Never use the user agent, `pointer`/`hover` media queries or "is mobile" checks to change layout or capability. A touch laptop at 1440px gets the expanded layout.
- **These are the only viewport breakpoints for layout decisions.** Don't switch layouts at `md` (768px) or `xl`. `md:`/`xl:` may tune spacing or column counts *within* a class, never what the user can do. No arbitrary breakpoints (`min-[700px]:`).
- **Why 1024px:** `UDashboardSidebar` becomes persistent at `lg`. Aligning the expanded class with it keeps the shell and page layouts switching together.
- **Same product at every width (owner-directed).** Capabilities, permissions, data, validation, URLs and route behavior are identical. Only presentation changes. A compact layout may move an action into a menu or sheet but never removes it; a deep link opens the same record at every width.

### Constrained surfaces: container queries

A slideover, a narrow column or a card is narrower than the viewport, so the viewport class says nothing about the room its contents have. A slideover on a 1440px screen is about as wide as a phone. Its **contents** therefore follow the width of the surface, not the viewport:

- **The surface is a Tailwind container.** Put `@container` on the element that holds the surface's content (a slideover's or column's body wrapper). Inside it, write the content **mobile first** (the compact composition, unprefixed) and add wider arrangements with Tailwind's **default container variants** (`@md:`, `@lg:`, `@2xl:` …) where the content needs them, for example `grid gap-3 @lg:grid-cols-2`. Use only the default container sizes; no arbitrary `@[500px]:` values and no named container sizes added to the theme.
- **The viewport class still decides the surface itself:** whether a modal is full screen, whether the shell shows a drawer, whether an editor is a slideover or a route. Container queries decide how the content inside lays out.
- **What container queries can't decide:** a choice made in JavaScript (a `UDropdownMenu` vs a `UDrawer` bottom sheet, `fullscreen` on a `UModal`). These come from the **viewport** only, through **one shared layout-context composable** (built on `useMediaQuery` with Tailwind's `sm` and `lg` breakpoint values, never a new number). The foundations PR creates it and replaces the four copies of `useMediaQuery('(max-width: 639px)')`.
- **When a component inside a constrained surface needs the compact JavaScript choice at every viewport** (a row-actions menu in the Options slideover opening as a bottom sheet), the surface passes an **explicit `compact` prop** to that component. Components never measure their own width (no `ResizeObserver`, no user-agent checks) to decide this.

Example: the Options editor stays a `USlideover` at every width (owner-directed). Its body is an `@container`; value rows are the compact composition by default, and nothing inside it relies on the viewport being expanded.

## 2. Compact is designed, not shrunk (owner-directed)

A compact screen is a **focused touch workflow**: one task per screen, the main content first, actions in thumb reach. Stacking the desktop composition in one column is not a compact design. Before building a compact layout, answer:

1. What is the one thing a manager does here on a phone? Put that first.
2. Which desktop regions become separate screens (pushed detail, full-screen editor) rather than stacked sections?
3. Which controls move into a sheet (filters, row actions) so the list itself stays visible?
4. Where is the primary action: the navbar, or a bottom action bar?

## 3. Application shell

The shell is Nuxt UI's dashboard (`app/layouts/default.vue`): `UDashboardGroup` → `UDashboardSidebar` + one `UDashboardPanel` per page.

| | Compact | Medium | Expanded |
|---|---|---|---|
| Sidebar | Temporary drawer, opened from the navbar's menu button | Temporary drawer (as today) | Persistent; collapsible to icons; resizable |
| Brand | Top of the drawer | Top of the drawer | Sidebar header |
| User menu | Bottom of the drawer | Bottom of the drawer | Sidebar footer |
| Page | Full width | Full width | Beside the sidebar |

**Compact and medium use the existing Nuxt UI dashboard app bar and drawer (owner-directed, approved 2026-09-28).** Medium stays a Nuxt UI drawer, **not a custom icon rail**: Nuxt UI's sidebar only collapses to icons from `lg`, and a medium rail would mean overriding the shell.

## 4. Navigation model

**Audit (2026-09-28):** the admin workspace has 7 destinations today: Dashboard (a placeholder), Menu items, Categories, Options, Add-ons, Availability and Staff. The blueprint adds roughly 7 more manager areas (banners, offers/vouchers, rewards, customers, branches/tables, reports, audit history). They're peer management areas grouped by domain ("Menu", "Admin"). No 3–5 of them are both stable and far more frequent than the rest, and the live order queue belongs to the separate **staff (counter) workspace**, not this admin.

**Model: app bar plus drawer (owner-directed, approved 2026-09-28).** On compact and medium, `UDashboardNavbar` is the app bar (menu button, page title, the page's primary action). The `UDashboardSidebar` drawer holds the full grouped navigation. There's **no admin bottom navigation**. A bottom bar is a question only for another workspace, when:
- a workspace has 3–5 honest primary destinations, which is likely the counter workspace (queue, payments, vouchers). That's a separate owner decision when the counter workspace is planned.

The drawer and sidebar come from one source (`app/utils/navigation.ts`, each feature's `navigation` export), so every width has the same destinations and order.

**Detail routes** (`/add-ons/[id]`) show a Back button to their index on compact and medium, and a breadcrumb on expanded. Back goes to the index in the browser history when the user came from it (so filters in the URL survive), otherwise to the index route.

## 5. Page anatomy

Every page renders a `UDashboardPanel`:

```
UDashboardPanel
├─ #header
│  ├─ UDashboardNavbar      title (or breadcrumb on detail) · sidebar toggle/collapse · #right: the ONE primary action
│  └─ UDashboardToolbar     optional: search · filters · view actions (Reorder, Select, Grid/List)
├─ #body                     intro paragraph (muted) · StatusTabs · state or content
└─ bottom action bar         optional, compact/medium: mode bars, Save changes, bulk actions
```

- **Navbar primary action:** labelled at every width (D74). Icon-only (with `aria-label` and tooltip) only when the label can't fit at 320px beside the title.
- **Toolbar on compact:** search gets the row; its width shrinks before any toolbar action goes off screen (`min-w-0`). Filters never make the toolbar scroll sideways. One or two simple filters may stay directly visible. **With more than two filters (owner-directed, decision 2):** compact shows one labelled **Filters** `UButton` (with the active-filter count when any are set, e.g. "Filters (2)") that opens a `UDrawer` bottom sheet holding the filters as ordinary Nuxt UI fields, with **Clear** and **Apply** actions. Filter meaning, values and URL/query state are the same at every width; Apply writes the same query the toolbar would. No custom-styled filter panel.
- **Body order:** intro → tabs → alerts that apply to the whole page (archived, conflict) → content. Alerts about one row sit on that row.
- **One bottom bar at a time.** A bottom bar is `fixed inset-x-0 bottom-0` on compact/medium and static (above the content or in the navbar) on expanded. It uses Nuxt UI surfaces and tokens (`bg-default`, `border-t border-default`, spacing tokens; no blur), pads `env(safe-area-inset-bottom)`, and the body adds matching bottom padding. **One shared bottom action bar component (owner-directed, decision 3)** replaces the four current implementations. It owns only: fixed or static positioning by width class, safe-area padding, the matching page-body padding, focus and on-screen-keyboard handling (focused fields are never hidden behind it, §6), and enforcing that only one bottom bar is visible. It renders the ordinary Nuxt UI buttons each feature supplies (a slot) and adds no colors, radius, shadows, button styles or other styling of its own.

## 6. Sticky and fixed elements (owner-directed)

Sticky or fixed controls must never cover focused elements or the last content:
- The panel body has bottom padding (a `pb-*` spacing token) covering the bar's height while a bottom bar shows.
- Scrolling to a focused field accounts for bars (a `scroll-pb-*` spacing token on the scroll container matching the bar), so keyboard focus is never hidden behind one (WCAG 2.4.11).
- The on-screen keyboard: forms in full-screen overlays put Save in the overlay footer, which stays above the keyboard. Don't pin anything to the bottom of a scrolling page while a text field is focused.
- Only the navbar/toolbar (the panel's own) stick to the top. Content doesn't add sticky headers, except a mode bar in its own section (reorder).

## 7. Responsive behavior matrix

What each element becomes per width class. Page-type specifics and examples: [page-patterns.md](./page-patterns.md).

| Element | Expanded ≥1024 | Medium 640–1023 | Compact <640 |
|---|---|---|---|
| Navigation | Persistent sidebar | Drawer | Drawer |
| Detail navigation | Breadcrumb | Back button + title | Back button + title |
| Primary action | Navbar, labelled | Navbar, labelled | Navbar (icon-only only if it can't fit) |
| Search | Toolbar, fixed width | Toolbar | Toolbar, full row |
| Filters (≤2) | Toolbar | Toolbar | Toolbar, wrapping to a second row if needed |
| Filters (>2) | Toolbar | Toolbar | Labelled **Filters** button (with count) → `UDrawer` with Clear and Apply; same query state (owner-directed) |
| Status tabs | Body | Body | Body; must fit without scrolling (short labels) |
| Comparable columns | `UTable` | `UTable` if it fits, else grouped rows | **Grouped rows or cards; never a sideways-scrolling table** (owner-directed) |
| Card collection | 2-column grid or full-width agenda cards | 1–2 columns | 1 column |
| Opening a record | Its name/content link or a Manage/View button | Same | One large content target; actions trigger beside it ([row composition](./page-patterns.md#compact-row-composition)) |
| Row actions | `⋮` `UDropdownMenu` | `⋮` `UDropdownMenu` | `⋮` `UDropdownMenu`, or a `UDrawer` bottom sheet for richer actions |
| Selection / bulk | Select mode + floating bar | Same | Select mode + bottom bar |
| Reorder | Drag + buttons + keys | Same | Move up/down buttons (drag optional) |
| Short form (≤ ~6 fields) | `UModal` | `UModal` | Full-screen `UModal` |
| Editor tied to a list (short sections, save each change) | `USlideover`; contents follow its `@container` | Same | `USlideover` (Nuxt UI fills the narrow viewport); contents unchanged, already compact. Options editor (owner-directed) |
| Long form tied to a list | `USlideover` | `USlideover` | **Focused route** (owner-directed for the Menu item editor); both URLs work at every width ([page-patterns → Menu item editor URLs](./page-patterns.md#menu-item-editor-urls-owner-directed-decision-4-approved-2026-09-28)) |
| Record with sub-collections | Route, multi-column | Route, single column or tabs | Route, tabs; focused full-screen sections |
| Settings | Sections, one Save | Same | Pushed sections editing the same draft; one final Save (owner-directed; [page-patterns → Settings](./page-patterns.md#3-settings)) |
| Master–detail | List + detail side by side | Pushed detail or slideover | **Pushed screen or bottom sheet** (owner-directed) |
| Brief contextual choice | Dropdown or popover | Dropdown | Bottom sheet (owner-directed) |
| Confirmation | Centered dialog | Centered dialog | Centered dialog |
| Toasts | Nuxt UI default position | Same | Same; never the only place for an error inside an overlay (see [page-patterns → States](./page-patterns.md#8-states)) |
| Keyboard hints (`kbds`, `?`) | Shown in tooltips | Shown | Not shown (tooltips don't appear on touch); shortcuts still work with a keyboard |

## 8. Reflow, zoom and orientation

- Content reflows to 320 CSS px (WCAG 1.4.10): no two-dimensional scrolling except tables on expanded, which never need horizontal scrolling at their own width class.
- 200% text zoom keeps everything readable; containers grow with text (no fixed heights on text containers).
- Landscape phones (e.g. 844×390) are compact by width rules if <640px wide, else medium. Full-screen overlays scroll their body; headers and footers stay.
