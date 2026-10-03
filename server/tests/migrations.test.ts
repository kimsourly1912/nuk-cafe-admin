import { describe, expect, it } from 'vitest'
import { applyMigration, createTestClient, migrationFiles } from '#server/tests/support/db'

// Migrations that change tables holding data are checked against data, not only an empty
// database: staging runs them over its rows.
describe('0011_drop_legacy_menu', () => {
  it('drops the legacy menu tables while they still hold linked rows (foreign keys on, like D1)', async () => {
    const client = await createTestClient()
    const files = migrationFiles()
    const drop = files.indexOf('0011_drop_legacy_menu.sql')
    expect(drop).toBeGreaterThan(0)
    for (const file of files.slice(0, drop)) await applyMigration(client, file)

    // A category tree, an item in it with an image, a schedule and a variant: every reference.
    await client.batch([
      `insert into legacy_media_assets (id, object_key, mime_type, byte_size) values ('m1', 'menu/a.png', 'image/png', 10)`,
      `insert into legacy_menu_categories (id, name) values ('c1', 'Drinks')`,
      `insert into legacy_menu_categories (id, name, parent_id) values ('c2', 'Tea', 'c1')`,
      `insert into menu_schedules (id, name, days, start_minute, end_minute, time_zone) values ('s1', 'Mornings', 31, 420, 660, 'Asia/Phnom_Penh')`,
      `insert into menu_products (id, category_id, name, price_minor, image_asset_id) values ('p1', 'c2', 'Latte', 350, 'm1')`,
      `insert into product_schedules (product_id, schedule_id) values ('p1', 's1')`,
      `insert into product_variant_groups (id, product_id, name) values ('g1', 'p1', 'Milk')`,
      `insert into product_variant_options (id, group_id, name) values ('o1', 'g1', 'Oat')`,
    ], 'write')

    await applyMigration(client, files[drop]!)

    const { rows } = await client.execute(`select name from sqlite_master where type = 'table' and name in ('legacy_media_assets', 'legacy_menu_categories', 'menu_products', 'menu_schedules', 'product_schedules', 'product_variant_groups', 'product_variant_options')`)
    expect(rows).toEqual([])
    // The migrations after it still apply.
    for (const file of files.slice(drop + 1)) await applyMigration(client, file)
  })
})

describe('0022_notification_rules_server_error', () => {
  it('rebuilds the rules table keeping every rule, then takes the new kind and still refuses an unknown one', async () => {
    const client = await createTestClient()
    const files = migrationFiles()
    const rebuild = files.indexOf('0022_notification_rules_server_error.sql')
    expect(rebuild).toBeGreaterThan(0)
    for (const file of files.slice(0, rebuild)) await applyMigration(client, file)

    await client.batch([
      `insert into telegram_destinations (id, kind, chat_id, title, status) values ('d1', 'group', '-100', 'Staff', 'connected')`,
      `insert into notification_rules (kind, destination_id, attach_csv) values ('new_order', 'd1', 0)`,
      `insert into notification_rules (kind, destination_id, attach_csv) values ('closing_summary', 'd1', 1)`,
    ], 'write')

    await applyMigration(client, files[rebuild]!)

    const { rows } = await client.execute('select kind, destination_id, attach_csv from notification_rules order by kind')
    expect(rows.map(row => ({ ...row }))).toEqual([
      { kind: 'closing_summary', destination_id: 'd1', attach_csv: 1 },
      { kind: 'new_order', destination_id: 'd1', attach_csv: 0 },
    ])
    await client.execute(`insert into notification_rules (kind, destination_id) values ('server_error', 'd1')`)
    await expect(client.execute(`insert into notification_rules (kind, destination_id) values ('nonsense', 'd1')`)).rejects.toThrow(/CHECK/)
    // A chat's rules still go with it.
    await client.execute(`delete from telegram_destinations where id = 'd1'`)
    expect((await client.execute('select count(*) as n from notification_rules')).rows[0]!.n).toBe(0)
    for (const file of files.slice(rebuild + 1)) await applyMigration(client, file)
  })
})

describe('0024_tenants', () => {
  const TENANT = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'
  const before = async () => {
    const client = await createTestClient()
    const files = migrationFiles()
    const at = files.indexOf('0024_tenants.sql')
    expect(at).toBeGreaterThan(0)
    for (const file of files.slice(0, at)) await applyMigration(client, file)
    return { client, files, at }
  }

  it('turns the cafe into tenant "nuk": branches, their staff, owners, and every branch and order row moved with foreign keys on', async () => {
    const { client, files, at } = await before()
    await client.batch([
      `insert into user (id, name, email, role) values ('u-admin', 'Owner', 'owner@example.com', 'admin'), ('u-mgr', 'Mia', 'mia@example.com', 'customer'), ('u-cust', 'Cam', 'cam@example.com', 'customer')`,
      `insert into organization (id, name, slug, created_at, timezone, address, phone, status, version) values ('b1', 'Riverside', 'riverside', 1, 'Asia/Phnom_Penh', '1 River St', '+85512345678', 'active', 3), ('b2', 'Old Market', 'old', 2, 'Asia/Phnom_Penh', null, null, 'archived', 1)`,
      `insert into member (id, organization_id, user_id, role, created_at) values ('m1', 'b1', 'u-mgr', 'manager', 5), ('m2', 'b2', 'u-mgr', 'staff', 6)`,
      `insert into branch_hours (branch_id, weekday, start_minute, end_minute) values ('b1', 1, 420, 1260)`,
      `insert into dining_tables (id, branch_id, label, qr_token_hash) values ('t1', 'b1', 'Table 1', 'hash-1')`,
      `insert into menu_categories (id, name) values ('c1', 'Coffee')`,
      `insert into menu_items (id, category_id, name) values ('i1', 'c1', 'Latte')`,
      `insert into menu_item_variations (id, item_id, combination_key, price_minor, status) values ('v1', 'i1', '', 350, 'active')`,
      `insert into branch_item_states (branch_id, variation_id, sold_out, updated_by) values ('b1', 'v1', 1, 'u-mgr')`,
      `insert into orders (id, branch_id, customer_id, business_date, pickup_number, status, order_type, table_id, table_label, subtotal_minor, total_minor, placed_at, payment_due_at, paid_at) values ('o1', 'b1', 'u-cust', '2026-10-02', 1, 'preparing', 'dine_in', 't1', 'Table 1', 350, 350, 10, 20, 15)`,
      `insert into order_lines (id, order_id, position, item_id, variation_id, item_name, detail, modifiers, unit_price_minor, quantity, total_minor) values ('l1', 'o1', 0, 'i1', 'v1', 'Latte', '', '[]', 350, 1, 350)`,
      `insert into order_events (id, order_id, to_version, actor_id, to_status, at) values ('e1', 'o1', 1, 'u-cust', 'awaiting_payment', 10), ('e2', 'o1', 2, 'u-mgr', 'preparing', 15)`,
      `insert into khqr_charges (id, order_id, branch_id, currency, amount, account_id, merchant_name, qr, md5, bill_number, created_by, created_at, expires_at) values ('k1', 'o1', 'b1', 'USD', 350, 'nuk@aclb', 'NUK', 'qr', 'md5-1', '001', 'u-mgr', 11, 12)`,
      `insert into counter_payments (id, order_id, branch_id, method, amount_minor, khqr_charge_id, collected_by, collected_at) values ('p1', 'o1', 'b1', 'khqr', 350, 'k1', 'u-mgr', 15)`,
    ], 'write')

    await applyMigration(client, files[at]!)
    const all = async (sql: string) => (await client.execute(sql)).rows.map(row => ({ ...row }))

    expect(await all('select id, name, slug, status from organization')).toEqual([{ id: TENANT, name: 'NUK Cafe', slug: 'nuk', status: 'active' }])
    expect(await all('select id, tenant_id, name, timezone, address, phone, status, version from branches order by id')).toEqual([
      { id: 'b1', tenant_id: TENANT, name: 'Riverside', timezone: 'Asia/Phnom_Penh', address: '1 River St', phone: '+85512345678', status: 'active', version: 3 },
      { id: 'b2', tenant_id: TENANT, name: 'Old Market', timezone: 'Asia/Phnom_Penh', address: null, phone: null, status: 'archived', version: 1 },
    ])
    expect(await all('select branch_id, user_id, role from branch_staff order by branch_id')).toEqual([
      { branch_id: 'b1', user_id: 'u-mgr', role: 'manager' },
      { branch_id: 'b2', user_id: 'u-mgr', role: 'staff' },
    ])
    expect(await all('select organization_id, user_id, role from member order by user_id')).toEqual([
      { organization_id: TENANT, user_id: 'u-admin', role: 'owner' },
      { organization_id: TENANT, user_id: 'u-mgr', role: 'member' },
    ])
    expect(await all(`select id, role from user order by id`)).toEqual([
      { id: 'u-admin', role: 'customer' }, { id: 'u-cust', role: 'customer' }, { id: 'u-mgr', role: 'customer' },
    ])
    for (const table of ['branch_hours', 'dining_tables', 'branch_item_states', 'orders', 'order_lines', 'order_events', 'counter_payments', 'khqr_charges']) {
      expect(await all(`select distinct tenant_id from ${table}`), table).toEqual([{ tenant_id: TENANT }])
    }
    expect(await all('select id, khqr_charge_id, branch_id from counter_payments')).toEqual([{ id: 'p1', khqr_charge_id: 'k1', branch_id: 'b1' }])
    expect(await all('select count(*) as n from order_events')).toEqual([{ n: 2 }])
    expect(await all(`select name from pragma_table_info('organization') where name in ('timezone', 'currency', 'address', 'phone')`)).toEqual([])

    // No temporary name is left in any table's definition, and every reference holds.
    expect(await all(`select name from sqlite_master where instr(sql, '__new_') > 0`)).toEqual([])
    expect(await all('pragma foreign_key_check')).toEqual([])
    // The new keys refuse a link into another tenant.
    await client.execute(`insert into organization (id, name, slug, created_at) values ('t2', 'Other', 'other', 1)`)
    await expect(client.execute(`insert into dining_tables (id, tenant_id, branch_id, label, qr_token_hash) values ('t9', 't2', 'b1', 'X', 'hash-9')`)).rejects.toThrow(/FOREIGN KEY/)
    // An order's children still go with it.
    await client.batch(['delete from counter_payments', 'delete from khqr_charges', `delete from orders where id = 'o1'`], 'write')
    expect(await all('select count(*) as n from order_lines')).toEqual([{ n: 0 }])

    for (const file of files.slice(at + 1)) await applyMigration(client, file)
  })

  it('creates no tenant in an empty database, and takes another slug when "nuk" is taken', async () => {
    const empty = await before()
    await applyMigration(empty.client, empty.files[empty.at]!)
    expect((await empty.client.execute('select count(*) as n from organization')).rows[0]!.n).toBe(0)

    const taken = await before()
    await taken.client.execute(`insert into organization (id, name, slug, created_at, timezone) values ('b1', 'NUK', 'nuk', 1, 'Asia/Phnom_Penh')`)
    await applyMigration(taken.client, taken.files[taken.at]!)
    expect((await taken.client.execute('select slug from organization')).rows.map(r => r.slug)).toEqual(['nuk-cafe'])
  })
})

describe('0025_menu_tenants', () => {
  const TENANT = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'
  const MENU_TABLES = ['menu_categories', 'menu_option_sets', 'menu_option_values', 'menu_modifier_groups', 'menu_modifiers', 'menu_items', 'menu_item_option_sets',
    'menu_item_variations', 'menu_variation_option_values', 'menu_item_modifier_groups', 'menu_item_modifier_prices', 'menu_availability_rules',
    'menu_availability_windows', 'menu_item_availability', 'menu_category_availability', 'branch_item_states', 'media_assets']
  const before = async () => {
    const client = await createTestClient()
    const files = migrationFiles()
    const at = files.indexOf('0025_menu_tenants.sql')
    expect(at).toBeGreaterThan(0)
    for (const file of files.slice(0, at)) await applyMigration(client, file)
    return { client, files, at }
  }

  it('gives every menu row and upload the tenant, keeps every link, and refuses links into another tenant', async () => {
    const { client, files, at } = await before()
    await client.batch([
      `insert into organization (id, name, slug, created_at, status, version) values ('${TENANT}', 'NUK Cafe', 'nuk', 1, 'active', 1)`,
      `insert into branches (id, tenant_id, name, timezone) values ('b1', '${TENANT}', 'Riverside', 'Asia/Phnom_Penh')`,
      `insert into media_assets (id, object_key, mime_type, byte_size, sha256, state) values ('a1', 'menu/a1.webp', 'image/webp', 10, 'sha', 'attached')`,
      `insert into menu_option_sets (id, name) values ('s1', 'Size')`,
      `insert into menu_option_values (id, set_id, name) values ('ov1', 's1', 'Large')`,
      `insert into menu_modifier_groups (id, name) values ('g1', 'Milk')`,
      `insert into menu_modifiers (id, group_id, name, price_delta_minor) values ('m1', 'g1', 'Oat', 50)`,
      `insert into menu_availability_rules (id, name) values ('r1', 'Breakfast')`,
      `insert into menu_availability_windows (rule_id, weekday, start_minute, end_minute) values ('r1', 1, 420, 660)`,
      // A sub-category before its parent in table order: the copy puts the parent first.
      `insert into menu_categories (id, parent_id, name, sort_order) values ('c1', null, 'Drinks', 1)`,
      `insert into menu_categories (id, parent_id, name, sort_order) values ('c2', 'c1', 'Coffee', 1)`,
      `insert into menu_category_availability (category_id, rule_id) values ('c2', 'r1')`,
      `insert into menu_items (id, category_id, name, image_asset_id, status) values ('i1', 'c2', 'Latte', 'a1', 'active')`,
      `insert into menu_item_option_sets (item_id, set_id, sort_order) values ('i1', 's1', 1)`,
      `insert into menu_item_variations (id, item_id, combination_key, price_minor, status) values ('v1', 'i1', 'ov1', 350, 'active')`,
      `insert into menu_variation_option_values (variation_id, value_id) values ('v1', 'ov1')`,
      `insert into menu_item_modifier_groups (item_id, group_id, sort_order) values ('i1', 'g1', 1)`,
      `insert into menu_item_modifier_prices (item_id, modifier_id, price_delta_minor) values ('i1', 'm1', 75)`,
      `insert into menu_item_availability (item_id, rule_id) values ('i1', 'r1')`,
      `insert into branch_item_states (tenant_id, branch_id, variation_id, sold_out, updated_by) values ('${TENANT}', 'b1', 'v1', 1, 'u1')`,
    ], 'write')

    await applyMigration(client, files[at]!)
    const all = async (sql: string) => (await client.execute(sql)).rows.map(row => ({ ...row }))

    for (const table of MENU_TABLES) {
      expect(await all(`select distinct tenant_id from ${table}`), table).toEqual([{ tenant_id: TENANT }])
    }
    expect(await all('select id, parent_id from menu_categories order by id')).toEqual([{ id: 'c1', parent_id: null }, { id: 'c2', parent_id: 'c1' }])
    expect(await all('select id, image_asset_id, category_id from menu_items')).toEqual([{ id: 'i1', image_asset_id: 'a1', category_id: 'c2' }])
    expect(await all('select object_key, state from media_assets')).toEqual([{ object_key: 'menu/a1.webp', state: 'attached' }])
    expect(await all('select item_id, modifier_id, price_delta_minor from menu_item_modifier_prices')).toEqual([{ item_id: 'i1', modifier_id: 'm1', price_delta_minor: 75 }])
    expect(await all(`select name from sqlite_master where instr(sql, '__new_') > 0`)).toEqual([])
    expect(await all('pragma foreign_key_check')).toEqual([])

    // Another tenant can't link to this menu, and its names don't clash with this one's.
    await client.batch([
      `insert into organization (id, name, slug, created_at) values ('t2', 'Other', 'other', 2)`,
      `insert into menu_option_sets (id, tenant_id, name) values ('s2', 't2', 'Size')`,
      `insert into menu_categories (id, tenant_id, name) values ('c9', 't2', 'Drinks')`,
      `insert into branches (id, tenant_id, name, timezone) values ('b9', 't2', 'Other branch', 'Asia/Phnom_Penh')`,
    ], 'write')
    for (const sql of [
      `insert into menu_categories (id, tenant_id, parent_id, name) values ('c8', 't2', 'c1', 'Tea')`,
      `insert into menu_items (id, tenant_id, category_id, name) values ('i9', 't2', 'c2', 'Tea')`,
      `insert into menu_option_values (id, tenant_id, set_id, name) values ('ov9', 't2', 's1', 'Small')`,
      `insert into menu_item_option_sets (tenant_id, item_id, set_id, sort_order) values ('t2', 'i1', 's2', 2)`,
      `insert into menu_item_option_sets (tenant_id, item_id, set_id, sort_order) values ('${TENANT}', 'i1', 's2', 2)`,
      `insert into branch_item_states (tenant_id, branch_id, variation_id, sold_out, updated_by) values ('t2', 'b9', 'v1', 1, 'u1')`,
    ]) await expect(client.execute(sql), sql).rejects.toThrow(/FOREIGN KEY/)
    // The same name in one tenant still clashes.
    await expect(client.execute(`insert into menu_option_sets (id, tenant_id, name) values ('s3', '${TENANT}', 'size')`)).rejects.toThrow(/UNIQUE/)

    // An item's links and versions still go with it, and a version's sold-out rows with the version.
    await client.execute(`delete from menu_items where id = 'i1'`)
    for (const table of ['menu_item_option_sets', 'menu_item_variations', 'menu_variation_option_values', 'menu_item_modifier_groups', 'menu_item_modifier_prices', 'menu_item_availability', 'branch_item_states']) {
      expect(await all(`select count(*) as n from ${table}`), table).toEqual([{ n: 0 }])
    }
    for (const file of files.slice(at + 1)) await applyMigration(client, file)
  })

  it('leaves an empty database without a tenant', async () => {
    const { client, files, at } = await before()
    await applyMigration(client, files[at]!)
    expect((await client.execute('select count(*) as n from organization')).rows[0]!.n).toBe(0)
  })
})
