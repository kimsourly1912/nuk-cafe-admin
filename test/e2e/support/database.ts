import { createClient } from '@libsql/client'

/**
 * A connection to the e2e server's database file, for tests that read or change it directly
 * (D103). It waits up to 5 s while the server holds the write lock, like the server does for
 * theirs, instead of failing at once with SQLITE_BUSY.
 */
export const e2eDatabase = (dbFile: string) => createClient({ url: `file:${dbFile}`, timeout: 5000 })
