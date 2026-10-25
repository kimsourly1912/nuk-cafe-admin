// The dev server's test accounts (docs/reference/auth.md → Test accounts, D209). Runs the dev
// tasks through Nitro's dev-only endpoint, so `pnpm dev` must be running:
//   pnpm dev:accounts          create or reset every test account, write dev-accounts.local.md
//   pnpm dev:reset <email>     any account back to the test password
//   pnpm dev:mail              the newest password reset and confirmation links
// NUXT_DEV_URL points it at another address than http://localhost:3000.
import { writeFileSync } from 'node:fs'

const BASE = (process.env.NUXT_DEV_URL || 'http://localhost:3000').replace(/\/$/, '')
const FILE = 'dev-accounts.local.md'

async function runTask(name, query = {}) {
  const url = `${BASE}/_nitro/tasks/${name}?${new URLSearchParams(query)}`
  let response
  try {
    response = await fetch(url)
  }
  catch {
    throw new Error(`The dev server doesn't answer at ${BASE}. Start it with \`pnpm dev\`, or set NUXT_DEV_URL.`)
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.message || `${name} failed (${response.status})`)
  return body.result
}

function credentialsFile({ password, accounts }) {
  const rows = accounts.map(a => `| ${a.role} | \`${a.email}\` | ${a.cafe ?? '—'} | ${a.branch ?? '—'} | [${a.signIn}](${BASE}${a.signIn}) |`)
  return [
    '# Dev test accounts',
    '',
    `Written by \`pnpm dev:accounts\` on ${new Date().toISOString()}. Local dev server only; this file is not committed.`,
    '',
    `Password for every account: \`${password}\``,
    '',
    '| Role | Email | Cafe | Branch | Sign in |',
    '|---|---|---|---|---|',
    ...rows,
    '',
    '- `pnpm dev:accounts` again: every account back to this state (password, role, no forced change, no two-step sign-in, not banned, signed out).',
    '- `pnpm dev:reset <email>`: any other account back to this password, keeping its roles.',
    '- `pnpm dev:mail`: the newest password reset and email confirmation links.',
    '',
  ].join('\n')
}

const [command, arg] = process.argv.slice(2)
try {
  if (command === 'accounts') {
    const result = await runTask('dev:accounts')
    writeFileSync(FILE, credentialsFile(result))
    console.table(result.accounts.map(({ role, email, cafe, created }) => ({ role, email, cafe: cafe ?? '', created })))
    console.log(`Password: ${result.password}\nSaved to ${FILE}`)
  }
  else if (command === 'reset') {
    if (!arg) throw new Error('Usage: pnpm dev:reset <email>')
    const result = await runTask('dev:reset-password', { email: arg })
    console.log(`${result.email} signs in with: ${result.password}`)
  }
  else if (command === 'mail') {
    const result = await runTask('dev:mail')
    if (!result.length) console.log('No account emails yet.')
    for (const mail of result) console.log(`${mail.createdAt}  ${mail.kind}  ${mail.to}\n  ${mail.url}`)
  }
  else {
    throw new Error('Usage: node scripts/dev-accounts.mjs accounts | reset <email> | mail')
  }
}
catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
