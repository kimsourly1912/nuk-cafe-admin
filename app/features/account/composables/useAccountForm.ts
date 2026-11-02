import type { AccountField } from '../utils/account'
import { accountFormError } from '../utils/account'

/** The page's one form alert (`FormErrorAlert`). */
export const FORM_ERROR_ID = 'account-form-error'

interface FormHandle {
  setErrors: (errors: { name: string, message: string }[]) => void
  /** Each error carries its field's input id, from the form's own register of fields. */
  getErrors: (name: string) => { id?: string }[]
}

/**
 * What every account form does with a server's refusal (page-patterns §5): a field's error on the
 * field, anything else in the alert above the fields, and focus moved to it. `fields` names the
 * form's fields (a `UFormField` `name` each); the input to focus is the one the form registered for
 * that name, so the inputs keep their `UFormField`'s id (no `id` of their own: the server would render
 * the label pointing at another id). A failed check before sending is `focusFirstInvalid`'s (forms →
 * Errors on submit).
 */
export function useAccountForm(fields: readonly AccountField[]) {
  const saving = ref(false)
  /** The message for the alert above the fields. */
  const formError = ref<string>()
  const form = useTemplateRef<FormHandle>('form')
  useFormErrorRecheck(form)

  function focusField(id: string | undefined) {
    // The form keeps its fields disabled until after its events (`loadingAuto`), and a disabled
    // field can't take focus: focus on the next frame.
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  async function showError(error: unknown) {
    const { field, message } = accountFormError(error)
    if (field && fields.includes(field)) {
      form.value?.setErrors([{ name: field, message }])
      focusField(form.value?.getErrors(field)[0]?.id)
      return
    }
    formError.value = message
    await nextTick()
    document.getElementById(FORM_ERROR_ID)?.focus()
  }

  /** Runs the submit with `saving` on and the previous error cleared; a failure is shown. */
  async function submit(action: () => Promise<void>) {
    saving.value = true
    formError.value = undefined
    try {
      await action()
    }
    catch (error) {
      await showError(error)
    }
    finally {
      saving.value = false
    }
  }

  return { saving, formError, submit }
}
