/**
 * A row's errors are named by its position (`values.2`, `modifiers.2.price`), so when a row is
 * removed or moved its errors must move with it; otherwise the row that takes its place shows them.
 * `order` lists the old positions in their new order, a removed row left out. Other errors stay as
 * they are. Used with `UForm`'s `getErrors` / `setErrors` after the rows change.
 */
export function followRowErrors<E extends { name?: string }>(errors: readonly E[], field: string, order: readonly number[]): E[] {
  const prefix = `${field}.`
  return errors.flatMap((error): E[] => {
    const name = error.name ?? ''
    // `values.2` or `modifiers.2.price`: the position, then whatever names the row's field.
    const match = name.startsWith(prefix) ? /^(\d+)(\..*)?$/.exec(name.slice(prefix.length)) : null
    if (!match) return [error]
    const index = order.indexOf(Number(match[1]))
    if (index < 0) return []
    return [{ ...error, name: `${prefix}${index}${match[2] ?? ''}` }]
  })
}
