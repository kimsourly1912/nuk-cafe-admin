import { tryOnScopeDispose } from '@vueuse/core'
import type { MaybeRefOrGetter } from 'vue'

/**
 * Back closes this overlay while it's open (D201, ui.md → Overlays): it gets a history entry, and
 * Back calls `onBack` instead of leaving the page. `<AppModal>`, `<AppSlideover>` and `<AppDrawer>`
 * do this for every overlay; call it directly only for Nuxt UI's own (the sidebar's phone menu, the
 * search palette).
 *
 * @example
 * const open = ref(false)
 * useOverlayBack(open, () => { open.value = false })
 */
export function useOverlayBack(open: MaybeRefOrGetter<boolean>, onBack: () => void) {
  if (!import.meta.client) return
  let close: (() => void) | undefined
  // Sync: an overlay opened while another closes (the unsaved-changes question) keeps its order.
  watch(() => toValue(open), (isOpen) => {
    if (isOpen && !close) close = overlayHistory().open(onBack)
    else if (!isOpen && close) {
      close()
      close = undefined
    }
  }, { immediate: true, flush: 'sync' })
  tryOnScopeDispose(() => close?.())
}
