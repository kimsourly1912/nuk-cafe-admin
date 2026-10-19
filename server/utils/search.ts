import { sql } from 'drizzle-orm'
import type { AnyColumn, SQL } from 'drizzle-orm'

/**
 * Whether `column` contains `search` as literal text, ignoring ASCII case. `like` can't do this on
 * D1: it refuses a pattern over 50 bytes, and the pattern is the search plus its `%…%`, in UTF-8,
 * with every `%`, `_` and `\` escaped (17 Khmer letters or 49 ASCII ones already pass it, and
 * the contracts allow 100 characters). `instr` takes no pattern, so nothing is a wildcard, nothing
 * needs escaping and the search has no length limit of its own. `lower` folds ASCII only, as
 * `like` did. Like `like '%…%'` it scans the table: neither uses an index.
 */
export const containsText = (column: AnyColumn, search: string): SQL => sql`instr(lower(${column}), lower(${search})) > 0`
