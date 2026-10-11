import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { ChannelLink, MarketingChannel, MarketingChannels, MarketingPost } from '../../shared/contracts/marketing'
import type { Promotion } from '../../shared/contracts/menu-promotions'
import { MENU_COFFEE, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

// Marketing channels and posts (M2a, D164) against a mocked API: connecting a Telegram channel by
// its code, a removed channel and Disconnect; posting a promotion now or later, and the posts list.

const NEWS: MarketingChannel = { id: 'ch-1', kind: 'telegram_channel', title: 'NUK Cafe News', username: 'nukcafe', subscriberCount: 1250, status: 'connected', connectedBy: 'alice', connectedAt: '2026-10-11T03:00:00.000Z', version: 1 }
const OLD: MarketingChannel = { ...NEWS, id: 'ch-2', title: 'Old channel', username: null, status: 'removed' }

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)
const COFFEE_WEEK: Promotion = {
  id: 'promo-1', name: 'Coffee week', description: 'Every coffee.', status: 'published', phase: 'live', discount: { kind: 'percent', percent: 20 }, label: '20% off',
  scope: 'selected', items: [], categories: [{ id: MENU_COFFEE.id, name: 'Coffee', status: 'active' }], branches: [], startsOn: day(-1), endsOn: day(5),
  poster: { id: 'asset-1', url: '/media/poster-1.png' }, endedAt: null, version: 1, createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
}

const postOf = (id: string, over: Partial<MarketingPost> = {}): MarketingPost => ({
  id, promotionId: COFFEE_WEEK.id, channel: { id: NEWS.id, title: NEWS.title, kind: 'telegram_channel' }, status: 'sent', caption: 'Coffee week: 20% off', withPoster: true,
  scheduledAt: '2026-10-11T03:00:00.000Z', attempts: 1, sentAt: '2026-10-11T03:00:05.000Z', url: 'https://t.me/nukcafe/101', reason: null, createdBy: 'alice', createdAt: '2026-10-11T03:00:00.000Z', version: 2, ...over,
})

async function openChannels(options: { channels?: MarketingChannel[], enabled?: boolean } = {}) {
  let channels = options.channels ?? []
  let link: ChannelLink = { id: 'link-1', status: 'waiting', expiresAt: '2026-10-11T03:15:00.000Z', channel: null, channelId: null }
  const sent: { key: string, body: unknown }[] = []
  /** Flipped by the test once it read the steps, so the poll can't skip them (progress.md → polled mocks). */
  const posted = { value: false }
  const page = await createPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page, {
    'GET /admin/marketing/channels': (): MarketingChannels => ({ telegram: { enabled: options.enabled ?? true, botUsername: 'NukCafeBot' }, channels }),
    'POST /admin/marketing/channels/links': () => ({ ...link, command: '/connect ABCD2345EF', addBotUrl: 'https://t.me/NukCafeBot?startchannel&admin=post_messages+delete_messages', botUsername: 'NukCafeBot' }),
    'GET /admin/marketing/channels/links/{id}': () => {
      if (posted.value && link.status === 'waiting') link = { ...link, status: 'confirm', channel: { title: 'NUK Cafe News', username: 'nukcafe', subscriberCount: 1250 } }
      return link
    },
    'POST /admin/marketing/channels/links/{id}/confirm': () => {
      sent.push({ key: 'confirm', body: null })
      channels = [NEWS]
      return NEWS
    },
    'POST /admin/marketing/channels/links/{id}/cancel': () => ({ ...link, status: 'cancelled' }),
    'POST /admin/marketing/channels/{id}/disconnect': ({ url: u, body }) => {
      sent.push({ key: `disconnect ${u.pathname.split('/').at(-2)}`, body })
      channels = channels.filter(c => !u.pathname.includes(`/${c.id}/`))
      return null
    },
  })
  await page.goto(url('/c/nuk/admin/channels'), { waitUntil: 'hydration' })
  return { page, sent, posted }
}

async function openPromotion(options: { channels?: MarketingChannel[], posts?: MarketingPost[], failOnce?: boolean } = {}) {
  let posts = options.posts ?? []
  const sent: { key: string, body: unknown, idempotencyKey?: string }[] = []
  const page = await createPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  await mockApi(page, {
    'GET /admin/menu/promotions/{id}': () => COFFEE_WEEK,
    'GET /admin/menu/promotions/{id}/results': () => ({ orders: 5, units: 9, discountMinor: 630, salesMinor: 2520, bySource: { telegram: 2, facebook: 0 } }),
    'GET /admin/menu/promotions/{id}/posts': () => posts,
    'GET /admin/marketing/channels': (): MarketingChannels => ({ telegram: { enabled: true, botUsername: 'NukCafeBot' }, channels: options.channels ?? [NEWS, OLD] }),
    'POST /admin/menu/promotions/{id}/posts': ({ body, headers }) => {
      sent.push({ key: 'post', body, idempotencyKey: headers['idempotency-key'] })
      const input = body as { at: string | null, caption: string, withPoster: boolean }
      const created = postOf(`post-${posts.length + 1}`, input.at
        ? { status: 'pending', attempts: 0, sentAt: null, url: null, scheduledAt: input.at, caption: input.caption, withPoster: input.withPoster, version: 1 }
        : { caption: input.caption, withPoster: input.withPoster })
      posts = [created, ...posts]
      return [created]
    },
    'POST /admin/marketing/posts/{id}/cancel': ({ url: u, body }) => {
      sent.push({ key: `cancel ${u.pathname.split('/').at(-2)}`, body })
      posts = posts.map(p => (u.pathname.includes(`/${p.id}/`) ? { ...p, status: 'cancelled', reason: 'Cancelled before it went out.', version: p.version + 1 } : p))
      return posts.find(p => u.pathname.includes(`/${p.id}/`))
    },
    'POST /admin/marketing/posts/{id}/retry': ({ url: u, body }) => {
      sent.push({ key: `retry ${u.pathname.split('/').at(-2)}`, body })
      posts = posts.map(p => (u.pathname.includes(`/${p.id}/`) ? postOf(p.id, { version: p.version + 2 }) : p))
      return posts.find(p => u.pathname.includes(`/${p.id}/`))
    },
  })
  await page.goto(url(`/c/nuk/admin/promotions/${COFFEE_WEEK.id}`), { waitUntil: 'hydration' })
  await page.getByRole('region', { name: 'Posts' }).waitFor()
  return { page, sent }
}

describe('Channels', () => {
  it('connects a Telegram channel by the code posted in it, after confirming', async () => {
    const { page, sent, posted } = await openChannels()
    await page.getByText('No channel yet.').waitFor()
    await page.getByRole('button', { name: 'Connect a channel' }).click()
    const dialog = page.getByRole('dialog', { name: 'Connect a Telegram channel' })
    await dialog.getByTestId('connect-command').getByText('/connect ABCD2345EF').waitFor()
    expect(await dialog.getByRole('link', { name: 'Open Telegram' }).getAttribute('href')).toBe('https://t.me/NukCafeBot?startchannel&admin=post_messages+delete_messages')
    await dialog.getByText('Waiting for the code in your channel…').waitFor()

    posted.value = true
    await dialog.getByText('1,250 subscribers').waitFor({ timeout: 8000 })
    expect(await dialog.textContent()).toContain('@nukcafe')
    await dialog.getByRole('button', { name: 'Connect channel' }).click()
    await toast(page, 'NUK Cafe News is connected').waitFor()
    expect(sent).toEqual([{ key: 'confirm', body: null }])
    await page.getByText('Connected', { exact: true }).waitFor()
    expect(await page.getByRole('region', { name: 'Telegram channels' }).textContent()).toContain('@nukcafe · 1,250 subscribers')
  })

  it('shows a channel the bot was removed from, and disconnects after asking', async () => {
    const { page, sent } = await openChannels({ channels: [NEWS, OLD] })
    await page.getByText('Bot removed').waitFor()
    await page.getByText('The bot is no longer an admin there.').waitFor()
    await page.getByRole('button', { name: 'Reconnect' }).waitFor()

    await page.getByRole('button', { name: 'Actions for Old channel' }).click()
    await page.getByRole('menuitem', { name: 'Disconnect' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Disconnect' }).click()
    await toast(page, 'Old channel is disconnected').waitFor()
    expect(sent).toEqual([{ key: 'disconnect ch-2', body: { version: 1 } }])
    await expect.poll(() => page.getByRole('region', { name: 'Telegram channels' }).getByText('Old channel').count()).toBe(0)
  })

  it('says when Telegram isn\'t set up, and Facebook is coming', async () => {
    const { page } = await openChannels({ enabled: false })
    await page.getByText('Telegram isn\'t set up for this app yet.').waitFor()
    expect(await page.getByRole('button', { name: 'Connect a channel' }).isDisabled()).toBe(true)
    await page.getByRole('region', { name: 'Facebook Page' }).getByText('Coming soon').waitFor()
  })
})

describe('posting a promotion', () => {
  it('posts now with the poster and the caption it starts from, once per submission', async () => {
    const { page, sent } = await openPromotion()
    // Results count the orders from Telegram posts.
    await page.getByText('2 orders from Telegram posts.').waitFor()
    await page.getByText('Not posted yet.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Post to channels' }).click()
    const dialog = page.getByRole('dialog', { name: 'Post “Coffee week”' })
    // The only connected channel is chosen; the removed one can't be.
    expect(await dialog.getByRole('checkbox', { name: 'NUK Cafe News' }).getAttribute('aria-checked')).toBe('true')
    expect(await dialog.getByRole('checkbox', { name: 'Old channel' }).isDisabled()).toBe(true)
    const caption = dialog.getByLabel('Caption')
    expect(await caption.inputValue()).toMatch(/^Coffee week: 20% off\n\nEvery coffee\.\n\nUntil \d+ \w{3}\.$/)
    await caption.fill('Coffee week: 20% off every coffee!')
    expect(await dialog.getByTestId('post-preview').textContent()).toContain('Coffee week: 20% off every coffee!')

    await dialog.getByRole('button', { name: 'Post now' }).click()
    await toast(page, 'Posted to NUK Cafe News').waitFor()
    expect(sent).toHaveLength(1)
    expect(sent[0]!.body).toEqual({ channelIds: ['ch-1'], caption: 'Coffee week: 20% off every coffee!', withPoster: true, at: null })
    expect(sent[0]!.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/)

    const posts = page.getByRole('region', { name: 'Posts' })
    await posts.getByText('Sent', { exact: true }).waitFor()
    expect(await posts.getByRole('link', { name: 'View post in NUK Cafe News' }).getAttribute('href')).toBe('https://t.me/nukcafe/101')
  })

  it('schedules a post for later, and cancels it after asking', async () => {
    const { page, sent } = await openPromotion()
    await page.getByRole('button', { name: 'Post to channels' }).click()
    const dialog = page.getByRole('dialog', { name: 'Post “Coffee week”' })
    await dialog.getByRole('radio', { name: 'Later' }).check()
    await dialog.getByRole('switch', { name: 'Include the poster' }).click()
    const later = new Date(Date.now() + 2 * 86_400_000)
    const pad = (n: number) => String(n).padStart(2, '0')
    await dialog.getByLabel('Date and time').fill(`${later.getFullYear()}-${pad(later.getMonth() + 1)}-${pad(later.getDate())}T09:30`)
    await dialog.getByRole('button', { name: 'Schedule post' }).click()
    await toast(page, 'Post scheduled for NUK Cafe News').waitFor()
    const body = sent[0]!.body as { at: string, withPoster: boolean }
    expect(body.withPoster).toBe(false)
    expect(new Date(body.at).getHours()).toBe(9)

    const posts = page.getByRole('region', { name: 'Posts' })
    await posts.getByText('Scheduled', { exact: true }).waitFor()
    await posts.getByRole('button', { name: 'Cancel the post to NUK Cafe News' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel post' }).click()
    await toast(page, 'Post to NUK Cafe News cancelled').waitFor()
    expect(sent[1]).toEqual({ key: 'cancel post-1', body: { version: 1 } })
    await posts.getByText('Cancelled', { exact: true }).waitFor()
  })

  it('shows why a post failed, and Try again posts it', async () => {
    const failed = postOf('post-7', { status: 'failed', url: null, sentAt: null, attempts: 5, reason: 'Telegram didn\'t accept it after 5 tries.', version: 6 })
    const { page, sent } = await openPromotion({ posts: [failed] })
    const posts = page.getByRole('region', { name: 'Posts' })
    await posts.getByText('Telegram didn\'t accept it after 5 tries.', { exact: false }).waitFor()
    await posts.getByRole('button', { name: 'Try again: NUK Cafe News' }).click()
    await toast(page, 'Posted to NUK Cafe News').waitFor()
    expect(sent).toEqual([{ key: 'retry post-7', body: { version: 6 } }])
    await posts.getByText('Sent', { exact: true }).waitFor()
  })

  it('points to Channels when none is connected', async () => {
    const { page } = await openPromotion({ channels: [] })
    await page.getByRole('button', { name: 'Post to channels' }).click()
    const dialog = page.getByRole('dialog', { name: 'Post “Coffee week”' })
    await dialog.getByText('No channel is connected yet.', { exact: false }).waitFor()
    expect(await dialog.getByRole('link', { name: 'Go to Channels' }).getAttribute('href')).toBe('/c/nuk/admin/channels')
    expect(await dialog.getByRole('button', { name: 'Post now' }).isDisabled()).toBe(true)
  })
})
