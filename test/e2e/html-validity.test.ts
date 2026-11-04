import { url } from '@nuxt/test-utils/e2e'
import { HtmlValidate } from 'html-validate'
import { describe, expect, inject, it } from 'vitest'
import { setupE2e } from './support/mock-api'

await setupE2e()

// The server-rendered pages' HTML, as a visitor gets it before the page's JavaScript runs (D256):
// valid structure (`standard`), accessibility rules html-validate can check without a browser (`a11y`),
// and a whole document's rules (`document`). axe (accessibility.test.ts) checks the page after
// hydration; this checks what the server sends. Pages that render in the browser only (`ssr: false`)
// have no server HTML to check.
const validator = new HtmlValidate({
  extends: ['html-validate:standard', 'html-validate:a11y', 'html-validate:document'],
  rules: {
    // Integrity hashes on our own build files: same origin, and the CSP allows only this origin.
    // Nuxt doesn't emit them; they would add nothing.
    'require-sri': 'off',
  },
})

const cafe = inject('shopSeed').secondCafe

const PAGES = [
  '/',
  '/c/nuk',
  `/c/${cafe.slug}`,
  '/sign-in',
  '/sign-up',
  '/google-callback',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/email-verified',
  '/email-verified?error=TOKEN_EXPIRED',
]

describe('server-rendered HTML (D256)', () => {
  it.each(PAGES)('%s is valid, accessible HTML', async (path) => {
    const response = await fetch(url(path))
    expect(response.status).toBe(200)
    const report = await validator.validateString(await response.text())
    const problems = report.results.flatMap(result => result.messages.map(message =>
      `${message.ruleId}: ${message.message} (${message.selector ?? `line ${message.line}`})`))
    expect(problems).toEqual([])
  })
})
