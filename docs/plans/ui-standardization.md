# UI standardization plan (temporary)

_Started 2026-09-28. A rollout plan: delete it when the migration below is done and its lasting content lives in the reference documents._

**Canonical rules** (this plan doesn't restate them):
- [ui.md](../reference/ui.md): visual foundation
- [responsive-layout.md](../reference/responsive-layout.md): width classes, shell, navigation, page anatomy, behavior matrix
- [page-patterns.md](../reference/page-patterns.md): page blueprints, editing surfaces, gestures, states
- [ui-review-checklist.md](../reference/ui-review-checklist.md): the pre-merge checklist

**Source:** the owner's "NUK Cafe Admin — Responsive UI standardization" request (2026-09-28). No separate plan document was attached, so the request's required decisions are the working specification. They're marked **owner-directed** in the reference pages; everything else is **proposed**.

---

## 1. Phase A: documentation (this change)

- Audited the routes, shell, shared components and docs (below).
- Moved the old `docs/reference/ui.md` (a helper API reference) to [ui-helpers.md](../reference/ui-helpers.md) and updated every link, so `ui.md` can be the visual foundation.
- Wrote the four reference pages and this plan; added a pointer in AGENTS.md; recorded D77.
- **No application code changed.**

## 2. Route inventory

| Route | Pattern | Surfaces today | Gap against the standard |
|---|---|---|---|
| `/login` | Task flow | Centered `UCard` | Check the compact layout: primary at the bottom, 44px targets |
| `/change-password` | Task flow | Centered `UCard` | Same |
| `/` Dashboard | Placeholder | Welcome text | No pattern until reports (8.1) |
| `/products` Menu items | Resource index (paginated; grid + table) | Editor: `USlideover` (`ProductFormSlideover`), `?item=` deep link | The List view is a `UTable` at every width (sideways scroll on compact). The editor is a long form: compact needs a focused full-screen route or sections |
| `/categories` | Resource index (tree) | Editor: `UModal` (full screen <640); Select/Reorder modes with a bottom mode bar | Mode bar switches at `md` (768), not 640/1024; it uses `backdrop-blur` |
| `/options` | Resource index (library cards) | Editor: `USlideover` with save-each-change | Reorder mode footer only <640; slideover content should follow compact rules at every width |
| `/add-ons` | Resource index (library cards) | Opens a route | Closest to the standard |
| `/add-ons/[id]` | Detail / editor route | Two columns → tabs <1024; add-on dialog; bottom sheet row actions <640 | Reference candidate |
| `/availability` | Resource index (agenda cards) | Editor: `UModal` (full screen <640); archived read-only | Card layout switches at `lg`; conforms otherwise |
| `/staff` | Resource index (table) | Editor: `UModal` | `UTable` at every width: needs grouped rows on compact; the modal isn't full screen <640 |

**Settings pattern:** no instance. The first settings page (branch settings, step 5.1) proves it.

## 3. Shell and shared building blocks

- **Shell:** `UDashboardGroup` + `UDashboardSidebar` (collapsible, resizable, a drawer below 1024px) + `UDashboardPanel` pages; the navigation is grouped in `app/utils/navigation.ts`; the user menu is in the sidebar footer. Global config: `app.config.ts` sets only `primary: amber`, `neutral: stone`; `main.css` adds pointer cursors.
- **Shared behavior components** (keep; they're not a component library): `SearchInput`, `StatusTabs`, `ListSkeleton`, `ListEmptyState`, `ApiErrorAlert`, `BulkActionsBar`, `ConfirmDialog`, `OfflineBanner`, `ShortcutsHelp`.
- **Feature-local layout pieces** that repeat a decision: `CategoryModeBar` (a fixed bottom bar), the Add-on page's Save bar, the Options editor's reorder footer, `BulkActionsBar` (sticky). That's **four bottom-bar implementations**.

## 4. Inconsistencies found

1. **Breakpoints:** compact detection uses `useMediaQuery('(max-width: 639px)')` in four components, while layouts switch at `sm` (Options/Add-ons chips), `md` (Categories rows and mode bar) and `lg` (Add-on page, Availability cards). → Standard: 640 and 1024 only ([responsive-layout §1](../reference/responsive-layout.md#1-width-classes-owner-directed)).
2. **Editing surfaces** were chosen per feature (modal, slideover, route) without a rule. → [page-patterns §4](../reference/page-patterns.md#4-detail--editor).
3. **Tables on compact:** `/staff` and `/products` (List) scroll sideways. → Grouped rows.
4. **Touch targets:** D72/D73 used per-component `min-h-11` overrides; D74 removed them in favor of defaults (~32px icon buttons); the owner now requires 44–48px on compact. → A global compact rule, not per-component overrides ([ui §6](../reference/ui.md#6-density-and-touch-targets)).
5. **Bottom bars:** four implementations with different safe-area, padding and blur handling. → One pattern ([responsive-layout §5–6](../reference/responsive-layout.md#5-page-anatomy)).
6. **Full-screen overlays:** `fullscreen` detection is repeated in each modal (a `useMediaQuery` per component). `StaffFormModal` doesn't go full screen.
7. **Row actions on compact:** a dropdown everywhere except Add-on rows (a bottom sheet).
8. **Save models:** save-each-change (Options, Add-on rows) vs a draft (every modal, Add-on settings); both are valid but need the rule in [page-patterns → Save models](../reference/page-patterns.md#save-models).
9. **Decorative styling left:** `backdrop-blur` on the Categories mode bar and the Add-on Save bar.
10. **Contrast:** amber-500 primary text on white is below 4.5:1 (links, active tabs, selected toggles, outline badges). Not measured per screen yet.

## 5. Documentation conflicts resolved

| Conflict | Resolution |
|---|---|
| `docs/reference/ui.md` was a helper API reference; the visual foundation needs that name | Moved to `ui-helpers.md`; links updated in README, mutations, data-fetching and feature-standard |
| AGENTS.md held detailed styling rules (the D74 bullet) | Kept as a one-line principle plus a pointer; details live in `ui.md` |
| AGENTS.md's page anatomy line ("Every page component renders a `UDashboardPanel`…") | Canonical home is [responsive-layout §5](../reference/responsive-layout.md#5-page-anatomy); AGENTS links to it |
| D74 "Nuxt UI default sizes, no `min-h`/`min-w` overrides" vs the owner's 44–48px compact targets | Both hold: defaults per component, plus one **global** compact rule. D77 records it; the mechanism awaits approval |
| feature-standard §4 "Layout" row chose collections informally | Links to [page-patterns §2](../reference/page-patterns.md#2-resource-index) |
| forms.md "Where forms live" named surfaces with outdated examples (products as a full page, points and carbon settings) | forms.md stays canonical for **which guard** to use; the surface choice links to page-patterns |
| ui-helpers documented a `StatusTabs` `size` prop removed in D74 | Row removed |

## 6. Owner decisions

Not approved yet; the recommendation is marked.

1. **Compact touch-target mechanism.** *Recommended:* one global rule in `main.css` for widths <640px giving buttons, inputs, selects, checkboxes' hit areas and menu items a 44px minimum (Nuxt UI keeps its visual sizes elsewhere). *Alternative:* set larger default sizes in `app.config.ts` for every width (heavier desktop).
2. **Mobile navigation.** *Recommended:* app bar + drawer, no bottom bar in the admin workspace (the audit in [responsive-layout §4](../reference/responsive-layout.md#4-navigation-model)); revisit for the counter workspace.
3. **Medium navigation:** drawer (the current Nuxt UI behavior) rather than an icon rail. *Recommended:* drawer.
4. **Primary color contrast:** darken the light-mode primary used for text (e.g. amber-700 via `--ui-primary`) globally. *Recommended:* yes, after measuring.
5. **Dark mode:** supported and switchable, or light only? The tokens allow both. *Recommended:* keep it token-clean; decide the switch later.
6. **Menu item editor on compact:** move the long slideover form to a route (`/products/[id]`) with focused sections. *Recommended:* yes, when Menu items migrates.
7. **Options editor surface:** keep the slideover (save-each-change) or move to a route like Add-ons. *Recommended:* keep the slideover; apply the compact rules.

## 7. Phase B: migration sequence (after review)

Each step is its own PR: build, e2e at the [verification widths](../reference/ui-review-checklist.md#verification-widths), update this plan, stop for review.

1. **Foundations (global, no page changes):** the compact touch-target rule, the primary contrast fix (decisions 1 and 4); one shared composable for "is compact" (`useMediaQuery('(max-width: 639px)')`) replacing the four copies; one bottom action bar component (safe area, body padding, no blur).
2. **Reference: resource index with a table → `/staff`.** Grouped rows on compact, full-screen modal, filters sheet if needed. Smallest page that proves the table→rows rule.
3. **Reference: detail / editor route → `/add-ons/[id]`.** Align breakpoints and the Save bar with the foundations; confirm the tab and bottom-sheet patterns.
4. **Reference: task flow → `/change-password`** (and `/login`): compact anatomy, primary at the bottom.
5. **Bring the rest to the references:** `/categories` (breakpoints, the shared bar), `/options`, `/availability`, `/add-ons`, then `/products` (List view rows; the editor route if decision 6 is approved).
6. **Settings reference:** the first settings page (step 5.1) is built to the blueprint.
7. **Close:** fold anything still useful into the reference pages, and delete this plan.
