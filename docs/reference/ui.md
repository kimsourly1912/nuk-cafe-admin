# UI foundation

← [API Reference](./README.md) · Layout: [responsive-layout.md](./responsive-layout.md) · Patterns: [page-patterns.md](./page-patterns.md) · Review: [ui-review-checklist.md](./ui-review-checklist.md) · Helper APIs: [ui-helpers.md](./ui-helpers.md)

The canonical visual rules for NUK Cafe Admin: tokens, spacing, radius, type, density, icons, surfaces, actions, motion and accessibility. Where a rule lives here, other documents link to it instead of repeating it.

> **Nuxt UI is the component design system. Tailwind CSS tokens are the layout and styling language.** Every screen is composed from Nuxt UI components (their variants, slots and semantic colors, configured globally in `app/app.config.ts`) and laid out with Tailwind's standard spacing, breakpoint, container-query, typography and color-token utilities. There is no second component library and no custom visual language on top.

Status labels used below:
- **Owner-directed**: stated by the owner (D74, the UI standardization request of 2026-09-28, or the approved directions of the 2026-09-28 review).
- **Open**: waiting on an owner decision; **not implementable** until decided. Every decision, approved or open, is in [the owner-decision table](../plans/ui-standardization.md#6-owner-decisions); none is open at present.
- Unlabelled rules are the standard as written in D77.

---

## 1. Principles

1. **Nuxt UI first (owner-directed, D74).** Use Nuxt UI components with their default sizes, variants and slots. Mockups decide layout, positions and content, not styling.
2. **Configure globally, not per page (owner-directed).** Colors, radius, default sizes and component defaults change only in `app/app.config.ts` (`ui.colors`, a component's `slots`, `variants` or `defaultVariants`). Theme variables that Nuxt UI exposes as CSS variables (`--ui-primary`, `--ui-radius`) are set once in `app/assets/css/tailwind.css`. A page never restyles a component to look different from the same component elsewhere: no per-page `ui` overrides of color, size, radius or shadow.
3. **No parallel component library (owner-directed).** Shared app components ([ui-helpers.md](./ui-helpers.md)) wrap *behavior* (search, empty states, bulk actions). They don't re-skin Nuxt UI. Don't create `AppButton`, `BaseCard`, a styled row component or similar.
4. **Tailwind tokens only (owner-directed).** Layout uses Tailwind's standard scales: spacing (`gap-4`, `p-3`), breakpoints (`sm:`, `lg:`, `max-sm:`), container queries (`@container`, `@md:`), sizing (`size-5`, `max-w-md`), typography (`text-sm`, `font-semibold`) and Nuxt UI's semantic color utilities (`text-muted`, `bg-elevated`, `border-default`). **No arbitrary values** (`[13px]`, `min-[700px]:`, `@[500px]:`), no hex colors, no palette classes.
5. **Allowed layout-only tweaks on a component:** grid and flex placement, `min-w-0`, `shrink`, `break-words`, visibility per width class, and a `ui` slot class that changes *layout* only (a card body becoming a flex row). Anything that changes color, size, radius or shadow is not a layout tweak and belongs in `app.config.ts`.
6. **Custom CSS is limited (owner-directed)** to global theme variables, safe-area handling (`env(safe-area-inset-*)`, the one place a non-token value is allowed) and behavior that neither Nuxt UI nor Tailwind utilities can express (the existing pointer-cursor rule). No one-off CSS, no broad element selectors for styling.
7. **Avoid (owner-directed):** decorative gradients, glass and blur effects (`backdrop-blur`), custom shadows, excessive pills, and one-off styling.

## 2. Color tokens

`app.config.ts` sets `primary: 'amber'` and `neutral: 'stone'`. Use **semantic** colors and utilities only, never palette classes (`bg-amber-400`, `text-gray-500`) or hex values.

| Role | Use | Classes / props |
|---|---|---|
| Primary | The one main action, the current navigation item, selected state | `color="primary"`; `text-primary`, `bg-primary/10`, `border-primary` |
| Neutral | Everything else: secondary buttons, badges without meaning | `color="neutral"` |
| Success | Active / completed / saved | `color="success"` |
| Warning | Needs attention, a conflict the user can resolve | `color="warning"` |
| Error | Failures, validation, destructive actions | `color="error"` |
| Info | Neutral notices (rare; prefer a muted paragraph) | `color="info"` |

| Text | Use |
|---|---|
| `text-highlighted` | Headings, names, the primary value in a row |
| `text-default` | Body text |
| `text-muted` | Supporting text, meta lines, help |
| `text-dimmed` | Placeholders and disabled-looking content only |

| Surface | Use |
|---|---|
| `bg-default` | Page, cards, overlays |
| `bg-elevated` (`/25`–`/50`) | Sidebar, a quiet grouped area (a table header, a main-category row) |
| `bg-muted`, `bg-accented` | Rare; hover and pressed states come from Nuxt UI |

Borders: `border-default` for separators and outlines, `border-muted` for very quiet dividers, `divide-default` between rows. Color is never the only signal: status also has text or an icon (§10).

**Semantic color roles are preserved (owner-directed, approved 2026-09-28).** A role keeps its meaning app-wide; a screen never repurposes `warning` for decoration or `primary` for emphasis.

**Dark mode (owner-directed, 2026-09-28; switch added 2026-09-29, D96).** Everything is written with semantic tokens so it works in both modes; nothing is light-only. **Light by default, whatever the system prefers;** Nuxt UI's `UColorModeButton` switches (the admin sidebar's footer, the admin's sign-in pages, the store's header, the account pages), and the choice is kept in the browser for the whole site. Screens are checked in both modes.

## 3. Spacing (owner-directed: the current 4px ramp is preserved)

Use Tailwind's spacing scale in 4px steps: `1` (4px), `2` (8), `3` (12), `4` (16), `5` (20), `6` (24), `8` (32), `10` (40), `12` (48), `16` (64). Half steps (`0.5`, `1.5`) only *inside* a compact control or badge, never between layout blocks.

| Between… | Space |
|---|---|
| Icon and its text; items in a chip row | `gap-1`–`gap-2` |
| Controls in a toolbar or form row | `gap-2`–`gap-3` |
| Fields in a form | `space-y-4` (a `UForm` default) |
| Sections of a page or card | `space-y-6` / `gap-6` |
| Page gutter | the `UDashboardPanel` body default (16px compact, 24px from `sm`); don't add another |
| Card padding | the `UCard` default (16px compact, 24px from `sm`); don't override |

## 4. Radius

Use Nuxt UI's `--ui-radius` (the default): controls and badges get the component's own radius, and cards and overlays theirs. Don't set `rounded-*` on Nuxt UI components. Plain elements the app draws (a row container, a dot) use `rounded-md` / `rounded-lg`, or `rounded-full` for dots and avatars only. Changing the radius is a global theme change.

## 5. Typography

| Level | Style | Where |
|---|---|---|
| Page title | `UDashboardNavbar` `title` (its own style) | One per page |
| Record title on a detail page | `text-xl font-semibold text-highlighted` (an `h2` under the navbar's `h1`) | `/add-ons/[id]` |
| Section heading | `font-semibold text-highlighted` (`h2`/`h3`) | Card and form sections |
| Body | `text-sm` (the dashboard's base) | Lists, forms |
| Supporting | `text-sm text-muted` | Meta lines, intros, help |
| Small meta | `text-xs text-muted` | Counts under a label, "next day" |

- At most three sizes on one screen. Numbers and times use `tabular-nums`.
- Long names wrap (`break-words`); they're truncated only where a full value is one tap away.
- Headings follow document order (`h1` navbar → `h2` → `h3`), never skip a level for looks.
- Copy: sentence case, verbs on buttons ("Save changes", "Archive group"), no ALL CAPS.

## 6. Density and touch targets

- **Nuxt UI's default sizes at every width (owner, 2026-09-28, D81).** Buttons, fields, tabs, menu items and navigation links keep the theme's own sizes (`md` controls, about 32px) on phones too; nothing makes them bigger. The owner tried 44px controls on a phone (D78) and found them too big. WCAG 2.2 AA's 24×24px minimum (2.5.8) is the floor, and Nuxt UI's defaults meet it (`test/e2e/ui-foundations.test.ts` measures every Nuxt UI control on a phone).
- **Checkboxes, radios and switches** (16–20px boxes) get a larger **invisible** hit area below `sm`, set once in `app/app.config.ts` (a `max-sm:after:` inset on the control): 44px to tap, no visual change.
- **Pages and components never add `min-h-*`/`min-w-*` or size props for touch** (D74), and there's no broad CSS selector for it. A size change is a theme change in `app.config.ts`, for every page.
- **Where a target should be large, make it large by content, not by overrides:** a record's row is one button holding its name and meta line ([compact row composition](./page-patterns.md#compact-row-composition)), which is naturally 44px or taller.
- Adjacent targets keep at least `gap-2` (8px) between their hit areas on compact.
- A record in a list has **one large content target** that opens it, with its actions trigger beside it as a sibling, never inside it ([page-patterns → Compact row composition](./page-patterns.md#compact-row-composition)).

## 7. Icons

- Lucide only, bundled at build time; write names as literal strings (D18).
- `size-4` inline with text, `size-5` standalone. Decorative icons are hidden from assistive technology (`UIcon` is by default); icon-only buttons need an `aria-label` and a tooltip on expanded.
- **One icon per concept**, app-wide:

| Concept | Icon | Concept | Icon |
|---|---|---|---|
| Create | `i-lucide-plus` | Row actions | `i-lucide-ellipsis-vertical` |
| Edit | `i-lucide-pencil` | Search | `i-lucide-search` |
| Archive | `i-lucide-archive` | Restore | `i-lucide-archive-restore` |
| Reorder mode | `i-lucide-arrow-down-up` | Drag handle | `i-lucide-grip-vertical` |
| Move up / down | `i-lucide-arrow-up` / `i-lucide-arrow-down` | Back | `i-lucide-arrow-left` |
| Save | `i-lucide-save` | Close | Nuxt UI's close icon |
| Info note | `i-lucide-info` | Error | `i-lucide-circle-alert` |
| Busy | `i-lucide-loader-circle` (spinning) | Time | `i-lucide-clock` |

A feature's own icon is the one in its `navigation.ts`; its cards reuse it rather than picking icons per record.

## 8. Surface hierarchy

From the page outwards:
1. **Page** (`UDashboardPanel` body, `bg-default`).
2. **Section**: a heading plus content, separated by space or `USeparator`. Prefer sections to boxes.
3. **Card** (`UCard`, `variant="outline"`): one record in a collection, or one group of settings. **No card inside a card.** Rows inside a card use `divide-y`.
4. **Overlays**: `UModal`, `USlideover`, `UDrawer`, menus and popovers. They're the only surfaces with shadows (Nuxt UI's own).

Alerts (`UAlert`, `variant="subtle"`) are for states that need action or explain a blocked action (conflict, archived, load error). A page's standing explanation is a muted intro paragraph, not an alert (D74).

## 9. Action hierarchy (owner-directed)

| Level | Style | Rule |
|---|---|---|
| Primary | `UButton` solid, `color="primary"` | **One per page** (the navbar's `#right`, e.g. "New rule"), and **at most one per card** or overlay footer |
| Secondary | `color="neutral" variant="outline"` | Cancel, Manage/View, Reorder |
| Tertiary | `variant="ghost"` or `variant="link"` | Inline and low-emphasis actions, presets |
| Destructive trigger | `color="error" variant="soft"` | Archive group, Archive option set |
| Destructive confirm | The confirm dialog's `danger` button | Only inside `useConfirm` / `useMutation` `confirm` |
| Overflow | `⋮` `UDropdownMenu` (or a bottom sheet on compact, see [page-patterns](./page-patterns.md#6-bottom-sheets)) | Everything beyond the one or two visible actions |

- A destructive action is never the primary button, never shown as the only visible action, and always confirms (with the effect in words).
- A disabled action that the user can't use yet stays visible with the reason (tooltip on expanded, description in menus and sheets).
- Labels are verb + object; icons don't replace labels for primary and secondary actions.

## 10. Status, badges and pills

- Status (Active, Archived, Draft, Required) is a `UBadge variant="subtle"` **with text**, plus an icon where helpful. Color alone never carries it.
- Badges are for status and counts. Plain attributes (a price, a category, a rule) are text, not pills. A row shows at most two badges.
- Chips (outline badges) are only for short previews of values (Options), capped with "+N more".

## 11. Motion

- Use Nuxt UI's transitions (overlays, menus, collapsibles). App-level motion is limited to state feedback: a moved row's brief highlight, a spinner, a fade of a bulk bar. It lasts ≤200ms, or ≤1.5s for a highlight that fades.
- Wrap app-level transitions in `motion-safe:`; nothing essential depends on motion (`prefers-reduced-motion`).
- No decorative or looping animation, no animated status indicators.

## 12. Accessibility baseline (owner-directed: WCAG 2.2 AA minimum)

- **Contrast:** text meets 4.5:1 (3:1 for large text and UI boundaries). Use the matching token on tinted backgrounds (`text-primary` on `bg-primary/10`), never a lighter shade. **Light-mode primary text (owner-directed, approved 2026-09-28):** with `primary: 'amber'`, Nuxt UI's light-mode primary is the 500 shade, which as text on white is below 4.5:1 (links, the active tab, selected day toggles, outline badges). The fix is **one semantic theme variable**: set light mode's `--ui-primary` to a darker shade of the same primary palette in `app/assets/css/tailwind.css`, leaving dark mode on Nuxt UI's default. Never per page, never a palette class. **Done (D78): the 800 shade.** 700 passed on white but measured 4.4:1 on its own tint (`text-primary` on `bg-primary/10`: subtle badges), so 800; it passes on white, on the tint, and behind the white label of solid primary buttons. `test/e2e/ui-foundations.test.ts` measures all three in light mode, and primary text and solid buttons in dark mode.
- **Light-mode warning text (owner, 2026-09-28, D80):** the same fix for `warning`: Nuxt UI's yellow-500 is 1.9:1 on white, 700 gives 4.3:1 on its tint, so light mode's `--ui-warning` is the **800** shade (6.8:1 on white, 5.8:1 on the tint); dark mode keeps 400. Measured in the same test file.
- **Success, error and info (owner, 2026-09-28, D80):** fixed the same way, each at the lightest shade that passes on white and on its tint: success **800**, error **700**, info **600** (Nuxt UI's 500 shades measured 2.2, 3.8 and 3.8:1 on white). Dark mode keeps Nuxt UI's 400 shades, which pass on the dark background and on their tints. Every status color is measured in `test/e2e/ui-foundations.test.ts`.
- **Focus:** never remove focus outlines. Nuxt UI's focus-visible rings are the style. After an action, focus goes somewhere sensible: the next row after a delete, the moved row after a reorder, the trigger after a dialog closes.
- **Names:** every control has a visible label or `aria-label`; row actions name their record ("Actions for Oat milk").
- **Structure:** landmarks from the dashboard shell, headings in order, lists as `ul`/`ol`, tables as `UTable` with headers.
- **Announcements:** async results reach screen readers: toasts (`aria-live`), inline alerts, `role="status"` for "Saving…/Saved", `aria-live="polite"` for reorder positions.
- **Input:** everything works by keyboard; no hover-only information (tooltips duplicate something reachable); gestures have button alternatives ([page-patterns → Gestures](./page-patterns.md#7-gestures)).
- **Reflow and zoom:** content works at 320 CSS px wide and at 200% text zoom without two-dimensional scrolling ([checklist](./ui-review-checklist.md)).
