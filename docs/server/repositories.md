# Repository standard

How a feature's `*.repository.ts` is written: the query API, names, the tenant rule, reads, conditions, guards, writes and tests. It refines [architecture → Features](./architecture.md#features) (what a repository is for) and [architecture → Atomic writes](./architecture.md#atomic-writes) (batches and D1's limits); those rules still apply.

**Status (D194, 2026-10-20):** new and changed repository code follows this page. The existing repositories don't yet; the [repository audit](../reviews/repository-audit-2026-10-20.md) lists every gap and the order of the clean-up steps. The [shared helpers](#shared-helpers) exist (step 2, 2026-10-20). A rule marked with a later step (**(step 6)**) waits for that step; until then, follow the nearest existing pattern.

**Official documentation first.** Before using a Drizzle, NuxtHub or D1 API, read its current official page ([Drizzle](https://orm.drizzle.team/docs/overview), [NuxtHub database](https://hub.nuxt.com/docs/database/query), [D1](https://developers.cloudflare.com/d1/)) and check the installed version's types: the docs can describe a newer release, and they don't always say which dialect a feature supports (`db.$count` exists for SQLite in 0.45, but isn't a batch item). Prefer the documented API to a helper of our own; cite the page in the decision or PR that introduces the use.

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

Answered by the owner on 2026-10-20 (audit R7, D194). A join to another feature's table stays a join: one query, one D1 round trip, one snapshot, and it can sort, filter and guard in SQL. Calling the owner's service for names would cost a second request and a merge in JavaScript on every read. So:

1. **Writes only by the owner.** A repository inserts, updates and deletes only its own feature's tables. One documented exception: identity's staff management writes `branch_staff` together with the account's `member` rows and sessions in one batch ([security → Staff onboarding](./security.md#staff-onboarding)).
2. **Read-only joins on this list only**, imported from `server/db/tables.ts` (never from another feature's `*.schema.ts`):

   | Table | Owner (writes) | Columns another feature may read | For |
   |---|---|---|---|
   | `user` | identity (and Better Auth) | `id`, `name` | who did something (`updatedByName`, `customerName`) |
   | `branches` | branches | `id`, `tenantId`, `name`, `timezone`, `status` | a branch's scope, clock and label |
   | `organization` | tenants (and Better Auth) | `id`, `slug`, `name`, `status` | resolving a cafe (a table's QR code) |

   No other column, so personal data (`email`, `banned`, `role`) stays with identity. Join `user` with `leftJoin` when the reference can be null, so a missing account reads as `null`. Identity also reads `branches` and `branch_staff` for access checks (D134).
3. **Meaning comes from the owner.** A condition with business meaning (an active branch, an owner who can sign in, an active cafe) is imported from the owner's `index.ts`, never written again in the joining repository.
4. **Anything else goes through the owner's `index.ts`:** another feature's business tables, and any column not listed.

ESLint's feature-boundary rule (`eslint.config.mjs`) refuses a repository's import of another feature's `*.schema` file, so `tables.ts` is the only way in. The column list is checked in review ([checklist](#checklist-for-a-repository-change)).

## Reads

```ts
const valueColumns = {
  id: menuOptionValues.id,
  setId: menuOptionValues.setId,
  name: menuOptionValues.name,
  sortOrder: menuOptionValues.sortOrder,
  status: menuOptionValues.status,
}

export function findValue(db: Db, tenantId: string, setId: string, valueId: string): Promise<OptionValueRow | undefined> {
  return firstRow(db
    .select(valueColumns)
    .from(menuOptionValues)
    .where(inTenant(menuOptionValues, tenantId, eq(menuOptionValues.setId, setId), eq(menuOptionValues.id, valueId))))
}

/** The values of these sets, each set's in order (`readInChunks` runs no query for none). */
export function valuesOf(db: Db, tenantId: string, setIds: string[]): Promise<OptionValueRow[]> {
  return readInChunks(setIds, ids => db
    .select(valueColumns)
    .from(menuOptionValues)
    .where(inTenant(menuOptionValues, tenantId, inArray(menuOptionValues.setId, ids)))
    .orderBy(asc(menuOptionValues.setId), asc(menuOptionValues.sortOrder), asc(menuOptionValues.name)))
}
```

- **Select named columns.** Each aggregate has one column list (`xColumns`) and one row type, used by every read of it. A row type is an `interface`, or `typeof table.$inferSelect` (narrowed with `Pick`) when it is the whole row. `db.select()` without columns is only for rows a background task uses whole and never returns to a route.
- **Let the return type check the row.** Don't annotate the result (`const rows: XRow[] = await …`) and never cast it (`as Promise<XRow[]>`). A cast hides a column that no longer matches. If the inferred type is wrong, fix the column (`$type<…>()` in the schema, `.mapWith()` on an `sql` value).
- **One row:** `firstRow(query)`. **A list by ids:** `readInChunks`, without an `if (!ids.length) return []` before it (it runs no query for no ids).
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

  A page and its total use `readPage(db, rows, total, query)`, which does exactly this ([Shared helpers](#shared-helpers)). Columns read in a batch need unique SQL names (D170). `readInChunks` reads stay as they are: their pieces already run at once.
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

- **A guard counts with Drizzle's [`db.$count(table, condition)`](https://orm.drizzle.team/docs/query-utils#count)**, which is an `SQL<number>` subquery, so it goes straight into `requireCount` and `requireAtMost`. The guard then reuses the named conditions its reads use, and the operators encode times, so the read and the guard can't disagree. Not `sql\`select count(*) from …\`` strings.

  ```ts
  /** Aborts unless the set has between 1 and `maxValues` active values (run it after the change). */
  export function requireActiveValueCount(db: Db, tenantId: string, setId: string, maxValues: number): Statement {
    const active = and(eq(menuOptionValues.tenantId, tenantId), eq(menuOptionValues.setId, setId), eq(menuOptionValues.status, 'active'))
    return requireCount(db, sql`${db.$count(menuOptionValues, active)} between 1 and ${maxValues}`, 1)
  }

  // the simple case: exactly `n` rows match
  requireCount(db, db.$count(menuItems, and(eq(menuItems.tenantId, tenantId), eq(menuItems.categoryId, categoryId), ne(menuItems.status, 'archived'))), n)
  ```
- **A guard over a list** splits it with `chunk(ids)`, one guard per piece, like any other statement over a list.
- **Its doc comment** says what aborts it, and the write it protects says "Follow it with `requireOneChange`".

## Writes

- **A write returns its statement(s)** for the service's `runBatch` (with the guards, audit and idempotency key in the same batch). A repository never calls `db.batch` or `runBatch` for a write.
- **An edit is conditional on the version read:** `updateAtVersion(db, table, { tenantId, id, version }, set, extra?)`, then `requireOneChange` in the service. Pass the current state as `extra` when the edit is only valid from it (`eq(t.status, 'active')`).
- **Lists:** multi-row inserts use `insertAll(db, table, rows)`; `IN` lists in updates, deletes and guards use `chunk(ids)`.
- **A replace** (`replaceXStatements`) is `replaceAll(db, table, inTenant(table, tenantId, eq(table.parentId, parentId)), rows)`: the cafe's rows of that parent go and the new ones come, in the same batch.
- **Upserts** name their conflict target and set only what changes (`onConflictDoUpdate({ target, set, setWhere })`).
- **Never delete** orders, their lines and events, payments, ledgers or audit rows. Cleanup of other history deletes a bounded set with `deleteOldest(db, table, key, where, orderBy, limit)` (a [background-task write](#background-task-writes)).
- **Values the database computes** (a pickup number, a counter) are computed in the same statement (`insertOrderStatement`), never read first and written after.

### Background-task writes

The one exception: a scheduled task or a delivery run may execute a **single conditional statement** in the repository and learn whether it applied: claiming due work (`claimMessage`), settling it with the claim's token (`markSent`, `markRetry`, `markFailed`), taking a lock (`claimRun`), or deleting a bounded batch of old rows (`deleteXBefore`). Such a function:

- is one `update`, `insert … on conflict` or `delete` with all of its conditions in the `where`, and `returning` the key;
- returns `boolean` (it applied) or `number` (rows changed);
- never runs a batch or a second statement. When it needs two statements, it returns them and the task's service runs the batch.

**(step 6)** The four queues that claim work with a token (outbox, marketing posts, notification deliveries, order-ready alerts) get one shared shape for these functions, built with the messages clean-up, where three of them live.

## Shared helpers

Repositories are built from **small typed building blocks**, not from a generic repository. There is no `BaseRepository`, no `findOne(table, id)` / `create(table, values)` for any table, and no filter language that turns query parameters into `where` clauses. Those would make the tenant, version and status conditions optional per call (audit R1), lose the result types and bring back casts (R8), run writes outside the service's batch, and let a client filter on columns nobody chose. Drizzle already is the generic layer; a helper only names a shape that repositories repeat.

**When a helper is made:** a query shape repeated in two or more features becomes a helper, in the narrowest shared place that every user can import (the same rule as [app architecture](../guides/app-architecture.md)). A shape that only one feature uses stays a named constant or function in that feature. A rule that belongs to a feature's data ("an owner who can sign in", "an active cafe") is a condition exported by that feature's `index.ts`, not a util.

| Where | What goes there |
|---|---|
| `server/utils/query.ts` | Conditions and reads for repositories |
| `server/utils/batch.ts` | Statements, guards and D1 limits |
| `shared/utils/` | Pure helpers the app also uses (no Vue, no Nitro: [Nuxt's rule](https://nuxt.com/docs/4.x/directory-structure/shared)); features import them as `#shared/utils/<file>` |

Nitro auto-imports every export of `server/utils/` into routes, so a helper's name says what it does there too (`firstRow`, `readPage`, not `first`, `page`).

**Drizzle's own, used as documented:** [`db.$count(table, condition)`](https://orm.drizzle.team/docs/query-utils#count) for a count and inside guards (it isn't a batch item); [`.$dynamic()`](https://orm.drizzle.team/docs/dynamic-query-building) for a query a helper changes; [`alias`](https://orm.drizzle.team/docs/joins#aliases--selfjoins) for a self-join; `getTableColumns`.

**The building blocks** (built in step 2, 2026-10-20; tested in `server/tests/query.test.ts` on the SQLite test database, which refuses more than D1's 100 parameters, and in `server/tests/d1-search.test.ts` on real D1):

| Helper | File | Does | Replaces (uses on 2026-10-20) |
|---|---|---|---|
| `inTenant(table, tenantId, ...conditions)` | query | `and(eq(t.tenantId, tenantId), …)`, `undefined` conditions skipped; the table must have `tenantId` | starting each `where` by hand (167) |
| `byId(table, tenantId, id)`, `atVersion(table, tenantId, id, version)` | query | the cafe's row by id, and by id at a version | 34, 18 |
| `withStatus(column, status)` | query | `eq(column, status)`; none for `'all'` or no status | 5 |
| `searchIn(search, ...columns)` | query | any column contains the search (`containsText`, D183); none without a search | 5 |
| `byName(column)` | query | `asc(lower(column))`: the one case-insensitive name order (`collate nocase` goes). Add `asc(t.id)` after it | 8 |
| `firstRow(query)` | query | `T \| undefined`: adds `limit 1` | ~41 |
| `withPage(query, { page, pageSize })` | query | limit and offset on a `.$dynamic()` query, as [Drizzle's pagination guide](https://orm.drizzle.team/docs/guides/limit-offset-pagination) | 7 |
| `readPage(db, rows, total, { page, pageSize })` | query | `{ rows, total }`: the ordered `.$dynamic()` page and `select({ total: count() })` in one [`db.batch`](https://orm.drizzle.team/docs/sqlite/batch-api); `total` must be a batch item, so `$count` is refused at compile time | 7, and their 10 casts |
| `hasAny(db, table, where)` | query | `boolean` from `select 1 … limit 1` | ~10 |
| `nextPosition(db, table, column, where)` | query | `max(column) + 1`, 1 when nothing matches | 4 |
| `updateAtVersion(db, table, { tenantId, id, version }, set, extra?)` | batch | a `Statement`: the cafe's row at its version, `version + 1`; `set` is typed by the table (a wrong column or value is refused). Follow it with `requireOneChange` | 22 |
| `insertAll(db, table, rows)` | batch | `Statement[]` in pieces under D1's limit; none for no rows | 13 |
| `replaceAll(db, table, where, rows)` | batch | delete what `where` names, then `insertAll` | 7 |
| `deleteOldest(db, table, key, where, orderBy, limit)` | batch | a scheduled cleanup: at most `limit` rows, first by `orderBy`; returns how many | 5 |
| `toPage(items, query, total)`, `slicePage(rows, query)` | `shared/contracts/common.ts` | a `Page<T>` response; one page of a list held in memory | 7 hand-built pages in services |
| `groupBy(rows, key)` | `shared/utils/collections.ts` | `Map<key, rows>`, in the rows' order | 6 |

Not built: a `countBy` helper. Five of its seven uses join another table and read in chunks, which a helper over one table can't do; the remaining step, `new Map(rows.map(row => [row.key, row.n]))`, is one line. `readPage` holds the one cast of these helpers: `db.batch`'s tuple types don't pass through a generic.

```ts
const setColumns = { id: menuOptionSets.id, name: menuOptionSets.name, status: menuOptionSets.status, version: menuOptionSets.version }

export function findSet(db: Db, tenantId: string, id: string): Promise<OptionSetRow | undefined> {
  return firstRow(db.select(setColumns).from(menuOptionSets).where(byId(menuOptionSets, tenantId, id)))
}

export function listSets(db: Db, tenantId: string, query: { status?: string, page: number, pageSize: number }): Promise<{ rows: OptionSetRow[], total: number }> {
  const where = inTenant(menuOptionSets, tenantId, withStatus(menuOptionSets.status, query.status))
  return readPage(db,
    db.select(setColumns).from(menuOptionSets).where(where).orderBy(byName(menuOptionSets.name), asc(menuOptionSets.id)).$dynamic(),
    db.select({ total: count() }).from(menuOptionSets).where(where),
    query)
}

/** Renames the set if it's still at `version` and active. Follow it with `requireOneChange`. */
export function renameSetStatement(db: Db, tenantId: string, id: string, version: number, name: string, now: Date): Statement {
  return updateAtVersion(db, menuOptionSets, { tenantId, id, version }, { name, updatedAt: now }, eq(menuOptionSets.status, 'active'))
}
```

**Enforced by lint** (`eslint.config.mjs`): in a `*.repository.ts`, `no-restricted-syntax` refuses `as Promise<…>`, `db.run`/`db.all`/`db.get`/`db.values`, and `.getTime()` inside an `sql` template; the feature-boundary rule already refuses another feature's `*.schema` file ([Other features' tables](#other-features-tables)). Repositories not yet cleaned up are listed in `REPOSITORIES_TO_CLEAN` there, and each clean-up step removes its own.

## D1 limits

They are in [architecture → Atomic writes](./architecture.md#atomic-writes): 100 bound parameters per statement (D62), unique column names in batch reads (D170), no `like` patterns over 50 bytes (D183). For a repository that means: a list of ids goes through `readInChunks`, `insertPieces` or `chunk`. An `inArray` without them is allowed only when a contract bounds the list well under 90 items, and the comment names that bound (`At most MAX_ITEM_MODIFIER_GROUPS (10) groups`).

## Tests

Repositories are tested through their services ([architecture → Tests](./architecture.md#tests)):

- the two-cafe test for every function on a cafe table ([The tenant rule](#the-tenant-rule));
- a stale-version or race case for every conditional write, and the guard removed to see it fail;
- a case in `server/tests/d1-limits.test.ts` for every new list at the contract's largest size;
- a case in `server/tests/d1-search.test.ts` (real D1) for every new search and every new batch read that joins tables.

## Checklist for a repository change

- [ ] Each library API used as its current official docs describe, checked against the installed version.
- [ ] Query builder only; no relational queries and no raw statements.
- [ ] A shared helper used where one exists; a shape now repeated in a second feature made into one.
- [ ] Names, parameter order and explicit return types as in the table above.
- [ ] Every function on a cafe table filters the table's own `tenant_id`, or says "Across cafes:" and is one of the allowed kinds.
- [ ] Writes only to the feature's own tables; another feature's table only through `tables.ts`, read-only, with the listed columns, and its business conditions imported from its owner.
- [ ] Named columns, no casts, no annotation of results, one row with `[row]` and `limit(1)`.
- [ ] Several reads for one answer in one `db.batch`; no query in a loop; filtering and ordering in SQL.
- [ ] Builder operators; `sql` only for what they lack, with interpolated columns and no written times.
- [ ] No condition written twice; guards reuse the reads' conditions.
- [ ] Writes return statements; the only executed writes are single conditional background-task statements.
- [ ] Every list chunked, or bounded by a contract the comment names.
- [ ] Two-cafe, stale-version, D1-limit and real-D1 tests where they apply.
