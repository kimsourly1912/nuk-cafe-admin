import type { Locator, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { MockHandler } from './support/mock-api'
import { deferred, failures, mockApi, paginatedHandler, setupE2e, toast } from './support/mock-api'

// Schedules: list display and filters, create/edit encodings (docs/plans/schedules.md S1–S7),
// delete only for schedules not in use (S6). The browser runs in Phnom Penh (UTC+7) and the
// fixtures are UTC, so every time on screen is converted (S2) and some cross midnight.
await setupE2e()

const VIEWER_ZONE = 'Asia/Phnom_Penh'

type Row = Record<string, unknown> & { id: number, name: string, item_count: number }

// Days deliberately out of order: the API returns them in random order.
const LUNCH: Row = { id: 1, name: 'Lunch', description: 'Midday menu', status: 'ACTIVE', startTime: '11:00', endTime: '14:30', timezone: 'UTC', days: ['FRIDAY', 'MONDAY'], item_count: 0 }
const BREAKFAST: Row = { id: 2, name: 'Breakfast', status: 'ACTIVE', startTime: '06:00', endTime: '10:00', timezone: 'UTC', days: ['SUNDAY', 'MONDAY', 'SATURDAY', 'TUESDAY', 'FRIDAY', 'WEDNESDAY', 'THURSDAY'], item_count: 2 }
const DINNER: Row = { id: 3, name: 'Dinner', status: 'INACTIVE', startTime: '18:00', endTime: '22:00', timezone: 'UTC', days: ['SATURDAY', 'SUNDAY'], item_count: 0 }

const ITEMS = [
  { id: 11, productId: 40, productName: 'Latte', price: 3 },
  { id: 12, productId: 41, productName: 'Mocha', price: 3.5 },
]

/** A backend whose list reflects deletes, and whose detail adds `items` + translations. */
function backend(initial: Row[] = [LUNCH, BREAKFAST, DINNER]) {
  let rows = [...initial]
  const idOf = (u: URL) => Number(u.pathname.split('/').pop())
  const detailOf = (id: number) => {
    const row = rows.find(r => r.id === id)!
    return { ...row, item_count: undefined, items: row.item_count ? ITEMS : [], nameI18n: { 'zh-HK': '名' } }
  }
  const handlers: Record<string, MockHandler> = {
    'GET /staff/schedules': paginatedHandler(() => rows, 'name'),
    'GET /staff/schedules/{id}': ({ url }) => detailOf(idOf(url)),
    'DELETE /staff/schedules/{id}': ({ url }) => {
      rows = rows.filter(r => r.id !== idOf(url))
      return null
    },
  }
  return { handlers, detailOf }
}

async function open(handlers: Record<string, MockHandler> = backend().handlers, firstCell = 'Lunch') {
  const page = await createPage(undefined, { timezoneId: VIEWER_ZONE })
  const api = await mockApi(page, handlers)
  await page.goto(url('/schedules'), { waitUntil: 'hydration' })
  if (firstCell) await page.getByText(firstCell, { exact: true }).first().waitFor()
  return { page, api }
}

function rowOf(page: Page, name: string) {
  return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) })
}

async function rowAction(page: Page, name: string, action: string) {
  await rowOf(page, name).getByRole('button', { name: 'Actions' }).click()
  return page.getByRole('menuitem', { name: action })
}

const writes = (calls: string[]) => calls.filter(c => !c.startsWith('GET'))

/** A `UInputTime` (hour and minute segments), found by its aria-label. */
const timeField = (form: Locator, label: string) => form.getByRole('group', { name: label })

/** Types a time as a user would: focus the hour segment, then digits (`'0830'`). */
async function typeTime(form: Locator, label: string, digits: string) {
  await timeField(form, label).getByRole('spinbutton').first().click()
  await form.page().keyboard.type(digits)
}

/** What the field shows, e.g. `'08:30'`. */
async function shownTime(form: Locator, label: string) {
  return (await timeField(form, label).innerText()).replace(/\s/g, '')
}

describe('schedules list', () => {
  it('shows days and 12-hour times in the viewer timezone, and the item count', async () => {
    const { page } = await open()
    const lunch = rowOf(page, 'Lunch')
    await page.getByRole('columnheader', { name: 'Time (GMT+7)' }).waitFor()
    // 11:00–14:30 UTC on Mon, Fri.
    await lunch.getByText('Mon, Fri').waitFor()
    await lunch.getByText('6:00 PM – 9:30 PM').waitFor()
    await lunch.getByText('Midday menu').waitFor()
    await rowOf(page, 'Breakfast').getByText('Every day').waitFor()
    await rowOf(page, 'Breakfast').getByText('1:00 PM – 5:00 PM').waitFor()
    await rowOf(page, 'Breakfast').getByRole('cell', { name: '2', exact: true }).waitFor()
    // 18:00–22:00 UTC on Sat, Sun starts after midnight at UTC+7: the days move to Sun, Mon.
    await rowOf(page, 'Dinner').getByText('Mon, Sun').waitFor()
    await rowOf(page, 'Dinner').getByText('1:00 AM – 5:00 AM').waitFor()
  })

  it('filters by day of week through the API and keeps it in the URL', async () => {
    const seen: string[] = []
    const list = paginatedHandler([LUNCH, BREAKFAST, DINNER], 'name')
    const { page } = await open({
      'GET /staff/schedules': (request) => {
        seen.push(request.url.searchParams.get('dayOfWeek') ?? '')
        return list(request)
      },
    })
    await page.getByRole('combobox', { name: 'Day' }).click()
    await page.getByRole('option', { name: 'Wed' }).click()
    await expect.poll(() => seen.at(-1)).toBe('WEDNESDAY')
    await expect.poll(() => new URL(page.url()).searchParams.get('dayOfWeek')).toBe('WEDNESDAY')
  })

  it('shows the empty state when there are no schedules', async () => {
    const { page } = await open({ 'GET /staff/schedules': paginatedHandler([]) }, '')
    await page.getByText('No schedules yet').waitFor()
  })
})

describe('schedule form', () => {
  it('creates a schedule: 12-hour local input becomes 24-hour UTC, moving the days back across midnight', async () => {
    let body: unknown
    const { page } = await open({
      ...backend().handlers,
      'POST /staff/schedules': (request) => {
        body = request.body
        return { id: 9 }
      },
    })
    await page.getByRole('button', { name: 'New schedule' }).click()
    const form = page.getByRole('dialog', { name: 'New schedule' })

    // Nothing is sent while required fields are empty.
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('Pick at least one day').waitFor()
    await form.getByText('Start time is required').waitFor()

    await form.getByLabel('Name').fill('Brunch')
    // Input validation is debounced: the error below Name vanishes ~300 ms later and shifts the
    // checkboxes. Clicking before that misses (progress.md → How to verify).
    await form.getByText('Name is required').waitFor({ state: 'hidden' })
    await form.getByLabel('Sun').check()
    await form.getByLabel('Sat').check()
    await form.getByLabel('Mon').check()
    await typeTime(form, 'Start time', '0300A')
    await typeTime(form, 'End time', '1130A')
    expect(await shownTime(form, 'Start time')).toBe('3:00AM')
    await form.getByRole('button', { name: 'Create' }).click()

    await toast(page, 'Schedule "Brunch" created').waitFor()
    expect(body).toEqual({
      name: 'Brunch',
      description: '',
      status: 'ACTIVE',
      // Mon, Sat, Sun 3:00–11:30 AM at UTC+7 = Sun, Fri, Sat 20:00–04:30 UTC.
      startTime: '20:00',
      endTime: '04:30',
      days: ['FRIDAY', 'SATURDAY', 'SUNDAY'],
      items: [],
    })
  })

  it('day shortcuts replace the selection', async () => {
    const { page } = await open()
    await page.getByRole('button', { name: 'New schedule' }).click()
    const form = page.getByRole('dialog', { name: 'New schedule' })
    await form.getByRole('button', { name: 'Weekdays' }).click()
    expect(await form.getByLabel('Fri').isChecked()).toBe(true)
    expect(await form.getByLabel('Sat').isChecked()).toBe(false)
    await form.getByRole('button', { name: 'Weekends' }).click()
    expect(await form.getByLabel('Fri').isChecked()).toBe(false)
    expect(await form.getByLabel('Sun').isChecked()).toBe(true)
  })

  it('edits only after the detail has loaded, and re-sends its items and translations', async () => {
    const { handlers, detailOf } = backend()
    const detail = deferred()
    let body: unknown
    const { page } = await open({
      ...handlers,
      'GET /staff/schedules/{id}': detail.handler,
      'PUT /staff/schedules/{id}': (request) => {
        body = request.body
        return detailOf(2)
      },
    })
    await (await rowAction(page, 'Breakfast', 'Edit')).click()
    const form = page.getByRole('dialog', { name: 'Edit schedule' })

    // Filled from the row at once, but Save waits for the items.
    expect(await form.getByLabel('Name').inputValue()).toBe('Breakfast')
    await form.getByText('Loading menu items…').waitFor()
    expect(await form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)

    detail.release(detailOf(2))
    // Each linked item by name, with its id beside it.
    await expect.poll(() => form.getByText('Latte').first().innerText()).toMatch(/Latte\s*#40/)
    await form.getByText('Mocha').waitFor()
    await form.getByLabel('Name').fill('Early breakfast')
    await form.getByLabel('Sun').uncheck()
    await form.getByRole('button', { name: 'Save' }).click()

    await toast(page, 'Schedule "Early breakfast" updated').waitFor()
    expect(body).toEqual({
      name: 'Early breakfast',
      description: '',
      status: 'ACTIVE',
      startTime: '06:00',
      endTime: '10:00',
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
      items: [40, 41],
      nameI18n: { 'zh-HK': '名' },
    })
  })

  it('cannot save while the detail failed to load, and recovers with Retry', async () => {
    const { handlers, detailOf } = backend()
    let fail = true
    const { page, api } = await open({
      ...handlers,
      'GET /staff/schedules/{id}': () => {
        if (fail) throw failures.technical()
        return detailOf(1)
      },
    })
    await (await rowAction(page, 'Lunch', 'Edit')).click()
    const form = page.getByRole('dialog', { name: 'Edit schedule' })
    await form.getByText('Could not load this schedule\'s menu items').waitFor()
    expect(await form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(true)

    fail = false
    await form.getByRole('button', { name: 'Retry' }).click()
    await form.getByText('No menu items use this schedule.').waitFor()
    await expect.poll(() => form.getByRole('button', { name: 'Save' }).isDisabled()).toBe(false)
    expect(writes(api.calls)).toEqual([])
  })

  it('keeps the input and shows the backend reason when the save fails', async () => {
    const { page } = await open({
      ...backend().handlers,
      'PUT /staff/schedules/{id}': () => {
        throw failures.validation('End time must be after start time')
      },
    })
    await (await rowAction(page, 'Lunch', 'Edit')).click()
    const form = page.getByRole('dialog', { name: 'Edit schedule' })
    await form.getByText('No menu items use this schedule.').waitFor()
    // Shows the record's time in 24-hour form, and typing replaces it.
    // 14:30 UTC is 9:30 PM at UTC+7; typing replaces it.
    expect(await shownTime(form, 'End time')).toBe('9:30PM')
    await typeTime(form, 'End time', '1000P')
    await form.getByRole('button', { name: 'Save' }).click()

    await page.getByText('End time must be after start time').first().waitFor()
    expect(await shownTime(form, 'End time')).toBe('10:00PM')
  })
})

describe('schedule delete', () => {
  it('deletes a schedule that no menu item uses, after re-reading it', async () => {
    const { page, api } = await open()
    await (await rowAction(page, 'Lunch', 'Delete')).click()
    await page.getByText('Delete "Lunch"?').waitFor()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Schedule "Lunch" deleted').waitFor()
    const i = api.calls.indexOf('DELETE /staff/schedules/1')
    expect(i).toBeGreaterThan(-1)
    expect(api.calls.slice(0, i)).toContain('GET /staff/schedules/1')
  })

  it('does not offer Delete for a schedule in use', async () => {
    const { page } = await open()
    const item = await rowAction(page, 'Breakfast', 'Delete')
    expect(await item.getAttribute('aria-disabled')).toBe('true')
    await page.getByText('In use by 2 menu items', { exact: true }).waitFor()
  })

  it('refuses when a menu item started using the schedule after the list loaded', async () => {
    const { handlers, detailOf } = backend()
    const { page, api } = await open({
      ...handlers,
      // The list still says 0 items; the fresh detail has two.
      'GET /staff/schedules/{id}': ({ url }) => ({ ...detailOf(Number(url.pathname.split('/').pop())), items: ITEMS }),
    })
    await (await rowAction(page, 'Lunch', 'Delete')).click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Could not delete "Lunch"').waitFor()
    await page.getByText('In use by 2 menu items. Remove it from their schedules first.').first().waitFor()
    expect(writes(api.calls)).toEqual([])
  })

  it('bulk delete leaves schedules in use out, says so, and keeps them selected', async () => {
    const { page, api } = await open()
    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await page.getByText('3 selected').waitFor()
    await page.getByRole('button', { name: 'Delete' }).first().click()
    const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await dialog.getByText('1 schedule in use will be kept.').waitFor()
    await dialog.getByRole('button', { name: 'Delete' }).click()

    await toast(page, /^2 schedules deleted$/).waitFor()
    expect(writes(api.calls).sort()).toEqual(['DELETE /staff/schedules/1', 'DELETE /staff/schedules/3'])
    await page.getByText('1 selected').waitFor()
  })

  it('bulk delete skips a schedule whose edit is still saving (record lock)', async () => {
    const save = deferred()
    const { handlers, detailOf } = backend()
    const { page, api } = await open({ ...handlers, 'PUT /staff/schedules/{id}': save.handler })

    await (await rowAction(page, 'Lunch', 'Edit')).click()
    const form = page.getByRole('dialog', { name: 'Edit schedule' })
    await form.getByText('No menu items use this schedule.').waitFor()
    await form.getByLabel('Name').fill('Lunch 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await save.started()
    // The footer's Close (the header X is also named "Close").
    await form.locator('[data-slot="footer"]').getByRole('button', { name: 'Close' }).click()
    await form.waitFor({ state: 'hidden' })
    await page.locator('[aria-label="Working…"]').waitFor()

    await page.getByRole('checkbox', { name: 'Select all' }).click()
    await page.getByRole('button', { name: 'Delete' }).first().click()
    await page.getByRole('alertdialog').or(page.getByRole('dialog')).getByRole('button', { name: 'Delete' }).click()

    await toast(page, /^1 schedule deleted$/).waitFor()
    expect(writes(api.calls).filter(c => c.startsWith('DELETE'))).toEqual(['DELETE /staff/schedules/3'])
    // Lunch (busy) and Breakfast (in use) stay selected.
    await page.getByText('2 selected').waitFor()

    save.release(detailOf(1))
    await toast(page, 'Schedule "Lunch 2" updated').waitFor()
  })
})
