# Repository audit — 20 October 2026

Reviewed revision `0f8a81e` (main). Scope: the 25 `server/features/*/*.repository.ts` files (4,465 lines), the schemas' indexes, Better Auth's indexes in the migrations, and the callers of every unbounded-looking list. Application code is unchanged. Measured against the [repository standard](../server/repositories.md) (D194), which this audit led to.

This is a source review. No query plan was measured on D1 and no finding was reproduced with a probe; the performance items are about round trips and duplicated work, not measured latency.

## What is already right

- **Layer boundaries hold.** No service, route or other server file imports `drizzle-orm` or calls `db.select/insert/update/delete`, except `api/health.get.ts` (`select 1`) and the shared utils. No repository imports another feature's schema file directly.
- **Indexes cover the queries.** Every cafe table has a `(tenant_id, id)` unique key, so a cafe's lists use an index. No missing index was found besides the known account-search scan (D183).
- **D1's limits are handled.** Growing lists go through `readInChunks`, `insertPieces` and `chunk`. The unchunked `inArray` lists that remain are all bounded by a contract or a page size well under 90 (staff branches 50, marketing channels 10, option sets 2, add-on groups 10, option values 2 × 20).
- **Good patterns to copy:** one-round-trip batch reads (`catalogRows`, `counterQueueRows`), named column lists (`options`, `modifiers`, `promotions`), named conditions (`unclaimed`, `ownsClaim`, `grantActive`), conditional writes followed by `requireOneChange`.

## Priorities

P1: next clean-up PRs, because a standard rule is broken. P2: the same PRs where the file is touched anyway. P3: watch.

| ID | Priority | Finding |
|---|---|---|
| R1 | P1 | About 70 functions on cafe tables don't filter the table's `tenant_id` |
| R2 | P1 | Raw SQL with written column names |
| R3 | P1 | Guards are SQL strings that repeat their reads' conditions; times encoded by hand |
| R4 | P1 | Repositories that run their own batch |
| R5 | P2 | Reads that wait on each other, or could share one round trip |
| R6 | P2 | The same query or condition in several places |
| R7 | P2 | Other features' tables read directly |
| R8 | P2 | Results typed three different ways; ten casts |
| R9 | P2 | Names and operators used inconsistently |
| R10 | P3 | Work that grows with the cafe's whole menu |

## Findings

### R1. Queries on cafe tables that don't name the cafe

These filter only by a parent id (set, group, item, category, rule, branch, order). The service checks the parent first, and the ids are UUIDs, so no cross-cafe read or write was found. But [security](../server/security.md#roles-and-permissions) requires every query on cafe data to name the cafe, and this is the layer the two-cafe tests are meant to prove.

| File | Functions |
|---|---|
| [options](../../server/features/menu/options.repository.ts) | `valuesOf`, `findValue`, `nextValueOrder`, `updateValueStatement`, `requireActiveValueCount` |
| [modifiers](../../server/features/menu/modifiers.repository.ts) | `modifiersOf`, `findModifier`, `nextModifierOrder`, `updateModifierStatement`, `requireSelectionRules` |
| [categories](../../server/features/menu/categories.repository.ts) | `countChildren`, `countListedItems`, `requireNoItems`, `requireNoChildren`, `archiveChildrenStatement`, `restoreChildrenStatement` |
| [items](../../server/features/menu/items.repository.ts) | `itemSetIds`, `variationsOf`, `countChildCategories`, `nextItemOrder`, `countSellable`, `itemCountsBySet`, `itemGroups`, `itemModifierPrices`, `itemCountsByGroup`, `requireSellable`, the deletes in `replaceOptionSetsStatements` and `replaceModifierGroupsStatements`, `updateVariationStatement`, `retireVariationsStatements` |
| [availability](../../server/features/menu/availability.repository.ts) | `windowsOf`, `usageCounts`, `itemRules`, `categoryRules`, `requireRuleUnused`, the deletes in the three `replace…Statements` |
| [soldout](../../server/features/menu/soldout.repository.ts) | `listSoldOut`, `labels`, `markOnSaleStatements`, `soldOutIds` |
| [branches](../../server/features/branches/branches.repository.ts) | `hoursOf`, `listTables`, `findTable`, `countTables`, `touchTableStatement` |
| [orders](../../server/features/orders/orders.repository.ts) | `findFinishedOrders`, `itemCounts`, `cancelEventOf`, `linesOf`, `linesOfOrders`, `transitionStatement`, `returnPaymentStatement`, `paymentsOf` |
| [reports](../../server/features/orders/reports.repository.ts) | `paidSalesTotal`, `refundsReturned`, `itemTotals`, `ordersPlaced`, `cancelledUnpaid`, `currentCounts`, `eventsOf`, `returnedByName` |
| others | khqr `findOpenCharge`; media `variantKeys`; notifications `setRule`, `removeRule`, `requeueFailed`, `sentStatement` |

These work across cafes on purpose and only need the "Across cafes:" comment: the `due…`, `claim…` and cleanup functions, `findLinkByCode` and `findOrderReadyAlertByCode`, `markRemoved`, `markBlocked`, `moveChat`, `chatConnectedAnywhere`, `channelConnectedAnywhere`, `findExpiredUnpaid`, `moveOrdersStatement` (D156), the platform console's reads (accounts, tenants, counts per cafe), and identity's reads of an account's own memberships. `bakongTokenExpiries(db, tenantId?)` takes an optional cafe and should become two functions.

**Fix:** add `tenantId` and the filter (free: the `(tenant_id, id)` keys). Each PR adds two-cafe tests for the functions it changes, with the filter removed to see them fail.

### R2. Raw SQL with written column names

A renamed column still compiles here and fails only at runtime.

- [media.repository.ts:118](../../server/features/media/media.repository.ts#L118) `deleteIfStillExpired`: `media_assets root … root.tenant_id … root.state_changed_at`.
- [items.repository.ts:241](../../server/features/menu/items.repository.ts#L241) `requireLeafCategory`: `c.tenant_id`, `c.status`, `s.parent_id`.
- [availability.repository.ts:102](../../server/features/menu/availability.repository.ts#L102) `requireRuleUnused`: `l.item_id`, `i.status`, `l.category_id`, `c.status`.

**Fix:** `alias(table, 'name')` from `drizzle-orm/sqlite-core` and interpolated columns, or the builder's `exists()`.

### R3. Guards written as SQL strings

All 21 `requireCount` and `requireAtMost` guards are `sql` strings, and several restate a condition their file already has: `requireNoActiveGrant` and `requireGrantActive` repeat `grantActive`; `requireActiveSiblingCount` repeats `parentIs`; `requireAnOwnerStatement` repeats `countOwners`. Ten conditions compare a time as `${now.getTime()}` (support ×2, notifications ×2, orders ×2, marketing, media, reports, tenants), which is right only because every timestamp column is `timestamp_ms`; `status <> 'archived'` is also written by hand in several.

**Fix (step 2):** a guard in `server/utils/batch.ts` that takes a builder query, so guards reuse the named conditions and the operators encode times.

### R4. Repositories that run their own batch

`media.deleteIfStillExpired` and `media.deleteAsset` call `db.batch`; `notifications.markDelivered` runs a batch with a guard and catches `isStaleWrite`. The service is meant to own every batch. Besides these, 42 writes are executed in repositories against 120 that return statements; most are background-task claims and settles, which the standard now allows when they are one conditional statement. The rest move to statements: `media.planObjects` (a loop of awaited inserts), `media.deletedObject`, `media.retryObjectDeletion`, `notifications.setRule`, `removeRule`, `moveChat`, `saveOrderReadyLink`, `sample-data.releaseRun`, `assistant.finishUsage`, `khqr.insertCharge`.

### R5. Round trips

On D1 each query is a request; a `db.batch` of reads is one request and one snapshot.

- **One after another:** `items.setsWithValues` and `items.groupsWithModifiers` (two reads each, awaited in turn), `media.planObjects` (an insert per 25 keys, awaited in turn).
- **At once but separate (`Promise.all`):** every page with its total (`accounts.listAccounts`, `tenants.listTenants`, `staff.listStaff`, `items.listItems`, `reports.orderHistory`, `orders.findCustomerOrdersPast`, `platform.listAuditEvents`), `reset.countMenuData` (5), `promotions.linksOf` (3), `promotions.targetIdsOf` (2), `availability.usageCounts` (2). The gain is fewer requests and one snapshot, not the sum of latencies.
- **Done in JavaScript:** `identity.findActiveTenants` loads every cafe and filters by status in code.
- **Extra join:** `reports.orderHistory`'s count always joins `counter_payments`, even without a payment filter.

### R6. Duplicates

| Same thing | Where |
|---|---|
| Cafe by address | `identity.findTenantBySlug`, `tenants.findTenantBySlug` |
| Oldest cafe | `identity.findCurrentTenant`, `tenants.findOldestTenant` |
| Cafe by id | `identity.findTenantById`, `tenants.findTenant` |
| "Active cafe" | JS filter (`identity.findActiveTenants`), `or(eq, isNull)` (`identity.findActiveTenantPage`), `coalesce` (`tenants.statusIs`) |
| Account's role in a cafe | `identity.findTenantRole`, `staff.tenantRoleOf` |
| Active branches by name | `identity.activeBranches`, `branches.listActiveBranches`, `reports.activeBranches` |
| A cafe's branch | `branches.findBranch`, `reports.findReportBranch` |
| A category, its children | `items.findCategory` and `countChildCategories`, `categories.findCategory` and `countChildren` |
| An owner who can sign in | `staff.activeOwners`, `staff.countOwners`, `accounts.activeOwnerCounts`, `tenants.noActiveOwner`; `coalesce(user.banned, 0) = 0` about 8 times; a registered account (`coalesce(is_anonymous, 0) = 0`) in `accounts.registered` and `staff.eligibleAccount` |
| A claimable queue (claim with a token, then sent, retry or failed) | `platform` outbox, `marketing` posts, `notifications` deliveries and order-ready alerts |
| Single-use link codes (insert, find, by code, advance, cancel, delete old) | `marketing` and `notifications`, line for line |

### R7. Other features' tables

[Architecture rule 2](../server/architecture.md#rules) says only a feature's repository touches its tables. `server/db/tables.ts` exports the Better Auth tables, `auditEvents`, `branches` and `branchStaff` for explicit imports, and documents only identity's reads of the branch tables (D134). In practice:

- `reports`, `orders` and `menu/promotions` read `branches` directly (name, timezone, status).
- Six repositories (soldout, khqr, orders, reports, marketing, notifications) join `user` for a display name (`updatedByName`, `connectedByName`, `customerName`).
- `identity`, `tenants` and `staff` all write or read `organization`, `member` and `user`.

No write to another feature's table was found outside identity's documented ownership. **Owner decision needed:** either allow read-only joins for a display name or a branch's scope through `tables.ts` (and write that into architecture), or move them behind the owners' `index.ts`. The standard leaves this open.

### R8. How results are typed

Three ways: an annotation on the result (most files), `as Promise<…>` (10 casts: `platform.listAuditEvents` ×2, `accounts.listAccounts` ×2, `tenants.listTenants` ×2, `staff.listStaff` ×2, `items.listItems` ×2), and no return type at all (about 15 functions, such as `identity.findActiveTenantPage`, `findTenantById`; media's `planObjects`, `dueObjectDeletions`, `deletedObject`, `retryObjectDeletion`; notifications' `listRules`, `targetsOf`, `findDelivery`, `recentDeliveries`, `findDestinationByChat`; orders' `linesOf`, `linesOfOrders`, `counterQueueRows`, `counterContext`; `reports.eventsOf`; `marketing.claimPost`). Full-row `select()` is used for rows that leave the repository in `support`, `marketing`, `notifications` and `media`.

### R9. Names and operators

- **One row:** `.limit(1)` and `rows[0]`, or `const [row] =` with no limit (khqr, marketing, notifications, reports).
- **Count:** `count()` or `` sql<number>`count(*)` `` (orders ×3).
- **Same operator two ways:** `ne(x, 'archived')` and `` sql`x <> 'archived'` ``; `isNotNull` and `` sql`is not null` ``; `desc()` and `` sql`… desc` ``; `lte` and `` sql`<=` `` (reports `placedIn`, promotions `runningPromotions`).
- **Names:** reads as `labels`, `identities`, `allRules`, `allWindows`, `staffBranches`, `memberTenants`, `soldOutIds` beside `find…` and `list…`; guards as `requireX`, `requireXStatement` (staff) or `unpaidAtMostStatement` (orders); executed writes as `markRemoved`, `setRule`, `cancelLink`, `insertRun`, `insertCharge`.
- **Header comments:** "All SQL of X (docs/server/architecture.md → Repository)" in several files, nothing in others. [orders.repository.ts:362-363](../../server/features/orders/orders.repository.ts#L362-L363) has two doc comments on one function.
- **Formatting:** many query chains on one line of 150–330 characters (for example [platform.repository.ts:76](../../server/features/platform/platform.repository.ts#L76) and [:101](../../server/features/platform/platform.repository.ts#L101)).

### R10. Watch

`items.listItems` totals the sellable prices of every variation in the cafe for each page, then joins the page (D170 already scoped it to the cafe). Fine at today's menu sizes; scope it to the page's items if a cafe's menu grows into thousands of variations.

## Out of scope

`identity.currentTenant` falls back to the oldest cafe for work with no cafe in its path (a sign-up's first customer profile, server errors, Bakong reminders; D140). That is tenancy policy, not repository style; nothing here changes it.

## Clean-up plan

One PR per step, each with `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, and the feature's e2e files when a response could change. Behavior and responses stay the same; only R1's added filters change what a wrong id from another cafe would reach (nothing, as before, now proven by tests).

1. **Standard (this PR):** [repositories.md](../server/repositories.md), D194, this audit.
2. **Shared helpers:** the builder guard (R3); shared conditions exported by their owners (an owner who can sign in, an active cafe, a registered account) (R6); one shape for claimable queues and for link codes (R6); the owner's answer on R7.
3. **Menu:** options, modifiers, categories, items, availability, soldout, promotions, reset, catalog (R1, R2, R3, R5, R6, R8, R9).
4. **Orders:** orders, reports, khqr (R1, R3, R5, R6, R9).
5. **Identity and cafes:** identity, accounts, staff, tenants, branches, customers (R1, R5, R6, R8, R9).
6. **Messages:** notifications, marketing (R1, R3, R4, R6, R8).
7. **The rest:** platform, media, support, assistant, sample-data (R2, R3, R4, R5, R8, R9).
