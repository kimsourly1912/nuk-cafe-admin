import { sql } from 'drizzle-orm'
import { check, foreignKey, index, integer, primaryKey, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { newId } from '#server/utils/ids'
import { branches, tenantId } from '#server/features/branches/branches.schema'

/**
 * The menu (docs/server/data-model.md → Menu, D44): categories (3.1), options (3.3), add-ons (3.4),
 * items (3.5), add-ons on items (3.5b), sold-out per branch (3.6), availability rules (3.7). Registered
 * with NuxtHub through the `hub:db:schema:extend` hook; column names are snake_case in SQL.
 *
 * Every table belongs to a tenant (D134, D136): each row carries `tenant_id`, and every link between
 * menu rows is a composite foreign key `(tenant_id, x_id) → x(tenant_id, id)`, so the database
 * refuses a link into another tenant's menu even if a query forgot its filter.
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
  tenantId: tenantId(),
  parentId: text(),
  name: text().notNull(),
  description: text().notNull().default(''),
  sortOrder: integer().notNull().default(0),
  status: text({ enum: CATEGORY_STATUSES }).notNull().default('active'),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_categories_status_check', sql`${t.status} in ('active', 'archived')`),
  unique('menu_categories_tenant_id_unique').on(t.tenantId, t.id),
  foreignKey({ name: 'menu_categories_parent_fk', columns: [t.tenantId, t.parentId], foreignColumns: [t.tenantId, t.id] }).onDelete('restrict'),
  index('menu_categories_parent_sort_idx').on(t.parentId, t.sortOrder),
  // Two active siblings never share a name (case-insensitive), even when two saves race. Archived
  // categories don't count, so a name can be reused after archiving. Two indexes because a unique
  // index treats NULL parents as all different, and drizzle-kit splits an expression at its commas
  // (so no `coalesce(parent_id, '')`).
  uniqueIndex('menu_categories_top_name_idx')
    .on(t.tenantId, sql`lower(${t.name})`)
    .where(sql`${t.parentId} is null and ${t.status} = 'active'`),
  uniqueIndex('menu_categories_sub_name_idx')
    .on(t.parentId, sql`lower(${t.name})`)
    .where(sql`${t.parentId} is not null and ${t.status} = 'active'`),
])

export const OPTION_STATUSES = ['active', 'archived'] as const

/**
 * The Options library (D44, D58): reusable option sets ("Size") with names only, no prices. A menu
 * item uses up to two, and gets one priced version per combination of their values (step 3.5).
 * `version` covers the set **and its values**: every change to either moves it, so two admins
 * editing the same set can't overwrite each other.
 */
export const menuOptionSets = sqliteTable('menu_option_sets', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  name: text().notNull(),
  status: text({ enum: OPTION_STATUSES }).notNull().default('active'),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_option_sets_status_check', sql`${t.status} in ('active', 'archived')`),
  unique('menu_option_sets_tenant_id_unique').on(t.tenantId, t.id),
  // A tenant's active sets have distinct names (case-insensitive), even when two saves race.
  uniqueIndex('menu_option_sets_active_name_idx').on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.status} = 'active'`),
])

/**
 * A value of a set ("Large"). Archiving a value hides the item versions that use it; it's never
 * deleted, because versions and past orders refer to it.
 */
export const menuOptionValues = sqliteTable('menu_option_values', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  setId: text().notNull(),
  name: text().notNull(),
  sortOrder: integer().notNull().default(0),
  status: text({ enum: OPTION_STATUSES }).notNull().default('active'),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_option_values_status_check', sql`${t.status} in ('active', 'archived')`),
  unique('menu_option_values_tenant_id_unique').on(t.tenantId, t.id),
  foreignKey({ name: 'menu_option_values_set_fk', columns: [t.tenantId, t.setId], foreignColumns: [menuOptionSets.tenantId, menuOptionSets.id] }).onDelete('restrict'),
  index('menu_option_values_set_sort_idx').on(t.setId, t.sortOrder),
  // Active values of one set have distinct names (case-insensitive).
  uniqueIndex('menu_option_values_active_name_idx').on(t.setId, sql`lower(${t.name})`).where(sql`${t.status} = 'active'`),
])

export const MODIFIER_STATUSES = ['active', 'archived'] as const

/**
 * The Add-ons library (D44, D59): reusable groups of extras ("Milk", "Extra shot") with default
 * prices and selection rules, used by many items (each item can override the rules and prices in
 * step 3.5). As with option sets, `version` covers the group **and its modifiers**.
 */
export const menuModifierGroups = sqliteTable('menu_modifier_groups', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  name: text().notNull(),
  /** How many the customer must choose (0 = optional). */
  minSelect: integer().notNull().default(0),
  /** How many they may choose; `null` = no limit. */
  maxSelect: integer(),
  status: text({ enum: MODIFIER_STATUSES }).notNull().default('active'),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_modifier_groups_status_check', sql`${t.status} in ('active', 'archived')`),
  check('menu_modifier_groups_select_check', sql`${t.minSelect} >= 0 and (${t.maxSelect} is null or (${t.maxSelect} >= 1 and ${t.maxSelect} >= ${t.minSelect}))`),
  unique('menu_modifier_groups_tenant_id_unique').on(t.tenantId, t.id),
  uniqueIndex('menu_modifier_groups_active_name_idx').on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.status} = 'active'`),
])

/** An extra ("Oat", +$0.50). Archived, never deleted: past orders refer to it. */
export const menuModifiers = sqliteTable('menu_modifiers', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  groupId: text().notNull(),
  name: text().notNull(),
  /** Added to the item's price, in cents; 0 for a free choice ("Whole milk"). */
  priceDeltaMinor: integer().notNull().default(0),
  /** Pre-selected for the customer. */
  isDefault: integer({ mode: 'boolean' }).notNull().default(false),
  sortOrder: integer().notNull().default(0),
  status: text({ enum: MODIFIER_STATUSES }).notNull().default('active'),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_modifiers_status_check', sql`${t.status} in ('active', 'archived')`),
  check('menu_modifiers_price_check', sql`${t.priceDeltaMinor} >= 0`),
  unique('menu_modifiers_tenant_id_unique').on(t.tenantId, t.id),
  foreignKey({ name: 'menu_modifiers_group_fk', columns: [t.tenantId, t.groupId], foreignColumns: [menuModifierGroups.tenantId, menuModifierGroups.id] }).onDelete('restrict'),
  index('menu_modifiers_group_sort_idx').on(t.groupId, t.sortOrder),
  uniqueIndex('menu_modifiers_active_name_idx').on(t.groupId, sql`lower(${t.name})`).where(sql`${t.status} = 'active'`),
])

export const ITEM_STATUSES = ['draft', 'active', 'archived'] as const
export const VARIATION_STATUSES = ['active', 'disabled', 'retired'] as const

/**
 * A menu item (D44, D60) in a leaf category. `draft` items are invisible to customers; `archived`
 * ones are kept (orders will refer to them) and can be restored as drafts. `version` covers the item
 * **and its option sets and variations**: the item form saves them together.
 */
export const menuItems = sqliteTable('menu_items', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  categoryId: text().notNull(),
  name: text().notNull(),
  description: text().notNull().default(''),
  /**
   * A `media_assets` id of the same tenant (the media feature owns that table and its lifecycle;
   * attached while the item uses it, checked by the media feature's tenant-scoped attach).
   */
  imageAssetId: text(),
  status: text({ enum: ITEM_STATUSES }).notNull().default('draft'),
  sortOrder: integer().notNull().default(0),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_items_status_check', sql`${t.status} in ('draft', 'active', 'archived')`),
  unique('menu_items_tenant_id_unique').on(t.tenantId, t.id),
  foreignKey({ name: 'menu_items_category_fk', columns: [t.tenantId, t.categoryId], foreignColumns: [menuCategories.tenantId, menuCategories.id] }).onDelete('restrict'),
  index('menu_items_category_sort_idx').on(t.categoryId, t.sortOrder),
  index('menu_items_tenant_status_idx').on(t.tenantId, t.status),
])

/** The option sets an item's versions come from, in grid order (at most 2 per item). */
export const menuItemOptionSets = sqliteTable('menu_item_option_sets', {
  tenantId: tenantId(),
  itemId: text().notNull(),
  setId: text().notNull(),
  sortOrder: integer().notNull(),
}, t => [
  primaryKey({ columns: [t.itemId, t.setId] }),
  foreignKey({ name: 'menu_item_option_sets_item_fk', columns: [t.tenantId, t.itemId], foreignColumns: [menuItems.tenantId, menuItems.id] }).onDelete('cascade'),
  foreignKey({ name: 'menu_item_option_sets_set_fk', columns: [t.tenantId, t.setId], foreignColumns: [menuOptionSets.tenantId, menuOptionSets.id] }).onDelete('restrict'),
])

/**
 * One priced version of an item: one combination of its option sets' values ("Large, Iced"), or
 * the only version of an item without option sets. Its id never changes: orders and sold-out
 * switches refer to it. `disabled`: in the grid but switched off (price optional); `retired`: no
 * longer in the grid (an option set was removed), kept for history.
 */
export const menuItemVariations = sqliteTable('menu_item_variations', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  itemId: text().notNull(),
  /** The sorted value ids joined with `,` (`''` without option sets): unique per item. */
  combinationKey: text().notNull(),
  priceMinor: integer(),
  currency: text().notNull().default('USD'),
  status: text({ enum: VARIATION_STATUSES }).notNull().default('disabled'),
  sortOrder: integer().notNull().default(0),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_item_variations_status_check', sql`${t.status} in ('active', 'disabled', 'retired')`),
  check('menu_item_variations_price_check', sql`${t.priceMinor} is null or ${t.priceMinor} >= 0`),
  check('menu_item_variations_active_price_check', sql`${t.status} <> 'active' or ${t.priceMinor} is not null`),
  uniqueIndex('menu_item_variations_combination_idx').on(t.itemId, t.combinationKey),
  unique('menu_item_variations_tenant_id_unique').on(t.tenantId, t.id),
  foreignKey({ name: 'menu_item_variations_item_fk', columns: [t.tenantId, t.itemId], foreignColumns: [menuItems.tenantId, menuItems.id] }).onDelete('cascade'),
])

/** The option values of a variation: one per option set of the item. */
export const menuVariationOptionValues = sqliteTable('menu_variation_option_values', {
  tenantId: tenantId(),
  variationId: text().notNull(),
  valueId: text().notNull(),
}, t => [
  primaryKey({ columns: [t.variationId, t.valueId] }),
  foreignKey({ name: 'menu_variation_option_values_variation_fk', columns: [t.tenantId, t.variationId], foreignColumns: [menuItemVariations.tenantId, menuItemVariations.id] }).onDelete('cascade'),
  foreignKey({ name: 'menu_variation_option_values_value_fk', columns: [t.tenantId, t.valueId], foreignColumns: [menuOptionValues.tenantId, menuOptionValues.id] }).onDelete('restrict'),
  index('menu_variation_option_values_value_idx').on(t.valueId),
])

/**
 * The add-on groups an item offers, in order (D61). `rulesOverridden`: this item uses its own
 * `minSelect` / `maxSelect` (`maxSelect` null = no limit) instead of the group's.
 */
export const menuItemModifierGroups = sqliteTable('menu_item_modifier_groups', {
  tenantId: tenantId(),
  itemId: text().notNull(),
  groupId: text().notNull(),
  sortOrder: integer().notNull(),
  rulesOverridden: integer({ mode: 'boolean' }).notNull().default(false),
  minSelect: integer(),
  maxSelect: integer(),
}, t => [
  primaryKey({ columns: [t.itemId, t.groupId] }),
  foreignKey({ name: 'menu_item_modifier_groups_item_fk', columns: [t.tenantId, t.itemId], foreignColumns: [menuItems.tenantId, menuItems.id] }).onDelete('cascade'),
  foreignKey({ name: 'menu_item_modifier_groups_group_fk', columns: [t.tenantId, t.groupId], foreignColumns: [menuModifierGroups.tenantId, menuModifierGroups.id] }).onDelete('restrict'),
  index('menu_item_modifier_groups_group_idx').on(t.groupId),
  check('menu_item_modifier_groups_rules_check', sql`not ${t.rulesOverridden} or (${t.minSelect} >= 0 and (${t.maxSelect} is null or (${t.maxSelect} >= 1 and ${t.maxSelect} >= ${t.minSelect})))`),
])

/** An add-on's price on one item, instead of its default ("Oat +$0.75 on the large drinks"). */
export const menuItemModifierPrices = sqliteTable('menu_item_modifier_prices', {
  tenantId: tenantId(),
  itemId: text().notNull(),
  modifierId: text().notNull(),
  priceDeltaMinor: integer().notNull(),
}, t => [
  primaryKey({ columns: [t.itemId, t.modifierId] }),
  foreignKey({ name: 'menu_item_modifier_prices_item_fk', columns: [t.tenantId, t.itemId], foreignColumns: [menuItems.tenantId, menuItems.id] }).onDelete('cascade'),
  foreignKey({ name: 'menu_item_modifier_prices_modifier_fk', columns: [t.tenantId, t.modifierId], foreignColumns: [menuModifiers.tenantId, menuModifiers.id] }).onDelete('restrict'),
  check('menu_item_modifier_prices_price_check', sql`${t.priceDeltaMinor} >= 0`),
])

export const AVAILABILITY_STATUSES = ['active', 'archived'] as const

/**
 * Availability rules (D45, D63): named weekly time windows ("Breakfast") that limit when items and
 * categories are sold. `version` covers the rule **and its windows**. Archived, never deleted; an
 * archived rule never matches, so whatever still uses it isn't sold.
 */
export const menuAvailabilityRules = sqliteTable('menu_availability_rules', {
  id: text().primaryKey().$defaultFn(() => newId()),
  tenantId: tenantId(),
  name: text().notNull(),
  status: text({ enum: AVAILABILITY_STATUSES }).notNull().default('active'),
  version: integer().notNull().default(1),
  createdAt: instant().notNull().default(nowMs),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  check('menu_availability_rules_status_check', sql`${t.status} in ('active', 'archived')`),
  unique('menu_availability_rules_tenant_id_unique').on(t.tenantId, t.id),
  uniqueIndex('menu_availability_rules_active_name_idx').on(t.tenantId, sql`lower(${t.name})`).where(sql`${t.status} = 'active'`),
])

/**
 * A weekly window of a rule, in the branch's local time: ISO `weekday` (1 = Monday), minutes after
 * midnight. An end before the start runs past midnight; the window belongs to the day it starts on.
 * Replaced whole when the rule's windows change.
 */
export const menuAvailabilityWindows = sqliteTable('menu_availability_windows', {
  tenantId: tenantId(),
  ruleId: text().notNull(),
  weekday: integer().notNull(),
  startMinute: integer().notNull(),
  endMinute: integer().notNull(),
}, t => [
  // Windows of a rule don't overlap (checked by the service), so none share a start.
  primaryKey({ columns: [t.ruleId, t.weekday, t.startMinute] }),
  foreignKey({ name: 'menu_availability_windows_rule_fk', columns: [t.tenantId, t.ruleId], foreignColumns: [menuAvailabilityRules.tenantId, menuAvailabilityRules.id] }).onDelete('cascade'),
  check('menu_availability_windows_range_check', sql`${t.weekday} between 1 and 7 and ${t.startMinute} between 0 and 1439 and ${t.endMinute} between 1 and 1440 and ${t.endMinute} <> ${t.startMinute}`),
])

/** The rules an item uses (none: whenever the branch is open; several: when any matches). */
export const menuItemAvailability = sqliteTable('menu_item_availability', {
  tenantId: tenantId(),
  itemId: text().notNull(),
  ruleId: text().notNull(),
}, t => [
  primaryKey({ columns: [t.itemId, t.ruleId] }),
  foreignKey({ name: 'menu_item_availability_item_fk', columns: [t.tenantId, t.itemId], foreignColumns: [menuItems.tenantId, menuItems.id] }).onDelete('cascade'),
  foreignKey({ name: 'menu_item_availability_rule_fk', columns: [t.tenantId, t.ruleId], foreignColumns: [menuAvailabilityRules.tenantId, menuAvailabilityRules.id] }).onDelete('restrict'),
  index('menu_item_availability_rule_idx').on(t.ruleId),
])

/** The rules a category uses; its items and sub-categories are limited by them too. */
export const menuCategoryAvailability = sqliteTable('menu_category_availability', {
  tenantId: tenantId(),
  categoryId: text().notNull(),
  ruleId: text().notNull(),
}, t => [
  primaryKey({ columns: [t.categoryId, t.ruleId] }),
  foreignKey({ name: 'menu_category_availability_category_fk', columns: [t.tenantId, t.categoryId], foreignColumns: [menuCategories.tenantId, menuCategories.id] }).onDelete('cascade'),
  foreignKey({ name: 'menu_category_availability_rule_fk', columns: [t.tenantId, t.ruleId], foreignColumns: [menuAvailabilityRules.tenantId, menuAvailabilityRules.id] }).onDelete('restrict'),
  index('menu_category_availability_rule_idx').on(t.ruleId),
])

/**
 * The counter's "86" switch (D64): one version of an item sold out at one branch ("Large" gone,
 * "Regular" still sold). Brand-wide menu, per-branch state. A row stays after it's switched back
 * on (`soldOut: false`), recording who did it. `updatedBy` is plain text, like the audit trail's
 * actor, so the record survives if the account is removed.
 */
export const branchItemStates = sqliteTable('branch_item_states', {
  tenantId: tenantId(),
  branchId: text().notNull(),
  variationId: text().notNull(),
  soldOut: integer({ mode: 'boolean' }).notNull().default(false),
  updatedBy: text().notNull(),
  updatedAt: instant().notNull().default(nowMs),
}, t => [
  primaryKey({ columns: [t.branchId, t.variationId] }),
  foreignKey({ name: 'branch_item_states_branch_fk', columns: [t.tenantId, t.branchId], foreignColumns: [branches.tenantId, branches.id] }).onDelete('cascade'),
  foreignKey({ name: 'branch_item_states_variation_fk', columns: [t.tenantId, t.variationId], foreignColumns: [menuItemVariations.tenantId, menuItemVariations.id] }).onDelete('cascade'),
  index('branch_item_states_variation_idx').on(t.variationId),
])
