import { describe, expect, it } from 'vitest'
import { isTextEntry } from '../../app/utils/bottom-bar'
import type { FocusTarget } from '../../app/utils/bottom-bar'

function element(tagName: string, attributes: Record<string, string> = {}, isContentEditable = false): FocusTarget {
  return { tagName, isContentEditable, getAttribute: name => attributes[name] ?? null }
}

describe('isTextEntry', () => {
  it('counts fields that open an on-screen keyboard', () => {
    expect(isTextEntry(element('INPUT'))).toBe(true)
    expect(isTextEntry(element('INPUT', { type: 'search' }))).toBe(true)
    expect(isTextEntry(element('INPUT', { type: 'Email' }))).toBe(true)
    expect(isTextEntry(element('INPUT', { type: 'number' }))).toBe(true)
    expect(isTextEntry(element('TEXTAREA'))).toBe(true)
    expect(isTextEntry(element('DIV', {}, true))).toBe(true)
    // A time or date segment takes digits
    expect(isTextEntry(element('DIV', { role: 'spinbutton' }))).toBe(true)
  })

  it('ignores controls without a keyboard', () => {
    expect(isTextEntry(element('INPUT', { type: 'checkbox' }))).toBe(false)
    expect(isTextEntry(element('INPUT', { type: 'radio' }))).toBe(false)
    expect(isTextEntry(element('INPUT', { type: 'file' }))).toBe(false)
    expect(isTextEntry(element('BUTTON'))).toBe(false)
    expect(isTextEntry(element('A'))).toBe(false)
    expect(isTextEntry(element('BODY'))).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})
