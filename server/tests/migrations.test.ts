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
