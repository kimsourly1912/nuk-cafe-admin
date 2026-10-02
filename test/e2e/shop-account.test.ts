import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { SeedCustomer } from './support/seed'
import { e2eDatabase } from './support/database'
import { setupE2e, toast } from './support/mock-api'
import { asNewVisitor } from './support/client-address'

await setupE2e()

// The customer's account pages (step 5.2, D97) against the e2e server's seeded database
// (support/seed.ts): real Better Auth, real sessions. The emails the server queues are read from its
// outbox, so verification and reset links are the real ones. Only sign-up's error answers are
// mocked: a real sign-up asks Have I Been Pwned, an external API.

const seed = inject('shopSeed')

/** Opens a page; collects errors, and Vue's "Hydration completed but contains mismatches". */
async function open(path: string, width = 1440) {
  const page = await createPage()
  await asNewVisitor(page)
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error' || /hydration/i.test(message.text())) problems.push(`${message.text()} ${message.location().url}`)
  })
  page.on('pageerror', error => problems.push(error.message))
  await page.setViewportSize({ width, height: width < 640 ? 844 : 900 })
  await page.goto(url(path), { waitUntil: 'hydration' })
  return { page, problems }
}

const button = (page: Page, name: string | RegExp) => page.getByRole('button', { name, exact: typeof name === 'string' })
const heading = (page: Page, name: string) => page.getByRole('heading', { name, exact: true })

async function signIn(page: Page, customer: Pick<SeedCustomer, 'email' | 'password'>) {
  await page.getByLabel('Email').fill(customer.email)
  await page.getByLabel('Password', { exact: true }).fill(customer.password)
  await button(page, 'Sign in').click()
}

/** The newest email of a kind the server queued for an address: its link. */
async function mailLink(to: string, kind: 'identity.verify-email' | 'identity.reset-password', after = 0) {
  const client = e2eDatabase(seed.dbFile)
  try {
    let link: string | undefined
    await expect.poll(async () => {
      const { rows } = await client.execute({ sql: 'select payload, created_at from outbox_messages where kind = ? order by created_at desc', args: [kind] })
      const row = rows.find(r => JSON.parse(String(r.payload)).to === to && Number(r.created_at) > after)
      link = row ? JSON.parse(String(row.payload)).url : undefined
      return link
    }).toBeDefined()
    return link!
  }
  finally {
    client.close()
  }
}

describe('signing in and out', () => {
  it('the menu offers "Sign in", which comes back to the menu signed in; the account menu shows the member code; sign out', async () => {
    const { page, problems } = await open('/')
    await page.getByRole('link', { name: 'Sign in' }).click()
    await page.waitForURL(/\/sign-in/)
    await heading(page, 'Sign in').waitFor()
    await signIn(page, seed.customers.verified)
    await page.waitForURL(url('/'))
    await button(page, 'Account: Dara Sok').click()
    const menu = page.getByRole('dialog')
    await menu.getByText('Email verified').waitFor()
    expect(await menu.getByText(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/).isVisible()).toBe(true)
    // Signed in and verified: no banner.
    expect(await page.getByText('Verify your email to place orders').count()).toBe(0)
    await menu.getByRole('button', { name: 'Sign out' }).click()
    await page.getByRole('link', { name: 'Sign in' }).waitFor()
    expect(problems).toEqual([])
  })

  it('a wrong password says so above the fields, and moves focus there', async () => {
    const { page } = await open('/sign-in')
    await signIn(page, { email: seed.customers.verified.email, password: 'not-the-password' })
    const alert = page.getByRole('alert').filter({ hasText: 'Wrong email or password.' })
    await alert.waitFor()
    await expect.poll(() => alert.evaluate(el => el === document.activeElement)).toBe(true)
  })

  it('checks the fields before asking the server', async () => {
    const { page } = await open('/sign-in')
    await button(page, 'Sign in').click()
    await page.getByText('Email is required').waitFor()
    await page.getByText('Password is required').waitFor()
    await expect.poll(() => page.getByLabel('Email').evaluate(el => el === document.activeElement)).toBe(true)
    await page.getByLabel('Email').fill('sokha@')
    await page.getByLabel('Email').press('Tab')
    await page.getByText('Enter a valid email address').waitFor()
  })

  it('returns to the page it was sent from, never to another site or the admin', async () => {
    const { page } = await open('/sign-in?redirect=//evil.example')
    await signIn(page, seed.customers.verified)
    await page.waitForURL(url('/'))
    // Already signed in: the sign-in page moves on by itself.
    await page.goto(url('/sign-in?redirect=/admin'), { waitUntil: 'hydration' })
    await page.waitForURL(url('/'))
  })

  it('the password can be shown', async () => {
    const { page } = await open('/sign-in')
    const password = page.getByLabel('Password', { exact: true })
    expect(await password.getAttribute('type')).toBe('password')
    await button(page, 'Show password').click()
    expect(await password.getAttribute('type')).toBe('text')
  })
})

describe('verifying the email', () => {
  it('an unverified account sees the banner, resends the email, opens the link and is verified', async () => {
    const customer = seed.customers.unverified
    const { page } = await open('/sign-in')
    await signIn(page, customer)
    await page.waitForURL(url('/'))
    const banner = page.getByText('Verify your email to place orders')
    await banner.waitFor()
    const sentAt = Date.now() - 1000
    await button(page, 'Resend email').click()
    await toast(page, 'Verification email sent').waitFor()
    // One wait for every place that offers it.
    await button(page, /^Resend email in \d+ s$/).waitFor()
    expect(await button(page, /^Resend email in \d+ s$/).isDisabled()).toBe(true)

    await page.goto(await mailLink(customer.email, 'identity.verify-email', sentAt), { waitUntil: 'hydration' })
    await page.waitForURL(/\/email-verified$/)
    await heading(page, 'Email verified').waitFor()
    await page.getByText(`You're signed in as ${customer.name}.`).waitFor()
    await page.getByRole('link', { name: 'Back to the menu' }).last().click()
    await page.waitForURL(url('/'))
    await button(page, `Account: ${customer.name}`).waitFor()
    expect(await banner.count()).toBe(0)
  })

  it('a link that doesn\'t work says so; signed out, a new one comes after signing in', async () => {
    const { page, problems } = await open('/email-verified?error=TOKEN_EXPIRED')
    await heading(page, 'This link doesn\'t work anymore').waitFor()
    await page.getByRole('link', { name: 'Sign in to get a new link' }).click()
    await page.waitForURL(u => u.pathname === '/sign-in' && u.searchParams.get('redirect') === '/verify-email')
    await signIn(page, seed.customers.verified)
    await page.waitForURL(/\/verify-email$/)
    await heading(page, 'Your email is verified').waitFor()
    expect(problems).toEqual([])
  })
})

describe('resetting the password', () => {
  // Saving the new password asks Have I Been Pwned (an external API), so only that answer is mocked;
  // the link, the page and the token handling are real.
  it('sends a link that opens the page (token out of the address bar); saving goes to sign-in, which says so', async () => {
    const customer = seed.customers.reset
    const { page, problems } = await open('/sign-in')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await heading(page, 'Reset your password').waitFor()
    const sentAt = Date.now() - 1000
    await page.getByLabel('Email').fill(customer.email)
    await button(page, 'Send reset link').click()
    await heading(page, 'Check your email').waitFor()
    await page.getByText(/If an account exists for vanna@example\.com/).waitFor()
    expect(await button(page, /^Send again in \d+ s$/).isDisabled()).toBe(true)

    await page.goto(await mailLink(customer.email, 'identity.reset-password', sentAt), { waitUntil: 'hydration' })
    await heading(page, 'Choose a new password').waitFor()
    await expect.poll(() => new URL(page.url()).search).toBe('')
    const sent: unknown[] = []
    await page.route('**/api/auth/reset-password', (route) => {
      sent.push(route.request().postDataJSON())
      return route.fulfill({ json: { status: true } })
    })
    await page.getByLabel('New password').fill('short')
    await page.getByLabel('New password').press('Enter')
    await page.getByText('At least 8 characters').first().waitFor()
    expect(sent).toEqual([])
    await page.getByLabel('New password').fill('a-brand-new-password-9')
    await page.getByLabel('New password').press('Enter')
    await page.waitForURL(u => u.pathname === '/sign-in' && u.searchParams.get('reset') === '1')
    await page.getByText('Password changed. Sign in with your new password.').waitFor()
    expect(sent).toEqual([{ token: expect.stringMatching(/^\w{20,}$/), newPassword: 'a-brand-new-password-9' }])
    expect(problems).toEqual([])
  })

  it('a link that doesn\'t work, on opening it or on saving, offers a new one', async () => {
    const { page } = await open('/reset-password?error=INVALID_TOKEN')
    await heading(page, 'This link doesn\'t work anymore').waitFor()
    await page.getByRole('link', { name: 'Send a new link' }).click()
    await heading(page, 'Reset your password').waitFor()

    await page.goto(url('/reset-password?token=abcdefghijklmnopqrstuvwx'), { waitUntil: 'hydration' })
    await page.route('**/api/auth/reset-password', route => route.fulfill({ status: 400, json: { code: 'INVALID_TOKEN', message: 'Invalid token' } }))
    await page.getByLabel('New password').fill('a-brand-new-password-9')
    await page.getByLabel('New password').press('Enter')
    await heading(page, 'This link doesn\'t work anymore').waitFor()
  })

  it('answers the same for an email without an account', async () => {
    const { page } = await open('/forgot-password')
    await page.getByLabel('Email').fill('nobody@example.com')
    await button(page, 'Send reset link').click()
    await page.getByText(/If an account exists for nobody@example\.com/).waitFor()
  })
})

describe('creating an account', () => {
  it('shows the server\'s answer on its field: a breached password, an email already used', async () => {
    const { page, problems } = await open('/sign-up')
    const answers = [
      { status: 400, body: { code: 'PASSWORD_COMPROMISED', message: 'Password is compromised' } },
      { status: 422, body: { code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', message: 'User already exists' } },
    ]
    await page.route('**/api/auth/sign-up/email', route => route.fulfill({ status: answers[0]!.status, json: answers.shift()!.body }))
    await page.getByLabel('Name').fill('Sokha Chan')
    await page.getByLabel('Email').fill('new@example.com')
    await page.getByLabel('Password', { exact: true }).fill('password123')
    await button(page, 'Create account').click()
    await page.getByText('This password has appeared in a data breach. Choose another one.').waitFor({ timeout: 10000 })
    await expect.poll(() => page.getByLabel('Password', { exact: true }).evaluate(el => el === document.activeElement)).toBe(true)
    await page.getByLabel('Password', { exact: true }).fill('another-long-password')
    // Typing clears the field's error after UForm's debounce; the button moves up then, so wait first.
    await page.getByText('This password has appeared in a data breach. Choose another one.').waitFor({ state: 'hidden', timeout: 5000 })
    await button(page, 'Create account').click()
    await page.getByText('An account with this email already exists. Sign in instead.').waitFor({ timeout: 10000 })
    expect(problems.filter(p => !/status of 4\d\d/.test(p))).toEqual([])
  })

  it('links sign-in and sign-up both ways, keeping where to come back to', async () => {
    const { page } = await open('/sign-in?redirect=/table/abc')
    await page.getByRole('link', { name: 'Create an account' }).click()
    await page.waitForURL(u => u.pathname === '/sign-up' && u.searchParams.get('redirect') === '/table/abc')
    await page.getByRole('link', { name: 'Sign in' }).click()
    await page.waitForURL(u => u.pathname === '/sign-in' && u.searchParams.get('redirect') === '/table/abc')
  })
})

describe('on a phone', () => {
  it('the account pages fill the screen with the action at the bottom; the header\'s account icon opens Sign in (D124)', async () => {
    const { page, problems } = await open('/sign-in', 390)
    const submit = button(page, 'Sign in')
    const box = (await submit.boundingBox())!
    expect(box.y + box.height).toBeGreaterThan(844 - 120)
    await page.goto(url('/'), { waitUntil: 'hydration' })
    await page.getByRole('button', { name: 'Account', exact: true }).click()
    await page.getByRole('link', { name: 'Create account' }).waitFor()
    await page.getByRole('link', { name: 'Sign in' }).click()
    await heading(page, 'Sign in').waitFor()
    expect(problems).toEqual([])
  })
})
