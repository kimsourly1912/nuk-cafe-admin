import { describe, expect, it } from 'vitest'
import type { ClientErrorReport } from '../../shared/contracts/client-errors'
import { ApiError } from '../../app/utils/api-error'
import { CLIENT_ERROR_REPORT_LIMIT, createClientErrorReporter, pageOf } from '../../app/utils/client-errors'

// Browser errors reported to the server (D149): what is sent, what isn't, and how often.

function reporter(page = '/c/nuk/admin/products') {
  const sent: ClientErrorReport[] = []
  const { report } = createClientErrorReporter({ send: r => sent.push(r), page: () => page, build: 'build-1' })
  return { report, sent }
}

describe('browser error reports', () => {
  it('sends the error, its stack, the page and the build', () => {
    const { report, sent } = reporter()
    const error = new TypeError('x is undefined')
    report('vue', error)
    expect(sent).toEqual([{ kind: 'vue', message: 'TypeError: x is undefined', stack: error.stack, page: '/c/nuk/admin/products', build: 'build-1' }])
  })

  it('never sends the query or hash: a reset link carries its token there', () => {
    expect(pageOf('/reset-password?token=secret#top')).toBe('/reset-password')
    const { report, sent } = reporter('/reset-password?token=secret')
    report('error', new Error('boom'))
    expect(sent[0]!.page).toBe('/reset-password')
  })

  it('skips our API\'s failures (the server logged them) and cancelled requests', () => {
    const { report, sent } = reporter()
    report('rejection', new ApiError('Server error', { kind: 'server', status: 500 }))
    report('rejection', new DOMException('The operation was aborted.', 'AbortError'))
    report('rejection', undefined)
    expect(sent).toEqual([])
  })

  it('sends a message once per page load, and at most the limit in all', () => {
    const { report, sent } = reporter()
    report('error', new Error('same'))
    report('error', new Error('same'))
    expect(sent).toHaveLength(1)
    for (let i = 0; i < CLIENT_ERROR_REPORT_LIMIT + 5; i++) report('error', new Error(`error ${i}`))
    expect(sent).toHaveLength(CLIENT_ERROR_REPORT_LIMIT)
  })

  it('reports a thrown value that isn\'t an Error by its text, without a stack', () => {
    const { report, sent } = reporter()
    report('rejection', 'plain text')
    expect(sent[0]).toMatchObject({ message: 'plain text', stack: undefined })
  })
})
