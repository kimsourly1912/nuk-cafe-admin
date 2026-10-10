import { describe, expect, it } from 'vitest'
import type { AdminSetupStep } from '~/types/admin-setup'
import { requiredLeft, setupRows } from '../utils/setup'

const step = (id: string, optional = false): AdminSetupStep => ({ id, label: id, description: '', page: `/admin/${id}`, optional, check: async () => true })
const done = (value: boolean | null): PromiseSettledResult<boolean | null> => ({ status: 'fulfilled', value })
const failed: PromiseSettledResult<boolean | null> = { status: 'rejected', reason: new Error('offline') }

describe('Set up your cafe (D155)', () => {
  it('lists what to do first (required, then optional), then what is done, each in the listed order', () => {
    const steps = [step('hours'), step('menu'), step('khqr', true), step('rate'), step('logo', true)]
    const rows = setupRows(steps, [done(true), done(false), done(false), done(false), done(true)])
    expect(rows.map(row => `${row.step.id}:${row.state}`)).toEqual(['menu:todo', 'rate:todo', 'khqr:todo', 'hours:done', 'logo:done'])
  })

  it('leaves out a step that doesn\'t apply here, and says when a check failed', () => {
    const rows = setupRows([step('telegram', true), step('menu')], [done(null), failed])
    expect(rows.map(row => `${row.step.id}:${row.state}`)).toEqual(['menu:failed'])
  })

  it('a failed required check still counts as left to do; optional ones never do', () => {
    expect(requiredLeft(setupRows([step('menu')], [failed]))).toBe(true)
    expect(requiredLeft(setupRows([step('menu'), step('logo', true)], [done(true), done(false)]))).toBe(false)
  })
})
