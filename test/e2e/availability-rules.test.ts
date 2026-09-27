import type { Locator, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { AvailabilityRule, AvailabilityWindow } from '../../shared/contracts/menu-availability'
import { failures, MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

const STAMP = '2026-09-27T00:00:00.000Z'
const w = (weekday: number, startMinute: number, endMinute: number): AvailabilityWindow => ({ weekday, startMinute, endMinute })

function ruleOf(id: string, name: string, overrides: Partial<AvailabilityRule> = {}): AvailabilityRule {
  return { id, name, status: 'active', windows: [1, 2, 3, 4, 5].map(d => w(d, 420, 660)), itemCount: 0, categoryCount: 0, version: 1, createdAt: STAMP, updatedAt: STAMP, ...overrides }
}

const BREAKFAST = ruleOf('rule-1', 'Breakfast', { itemCount: 3, categoryCount: 1 })
const LATE = ruleOf('rule-2', 'Late night', { windows: [w(5, 1320, 120), w(6, 1320, 120)] })
const OLD = ruleOf('rule-3', 'Old brunch', { status: 'archived', version: 4 })

async function open(rules: AvailabilityRule[] = [BREAKFAST, LATE, OLD], extra: Parameters<typeof mockApi>[1] = {}) {
  const page = await createPage()
  const api = await mockApi(page, { 'GET /admin/menu/availability-rules': () => rules, ...extra })
  await page.goto(url('/availability'), { waitUntil: 'hydration' })
  return { page, api }
}

const card = (page: Page, name: string) => page.getByRole('article', { name, exact: true })
const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))

async function cardAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
  return page.getByRole('menuitem', { name: action })
}

const timeField = (form: Locator, label: string) => form.getByRole('group', { name: label })
async function typeTime(form: Locator, label: string, digits: string) {
  await timeField(form, label).getByRole('spinbutton').first().click()
  await form.page().keyboard.type(digits)
}

describe('availability rules list', () => {
  it('shows each rule\'s times in words and what uses it, active ones first', async () => {
    const { page } = await open()
    await card(page, 'Breakfast').getByText('Mon–Fri · 7:00 AM – 11:00 AM').waitFor()
    await card(page, 'Breakfast').getByText('In use by 3 menu items and 1 category').waitFor()
    await card(page, 'Late night').getByText('Fri, Sat · 10:00 PM – 2:00 AM (next day)').waitFor()
    await card(page, 'Late night').getByText('Not used yet').waitFor()
    expect(await card(page, 'Old brunch').count()).toBe(0)

    await page.getByRole('tab', { name: /Archived/ }).click()
    await card(page, 'Old brunch').getByText('Archived').waitFor()
    await expect.poll(() => new URL(page.url()).searchParams.get('status')).toBe('archived')
  })

  it('searches by name', async () => {
    const { page } = await open()
    await page.getByPlaceholder('Search rules…').fill('late')
    await expect.poll(() => card(page, 'Breakfast').count()).toBe(0)
    await card(page, 'Late night').waitFor()
  })

  it('won\'t archive a rule that is in use, and says why', async () => {
    const { page } = await open()
    const item = await cardAction(page, 'Breakfast', 'Archive')
    await expect.poll(() => item.getAttribute('data-disabled')).not.toBeNull()
    await item.getByText('In use by 3 menu items and 1 category').waitFor()
  })

  it('archives an unused rule after confirming, and restores an archived one', async () => {
    const archived: unknown[] = []
    const restored: unknown[] = []
    const { page, api } = await open(undefined, {
      'POST /admin/menu/availability-rules/{id}/archive': ({ body }) => {
        archived.push(body)
        return { ...LATE, status: 'archived', version: 2 }
      },
      'POST /admin/menu/availability-rules/{id}/restore': ({ body }) => {
        restored.push(body)
        return { ...OLD, status: 'active', version: 5 }
      },
    })
    await (await cardAction(page, 'Late night', 'Archive')).click()
    await page.getByRole('button', { name: 'Archive' }).last().click()
    await toast(page, 'Rule "Late night" archived').waitFor()
    expect(archived).toEqual([{ version: 1 }])

    await page.getByRole('tab', { name: /Archived/ }).click()
    await (await cardAction(page, 'Old brunch', 'Restore')).click()
    await toast(page, 'Rule "Old brunch" restored').waitFor()
    expect(restored).toEqual([{ version: 4 }])
    expect(writes(api.calls)).toEqual(['POST /admin/menu/availability-rules/rule-2/archive', 'POST /admin/menu/availability-rules/rule-3/restore'])
  })
})

describe('availability rule form', () => {
  it('creates a rule from rows of days and times, one window per day', async () => {
    const created: unknown[] = []
    const { page } = await open([], {
      'POST /admin/menu/availability-rules': ({ body }) => {
        created.push(body)
        return ruleOf('rule-9', 'Brunch')
      },
    })
    await page.getByRole('button', { name: 'New rule' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name').fill('Brunch')
    // The first row starts as Mon–Fri: make it the weekend.
    const first = form.getByRole('group', { name: 'Time 1' })
    for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) await first.getByLabel(day, { exact: true }).click()
    await typeTime(form, 'Start of time 1', '1000A')
    await typeTime(form, 'End of time 1', '0200P')
    // A late window on Friday that runs past midnight.
    await form.getByRole('button', { name: 'Add another time' }).click()
    await form.getByRole('group', { name: 'Time 2' }).getByLabel('Fri', { exact: true }).click()
    await typeTime(form, 'Start of time 2', '1000P')
    await typeTime(form, 'End of time 2', '1200A')
    await form.getByRole('button', { name: 'Create' }).click()

    await toast(page, 'Rule "Brunch" created').waitFor()
    expect(created).toEqual([{ name: 'Brunch', windows: [w(6, 600, 840), w(7, 600, 840), w(5, 1320, 1440)] }])
  })

  it('shows what\'s missing before sending anything', async () => {
    const { page, api } = await open([])
    await page.getByRole('button', { name: 'New rule' }).first().click()
    const form = page.getByRole('dialog')
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Name is required').waitFor()
    await form.getByText('Start time is required').waitFor()
    await form.getByText('End time is required').waitFor()
    expect(writes(api.calls)).toEqual([])
  })

  it('edits a rule: its windows open grouped, and the save sends the version read', async () => {
    const updates: unknown[] = []
    const { page } = await open(undefined, {
      'PATCH /admin/menu/availability-rules/{id}': ({ body }) => {
        updates.push(body)
        return { ...BREAKFAST, version: 2 }
      },
    })
    await card(page, 'Breakfast').getByRole('heading').click()
    const form = page.getByRole('dialog')
    await expect.poll(() => form.getByRole('group', { name: /^Time \d$/ }).count()).toBe(1)
    await form.getByRole('group', { name: 'Time 1' }).getByLabel('Sat', { exact: true }).click()
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Rule "Breakfast" updated').waitFor()
    expect(updates).toEqual([{ version: 1, name: 'Breakfast', windows: [1, 2, 3, 4, 5, 6].map(d => w(d, 420, 660)) }])
  })

  it('marks the row the server found overlapping, and keeps the form open', async () => {
    const { page } = await open([LATE], {
      'PATCH /admin/menu/availability-rules/{id}': () => {
        throw new MockFailure(422, 'AVAILABILITY_WINDOWS', 'Overlaps another window (Friday 22:00–02:00).', { 'windows.2': ['Overlaps another window (Friday 22:00–02:00).'] })
      },
    })
    await card(page, 'Late night').getByRole('heading').click()
    const form = page.getByRole('dialog')
    await form.getByRole('button', { name: 'Add another time' }).click()
    await form.getByRole('group', { name: 'Time 2' }).getByLabel('Sat', { exact: true }).click()
    await typeTime(form, 'Start of time 2', '0100A')
    await typeTime(form, 'End of time 2', '0300A')
    await form.getByRole('button', { name: 'Save' }).click()
    await form.getByRole('group', { name: 'Time 2' }).getByText('Overlaps another window (Friday 22:00–02:00).').waitFor()
    expect(await form.getByRole('group', { name: 'Time 1' }).getByText(/Overlaps/).count()).toBe(0)
  })

  it('keeps the input when someone else saved first', async () => {
    const { page } = await open([LATE], {
      'PATCH /admin/menu/availability-rules/{id}': () => {
        throw failures.conflict('VERSION_CONFLICT', 'This availability rule was changed by someone else. Reload it and try again.')
      },
    })
    await card(page, 'Late night').getByRole('heading').click()
    const form = page.getByRole('dialog')
    await form.getByLabel('Name').fill('Night owls')
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Could not save "Night owls"').waitFor()
    expect(await form.getByLabel('Name').inputValue()).toBe('Night owls')
  })
})
