# UI review checklist

← [API Reference](./README.md) · Rules: [ui.md](./ui.md) · [responsive-layout.md](./responsive-layout.md) · [page-patterns.md](./page-patterns.md)

Run this before merging any UI change. Nuxt UI is the component design system and Tailwind CSS tokens are the layout and styling language ([ui.md](./ui.md)); every line below checks one rule. Each line links to the rule it checks. A "no" is fixed, or explained in the PR as a known gap with an entry in the [rollout plan](../plans/ui-standardization.md).

## Verification widths

Check every changed screen at **320, 390, 768, 1024 and 1440 px** wide, plus one landscape phone (844×390). Screenshots at those widths go in the PR or the feature's progress entry.

## Pattern and composition

- [ ] The page follows one [pattern](./page-patterns.md#1-choose-the-pattern); a deviation is written down with its reason.
- [ ] The compact layout was **designed** (answers the four questions in [responsive-layout §2](./responsive-layout.md#2-compact-is-designed-not-shrunk-owner-directed)), not the desktop stacked.
- [ ] Capabilities, permissions, URLs and validation are the same at every width ([responsive-layout §1](./responsive-layout.md#1-width-classes-owner-directed)).
- [ ] Page layout switches only at the viewport's `sm` (640px) and `lg` (1024px), by width; no device detection and no arbitrary breakpoints ([§1](./responsive-layout.md#1-width-classes-owner-directed)).
- [ ] Content inside a constrained surface (slideover, narrow column) lays out by its `@container` with Tailwind's default container variants; JavaScript choices come from the layout-context composable or an explicit `compact` prop ([§1](./responsive-layout.md#constrained-surfaces-container-queries)).
- [ ] Compact record rows are the [row composition](./page-patterns.md#compact-row-composition): one large record target and a sibling actions trigger; no button inside a link, no custom row component for styling.
- [ ] The save model is the same at every width: a page-wide draft is never split into independently saved sections on compact ([page-patterns §3–4](./page-patterns.md#save-models)).
- [ ] Nothing depends on an **Open** item in [the owner-decision table](../plans/ui-standardization.md#6-owner-decisions).
- [ ] More than two filters on compact: a labelled Filters button (with count) → `AppDrawer` with Clear and Apply, writing the same URL query as the toolbar ([responsive-layout §5](./responsive-layout.md#5-page-anatomy)).
- [ ] Bottom actions use the shared bottom action bar with ordinary Nuxt UI buttons; only one bar is visible ([responsive-layout §5](./responsive-layout.md#5-page-anatomy)).
- [ ] Where a record has two URLs (Menu items), both open it at every width, resizing never changes the URL, and Back keeps the list's query ([page-patterns §4](./page-patterns.md#menu-item-editor-urls-owner-directed-decision-4-approved-2026-09-28)).
- [ ] No sideways-scrolling table on compact; no two-dimensional scrolling at 320px ([matrix](./responsive-layout.md#7-responsive-behavior-matrix)).

## Visual

- [ ] Nuxt UI components at their default sizes and variants; any change to them is in `app.config.ts`, never a per-page `ui` override of color, size, radius or shadow ([ui §1](./ui.md#1-principles)).
- [ ] Tailwind tokens only: no arbitrary values (`[13px]`, `min-[700px]:`, `@[500px]:`), no one-off CSS; custom CSS only for theme variables, safe areas or behavior utilities can't express ([ui §1](./ui.md#1-principles)).
- [ ] Semantic colors and surfaces only: no palette classes, hex, gradients, blur or custom shadows ([ui §2](./ui.md#2-color-tokens), [§8](./ui.md#8-surface-hierarchy)).
- [ ] Spacing on the 4px ramp; no card inside a card ([ui §3](./ui.md#3-spacing-owner-directed-the-current-4px-ramp-is-preserved), [§8](./ui.md#8-surface-hierarchy)).
- [ ] One primary action per page, at most one per card or overlay; destructive actions confirm and are never primary ([ui §9](./ui.md#9-action-hierarchy-owner-directed)).
- [ ] Status shown with text (and icon), not color alone; badges only for status and counts ([ui §10](./ui.md#10-status-badges-and-pills)).
- [ ] Icons match the one-icon-per-concept table ([ui §7](./ui.md#7-icons)).
- [ ] Numbers are `<StatCard>`s; a card's header strip comes from `app.config.ts` ([ui §8](./ui.md#8-surface-hierarchy)).
- [ ] The page sets no max-width or breakpoint for its width; a settings or form page has `page-narrow` ([ui §13](./ui.md#13-page-width-owner-2026-10-02-d126)). Checked at 1920px too.
- [ ] Every dropdown of records (or a long fixed list) is searchable and virtualized (`<RecordSelect>`); `USelect` only for fixed sets ([ui §14](./ui.md#14-dropdowns-owner-2026-10-02-d126)).
- [ ] One line under tabs: `<ToolbarTabs>` in a toolbar; the tab is in the URL (`useUrlTab`); the sidebar marks the section ([ui §15](./ui.md#15-tabs-and-the-sidebar-owner-2026-10-02-d126)). A tab row that doesn't fit scrolls with every label whole, the active tab centered.
- [ ] A paginated list ends with `<ListPagination>`; a quantity is a `<QuantityStepper>` ([ui §16](./ui.md#16-pagination-and-quantities-owner-2026-10-02-d128)).
- [ ] Drawers and bottom sheets are `<AppDrawer>`: no handle, no dragging, an X ([ui §8](./ui.md#8-surface-hierarchy)).

## Touch and keyboard

- [ ] Controls keep Nuxt UI's default sizes at every width (no `min-h-*`/`min-w-*` or size props for touch, D81); every target is at least 24×24px with `gap-2` or more between targets; a record's row is one large target by its content ([ui §6](./ui.md#6-density-and-touch-targets)).
- [ ] Everything works with the keyboard alone, in a logical order; focus is visible everywhere.
- [ ] Focus lands sensibly after open, close, save, delete and reorder; dialogs trap and restore focus.
- [ ] Drag, swipe and long-press all have button or keyboard alternatives ([page-patterns §7](./page-patterns.md#7-gestures)).
- [ ] Icon-only controls and row actions have accessible names that include the record ("Actions for Oat milk").
- [ ] Sticky and fixed bars never hide the focused field or the last content; safe-area padding on bottom bars ([responsive-layout §6](./responsive-layout.md#6-sticky-and-fixed-elements-owner-directed)).

## States

For each screen and overlay, show and test the applicable [states](./page-patterns.md#8-states):

- [ ] First load (skeleton, no empty-state flash) and refresh (content stays)
- [ ] Initial empty and filtered empty (with Clear filters)
- [ ] Load error with Retry; not found (detail routes)
- [ ] Unauthorized / forbidden; offline
- [ ] Saving (loading control, locked inputs), validation next to fields
- [ ] Conflict (Reload inside the surface, input kept)
- [ ] Archived / read-only (why, what still works, restore)
- [ ] Long names, large numbers and counts, zero values, many rows

## Accessibility

- [ ] Text contrast ≥4.5:1 (3:1 large text and UI boundaries), including primary-colored text, in light and dark mode ([ui §12](./ui.md#12-accessibility-baseline-owner-directed-wcag-22-aa-minimum))
- [ ] Headings in order; lists and tables are semantic; form errors are associated with their fields
- [ ] Async results are announced (toast, inline alert, `role="status"`, `aria-live` for moves)
- [ ] 200% text zoom keeps content usable; nothing depends on hover or motion (`motion-safe:`)

## Tests

- [ ] e2e covers the compact layout where it differs (a phone-width test: no horizontal overflow, key controls reachable) and at least one keyboard path.
- [ ] Each new guard (a disabled action, a read-only state, a conflict path) is checked to fail its test when removed ([progress → How to verify](../progress.md#how-to-verify)).
