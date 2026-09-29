import type { FormErrorEvent } from '@nuxt/ui'
import type { AccountField } from '../utils/account'
import { accountFormError } from '../utils/account'

/** The page's one form alert (`FormErrorAlert`). */
export const FORM_ERROR_ID = 'account-form-error'

interface FormHandle {
  setErrors: (errors: { name: string, message: string }[]) => void
}

/**
 * What every account form does with a failure (page-patterns §5): a field's error on the field,
 * anything else in the alert above the fields, and focus moved to it. `fieldIds` names each
 * field's input id, for focusing it.
 */
export function useAccountForm(fieldIds: Partial<Record<AccountField, string>>) {
  const saving = ref(false)
  /** The message for the alert above the fields. */
  const formError = ref<string>()
  const form = useTemplateRef<FormHandle>('form')

  function focusField(id: string | undefined) {
    // The form keeps its fields disabled until after its events (`loadingAuto`), and a disabled
    // field can't take focus: focus on the next frame.
    if (id) requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  function focusFirstInvalid(event: FormErrorEvent) {
    focusField(event.errors[0]?.id)
  }

  async function showError(error: unknown) {
    const { field, message } = accountFormError(error)
    if (field && fieldIds[field]) {
      form.value?.setErrors([{ name: field, message }])
      focusField(fieldIds[field])
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

  return { saving, formError, focusFirstInvalid, submit }
}
