import type { FormErrorEvent } from '@nuxt/ui'

/**
 * A submit that fails validation brings the first invalid field into view and focuses it, so an
 * error below the fold (the 12th value of a long list) is never missed. "First" is the one highest
 * on the page, not the first the schema reported. Use it as `@error="focusFirstInvalid"` on every
 * `UForm` ([forms → Errors on submit](docs/reference/forms.md#errors-on-submit)).
 *
 * It runs on the next frame: the form keeps its fields disabled until after its events
 * (`loadingAuto`), and a disabled field can't take focus. A group's own error (a field with no input
 * of its own) has nothing to focus, so the page scrolls to its message instead.
 */
export function focusFirstInvalid(event: FormErrorEvent) {
  const ids = event.errors.map(error => error.id).filter((id): id is string => !!id)
  requestAnimationFrame(() => {
    const fields = ids.flatMap(id => document.getElementById(id) ?? [])
    const first = fields.sort((a, b) => a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)[0]
      ?? document.querySelector<HTMLElement>('[data-slot="error"]')
    if (!first) return
    // Centered, so a sticky modal header or footer never covers it.
    first.scrollIntoView({ block: 'center', behavior: 'smooth' })
    first.focus({ preventScroll: true })
  })
}
