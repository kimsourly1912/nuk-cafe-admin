import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'
import { setupE2e } from './support/mock-api'
import { asNewVisitor } from './support/client-address'

await setupE2e()

describe('Google account page fallback', () => {
  it('keeps Google hidden when rollout is disabled and preserves the email form', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    for (const path of ['/sign-in', '/sign-up']) {
      await page.goto(url(path), { waitUntil: 'hydration' })
      await page.getByLabel('Email', { exact: true }).waitFor()
      expect(await page.getByRole('button', { name: 'Continue with Google' }).count()).toBe(0)
    }
  })

  it('explains an existing account conflict and retains the original cafe redirect', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/sign-in?error=account_not_linked&redirect=/c/nuk/checkout'), { waitUntil: 'hydration' })
    await page.getByRole('alert').filter({ hasText: 'This email already has an account. Sign in with your email and password.' }).waitFor()
    expect(await page.getByRole('link', { name: 'Create an account', exact: true }).getAttribute('href')).toContain('redirect=')
    await page.getByLabel('Email', { exact: true }).fill('person@example.com')
  })

  it('uses bounded copy for cancellation or arbitrary upstream error descriptions', async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url('/sign-in?error=access_denied&error_description=DO_NOT_RENDER_PROVIDER_TEXT'), { waitUntil: 'hydration' })
    await page.getByRole('alert').filter({ hasText: 'Google sign-in did not finish.' }).waitFor()
    expect(await page.getByText('DO_NOT_RENDER_PROVIDER_TEXT').count()).toBe(0)
    await page.getByLabel('Email', { exact: true }).waitFor()
  })
})
