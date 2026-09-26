/**
 * Consistent success/warning/error toasts for code that doesn't go through `useMutation`
 * (mutations toast by themselves). Prefer `useMutation` for create/update/delete.
 *
 * @example
 * const notify = useNotify()
 * try { await exportReport(); notify.success('Report exported') }
 * catch (error) { notify.error('Could not export report', error) }
 */
export function useNotify() {
  const toast = useToast()

  return {
    success(title: string, description?: string) {
      toast.add({ title, description, color: 'success', icon: 'i-lucide-circle-check' })
    },

    /**
     * Something succeeded but needs a look (e.g. the server saved something other than what was
     * sent). Stays until dismissed, so it can't be missed.
     */
    warning(title: string, description?: string) {
      toast.add({ title, description, color: 'warning', icon: 'i-lucide-triangle-alert', duration: Number.POSITIVE_INFINITY })
    },

    error(title: string, error: unknown) {
      const apiError = ApiError.from(error)
      if (isSilentError(apiError)) return
      if (import.meta.dev) console.error(`[${apiError.kind}] ${title}:`, apiError.detail ?? apiError.message, apiError)
      toast.add({ title, description: apiError.message, color: 'error', icon: 'i-lucide-circle-alert' })
    },
  }
}
