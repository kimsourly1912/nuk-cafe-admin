/**
 * Nuxt UI's global configuration: the one place component styling changes (D74, D77,
 * docs/reference/ui.md). Pages never override color, size, radius or shadow.
 *
 * Compact touch targets (D77, ui.md §6): below Tailwind's `sm` every interactive target is at least
 * 44px (`min-h-11`, and `min-w-11` for icon-only buttons), without changing the look from `sm` up.
 * Checkboxes, radios and switches keep their visual size and get a larger invisible hit area
 * (`after:` inset) instead. These are added to Nuxt UI's own classes (tailwind-merge), per component.
 */
export default defineAppConfig({
  ui: {
    colors: {
      primary: 'amber',
      neutral: 'stone',
    },
    button: {
      slots: { base: 'max-sm:min-h-11' },
      // Nuxt UI makes a button without a label `square`: icon-only buttons get 44×44.
      variants: { square: { true: 'max-sm:min-w-11 max-sm:justify-center' } },
    },
    input: { slots: { base: 'max-sm:min-h-11' } },
    inputNumber: { slots: { base: 'max-sm:min-h-11' } },
    inputTime: { slots: { base: 'max-sm:min-h-11' } },
    select: { slots: { base: 'max-sm:min-h-11' } },
    selectMenu: { slots: { base: 'max-sm:min-h-11' } },
    tabs: { slots: { trigger: 'max-sm:min-h-11' } },
    dropdownMenu: { slots: { item: 'max-sm:min-h-11 max-sm:items-center' } },
    navigationMenu: { slots: { link: 'max-sm:min-h-11' } },
    // 16px box + 14px on each side = 44px. `overflow-visible` so the hit area isn't clipped; the
    // indicator keeps the box's rounding itself.
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
