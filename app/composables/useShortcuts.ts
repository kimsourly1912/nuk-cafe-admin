/**
 * Keyboard shortcuts on top of Nuxt UI's `defineShortcuts` (`meta` = Cmd on macOS, Ctrl elsewhere;
 * ignored while typing in an input unless `usingInput`). The full list is in `SHORTCUTS`, shown by
 * `<ShortcutsHelp>` (press `?`). Cases: docs/reference/app-behavior.md → "Keyboard shortcuts".
 */

/** Every shortcut in the app, for the help dialog. Keep it in sync when adding one. */
export const SHORTCUTS = [
  { kbds: ['/'], label: 'Search the list' },
  { kbds: ['n'], label: 'New item (on list pages)' },
  { kbds: ['s'], label: 'Select categories (Categories)' },
  { kbds: ['r'], label: 'Reorder categories (Categories)' },
  { kbds: ['meta', 'enter'], label: 'Save the open form' },
  { kbds: ['escape'], label: 'Close the dialog (asks first if there are unsaved changes)' },
  { kbds: ['escape'], label: 'Leave Select or Reorder (Categories; an unsaved order stays until saved or discarded)' },
  { kbds: ['meta', '/'], label: 'Open or close the assistant (where it is on)' },
  { kbds: ['?'], label: 'Show keyboard shortcuts' },
] as const

/** A dialog, alert, menu or open select is on screen: page shortcuts must not act behind it. */
function somethingOnTop() {
  return !!document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
}

/**
 * Page-level shortcuts (list pages, the shell). Skipped while a dialog, menu or select is open,
 * so `n` behind an open form doesn't open a second one.
 *
 * @example
 * usePageShortcuts({ n: () => openForm() })
 */
export function usePageShortcuts(config: Record<string, () => void>) {
  defineShortcuts(Object.fromEntries(Object.entries(config).map(([key, handler]) => [key, () => {
    if (!somethingOnTop()) handler()
  }])))
}

/**
 * Ctrl/Cmd+Enter submits a form, also while typing in it. Skipped when another dialog is on top
 * (e.g. "Discard unsaved changes?" over the form).
 *
 * @example
 * const form = useTemplateRef('form')
 * useSubmitShortcut(() => form.value?.submit())
 */
export function useSubmitShortcut(submit: () => void) {
  defineShortcuts({
    meta_enter: {
      usingInput: true,
      handler: () => {
        if (document.querySelectorAll('[role="dialog"], [role="alertdialog"]').length <= 1) submit()
      },
    },
  })
}
