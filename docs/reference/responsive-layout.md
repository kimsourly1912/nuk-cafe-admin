# Responsive layout

← [API Reference](./README.md) · Visual rules: [ui.md](./ui.md) · Patterns: [page-patterns.md](./page-patterns.md) · Review: [ui-review-checklist.md](./ui-review-checklist.md)

How the admin adapts to width: the three width classes, the application shell and navigation, page anatomy, and what each part of a page becomes at each width. Page-type blueprints are in [page-patterns.md](./page-patterns.md); visual tokens are in [ui.md](./ui.md).

Status labels: **owner-directed** (stated by the owner) and **proposed** (awaiting review, see [the rollout plan](../plans/ui-standardization.md#6-owner-decisions)).

---

## 1. Width classes (owner-directed)

| Class | Viewport or container width | Tailwind | Typical use |
|---|---|---|---|
| **Compact** | < 640px | unprefixed, `max-sm:` | Phones; a narrow slideover |
| **Medium** | 640–1023px | `sm:` … `max-lg:` | Tablets, small laptop windows, split screen |
| **Expanded** | ≥ 1024px | `lg:` | Laptops and desktops |

- **Width-based, never device-based (owner-directed).** Decide with CSS breakpoints. When JavaScript must choose a component (a full-screen modal, a bottom sheet), use `useMediaQuery('(max-width: 639px)')` on **width**. Never use the user agent, `pointer`/`hover` media queries or "is mobile" checks to change layout or capability. A touch laptop at 1440px gets the expanded layout.
- **These are the only breakpoints for layout decisions.** Don't switch layouts at `md` (768px) or `xl`. `md:`/`xl:` may tune spacing or column counts *within* a class, never what the user can do.
- **Why 1024px:** `UDashboardSidebar` becomes persistent at `lg`. Aligning the expanded class with it keeps the shell and page layouts switching together.
- **Containers count too.** Content inside a slideover or a narrow column is laid out for the width it gets. A slideover is compact-width even on a desktop, so its content uses the compact rules.
- **Same product at every width (owner-directed).** Capabilities, permissions, data, validation, URLs and route behavior are identical. Only presentation changes. A compact layout may move an action into a menu or sheet but never removes it; a deep link opens the same record at every width.

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

**Medium: drawer, not rail (proposed).** Nuxt UI's sidebar only collapses to icons from `lg`. A medium rail would mean overriding the shell. Revisit only if tablet use shows the drawer is too slow.

## 4. Navigation model

**Audit (2026-09-28):** the admin workspace has 7 destinations today: Dashboard (a placeholder), Menu items, Categories, Options, Add-ons, Availability and Staff. The blueprint adds roughly 7 more manager areas (banners, offers/vouchers, rewards, customers, branches/tables, reports, audit history). They're peer management areas grouped by domain ("Menu", "Admin"). No 3–5 of them are both stable and far more frequent than the rest, and the live order queue belongs to the separate **staff (counter) workspace**, not this admin.

**Model: app bar plus drawer (proposed).** On compact and medium, the navbar is the app bar (menu button, page title, the page's primary action). The drawer holds the full grouped navigation. There's **no bottom navigation bar** in the admin workspace. A bottom bar is re-evaluated when:
- a workspace has 3–5 honest primary destinations, which is likely the counter workspace (queue, payments, vouchers); or
- usage data shows a few admin destinations dominate on phones.

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
- **Toolbar on compact:** search gets the row; its width shrinks before any toolbar action goes off screen (`min-w-0`). With more than two filters, compact shows one "Filters" button that opens a sheet (proposed), rather than a sideways-scrolling toolbar.
- **Body order:** intro → tabs → alerts that apply to the whole page (archived, conflict) → content. Alerts about one row sit on that row.
- **One bottom bar at a time.** A bottom bar is `position: fixed` on compact/medium and static (above the content or in the navbar) on expanded. It pads `env(safe-area-inset-bottom)`, and the body adds matching bottom padding.

## 6. Sticky and fixed elements (owner-directed)

Sticky or fixed controls must never cover focused elements or the last content:
- The panel body has bottom padding equal to the bar's height while a bottom bar shows.
- Scrolling to a focused field accounts for bars (`scroll-padding-bottom` on the scroll container), so keyboard focus is never hidden behind one (WCAG 2.4.11).
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
| Filters (>2) | Toolbar | Toolbar | "Filters" sheet (proposed) |
| Status tabs | Body | Body | Body; must fit without scrolling (short labels) |
| Comparable columns | `UTable` | `UTable` if it fits, else grouped rows | **Grouped rows or cards; never a sideways-scrolling table** (owner-directed) |
| Card collection | 2-column grid or full-width agenda cards | 1–2 columns | 1 column |
| Row actions | `⋮` dropdown | `⋮` dropdown | `⋮` dropdown, or a bottom sheet for richer actions |
| Selection / bulk | Select mode + floating bar | Same | Select mode + bottom bar |
| Reorder | Drag + buttons + keys | Same | Move up/down buttons (drag optional) |
| Short form (≤ ~6 fields) | `UModal` | `UModal` | Full-screen `UModal` |
| Editor tied to a list | `USlideover` | `USlideover` (full width at <640 automatically) | Full-screen |
| Long form / record with sub-collections | Route, multi-column | Route, single column or tabs | Route, tabs; focused full-screen sections |
| Master–detail | List + detail side by side | Pushed detail or slideover | **Pushed screen or bottom sheet** (owner-directed) |
| Brief contextual choice | Dropdown or popover | Dropdown | Bottom sheet (owner-directed) |
| Confirmation | Centered dialog | Centered dialog | Centered dialog |
| Toasts | Nuxt UI default position | Same | Same; never the only place for an error inside an overlay (see [page-patterns → States](./page-patterns.md#8-states)) |
| Keyboard hints (`kbds`, `?`) | Shown in tooltips | Shown | Not shown (tooltips don't appear on touch); shortcuts still work with a keyboard |

## 8. Reflow, zoom and orientation

- Content reflows to 320 CSS px (WCAG 1.4.10): no two-dimensional scrolling except tables on expanded, which never need horizontal scrolling at their own width class.
- 200% text zoom keeps everything readable; containers grow with text (no fixed heights on text containers).
- Landscape phones (e.g. 844×390) are compact by width rules if <640px wide, else medium. Full-screen overlays scroll their body; headers and footers stay.
