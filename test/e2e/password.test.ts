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

    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await expect.poll(() => path(page)).toBe('/change-password')
    expect(new URL(page.url()).searchParams.get('redirect')).toBe('/categories')
    await page.getByRole('heading', { name: 'Choose your password' }).waitFor()
    // No app around it: the sidebar isn't there.
    expect(await page.getByRole('link', { name: 'Categories' }).count()).toBe(0)

    await fillPasswords(page, 'Temp-1234-abcd', 'my own password')
    await page.getByRole('button', { name: 'Change password' }).click()

    await expect.poll(() => path(page)).toBe('/categories')
    await toast(page, 'Password changed').waitFor()
    expect(backend.bodies).toEqual([{ currentPassword: 'Temp-1234-abcd', newPassword: 'my own password', revokeOtherSessions: true }])
  })

  it('says so when the temporary password is wrong, and stays', async () => {
    const page = await createPage()
    const backend = temporaryPasswordBackend()
    await mockApi(page, backend.handlers)
    await page.goto(url('/change-password'), { waitUntil: 'hydration' })

    await fillPasswords(page, 'wrong', 'my own password')
    await page.getByRole('button', { name: 'Change password' }).click()
    await page.getByText('Your current password is incorrect.').waitFor()
    expect(path(page)).toBe('/change-password')
  })

  it('checks the repeat and refuses the same password before sending anything', async () => {
    const page = await createPage()
    const backend = temporaryPasswordBackend()
    await mockApi(page, backend.handlers)
    await page.goto(url('/change-password'), { waitUntil: 'hydration' })

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
      'GET /admin/schedules': () => {
        throw failures.passwordChangeRequired()
      },
    })
    // Signed in normally; the Schedules list is the first request to meet the refusal.
    await gotoViaSidebar(page, ['Schedules'])
    await expect.poll(() => path(page)).toBe('/change-password')
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
    await page.goto(url('/categories'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'alice', exact: true }).click()
    await page.getByRole('menuitem', { name: 'Change password' }).click()

    await page.getByRole('heading', { name: 'Change password' }).waitFor()
    await fillPasswords(page, 'my own password', 'a better password')
    await page.getByRole('button', { name: 'Change password' }).click()
    await toast(page, 'Password changed').waitFor()
    await expect.poll(() => path(page)).toBe('/')
    expect(bodies).toHaveLength(1)
  })
})
