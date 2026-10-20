# Repository standard

How a feature's `*.repository.ts` is written: the query API, names, the tenant rule, reads, conditions, guards, writes and tests. It refines [architecture → Features](./architecture.md#features) (what a repository is for) and [architecture → Atomic writes](./architecture.md#atomic-writes) (batches and D1's limits); those rules still apply.

**Status (D194, 2026-10-20):** new and changed repository code follows this page. The existing repositories don't yet; the [repository audit](../reviews/repository-audit-2026-10-20.md) lists every gap and the order of the clean-up PRs. A rule marked **(step 2)** needs a shared helper that the second clean-up PR adds; until then, follow the nearest existing pattern and leave a `TODO(D194)`.

## Query API

Repositories use **Drizzle's query builder**: `db.select()`, `db.selectDistinct()`, `db.insert()`, `db.update()`, `db.delete()` and `db.batch()`. Drizzle 1.0 keeps this API unchanged.

- **Not Drizzle's relational queries** (`db.query.<table>.findMany`, `relations()`, `defineRelations()`). Version 1 (callbacks, `relations()` per table) is removed in Drizzle 1.0, so code written with it now would be migrated twice. Version 2 (object filters, one `defineRelations()`) needs Drizzle 1.0 and `drizzle(client, { relations })`, which NuxtHub 0.10 doesn't pass: it builds the database with `{ schema }` only.
- **Revisit** relational queries v2 for nested reads (an order with its lines, a menu with its categories) when both hold: Drizzle 1.0 is released as `latest`, and NuxtHub supports it (nuxt-hub/core PR #825, open on 2026-10-20). Writes stay on the query builder either way: guards, conditional updates and upserts have no relational form.
- **No raw statements** (`db.run(sql…)`, `db.all(sql…)`) in a repository. D1's driver can't batch a raw statement that has bound parameters (D53). `sql` fragments inside the builder are fine (see [Conditions](#conditions)).

## A repository file

A file holds one aggregate (`items.repository.ts`, `categories.repository.ts`). Split it when it passes about 300 lines or mixes two aggregates. Sections, in this order, each under a `// --- Name ---` comment when the file has more than one:

1. Imports: `drizzle-orm`, then `#shared`, then `#server`, then `./` (as ESLint sorts them).
2. Row types: the records the repository returns.
3. Column lists and shared conditions (`const itemColumns = {…}`, `const activeItem = …`).
4. Reads.
5. Guards.
6. Write statements.
7. Background-task writes (the [one exception](#background-task-writes) to "writes return statements").

A file needs no header comment. Write one only when the file has a rule that applies to all of it (`catalog.repository.ts`: every read follows composite keys inside the tenant). Don't write "All SQL of X".

## Names and signatures

Parameters come in this order: `db`, `tenantId`, the ids, the values, then `now` (and `limit`). Every exported function has an explicit return type.

| Kind | Name | Returns |
|---|---|---|
| One record by key | `findX(db, tenantId, id)` | `Promise<XRow \| undefined>` |
| Records by ids (unknown and other cafes' left out) | `findXs(db, tenantId, ids)` | `Promise<XRow[]>` |
| A cafe's list, filtered or paged | `listX(db, tenantId, query)` | `Promise<XRow[]>` or `Promise<{ rows: XRow[], total: number }>` |
| Children of one or more parents | `xOf(db, tenantId, parentIds)` (`valuesOf`, `linesOf`) | `Promise<XRow[]>` or a `Map` by parent id |
| A count, or counts per key | `countX(db, tenantId, …)` | `Promise<number>` or `Promise<Map<string, number>>` |
| Whether something exists | `hasX(db, tenantId, …)` | `Promise<boolean>` |
| A computed value | `nextX`, `currentX` (`nextSortOrder`, `currentRate`) | the value |
| Work due for a task, across cafes | `dueX(db, now, limit)` | `Promise<XRow[]>` |
| Guard | `requireX(db, tenantId, …)` | `Statement` or `Statement[]` |
| Write | `<verb>XStatement(s)`: `insert`, `update`, `touch` (version bump), `replace`, `upsert`, `delete` | `Statement` or `Statement[]` |
| Background-task write | `claimX`, `markX`, `settleX`, `deleteXBefore` | `Promise<boolean>` (applied) or `Promise<number>` (rows) |

A guard is a statement, but its name says what it checks, so it has no `Statement` suffix. Two repositories never hold the same query under two names: a feature that needs another's data asks that feature's `index.ts`.

## The tenant rule

[Security → Roles and permissions](./security.md#roles-and-permissions) requires every query on a cafe's data to name the cafe. In a repository that means:

- **A function that reads or writes a cafe's table takes `tenantId` and filters that table's own `tenant_id`**, even when it also filters by a parent id the service has already checked (`valuesOf(db, tenantId, setIds)`, not `valuesOf(db, setIds)`). Every cafe table has a `(tenant_id, id)` unique key, so the extra condition costs nothing. A parent check in the service is the first line; this is the second, and it is what the two-cafe tests prove.
- **A joined cafe table** is reached through a composite foreign key or an explicit `eq(a.tenantId, b.tenantId)` in the join.
- **A function that works across cafes on purpose** says so in its doc comment, starting with "Across cafes:". This is allowed for scheduled tasks (`dueX`, `claimX`, cleanup), webhooks that only know a code or a provider's id (`findLinkByCode`), the platform console (D186) and an account's own rows (`memberTenants`). Such a function never takes an optional `tenantId`: write two functions.
- **Every new function on a cafe table gets a two-cafe test** through its service: seed two cafes, check the other cafe's rows are neither read nor changed, then remove the tenant filter and see the test fail.

## Other features' tables

A repository writes only its own feature's tables ([architecture rule 2](./architecture.md#rules)). Several repositories today also **read** other features' tables through `server/db/tables.ts`: `user.name` for who did something, and `branches` for a branch's name, timezone or status. **Open (audit R7):** whether such read-only joins stay allowed or move behind the owner's `index.ts` is the owner's decision. Until it is made, don't add a new kind of cross-feature join; existing ones stay as they are.

## Reads

```ts
const valueColumns = {
  id: menuOptionValues.id,
  setId: menuOptionValues.setId,
  name: menuOptionValues.name,
  sortOrder: menuOptionValues.sortOrder,
  status: menuOptionValues.status,
}

export async function findValue(db: Db, tenantId: string, setId: string, valueId: string): Promise<OptionValueRow | undefined> {
  const [row] = await db
    .select(valueColumns)
    .from(menuOptionValues)
    .where(and(
      eq(menuOptionValues.tenantId, tenantId),
      eq(menuOptionValues.setId, setId),
      eq(menuOptionValues.id, valueId),
    ))
    .limit(1)
  return row
}

/** The values of these sets, each set's in order. */
export async function valuesOf(db: Db, tenantId: string, setIds: string[]): Promise<OptionValueRow[]> {
  if (!setIds.length) return []
  return readInChunks(setIds, ids => db
    .select(valueColumns)
    .from(menuOptionValues)
    .where(and(eq(menuOptionValues.tenantId, tenantId), inArray(menuOptionValues.setId, ids)))
    .orderBy(asc(menuOptionValues.setId), asc(menuOptionValues.sortOrder), asc(menuOptionValues.name)))
}
```

- **Select named columns.** Each aggregate has one column list (`xColumns`) and one row type, used by every read of it. A row type is an `interface`, or `typeof table.$inferSelect` (narrowed with `Pick`) when it is the whole row. `db.select()` without columns is only for rows a background task uses whole and never returns to a route.
- **Let the return type check the row.** Don't annotate the result (`const rows: XRow[] = await …`) and never cast it (`as Promise<XRow[]>`). A cast hides a column that no longer matches. If the inferred type is wrong, fix the column (`$type<…>()` in the schema, `.mapWith()` on an `sql` value).
- **One row:** `const [row] = await ….limit(1)` and `return row`.
- **No query in a loop.** Children of many parents come from one `xOf(db, tenantId, parentIds)` read, grouped in the service or into a `Map` in the repository.
- **Several reads for one answer go in one `db.batch([...])`**, not `Promise.all` and never one `await` after another. On D1 a batch is one round trip and one consistent snapshot ([`catalogRows`](../../server/features/menu/catalog.repository.ts), [`counterQueueRows`](../../server/features/orders/orders.repository.ts)). This includes a page and its total:

  ```ts
  const [rows, [counted]] = await db.batch([
    db.select(itemColumns)
      .from(menuItems)
      .where(where)
      .orderBy(asc(menuItems.sortOrder), asc(menuItems.id))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db.select({ total: count() }).from(menuItems).where(where),
  ])
  return { rows, total: counted?.total ?? 0 }
  ```

  Columns read in a batch need unique SQL names (D170). `readInChunks` reads stay as they are: their pieces already run at once.
- **Order in SQL**, and always end with a unique column (`id`) so pages never overlap. `readInChunks` keeps the order only inside each piece: sort the joined rows afterwards, or group them by the id you passed.
- **Filter in SQL.** Never load a table and filter it in JavaScript.
- **Name the index** a list or task query depends on in its doc comment (`Uses orders_branch_date_idx`), and check new list queries with `EXPLAIN QUERY PLAN` against the test database.

## Conditions

- **Use the builder's operators** (`eq`, `ne`, `lt`, `lte`, `gt`, `gte`, `isNull`, `isNotNull`, `inArray`, `notInArray`, `between`, `and`, `or`, `not`, `exists`, `notExists`) and the aggregate helpers (`count()`, `max()`, `min()`, `sum()`). They encode values the way the column stores them.
- **Use `sql` only for what the builder lacks:** `case`, `coalesce`, `json_each` and `json_extract`, `changes()`, `lower()` or `collate nocase` in an order, and searches through `containsText` (D183). Inside `sql`, every column and table is an interpolation (`${menuItems.status}`), never a written name such as `c.tenant_id`. For a table joined to itself, use `alias(table, 'name')` from `drizzle-orm/sqlite-core`.
- **Never write a time as a number** (`${now.getTime()}`). Compare the column with an operator (`gt(table.expiresAt, now)`), which encodes it as the column's `timestamp_ms`.
- **A rule written twice is defined once.** A condition used by more than one query is a named constant or function next to the column lists (`const unclaimed = (now: Date) => …`). A condition that several features share, such as "an owner who can sign in", lives with the table's owner and is exported through its `index.ts`.
- **One condition per line** when an `and(...)` has three or more conditions or doesn't fit on one line.

## Guards

A guard is a statement in a batch that aborts the whole batch unless a check still holds ([architecture → Atomic writes](./architecture.md#atomic-writes)): `requireOneChange(db)` after a conditional update, and `requireCount`, `requireAtMost` for set checks.

- **A guard reuses the conditions its reads use**, so the read and the guard can't disagree. **(step 2)** `server/utils/batch.ts` gets a guard that takes a query built with the builder (`db.select({ n: count() }).from(table).where(condition)`), and the `sql\`select count(*) …\`` strings move to it. Until then, a new guard interpolates the same named condition into its `sql` instead of writing the predicate again.
- **A guard over a list** splits it with `chunk(ids)`, one guard per piece, like any other statement over a list.
- **Its doc comment** says what aborts it, and the write it protects says "Follow it with `requireOneChange`".

## Writes

- **A write returns its statement(s)** for the service's `runBatch` (with the guards, audit and idempotency key in the same batch). A repository never calls `db.batch` or `runBatch` for a write.
- **An edit is conditional on the version read:** `where(and(eq(t.tenantId, tenantId), eq(t.id, id), eq(t.version, version)))` and `set({ version: sql\`${t.version} + 1\` })`, then `requireOneChange` in the service. Add the current state to the condition when the edit is only valid from it (`eq(t.status, 'active')`).
- **Lists:** multi-row inserts use `insertPieces(table, rows)`; `IN` lists in updates, deletes and guards use `chunk(ids)`.
- **A replace** (`replaceXStatements`) deletes the cafe's rows of that parent and inserts the new ones, all as statements of the same batch.
- **Upserts** name their conflict target and set only what changes (`onConflictDoUpdate({ target, set, setWhere })`).
- **Never delete** orders, their lines and events, payments, ledgers or audit rows. Cleanup of other history deletes a bounded set: `inArray(t.id, db.select({ id: t.id }).from(t).where(…).orderBy(…).limit(limit))`.
- **Values the database computes** (a pickup number, a counter) are computed in the same statement (`insertOrderStatement`), never read first and written after.

### Background-task writes

The one exception: a scheduled task or a delivery run may execute a **single conditional statement** in the repository and learn whether it applied: claiming due work (`claimMessage`), settling it with the claim's token (`markSent`, `markRetry`, `markFailed`), taking a lock (`claimRun`), or deleting a bounded batch of old rows (`deleteXBefore`). Such a function:

- is one `update`, `insert … on conflict` or `delete` with all of its conditions in the `where`, and `returning` the key;
- returns `boolean` (it applied) or `number` (rows changed);
- never runs a batch or a second statement. When it needs two statements, it returns them and the task's service runs the batch.

**(step 2)** The four queues that claim work with a token (outbox, marketing posts, notification deliveries, order-ready alerts) get one shared shape for these functions.

## D1 limits

They are in [architecture → Atomic writes](./architecture.md#atomic-writes): 100 bound parameters per statement (D62), unique column names in batch reads (D170), no `like` patterns over 50 bytes (D183). For a repository that means: a list of ids goes through `readInChunks`, `insertPieces` or `chunk`. An `inArray` without them is allowed only when a contract bounds the list well under 90 items, and the comment names that bound (`At most MAX_ITEM_MODIFIER_GROUPS (10) groups`).

## Tests

Repositories are tested through their services ([architecture → Tests](./architecture.md#tests)):

- the two-cafe test for every function on a cafe table ([The tenant rule](#the-tenant-rule));
- a stale-version or race case for every conditional write, and the guard removed to see it fail;
- a case in `server/tests/d1-limits.test.ts` for every new list at the contract's largest size;
- a case in `server/tests/d1-search.test.ts` (real D1) for every new search and every new batch read that joins tables.

## Checklist for a repository change

- [ ] Query builder only; no relational queries and no raw statements.
- [ ] Names, parameter order and explicit return types as in the table above.
- [ ] Every function on a cafe table filters the table's own `tenant_id`, or says "Across cafes:" and is one of the allowed kinds.
- [ ] Writes only to the feature's own tables; no new kind of cross-feature join while R7 is open.
- [ ] Named columns, no casts, no annotation of results, one row with `[row]` and `limit(1)`.
- [ ] Several reads for one answer in one `db.batch`; no query in a loop; filtering and ordering in SQL.
- [ ] Builder operators; `sql` only for what they lack, with interpolated columns and no written times.
- [ ] No condition written twice; guards reuse the reads' conditions.
- [ ] Writes return statements; the only executed writes are single conditional background-task statements.
- [ ] Every list chunked, or bounded by a contract the comment names.
- [ ] Two-cafe, stale-version, D1-limit and real-D1 tests where they apply.
