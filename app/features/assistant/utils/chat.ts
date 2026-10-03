import type { UIMessage } from 'ai'
import type { AssistantPageLink } from '#shared/contracts/assistant'
import { ASSISTANT_CHAT_MAX_MESSAGES } from '#shared/contracts/assistant'

/** The chat's messages: text, and `link_to_page` buttons (step 9.1, D109). */
export type AssistantMessage = UIMessage<never, never, { link_to_page: { input: { page: string }, output: AssistantPageLink } }>

/** What goes to the server: the latest messages only (the rest stays on screen). */
export function latestMessages<T>(messages: T[]): T[] {
  return messages.slice(-ASSISTANT_CHAT_MAX_MESSAGES)
}

/** The links an answer gives, once each, in order. */
export function linksOf(message: AssistantMessage): AssistantPageLink[] {
  const links: AssistantPageLink[] = []
  for (const part of message.parts) {
    if (part.type === 'tool-link_to_page' && part.state === 'output-available' && !links.some(l => l.path === part.output.path)) {
      links.push(part.output)
    }
  }
  return links
}

/** An answer's text, its parts joined (a link between two parts splits them). */
export function textOf(message: AssistantMessage): string {
  return message.parts.map(part => (part.type === 'text' ? part.text : '')).join('').trim()
}

/** A piece of an answer's line: plain text, or text the model wrote in `**bold**` (screen labels). */
export interface TextRun {
  text: string
  bold: boolean
}

/**
 * The answer as lines of runs. The model is told to write plain text with numbered lines and
 * `**bold**` only (the prompt's rules); anything else shows as it was written. Rendered as text
 * nodes, never as HTML.
 */
export function formatAnswer(text: string): TextRun[][] {
  return text.split('\n').map(line => line.split(/(\*\*[^*\n]+\*\*)/).filter(Boolean).map(piece => (
    piece.startsWith('**') && piece.endsWith('**') && piece.length > 4
      ? { text: piece.slice(2, -2), bold: true }
      : { text: piece, bold: false }
  )))
}

/** Questions to start with, for the page the admin is on (named inside the cafe, D141). */
const SUGGESTIONS: { page: string, questions: string[] }[] = [
  { page: '/admin/products', questions: ['How do I add a new menu item?', 'Why can\'t customers see my menu item?', 'How do versions and prices work?'] },
  { page: '/admin/categories', questions: ['How do I add a subcategory?', 'How do I change the order of categories?', 'Why can\'t I add a subcategory here?'] },
  { page: '/admin/options', questions: ['What is an option set?', 'I added a value but customers can\'t choose it. Why?'] },
  { page: '/admin/add-ons', questions: ['How do I make an add-on group required?', 'Can one item charge a different add-on price?'] },
  { page: '/admin/availability', questions: ['How do I sell breakfast items only in the morning?', 'How do times past midnight work?'] },
  { page: '/admin/staff', questions: ['How do I add a cashier?', 'What can a manager do?', 'How do I remove someone\'s access?'] },
  { page: '/admin/branches', questions: ['How do I change the opening hours?', 'How do I print a table\'s QR code?', 'A table\'s QR code doesn\'t work. What do I check?'] },
  { page: '/admin/payments', questions: ['How does the riel rate work?', 'What happens if the rate changes during a payment?'] },
  { page: '/admin/sample-data', questions: ['What does the sample menu include?', 'What does Reset delete?'] },
]
const GENERAL = ['How do I set up the menu?', 'How do customers order and pay?', 'What can I do in this portal?']

export function suggestionsFor(path: string): string[] {
  return SUGGESTIONS.find(s => path === s.page || path.startsWith(`${s.page}/`))?.questions ?? GENERAL
}
