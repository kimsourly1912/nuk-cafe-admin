import { type MaybeRefOrGetter, toValue } from 'vue'
import { followRowErrors } from '~/utils/form-rows'

/** What this reads of a `UForm` template ref: its errors, read and set. */
interface RowErrorsForm {
  getErrors: () => { name?: string, message: string }[]
  setErrors: (errors: { name?: string, message: string }[]) => void
}

/**
 * A list's per-row errors in a `UForm` (`values.2`, `modifiers.2.price`) follow their rows: remove
 * or move a row through this and its error moves with it, instead of staying on its position for
 * the row that takes its place (D171, [ui §17](./ui.md#forms-and-their-errors)).
 *
 * Use it in place of `list.splice(i, 1)` and of moving the array by hand, for every list whose rows
 * have their own fields. The list is changed in place. Keys (`:key`) are the caller's: use an id
 * per row, not the position, when a row moves.
 *
 * ```ts
 * const form = useTemplateRef('form')
 * const rowErrors = useFormRowErrors(form, 'modifiers')
 * rowErrors.removeRow(state.modifiers, i)
 * rowErrors.moveRow(state.modifiers, i, i - 1)
 * ```
 */
export function useFormRowErrors(form: MaybeRefOrGetter<RowErrorsForm | null | undefined>, field: string) {
  /** Gives the errors the rows' new positions; `order` lists the old positions in their new order. */
  function follow(order: number[]) {
    const instance = toValue(form)
    instance?.setErrors(followRowErrors(instance.getErrors(), field, order))
  }

  return {
    /** Removes row `index` from `list`, and its errors with it. */
    removeRow<T>(list: T[], index: number) {
      if (index < 0 || index >= list.length) return
      follow(list.map((_, i) => i).filter(i => i !== index))
      list.splice(index, 1)
    },
    /** Moves row `from` to `to` in `list`, and its errors with it; a move past either end does nothing. */
    moveRow<T>(list: T[], from: number, to: number) {
      if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return
      const order = list.map((_, i) => i)
      const [moved] = order.splice(from, 1)
      order.splice(to, 0, moved!)
      follow(order)
      const [item] = list.splice(from, 1)
      list.splice(to, 0, item!)
    },
  }
}
