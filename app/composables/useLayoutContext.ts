import { useMediaQuery } from '@vueuse/core'

/**
 * The viewport width class, for the choices CSS can't make: a full-screen `UModal`, a `UDrawer`
 * instead of a dropdown, which URL a list opens (D77, docs/reference/responsive-layout.md §1).
 * Layout that CSS can express uses Tailwind's `sm:` / `lg:` variants (or container queries) instead.
 *
 * The queries are Tailwind's own `sm` (40rem) and `lg` (64rem) breakpoints, written the way Tailwind
 * writes them, so JavaScript and CSS switch at the same width even with a larger browser font size.
 * Width only: never the user agent, touch or hover.
 *
 * @example
 * const { isCompact } = useLayoutContext()
 * <UModal :fullscreen="isCompact">
 */
export function useLayoutContext() {
  /** Compact: narrower than `sm` (< 640px at the default font size). Phones. */
  const isCompact = useMediaQuery('(width < 40rem)')
  /** Expanded: `lg` and wider (≥ 1024px). The persistent sidebar; below it the shell uses a drawer. */
  const isExpanded = useMediaQuery('(width >= 64rem)')
  return { isCompact, isExpanded }
}
