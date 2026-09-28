/**
 * Pure helpers of the shared bottom action bar (`BottomActionBar`, D78).
 */

/** Input types that open no on-screen keyboard. */
const NO_KEYBOARD_INPUTS = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** The part of an element this check needs (a DOM `Element`, or a stand-in in tests). */
export interface FocusTarget {
  tagName: string
  isContentEditable?: boolean
  getAttribute: (name: string) => string | null
}

/**
 * Whether focusing `element` brings up an on-screen keyboard: a text-like input, a textarea, an
 * editable element, or a segment of a date/time field (`role="spinbutton"`, which takes digits).
 * While one is focused, a bar pinned to the bottom of a phone screen steps aside (responsive-layout §6).
 */
export function isTextEntry(element: FocusTarget | null | undefined): boolean {
  if (!element) return false
  const tag = element.tagName.toLowerCase()
  if (tag === 'textarea') return true
  if (tag === 'input') return !NO_KEYBOARD_INPUTS.has((element.getAttribute('type') ?? 'text').toLowerCase())
  if (element.isContentEditable) return true
  return element.getAttribute('role') === 'spinbutton'
}
