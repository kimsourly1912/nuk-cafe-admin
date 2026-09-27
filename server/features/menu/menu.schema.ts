import { sql } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { newId } from '../../utils/ids'

/**
 * The menu (docs/server/data-model.md → Menu, D44). Step 3.1: categories. Options, add-ons, items
 * and availability join in steps 3.3 to 3.7. Registered with NuxtHub through the
 * `hub:db:schema:extend` hook; column names are snake_case in SQL.
 */

const nowMs = sql`(cast(unixepoch('subsecond') * 1000 as integer))`
const instant = () => integer({ mode: 'timestamp_ms' })

export const CATEGORY_STATUSES = ['active', 'archived'] as const

/**
 * A two-level tree: top-level categories (`parentId` null) and their sub-categories. A category
 * holds either sub-categories or items, never both (items join in step 3.5). Sort order is per
 * parent. Archived, never deleted.
 */
export const menuCategories = sqliteTable('menu_categories', {
  id: text().primaryKey().$defaultFn(() => newId()),
  parentId: text().references((): AnySQLiteColumn => menuCategories.id, { onDelete: 'restrict' }),
  name: text().notNull(),
  description: text().notNull().default(''),
  sortOrder: integer().notNull().default(0),
  status: text({ enum: CATEGORY_STATUSES }).notNull().default('active'),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_categories_status_check', sql`${t.status} in ('active', 'archived')`),
  index('menu_categories_parent_sort_idx').on(t.parentId, t.sortOrder),
  // Two active siblings never share a name (case-insensitive), even when two saves race. Archived
  // categories don't count, so a name can be reused after archiving. Two indexes because a unique
  // index treats NULL parents as all different, and drizzle-kit splits an expression at its commas
  // (so no `coalesce(parent_id, '')`).
  uniqueIndex('menu_categories_top_name_idx')
    .on(sql`lower(${t.name})`)
    .where(sql`${t.parentId} is null and ${t.status} = 'active'`),
  uniqueIndex('menu_categories_sub_name_idx')
    .on(t.parentId, sql`lower(${t.name})`)
    .where(sql`${t.parentId} is not null and ${t.status} = 'active'`),
])
