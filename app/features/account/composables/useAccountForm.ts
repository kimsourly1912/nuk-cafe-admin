import type { AccountField } from '../utils/account'
import { accountFormError } from '../utils/account'

/** The page's one form alert (`FormErrorAlert`). */
export const FORM_ERROR_ID = 'account-form-error'

interface FormHandle {
  setErrors: (errors: { name: string, message: string }[]) => void
}

interface AccountFormOptions {
  /** The `UForm`'s id: a field is found by its `name` inside it. */
  formId?: string
  /** The fields the form shows: a server's error for one of them goes on it. None: every error goes in the alert. */
  fields?: AccountField[]
}

/**
 * What every account form does with a server's refusal (page-patterns §5): a field's error on the
 * field, anything else in the alert above the fields, and focus moved to it. A failed check before
 * sending is `focusFirstInvalid`'s (forms → Errors on submit).
 *
 * Fields are found by `name`, not by an input `id` of our own: inside a `UFormField` an input's own
 * `id` reaches the label only after the label was rendered, so the server's HTML labelled the field
 * with an id nothing had (D256).
 */
export function useAccountForm(options: AccountFormOptions = {}, state?: Record<string, string>) {
  const { formId, fields = [] } = options
  const identity = useSessionIdentity()
  const saving = ref(false)
  /** The message for the alert above the fields. */
  const formError = ref<string>()
  const form = useTemplateRef<FormHandle>('form')
  useFormErrorRecheck(form)
  let disposed = false
  onScopeDispose(() => {
    disposed = true
  })
  function clearIdentityInput() {
    if (state) for (const key of Object.keys(state)) state[key] = ''
    formError.value = undefined
  }
  watch(identity.generation, () => {
    if (!saving.value) clearIdentityInput()
  }, { flush: 'sync' })

  function focusField(field: AccountField) {
    // The form keeps its fields disabled until after its events (`loadingAuto`), and a disabled
    // field can't take focus: focus on the next frame.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`#${formId} [name="${field}"]`)?.focus())
  }

  async function showError(error: unknown) {
    const { field, message } = accountFormError(error)
    if (field && formId && fields.includes(field)) {
      form.value?.setErrors([{ name: field, message }])
      focusField(field)
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
      return true
    }
    catch (error) {
      if (ApiError.from(error).kind === 'aborted' || disposed) clearIdentityInput()
      else await showError(error)
      return false
    }
    finally {
      saving.value = false
    }
  }

  return { saving, formError, submit }
}
