import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { HELP_CASES } from '../../server/features/assistant/eval/help-cases.ts'

const directory = '.data/assistant-preview'
const access = JSON.parse(await readFile(`${directory}/access.json`, 'utf8'))
const reports = []
let cookie = ''
const authorization = `Basic ${Buffer.from(`${access.gatewayUser}:${access.gatewayPassword}`).toString('base64')}`
if (process.env.GITHUB_ACTIONS) {
  for (const value of [access.gatewayPassword, access.password, authorization]) console.log(`::add-mask::${value}`)
}
async function request(path, init = {}, expected = 200, authenticated = true) {
  const started = Date.now()
  const response = await fetch(`${access.url}${path}`, { ...init, signal: AbortSignal.timeout(75_000), headers: { authorization, origin: access.url, ...(authenticated ? { cookie } : {}), ...init.headers } })
  const text = await response.text()
  reports.push({ path, method: init.method ?? 'GET', status: response.status, finalUrl: response.url, redirected: response.redirected, gatewayDenied: text === 'Preview access required.', elapsedMs: Date.now() - started, ray: response.headers.get('cf-ray'), cpuLimitExceeded: text.includes('Error 1102') || text.includes('exceeded resource limits') })
  // Never print credentials, original documents, provider bodies or private review content.
  if (expected !== null) assert.equal(response.status, expected, `${init.method ?? 'GET'} ${path} status ${response.status}`)
  return { response, text, json: () => JSON.parse(text) }
}
const command = async (path, method, body, extraHeaders = {}) => (await request(path, { method, headers: { 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(body) })).json()
const base = '/api/c/nuk/admin/assistant/imports'
const fixture = name => readFile(`server/features/assistant/eval/fixtures/${name}`)
let failure
try {
  // A new workers.dev route returned 404 immediately after its first successful deploy.
  // Retry only this read-only readiness check, never auth writes or metered inference.
  let readiness
  for (let attempt = 0; attempt < 10; attempt++) {
    readiness = await fetch(access.url, { signal: AbortSignal.timeout(15_000) })
    if (readiness.status !== 404) break
    await readiness.arrayBuffer()
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  assert.equal(readiness.status, 401, 'Gateway must reject unauthenticated requests, including assets.')
  await request('/api/health', {}, 200, false)
  // Preserve a page-routing failure while still measuring the authenticated API separately.
  await request('/c/nuk/admin/login', {}, null, false)
  await request('/api/c/nuk/admin/me', {}, 401, false)
  const signedIn = await request('/api/auth/sign-in/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: access.email, password: access.password }) }, 200, false)
  cookie = signedIn.response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  assert.ok(cookie, 'Better Auth must return a session cookie.')
  await request('/api/c/nuk/admin/me')
  await request('/api/c/nuk/admin/assistant/import-status')
  const image = (await request(base, { method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'synthetic-preview.png' }, body: await fixture('columns-and-sizes.png') }, 201)).json()
  let review = await command(`${base}/${image.id}/extract`, 'POST', { version: image.version })
  assert.equal(review.state, 'ready')
  assert.ok(review.rows.some(row => row.source.name === 'Americano'))
  const row = review.rows.find(row => row.source.name === 'Americano')
  review = await command(`${base}/${image.id}/review/${row.id}`, 'PATCH', { version: review.source.version, draft: { ...row.draft, categoryId: '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cf' } })
  const draftHeaders = { 'idempotency-key': crypto.randomUUID() }
  const draft = await command(`${base}/${image.id}/review/${row.id}/create-draft`, 'POST', { version: review.source.version }, draftHeaders)
  assert.ok(draft.itemId)
  const replay = await command(`${base}/${image.id}/review/${row.id}/create-draft`, 'POST', { version: review.source.version }, draftHeaders)
  assert.equal(replay.itemId, draft.itemId)
  assert.equal((await request(`/api/c/nuk/admin/menu/items/${draft.itemId}`)).json().status, 'draft')
  await command(`${base}/${image.id}/discard`, 'POST', { version: draft.version })
  await request(`${base}/${image.id}/source`, {}, 404)
  // Same real supplied-page endpoint as the browser. Rendering remains browser-side.
  const pdf = (await request(base, { method: 'POST', headers: { 'content-type': 'application/pdf', 'x-file-name': 'synthetic-preview.pdf' }, body: await fixture('columns-and-sizes-scan.pdf') }, 201)).json()
  const prepared = await command(`${base}/${pdf.id}/pdf-pages`, 'POST', { version: pdf.version, pageNumbers: [1] })
  const page = (await request(`${base}/${pdf.id}/pdf-pages/1/extract`, { method: 'POST', headers: { 'content-type': 'image/png', 'x-source-version': String(prepared.source.version) }, body: await fixture('columns-and-sizes.png') })).json()
  assert.equal(page.state, 'ready')
  await command(`${base}/${pdf.id}/discard`, 'POST', { version: page.source.version })
  // Reuse the repository's fixed quality cases; no additional model comparison loop.
  for (const c of HELP_CASES) {
    const result = await request('/api/c/nuk/admin/assistant/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: [{ id: 'q', role: 'user', parts: [{ type: 'text', text: c.question }] }], page: c.page ?? '/admin' }) })
    const chunks = result.text.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)))
    const answer = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.delta).join('')
    const links = chunks.filter(chunk => chunk.type === 'tool-output-available').map(chunk => chunk.output.path)
    const lower = answer.toLowerCase().replace(/[‘’]/g, '\'')
    const problems = c.expect.filter(words => !words.some(word => lower.includes(word.toLowerCase()))).map(words => `missing ${words.join('|')}`)
    if (c.link && !links.includes(c.link)) problems.push('missing navigation button')
    if (c.khmer && !/[ក-៿]/.test(answer)) problems.push('missing Khmer answer')
    if (chunks.some(chunk => chunk.type === 'error')) problems.push('provider error')
    for (const word of c.never ?? []) if (lower.includes(word.toLowerCase()) || links.includes(word)) problems.push('forbidden claim')
    reports.at(-1).quality = { question: c.question, passed: !problems.length, problems }
    // Stop on quality failure, preserving the daily free allocation for a focused fix.
    assert.deepEqual(problems, [], 'Help quality case failed.')
  }
  assert.equal(reports.find(report => report.path === '/c/nuk/admin/login').status, 200, 'The review login page must load.')
}
catch (error) {
  failure = error instanceof Error ? error.message : 'Preview check failed.'
  console.error(failure)
}
finally {
  await writeFile(`${directory}/results.json`, JSON.stringify({ revision: process.env.PREVIEW_REVISION ?? process.env.GITHUB_SHA ?? null, startedAt: reports.length ? new Date(Date.now() - reports.reduce((sum, report) => sum + report.elapsedMs, 0)).toISOString() : null, completedAt: new Date().toISOString(), passed: !failure, failure: failure ?? null, requests: reports }, null, 2))
}
if (failure) process.exitCode = 1
