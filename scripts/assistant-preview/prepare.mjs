import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { hashPassword } from 'better-auth/crypto'

// Fixed, isolated resources: never allow a caller to point this script at staging/production.
const directory = '.data/assistant-preview'
const databaseId = 'ca2b3f1c-8341-4370-b4f2-bd6b25c1423a'
const bucket = 'nuk-cafe-assistant-preview'
const site = 'https://nuk-cafe-assistant-preview.kimsur61.workers.dev'
const configPath = '.output/server/wrangler.json'
const config = JSON.parse(await readFile(configPath, 'utf8'))
if (config.name !== 'nuk-cafe-staging' || config.d1_databases?.[0]?.binding !== 'DB' || config.r2_buckets?.[0]?.binding !== 'BLOB') throw new Error('Build the staging preset before preparing this isolated preview.')
await mkdir(directory, { recursive: true, mode: 0o700 })
const secret = () => randomBytes(32).toString('base64url')
const gatewayPassword = secret()
const password = secret()
const authSecret = secret()
for (const value of [gatewayPassword, password, authSecret]) console.log(`::add-mask::${value}`)
const authorization = `Basic ${Buffer.from(`preview:${gatewayPassword}`).toString('base64')}`
console.log(`::add-mask::${authorization}`)
const expiresAt = Date.now() + 24 * 60 * 60 * 1000
const save = (name, value) => writeFile(`${directory}/${name}`, typeof value === 'string' ? value : JSON.stringify(value, null, 2), { mode: 0o600 })
await save('access.json', { url: site, gatewayUser: 'preview', gatewayPassword, email: 'assistant-preview@example.test', password, expiresAt: new Date(expiresAt).toISOString() })
await save('app-secrets.json', { NUXT_BETTER_AUTH_SECRET: authSecret })
await save('gateway-secrets.json', { PREVIEW_AUTHORIZATION: authorization })
config.name = 'nuk-cafe-assistant-preview-app'
config.workers_dev = false
config.preview_urls = false
config.d1_databases = [{ ...config.d1_databases[0], database_id: databaseId, database_name: bucket }]
config.r2_buckets = [{ binding: 'BLOB', bucket_name: bucket }]
// Only the import deletion ledger is scheduled; account Free cron quota is shared.
config.triggers = { crons: ['*/5 * * * *'] }
config.vars = { ...config.vars, NUXT_PUBLIC_SITE_URL: site, NUXT_PUBLIC_SAMPLE_DATA_ENVIRONMENT: 'Assistant preview', NUXT_AI_ENABLED: 'true', NUXT_AI_PROVIDER: 'cloudflare', NUXT_AI_MODEL: '@cf/google/gemma-4-26b-a4b-it', NUXT_AI_IMPORT_ENABLED: 'true', NUXT_AI_IMPORT_MODEL: '@cf/meta/llama-4-scout-17b-16e-instruct', NUXT_AI_DAILY_LIMIT: '40' }
await writeFile(configPath, JSON.stringify(config, null, 2))
await save('gateway.json', { name: 'nuk-cafe-assistant-preview', main: resolve('scripts/assistant-preview/gateway.mjs'), compatibility_date: config.compatibility_date, workers_dev: true, preview_urls: false, observability: { enabled: true }, services: [{ binding: 'APP', service: config.name }], vars: { PREVIEW_EXPIRES_AT: String(expiresAt) } })
const tenant = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'
const user = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6ce'
const quoted = value => `'${value.replaceAll('\'', '\'\'')}'`
const now = Date.now()
const hash = await hashPassword(password)
console.log(`::add-mask::${hash}`)
// Idempotent synthetic owner seed. Password rotations never touch another user/cafe.
await save('seed.sql', `INSERT OR IGNORE INTO organization (id, name, slug, created_at, status, version) VALUES (${quoted(tenant)}, 'Assistant preview', 'nuk', ${now}, 'active', 1);
INSERT OR IGNORE INTO user (id, name, email, email_verified, role, must_change_password, created_at, updated_at) VALUES (${quoted(user)}, 'Preview owner', 'assistant-preview@example.test', 1, 'customer', 0, ${now}, ${now});
INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES ('assistant-preview-account', ${quoted(user)}, 'credential', ${quoted(user)}, ${quoted(hash)}, ${now}, ${now}) ON CONFLICT(id) DO UPDATE SET password=excluded.password, updated_at=excluded.updated_at;
INSERT OR IGNORE INTO member (id, organization_id, user_id, role, created_at) VALUES ('assistant-preview-member', ${quoted(tenant)}, ${quoted(user)}, 'owner', ${now});
INSERT OR IGNORE INTO menu_categories (id, tenant_id, name, status, version) VALUES ('01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cf', ${quoted(tenant)}, 'Preview drinks', 'active', 1);`)
console.log(`Prepared isolated preview; access expires ${new Date(expiresAt).toISOString()}.`)
