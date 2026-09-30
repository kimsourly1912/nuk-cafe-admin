import { describe, expect, it } from 'vitest'
import type { AssistantMessage } from '../utils/chat'
import { formatAnswer, latestMessages, linksOf, suggestionsFor, textOf } from '../utils/chat'

const staff = { title: 'Staff', path: '/admin/staff' }

function answer(parts: AssistantMessage['parts']): AssistantMessage {
  return { id: 'a1', role: 'assistant', parts }
}

describe('the help chat (D109)', () => {
  it('sends only the latest 20 messages', () => {
    const messages = Array.from({ length: 25 }, (_, i) => i)
    expect(latestMessages(messages)).toEqual(messages.slice(5))
    expect(latestMessages([1, 2])).toEqual([1, 2])
  })

  it('shows each page an answer links to once, and only finished links', () => {
    const message = answer([
      { type: 'text', text: 'On the Staff page.' },
      { type: 'tool-link_to_page', toolCallId: 'c1', state: 'output-available', input: { page: 'staff' }, output: staff },
      { type: 'tool-link_to_page', toolCallId: 'c2', state: 'output-available', input: { page: 'staff' }, output: staff },
      { type: 'tool-link_to_page', toolCallId: 'c3', state: 'input-available', input: { page: 'branch' } },
      { type: 'tool-link_to_page', toolCallId: 'c4', state: 'output-error', input: { page: 'reports' }, errorText: 'Unknown page' },
    ])
    expect(linksOf(message)).toEqual([staff])
  })

  it('joins an answer\'s text around its links', () => {
    const message = answer([
      { type: 'text', text: 'Add them on the Staff page.' },
      { type: 'tool-link_to_page', toolCallId: 'c1', state: 'output-available', input: { page: 'staff' }, output: staff },
      { type: 'text', text: ' Then share the password.\n' },
    ])
    expect(textOf(message)).toBe('Add them on the Staff page. Then share the password.')
  })

  it('shows **labels** in bold and everything else as written', () => {
    expect(formatAnswer('1. Press **Add staff member**.\n\n2. Copy **it**')).toEqual([
      [{ text: '1. Press ', bold: false }, { text: 'Add staff member', bold: true }, { text: '.', bold: false }],
      [],
      [{ text: '2. Copy ', bold: false }, { text: 'it', bold: true }],
    ])
    // Not bold: an unclosed marker; HTML stays text.
    expect(formatAnswer('**open and <b>x</b>')).toEqual([[{ text: '**open and <b>x</b>', bold: false }]])
  })

  it('suggests questions for the page, and general ones elsewhere', () => {
    expect(suggestionsFor('/admin/staff')[0]).toBe('How do I add a cashier?')
    expect(suggestionsFor('/admin/add-ons/0199abc')[0]).toBe('How do I make an add-on group required?')
    expect(suggestionsFor('/admin')).toContain('How do I set up the menu?')
    expect(suggestionsFor('/admin/staffing')).toContain('How do I set up the menu?')
  })
})
