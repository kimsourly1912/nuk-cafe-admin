import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { ADMIN, failures, mockApi, setupE2e } from './support/mock-api'

await setupE2e()

const cases = [
  ['/sign-in', 'Sign in'],
  ['/sign-up', 'Create an account'],
  ['/forgot-password', 'Forgot your password?'],
  ['/reset-password?token=layout-fake-token', 'Choose a new password'],
  ['/verify-email', 'Check your email'],
  ['/email-verified', 'Email verified'],
  ['/c/nuk/admin/login', 'NUK Cafe Admin'],
  ['/c/nuk/admin/change-password', 'Change password'],
  ['/c/nuk/admin/account-security', 'Account security'],
  ['/c/nuk/counter/sign-in', 'NUK Cafe Counter'],
  ['/c/nuk/counter/change-password', 'Change password'],
  ['/c/nuk/counter/account-security', 'Account security'],
  ['/platform/sign-in', 'Angder'],
  ['/platform/change-password', 'Change password'],
  ['/platform/two-factor', 'Set up two-step sign-in'],
  ['/cafes', 'Your cafes'],
  ['/c/nuk/counter', 'Choose a branch'],
] as const

describe('auth layouts at the required review widths', () => {
  it.each([[320, 844], [390, 844], [768, 900], [1024, 900], [1440, 900], [844, 390]])('%s × %s in light and dark mode', async (width, height) => {
    const page = await createPage()
    await page.setViewportSize({ width, height })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    let current = '/sign-in'
    const issues: string[] = []
    page.on('console', (message) => {
      if (/hydration/i.test(message.text())) issues.push(message.text())
    })
    page.on('pageerror', error => issues.push(error.message))
    const user = { id: ADMIN.userId, name: ADMIN.name, email: ADMIN.email, emailVerified: true }
    await mockApi(page, {
      'GET /auth/get-session': () => ['/verify-email', '/email-verified', '/cafes'].includes(current)
        ? { user: { ...user, emailVerified: current !== '/verify-email' }, session: { id: 'layout-session' } }
        : null,
      'GET /admin/me': () => {
        if (current.endsWith('/login')) throw failures.unauthorized()
        return ADMIN
      },
      'GET /counter/me': () => {
        if (current.endsWith('/sign-in')) throw failures.unauthorized()
        return { ...ADMIN, branches: [{ id: 'branch-1', name: 'Main', role: 'staff', permissions: [] }, { id: 'branch-2', name: 'Airport', role: 'staff', permissions: [] }] }
      },
      'GET /platform/me': () => {
        if (current.endsWith('/sign-in')) throw failures.unauthorized()
        return { ...ADMIN, twoFactorEnabled: current !== '/platform/two-factor' }
      },
      'GET /me/cafes': () => [],
    })
    await page.goto(url('/sign-in'), { waitUntil: 'hydration' })
    const output = join(process.cwd(), 'output', 'playwright', 'auth-layout')
    if (process.env.AUTH_LAYOUT_SCREENSHOTS) await mkdir(output, { recursive: true })
    for (const mode of ['light', 'dark']) {
      await page.evaluate(value => localStorage.setItem('nuxt-color-mode', value), mode)
      for (const [path, title] of cases) {
        current = path.split('?')[0]!
        await page.goto(url(path), { waitUntil: 'hydration' })
        await page.getByRole('heading', { name: title, exact: true }).waitFor()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${path} at ${width}px in ${mode}`).toBe(true)
        if (process.env.AUTH_LAYOUT_SCREENSHOTS) {
          const name = current.replace(/[^a-z0-9]+/gi, '-').replace(/^-/, '')
          await page.screenshot({ path: join(output, `${width}x${height}-${mode}-${name}.png`), fullPage: true })
        }
      }
    }
    expect(issues).toEqual([])
  }, 120_000)
})
