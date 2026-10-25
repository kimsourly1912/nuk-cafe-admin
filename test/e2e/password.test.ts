import { createHash } from 'node:crypto'
import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { ADMIN, failures, gotoViaSidebar, MockFailure, mockApi, setupE2e, toast } from './support/mock-api'

await setupE2e()

const path = (page: Page) => new URL(page.url()).pathname

/** The admin session, on a temporary password until the change succeeds. */
function temporaryPasswordBackend() {
  let changed = false
  const bodies: unknown[] = []
  return {
    bodies,
    handlers: {
      'GET /admin/me': () => ({ ...ADMIN, mustChangePassword: !changed }),
      'POST /auth/change-password': ({ body }: { body: unknown }) => {
        bodies.push(body)
        if ((body as { currentPassword: string }).currentPassword !== 'Temp-1234-abcd') {
          throw new MockFailure(400, 'INVALID_PASSWORD', 'Invalid password')
        }
        changed = true
        return { token: null, user: { id: ADMIN.userId } }
      },
    },
  }
}

async function fillPasswords(page: Page, current: string, next: string, repeat = next) {
  await page.getByLabel(/^(Temporary|Current) password/).fill(current)
  await page.getByLabel(/^New password/).fill(next)
  await page.getByLabel(/^Repeat new password/).fill(repeat)
}

describe('temporary password', () => {
  it('keeps every page behind the change-password page until it is changed, then goes on', async () => {
    const page = await createPage()
    const backend = temporaryPasswordBackend()
    await mockApi(page, backend.handlers)

    await page.goto(url('/c/nuk/admin/categories'), { waitUntil: 'hydration' })
    await expect.poll(() => path(page)).toBe('/c/nuk/admin/change-password')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/c/nuk/admin/categories')
    await page.getByRole('heading', { name: 'Choose your password' }).waitFor()
    // No app around it: the sidebar isn't there.
    expect(await page.getByRole('link', { name: 'Categories' }).count()).toBe(0)

    await fillPasswords(page, 'Temp-1234-abcd', 'my own password')
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect.poll(() => path(page)).toBe('/c/nuk/admin/categories')
    await toast(page, 'Password changed').waitFor()
    expect(backend.bodies).toEqual([{ currentPassword: 'Temp-1234-abcd', newPassword: 'my own password', revokeOtherSessions: true }])
  })

  it('says so when the temporary password is wrong, and stays', async () => {
    const page = await createPage()
    const backend = temporaryPasswordBackend()
    await mockApi(page, backend.handlers)
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })

    await fillPasswords(page, 'wrong', 'my own password')
    await page.getByRole('button', { name: 'Change password' }).click()
    await page.getByText('Your current password is incorrect.').waitFor()
    expect(path(page)).toBe('/c/nuk/admin/change-password')
  })

  it('checks the repeat and refuses the same password before sending anything', async () => {
    const page = await createPage()
    const backend = temporaryPasswordBackend()
    await mockApi(page, backend.handlers)
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })

    await fillPasswords(page, 'Temp-1234-abcd', 'my own password', 'my own passwort')
    await page.getByRole('button', { name: 'Change password' }).click()
    await page.getByText('The passwords don\'t match').waitFor()
    await fillPasswords(page, 'Temp-1234-abcd', 'Temp-1234-abcd')
    await page.getByRole('button', { name: 'Change password' }).click()
    await page.getByText('Choose a password different from the current one').waitFor()
    expect(backend.bodies).toEqual([])
  })

  it('moves to the change-password page when a route asks for it mid-session', async () => {
    const page = await createPage()
    await mockApi(page, {
      'GET /admin/menu/availability-rules': () => {
        throw failures.passwordChangeRequired()
      },
    })
    // Signed in normally; the Availability list is the first request to meet the refusal.
    await gotoViaSidebar(page, ['Availability'])
    await expect.poll(() => path(page)).toBe('/c/nuk/admin/change-password')
  })
})

describe('the password rules\' checklist (D210)', () => {
  const lines = (page: Page) => page.getByRole('list', { name: 'Password requirements' }).getByRole('listitem')
  const states = (page: Page) => lines(page).evaluateAll(items => items.map(item => item.getAttribute('data-state')))

  it('ticks each rule while typing, checking for a leaked password once typing pauses', async () => {
    const page = await createPage()
    await mockApi(page, temporaryPasswordBackend().handlers)
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })

    expect(await lines(page).allInnerTexts()).toEqual([
      expect.stringContaining('At least 8 characters'),
      expect.stringContaining('Repeat new password matches'),
      expect.stringContaining('Not a commonly used password'),
    ])
    expect(await states(page)).toEqual(['pending', 'pending', 'pending'])
    await page.getByLabel(/^New password/).fill('short')
    expect(await states(page)).toEqual(['pending', 'pending', 'pending'])
    expect(await lines(page).last().innerText()).toContain('Checked against passwords leaked from other websites')
    await page.getByLabel(/^New password/).fill('my own password')
    await expect.poll(() => states(page)).toEqual(['met', 'pending', 'met'])
    await page.getByLabel(/^Repeat new password/).fill('my own password')
    await expect.poll(() => states(page)).toEqual(['met', 'met', 'met'])
  })

  it('puts a breached password\'s refusal on the field and the checklist, until it is changed', async () => {
    const page = await createPage()
    const backend = temporaryPasswordBackend()
    await mockApi(page, {
      ...backend.handlers,
      'POST /auth/change-password': () => {
        throw new MockFailure(400, 'PASSWORD_COMPROMISED', 'The password you entered has been compromised.')
      },
    })
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })

    await fillPasswords(page, 'Temp-1234-abcd', 'password123')
    await page.getByRole('button', { name: 'Change password' }).click()
    await page.getByText('This password is too common. Choose another one.').waitFor()
    await expect.poll(() => states(page)).toEqual(['met', 'met', 'failed'])
    await expect.poll(() => page.getByLabel(/^New password/).evaluate(el => el === document.activeElement)).toBe(true)
    expect(await page.getByRole('alert').count()).toBe(0)

    await page.getByLabel(/^New password/).fill('a much better password')
    await expect.poll(() => states(page)).toEqual(['met', 'pending', 'met'])
    await page.getByText('This password is too common. Choose another one.').waitFor({ state: 'hidden' })
  })

  it('marks a leaked password red while typing, sending only the hash\'s first 5 characters', async () => {
    const page = await createPage()
    const sha1 = createHash('sha1').update('password123').digest('hex').toUpperCase()
    const asked: string[] = []
    await mockApi(page, {
      ...temporaryPasswordBackend().handlers,
      'GET /password-ranges/{prefix}': ({ url: requestUrl }) => {
        asked.push(requestUrl.pathname)
        return { suffixes: requestUrl.pathname.endsWith(sha1.slice(0, 5)) ? [sha1.slice(5)] : [] }
      },
    })
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })

    await page.getByLabel(/^New password/).fill('password123')
    await expect.poll(() => states(page)).toEqual(['met', 'pending', 'failed'])
    expect(asked).toEqual([`/api/password-ranges/${sha1.slice(0, 5)}`])
    await page.getByLabel(/^New password/).fill('a much better password')
    await expect.poll(() => states(page)).toEqual(['met', 'pending', 'met'])
  })

  it('Generate puts a strong password in both fields, shown, ticked without a check, and it is what gets sent', async () => {
    const page = await createPage()
    const backend = temporaryPasswordBackend()
    const api = await mockApi(page, backend.handlers)
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })

    await page.getByLabel(/^Temporary password/).fill('Temp-1234-abcd')
    await page.getByRole('button', { name: 'Generate a strong password' }).click()
    const generated = await page.getByLabel(/^New password/).inputValue()
    expect(generated).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{5}(-[a-km-zA-HJ-NP-Z2-9]{5}){3}$/)
    expect(await page.getByLabel(/^Repeat new password/).inputValue()).toBe(generated)
    expect(await page.getByLabel(/^New password/).getAttribute('type')).toBe('text')
    await expect.poll(() => states(page)).toEqual(['met', 'met', 'met'])
    await page.getByRole('status').filter({ hasText: 'A strong password was filled in.' }).waitFor({ state: 'attached' })
    // Random, so never looked up, however often it's pressed.
    await page.getByRole('button', { name: 'Generate a strong password' }).click()
    await page.getByRole('button', { name: 'Generate a strong password' }).click()
    await page.waitForTimeout(800)
    expect(api.calls.filter(call => call.includes('/password-ranges/'))).toEqual([])
    expect(await states(page)).toEqual(['met', 'met', 'met'])
    const sent = await page.getByLabel(/^New password/).inputValue()

    await page.getByRole('button', { name: 'Change password' }).click()
    await toast(page, 'Password changed').waitFor()
    expect(backend.bodies).toEqual([{ currentPassword: 'Temp-1234-abcd', newPassword: sent, revokeOtherSessions: true }])
  })
})

describe('changing one\'s password', () => {
  it('is in the user menu, and goes back afterwards', async () => {
    const page = await createPage()
    const bodies: unknown[] = []
    await mockApi(page, {
      'POST /auth/change-password': ({ body }) => {
        bodies.push(body)
        return { token: null, user: { id: ADMIN.userId } }
      },
    })
    await page.goto(url('/c/nuk/admin/categories'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'alice', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Change password' }).click()

    await page.getByRole('heading', { name: 'Change password' }).waitFor()
    await fillPasswords(page, 'my own password', 'a better password')
    await page.getByRole('button', { name: 'Change password' }).click()
    await toast(page, 'Password changed').waitFor()
    await expect.poll(() => path(page)).toBe('/c/nuk/admin')
    expect(bodies).toHaveLength(1)
  })
})

describe('change password as a task flow (D84)', () => {
  it('fills a phone screen, with Change password and Log out at the bottom', async () => {
    const page = await createPage()
    await page.setViewportSize({ width: 390, height: 844 })
    await mockApi(page, temporaryPasswordBackend().handlers)
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })
    await page.getByRole('heading', { name: 'Choose your password' }).waitFor()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const logOut = (await page.getByRole('button', { name: 'Log out' }).boundingBox())!
    expect(logOut.y + logOut.height).toBeGreaterThan(844 - 80)
    const submit = (await page.getByRole('button', { name: 'Change password' }).boundingBox())!
    expect(submit.y).toBeLessThan(logOut.y)
  })

  it('moves focus to the server\'s error after a failed change', async () => {
    const page = await createPage()
    await mockApi(page, temporaryPasswordBackend().handlers)
    await page.goto(url('/c/nuk/admin/change-password'), { waitUntil: 'hydration' })
    await fillPasswords(page, 'wrong', 'my own password')
    await page.getByRole('button', { name: 'Change password' }).click()
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('alert')
  })
})
