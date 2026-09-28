# UI review checklist

← [API Reference](./README.md) · Rules: [ui.md](./ui.md) · [responsive-layout.md](./responsive-layout.md) · [page-patterns.md](./page-patterns.md)

Run this before merging any UI change. Each line links to the rule it checks. A "no" is fixed, or explained in the PR as a known gap with an entry in the [rollout plan](../plans/ui-standardization.md).

## Verification widths

Check every changed screen at **320, 390, 768, 1024 and 1440 px** wide, plus one landscape phone (844×390). Screenshots at those widths go in the PR or the feature's progress entry.

## Pattern and composition

- [ ] The page follows one [pattern](./page-patterns.md#1-choose-the-pattern); a deviation is written down with its reason.
- [ ] The compact layout was **designed** (answers the four questions in [responsive-layout §2](./responsive-layout.md#2-compact-is-designed-not-shrunk-owner-directed)), not the desktop stacked.
- [ ] Capabilities, permissions, URLs and validation are the same at every width ([responsive-layout §1](./responsive-layout.md#1-width-classes-owner-directed)).
- [ ] Layout switches only at 640px and 1024px, by width ([§1](./responsive-layout.md#1-width-classes-owner-directed)).
- [ ] No sideways-scrolling table on compact; no two-dimensional scrolling at 320px ([matrix](./responsive-layout.md#7-responsive-behavior-matrix)).

## Visual

- [ ] Nuxt UI components at their default sizes and variants; no per-page restyling ([ui §1](./ui.md#1-principles)).
- [ ] Semantic colors and surfaces only: no palette classes, hex, gradients, blur or custom shadows ([ui §2](./ui.md#2-color-tokens), [§8](./ui.md#8-surface-hierarchy)).
- [ ] Spacing on the 4px ramp; no card inside a card ([ui §3](./ui.md#3-spacing-owner-directed-a-4px-ramp), [§8](./ui.md#8-surface-hierarchy)).
- [ ] One primary action per page, at most one per card or overlay; destructive actions confirm and are never primary ([ui §9](./ui.md#9-action-hierarchy-owner-directed)).
- [ ] Status shown with text (and icon), not color alone; badges only for status and counts ([ui §10](./ui.md#10-status-badges-and-pills)).
- [ ] Icons match the one-icon-per-concept table ([ui §7](./ui.md#7-icons)).

## Touch and keyboard

- [ ] On compact, every target is ≥44px (icon buttons 44×44), with ≥8px between targets ([ui §6](./ui.md#6-density-and-touch-targets)).
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

- [ ] Text contrast ≥4.5:1 (3:1 large text and UI boundaries), including primary-colored text ([ui §12](./ui.md#12-accessibility-baseline-owner-directed-wcag-22-aa-minimum))
- [ ] Headings in order; lists and tables are semantic; form errors are associated with their fields
- [ ] Async results are announced (toast, inline alert, `role="status"`, `aria-live` for moves)
- [ ] 200% text zoom keeps content usable; nothing depends on hover or motion (`motion-safe:`)

## Tests

- [ ] e2e covers the compact layout where it differs (a phone-width test: no horizontal overflow, key controls reachable) and at least one keyboard path.
- [ ] Each new guard (a disabled action, a read-only state, a conflict path) is checked to fail its test when removed ([progress → How to verify](../progress.md#how-to-verify)).
