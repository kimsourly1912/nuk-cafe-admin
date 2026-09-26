import type { Locator, Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import type { Schedule, ScheduleDetail } from '../../shared/contracts/menu'
import type { MockHandler } from './support/mock-api'
import { deferred, failures, lastSegment, mockApi, paginatedHandler, scheduleOf, setupE2e, toast } from './support/mock-api'

// Schedules: list display and filters, create/edit bodies, delete only for schedules not in use.
// Times are local wall time at the cafe (D41): the browser runs in another zone (New York) on
// purpose, and nothing on screen or in a request is converted.
await setupE2e()

const VIEWER_ZONE = 'America/New_York'

const LUNCH = scheduleOf('sched-1', 'Lunch', { description: 'Midday menu', startTime: '11:00', endTime: '14:30', days: ['MONDAY', 'FRIDAY'] })
const BREAKFAST = scheduleOf('sched-2', 'Breakfast', {
  startTime: '06:00',
  endTime: '10:00',
  days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'],
  productCount: 2,
})
const DINNER = scheduleOf('sched-3', 'Dinner', { status: 'INACTIVE', startTime: '18:00', endTime: '22:00', days: ['SATURDAY', 'SUNDAY'] })

const PRODUCTS: ScheduleDetail['products'] = [
  { id: 'prod-40', name: 'Latte', status: 'ACTIVE' },
  { id: 'prod-41', name: 'Mocha', status: 'INACTIVE' },
]

/** A server whose list reflects deletes, and whose detail adds the menu items. */
function backend(initial: Schedule[] = [LUNCH, BREAKFAST, DINNER]) {
  let rows = [...initial]
  const detailOf = (id: string): ScheduleDetail => {
    const row = rows.find(r => r.id === id)!
    return { ...row, products: row.productCount ? PRODUCTS : [] }
  }
  const handlers: Record<string, MockHandler> = {
    'GET /admin/schedules': paginatedHandler(() => rows),
    'GET /admin/schedules/{id}': ({ url }) => detailOf(lastSegment(url)),
    'DELETE /admin/schedules/{id}': ({ url }) => {
      rows = rows.filter(r => r.id !== lastSegment(url))
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

/** A schedule's card. */
function rowOf(page: Page, name: string) {
  return page.getByRole('article', { name, exact: true })
}

async function rowAction(page: Page, name: string, action: string) {
  await page.getByRole('button', { name: `Actions for ${name}` }).click()
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

/** What the field shows, e.g. `'8:30AM'`. */
async function shownTime(form: Locator, label: string) {
  return (await timeField(form, label).innerText()).replace(/\s/g, '')
}

describe('schedules list', () => {
  it('shows the week as day pills and 12-hour cafe times as stored, whatever the viewer\'s zone', async () => {
    const { page } = await open()
    const lunch = rowOf(page, 'Lunch')
    await page.getByText('Cafe time: Asia/Phnom_Penh (GMT+7)').waitFor()
    // The pills are one image named by the days.
    await lunch.getByRole('img', { name: 'Mon, Fri' }).waitFor()
    await lunch.getByText('11:00 AM – 2:30 PM').waitFor()
    await lunch.getByText('Midday menu').waitFor()
    await rowOf(page, 'Breakfast').getByRole('img', { name: 'Every day' }).waitFor()
    await rowOf(page, 'Breakfast').getByText('6:00 AM – 10:00 AM').waitFor()
    await rowOf(page, 'Breakfast').getByText('2 menu items').waitFor()
    await rowOf(page, 'Dinner').getByRole('img', { name: 'Weekends' }).waitFor()
    await rowOf(page, 'Dinner').getByText('6:00 PM – 10:00 PM').waitFor()
  })

  it('names the zone of a schedule stored in another zone', async () => {
    const { page } = await open(backend([scheduleOf('sched-9', 'Lunch', { timeZone: 'UTC' })]).handlers)
    await rowOf(page, 'Lunch').getByText('UTC', { exact: true }).waitFor()
  })

  it('opens a schedule by clicking its card, and filters by status with counted tabs', async () => {
    const { page } = await open()
    const tabs = page.getByRole('group', { name: 'Status' })
    await expect.poll(() => tabs.innerText()).toMatch(/All\s*3\s*Active\s*2\s*Inactive\s*1/)
    await tabs.getByRole('tab', { name: /Inactive/ }).click()
    await expect.poll(() => page.getByRole('article').count()).toBe(1)
    await rowOf(page, 'Dinner').getByRole('heading', { name: 'Dinner' }).click()
    await page.getByRole('dialog', { name: 'Edit schedule' }).waitFor()
  })

  it('filters by day through the API and keeps it in the URL', async () => {
    const seen: string[] = []
    const list = paginatedHandler([LUNCH, BREAKFAST, DINNER])
    const { page } = await open({
      'GET /admin/schedules': (request) => {
        seen.push(request.url.searchParams.get('day') ?? '')
        return list(request)
      },
    })
    await page.getByRole('combobox', { name: 'Day' }).click()
    await page.getByRole('option', { name: 'Wed' }).click()
    await expect.poll(() => seen.at(-1)).toBe('WEDNESDAY')
    await expect.poll(() => new URL(page.url()).searchParams.get('day')).toBe('WEDNESDAY')
  })

  it('shows the empty state when there are no schedules', async () => {
    const { page } = await open({ 'GET /admin/schedules': paginatedHandler([]) }, '')
    await page.getByText('No schedules yet').waitFor()
  })
})

describe('schedule form', () => {
  it('creates a schedule: 12-hour input is sent as 24-hour cafe time, days in week order', async () => {
    let body: unknown
    const { page } = await open({
      ...backend().handlers,
      'POST /admin/schedules': (request) => {
        body = request.body
        return { ...scheduleOf('sched-9', 'Brunch'), products: [] }
      },
    })
    await page.getByRole('button', { name: 'New schedule' }).click()
    const form = page.getByRole('dialog', { name: 'New schedule' })
    await form.getByText('Times are cafe time: Asia/Phnom_Penh (GMT+7).').waitFor()

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
    await typeTime(form, 'Start time', '0930A')
    await typeTime(form, 'End time', '0200P')
    expect(await shownTime(form, 'Start time')).toBe('9:30AM')
    await form.getByRole('button', { name: 'Create' }).click()

    await toast(page, 'Schedule "Brunch" created').waitFor()
    expect(body).toEqual({
      name: 'Brunch',
      description: '',
      status: 'ACTIVE',
      startTime: '09:30',
      endTime: '14:00',
      days: ['MONDAY', 'SATURDAY', 'SUNDAY'],
    })
  })

  it('refuses a range that ends before it starts (no overnight ranges yet)', async () => {
    const { page, api } = await open()
    await page.getByRole('button', { name: 'New schedule' }).click()
    const form = page.getByRole('dialog', { name: 'New schedule' })
    await form.getByLabel('Name').fill('Late')
    await form.getByText('Name is required').waitFor({ state: 'hidden' })
    await form.getByRole('button', { name: 'Weekends' }).click()
    await typeTime(form, 'Start time', '1000P')
    await typeTime(form, 'End time', '0200A')
    await form.getByRole('button', { name: 'Create' }).click()
    await form.getByText('End time must be after the start time').waitFor()
    expect(writes(api.calls)).toEqual([])
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

  it('edits from the version it read, shows its menu items, and never sends them', async () => {
    const { handlers, detailOf } = backend()
    let body: unknown
    const { page } = await open({
      ...handlers,
      'PATCH /admin/schedules/{id}': (request) => {
        body = request.body
        return detailOf('sched-2')
      },
    })
    await (await rowAction(page, 'Breakfast', 'Edit')).click()
    const form = page.getByRole('dialog', { name: 'Edit schedule' })
    expect(await form.getByLabel('Name').inputValue()).toBe('Breakfast')
    await form.getByText('Latte').waitFor()
    await expect.poll(() => form.getByText('Mocha').first().innerText()).toMatch(/Mocha\s*\(inactive\)/)

    await form.getByLabel('Name').fill('Early breakfast')
    await form.getByLabel('Sun').uncheck()
    await form.getByRole('button', { name: 'Save' }).click()

    await toast(page, 'Schedule "Early breakfast" updated').waitFor()
    expect(body).toEqual({
      version: 1,
      name: 'Early breakfast',
      description: '',
      status: 'ACTIVE',
      startTime: '06:00',
      endTime: '10:00',
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'],
    })
  })

  it('can save while the menu items are still loading or failed to load (they aren\'t sent)', async () => {
    const { handlers, detailOf } = backend()
    const saved: unknown[] = []
    const { page } = await open({
      ...handlers,
      'GET /admin/schedules/{id}': () => {
        throw failures.server()
      },
      'PATCH /admin/schedules/{id}': (request) => {
        saved.push(request.body)
        return detailOf('sched-1')
      },
    })
    await (await rowAction(page, 'Lunch', 'Edit')).click()
    const form = page.getByRole('dialog', { name: 'Edit schedule' })
    await form.getByText('Could not load this schedule\'s menu items').waitFor()
    await form.getByLabel('Name').fill('Lunch 2')
    await form.getByRole('button', { name: 'Save' }).click()
    await toast(page, 'Schedule "Lunch 2" updated').waitFor()
    expect(saved).toHaveLength(1)
  })

  it('keeps the input and says why when someone else changed the schedule (409)', async () => {
    const { page } = await open({
      ...backend().handlers,
      'PATCH /admin/schedules/{id}': () => {
        throw failures.conflict('VERSION_CONFLICT', 'This schedule was changed by someone else. Reload it and try again.')
      },
    })
    await (await rowAction(page, 'Lunch', 'Edit')).click()
    const form = page.getByRole('dialog', { name: 'Edit schedule' })
    await form.getByText('No menu items use this schedule.').waitFor()
    // Shows the stored time, and typing replaces it.
    expect(await shownTime(form, 'End time')).toBe('2:30PM')
    await typeTime(form, 'End time', '0300P')
    await form.getByRole('button', { name: 'Save' }).click()

    await page.getByText('This schedule was changed by someone else. Reload it and try again.').first().waitFor()
    expect(await shownTime(form, 'End time')).toBe('3:00PM')
  })
})

describe('schedule delete', () => {
  it('deletes a schedule no menu item uses, naming the version it read', async () => {
    const { page, api } = await open()
    await (await rowAction(page, 'Lunch', 'Delete')).click()
    await page.getByText('Delete "Lunch"?').waitFor()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Schedule "Lunch" deleted').waitFor()
    expect(writes(api.calls)).toEqual(['DELETE /admin/schedules/sched-1'])
  })

  it('does not offer Delete for a schedule in use', async () => {
    const { page } = await open()
    const item = await rowAction(page, 'Breakfast', 'Delete')
    expect(await item.getAttribute('aria-disabled')).toBe('true')
    await page.getByText('In use by 2 menu items', { exact: true }).waitFor()
  })

  it('shows the server\'s reason when a menu item started using it after the list loaded', async () => {
    const { page } = await open({
      ...backend().handlers,
      'DELETE /admin/schedules/{id}': () => {
        throw failures.conflict('SCHEDULE_IN_USE', '"Lunch" is used by 2 menu items. Remove it from their schedules first.')
      },
    })
    await (await rowAction(page, 'Lunch', 'Delete')).click()
    await page.getByRole('button', { name: 'Delete' }).last().click()
    await toast(page, 'Could not delete "Lunch"').waitFor()
    await page.getByText('"Lunch" is used by 2 menu items. Remove it from their schedules first.').first().waitFor()
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
    expect(writes(api.calls).sort()).toEqual(['DELETE /admin/schedules/sched-1', 'DELETE /admin/schedules/sched-3'])
    await page.getByText('1 selected').waitFor()
  })

  it('bulk delete skips a schedule whose edit is still saving (record lock)', async () => {
    const save = deferred()
    const { handlers, detailOf } = backend()
    const { page, api } = await open({ ...handlers, 'PATCH /admin/schedules/{id}': save.handler })

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
    expect(writes(api.calls).filter(c => c.startsWith('DELETE'))).toEqual(['DELETE /admin/schedules/sched-3'])
    // Lunch (busy) and Breakfast (in use) stay selected.
    await page.getByText('2 selected').waitFor()

    save.release(detailOf('sched-1'))
    await toast(page, 'Schedule "Lunch 2" updated').waitFor()
  })
})
