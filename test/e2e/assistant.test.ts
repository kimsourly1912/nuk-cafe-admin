import type { Page, Route } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { AssistantStatus } from '../../shared/contracts/assistant'
import { mockApi, setupE2e } from './support/mock-api'

await setupE2e()

// The help assistant (step 9.1, D109): the Ask button and panel where an AI key is set, answers
// streamed with buttons to pages, errors with Try again. The chat route is mocked with the AI SDK's
// UI message stream (server-sent events), as the server sends it.

const STATUS: AssistantStatus = { dailyLimit: 100, usedToday: 3 }

/** A UI message stream: text, then links, then the end. */
function stream(text: string, links: { title: string, path: string }[] = []) {
  const events: unknown[] = [
    { type: 'start' },
    { type: 'start-step' },
    { type: 'text-start', id: 't1' },
    { type: 'text-delta', id: 't1', delta: text },
    { type: 'text-end', id: 't1' },
    ...links.flatMap((link, i) => [
      { type: 'tool-input-available', toolCallId: `c${i}`, toolName: 'link_to_page', input: { page: link.title.toLowerCase() } },
      { type: 'tool-output-available', toolCallId: `c${i}`, output: link },
    ]),
    { type: 'finish-step' },
    { type: 'finish' },
  ]
  return `${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`
}

const failedStream = `${[{ type: 'start' }, { type: 'error', errorText: 'The assistant can\'t answer right now. Try again in a moment.' }].map(e => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`

type ChatReply = { body: string } | { status: number, json: unknown }

/** Mocks the chat route; each request gets the next reply and is kept for checks. */
async function mockChat(page: Page, replies: ChatReply[]) {
  const requests: { messages: { role: string, parts: { type: string, text?: string }[] }[], page: string }[] = []
  await page.route(url('/api/admin/assistant/chat'), async (route: Route) => {
    requests.push(route.request().postDataJSON())
    const reply = replies.shift() ?? { body: stream('…') }
    if ('body' in reply) await route.fulfill({ status: 200, contentType: 'text/event-stream', headers: { 'x-vercel-ai-ui-message-stream': 'v1' }, body: reply.body })
    else await route.fulfill({ status: reply.status, json: reply.json })
  })
  return requests
}

async function open(path = '/admin/staff', width = 1440) {
  const page = await createPage()
  await page.setViewportSize({ width, height: 900 })
  await mockApi(page, {
    'GET /admin/assistant': () => STATUS,
    'GET /admin/staff': () => ({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 1 }),
    // The pages the tests visit, empty: only the panel matters here.
    'GET /admin/branches/options': () => [],
    'GET /admin/exchange-rates': () => ({ current: null, history: [] }),
    'GET /admin/khqr': () => ({ version: 0, enabled: false, accountId: null, merchantName: null, merchantCity: null, currencies: [], updatedAt: null, updatedBy: null, automaticCheck: false }),
  })
  // The Ask button and the shortcut work once the assistant's status has loaded.
  const status = page.waitForResponse(response => response.url().endsWith('/api/admin/assistant'))
  await page.goto(url(path), { waitUntil: 'hydration' })
  await status
  return page
}

const panel = (page: Page) => page.locator('aside[aria-label="Assistant"] [data-slot="container"]')
const askButton = (page: Page) => page.getByRole('button', { name: /^Assistant/ })

describe('the help assistant', () => {
  it('is hidden where it is off (no AI key: its status is 404)', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 1440, height: 900 })
    const api = await mockApi(page)
    await page.goto(url('/admin'), { waitUntil: 'hydration' })
    await expect.poll(() => api.calls.includes('GET /admin/assistant')).toBe(true)
    await page.getByText('Welcome back').waitFor()
    expect(await askButton(page).count()).toBe(0)
    // Its shortcut does nothing either: the panel stays closed.
    await page.keyboard.press('Control+/')
    await page.waitForTimeout(300)
    expect(await panel(page).getAttribute('data-state')).toBe('collapsed')
  })

  it('opens beside the page, suggests questions for it, streams an answer with a link that opens the page', async () => {
    const page = await open('/admin/staff')
    const requests = await mockChat(page, [{ body: stream('1. Press **Add staff member**.\n2. Copy the password.', [{ title: 'Staff', path: '/admin/staff' }, { title: 'Branch', path: '/admin/branches' }]) }])
    await askButton(page).click()
    await panel(page).getByText('Answers from the NUK Cafe help guide').waitFor()
    // Docked: the page narrows instead of being covered.
    await expect.poll(() => panel(page).getAttribute('data-state')).toBe('expanded')

    await panel(page).getByRole('button', { name: 'How do I add a cashier?' }).click()
    await panel(page).getByText('Add staff member', { exact: true }).waitFor()
    expect(await panel(page).locator('strong', { hasText: 'Add staff member' }).count()).toBe(1)
    expect(requests).toHaveLength(1)
    expect(requests[0]!.page).toBe('/admin/staff')
    expect(requests[0]!.messages.map(m => [m.role, m.parts[0]?.text])).toEqual([['user', 'How do I add a cashier?']])

    await panel(page).getByRole('link', { name: 'Open Branch' }).click()
    await page.waitForURL(address => address.pathname === '/admin/branches')
    // The panel stays open beside the next page, with the conversation.
    await panel(page).getByText('Copy the password.').waitFor()
  })

  it('sends the conversation so far with the next question, and Clear chat starts over', async () => {
    const page = await open('/admin/categories')
    const requests = await mockChat(page, [{ body: stream('Use **Add subcategory**.') }, { body: stream('Press **Reorder**.') }])
    await askButton(page).click()
    const prompt = panel(page).getByRole('textbox', { name: 'Your question' })
    await prompt.fill('How do I add a subcategory?')
    await prompt.press('Enter')
    await panel(page).getByText('Add subcategory', { exact: true }).waitFor()
    await prompt.fill('And change the order?')
    await prompt.press('Enter')
    await panel(page).getByText('Reorder', { exact: true }).waitFor()
    expect(requests[1]!.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user'])

    await panel(page).getByRole('button', { name: 'Clear chat' }).click()
    await panel(page).getByRole('button', { name: 'How do I add a subcategory?' }).waitFor()
    expect(await panel(page).getByText('Reorder', { exact: true }).count()).toBe(0)
  })

  it('a failed answer offers Try again, which asks again', async () => {
    const page = await open('/admin/payments')
    const requests = await mockChat(page, [{ body: failedStream }, { body: stream('Set it on **Payments**.') }])
    // Ctrl/⌘+/ opens it too, once the app knows it's on (the button shows).
    await askButton(page).waitFor()
    await page.keyboard.press('Control+/')
    await panel(page).getByRole('button', { name: 'How does the riel rate work?' }).click()
    await panel(page).getByText('The assistant can\'t answer right now. Try again in a moment.').waitFor()
    await panel(page).getByRole('button', { name: 'Try again' }).click()
    await panel(page).getByText('Payments', { exact: true }).waitFor()
    expect(requests).toHaveLength(2)
    expect(requests[1]!.messages.map(m => m.role)).toEqual(['user'])
    expect(await panel(page).getByRole('button', { name: 'Try again' }).count()).toBe(0)
  })

  it('past today\'s limit, says so without Try again', async () => {
    const page = await open('/admin')
    await mockChat(page, [{ status: 429, json: { statusCode: 429, message: 'x', data: { code: 'AI_LIMIT_REACHED', message: 'You\'ve used today\'s 100 assistant requests. They reset at midnight.' } } }])
    await askButton(page).click()
    const prompt = panel(page).getByRole('textbox', { name: 'Your question' })
    await prompt.fill('Hello?')
    await prompt.press('Enter')
    await panel(page).getByText('You\'ve used today\'s 100 assistant requests. They reset at midnight.').waitFor()
    expect(await panel(page).getByRole('button', { name: 'Try again' }).count()).toBe(0)
  })

  it('on a phone: a full-width sheet; a link closes it and opens the page', async () => {
    const page = await open('/admin/branches', 390)
    await mockChat(page, [{ body: stream('Open **Branch**, then **Dining tables**.', [{ title: 'Branch', path: '/admin/branches' }, { title: 'Payments', path: '/admin/payments' }]) }])
    // On a phone the button is in the menu.
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await askButton(page).click()
    const sheet = page.getByRole('dialog', { name: 'Assistant' })
    await sheet.waitFor()
    const box = await sheet.boundingBox()
    expect(box!.width).toBeGreaterThan(300)
    await sheet.getByRole('button', { name: 'How do I print a table\'s QR code?' }).click()
    await sheet.getByRole('link', { name: 'Open Payments' }).click()
    await page.waitForURL(address => address.pathname === '/admin/payments')
    await sheet.waitFor({ state: 'hidden' })
  })
})
