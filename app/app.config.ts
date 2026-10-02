/**
 * Nuxt UI's global configuration: the one place component styling changes (D74, D77,
 * docs/reference/ui.md). Pages never override color, size, radius or shadow.
 *
 * Touch targets (D81, ui.md §6): controls keep Nuxt UI's default sizes at every width (the owner
 * found 44px buttons too big on a phone). Only checkboxes, radios and switches get a larger
 * *invisible* hit area below `sm` (an `after:` inset): their 16–20px box is hard to hit, and nothing
 * changes visually. Classes here are added to Nuxt UI's own (tailwind-merge), per component.
 */
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'amber',
      neutral: 'stone',
    },
    // Page width (D126, ui.md → Page width): the navbar, the toolbar and the body share one side
    // padding, `--page-gutter` (tailwind.css), which centers them on a wide screen. A page opts into
    // the narrow width with `class="page-narrow"` on its UDashboardPanel; nothing else per page.
    dashboardNavbar: {
      slots: { root: 'px-(--page-gutter) sm:px-(--page-gutter)' },
    },
    dashboardPanel: {
      slots: { body: 'px-(--page-gutter) sm:px-(--page-gutter)' },
    },
    // The toolbar never scrolls sideways on a phone (responsive-layout §5): its items wrap, and the
    // left group (search, filters) takes the room it needs.
    dashboardToolbar: {
      slots: {
        root: 'px-(--page-gutter) sm:px-(--page-gutter) max-sm:flex-wrap max-sm:gap-y-2 max-sm:py-2',
        left: 'max-sm:min-w-0 max-sm:flex-1 max-sm:flex-wrap',
      },
    },
    // Tabs never cut a label (owner, 2026-10-02, D128): a row that doesn't fit scrolls sideways (no
    // scrollbar), tabs keep their width, and the link variant's underline sits inside the row (a
    // scrolling box clips what hangs below it). The tapped tab is centered by useCenteredTab.
    tabs: {
      slots: { list: 'overflow-x-auto scrollbar-none', trigger: 'shrink-0', label: 'overflow-visible whitespace-nowrap' },
      compoundVariants: [{ orientation: 'horizontal', variant: 'link', class: { indicator: 'bottom-0' } }],
    },
    // Surfaces (D126, ui.md → Surfaces): a card's header is a quiet strip, so a group's title reads as
    // its heading; numbers use <StatCard> (the soft `subtle` card).
    card: {
      slots: { header: 'bg-elevated/25' },
    },
    // Invisible hit areas below `sm`: 16px box + 14px on each side = 44px. `overflow-visible` so the
    // hit area isn't clipped; the indicator keeps the box's rounding itself.
    checkbox: {
      slots: {
        base: 'max-sm:relative max-sm:overflow-visible max-sm:after:absolute max-sm:after:-inset-3.5',
        indicator: 'max-sm:rounded-sm',
      },
    },
    radioGroup: {
      slots: {
        base: 'max-sm:relative max-sm:overflow-visible max-sm:after:absolute max-sm:after:-inset-3.5',
        indicator: 'max-sm:rounded-full',
      },
    },
    // The default switch is 36×20px: 4px more on each side and 12px above and below.
    switch: { slots: { base: 'max-sm:relative max-sm:after:absolute max-sm:after:-inset-x-1 max-sm:after:-inset-y-3' } },
  },
})
