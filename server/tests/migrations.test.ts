import { describe, expect, it } from 'vitest'
import { applyMigration, createTestClient, migrationFiles } from './support/db'

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
