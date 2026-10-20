/**
 * The rows by `key(row)`, each group in the rows' order. Shared by the app and the server (Nuxt
 * auto-imports `shared/utils`; server features import it as `#shared/utils/collections`).
 *
 * @example
 * const linesOf = groupBy(lines, line => line.orderId)   // Map<orderId, line[]>
 */
export function groupBy<T, K>(rows: readonly T[], key: (row: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const row of rows) {
    const group = key(row)
    const bucket = groups.get(group)
    if (bucket) bucket.push(row)
    else groups.set(group, [row])
  }
  return groups
}
