/**
 * Unsaved form input kept in the browser (D151), so a crash, a dead battery or a phone dropping the
 * tab doesn't lose it: the form offers it back when it opens again. Framework-free and unit-tested;
 * `useUnsavedChanges({ draft })` wires it to a form.
 *
 * A draft is a private copy of what one person typed in one cafe, never the record: nothing is sent
 * until they press Save, and the save still names the version it was read at (D41).
 */

/** Every draft's storage key starts with this, so all of them can be found and removed at once. */
export const FORM_DRAFT_PREFIX = 'nuk:draft:'
/** A draft older than this is dropped. */
export const FORM_DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface FormDraftKey {
  /** The cafe's address. */
  tenant: string
  /** Who typed it (the user's id): another person on this browser never sees it. */
  owner: string
  /** Which form (`menu-item`, `branch-settings`). */
  form: string
  /** Which record (its id), or `new`. */
  record: string
}

export interface StoredFormDraft<T> {
  value: T
  /** The record's version the form was opened at; `undefined` for a new record. */
  version?: number
  /** Milliseconds since the epoch. */
  savedAt: number
}

/** The part of `Storage` the store uses (a stand-in in tests). */
export type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>

export const formDraftKey = (key: FormDraftKey) =>
  `${FORM_DRAFT_PREFIX}${[key.tenant, key.owner, key.form, key.record].map(encodeURIComponent).join(':')}`

/**
 * Reads and writes drafts. Every storage call is guarded: private windows, a full quota or blocked
 * site data make it do nothing, and the form works as it would without drafts.
 */
export function createFormDraftStore(storage: DraftStorage | undefined, now: () => number = Date.now) {
  function read<T>(key: string): StoredFormDraft<T> | null {
    let raw: string | null
    try {
      raw = storage?.getItem(key) ?? null
    }
    catch {
      return null
    }
    if (raw === null) return null
    const draft = parse<T>(raw)
    if (!draft || now() - draft.savedAt > FORM_DRAFT_MAX_AGE_MS) {
      remove(key)
      return null
    }
    return draft
  }

  function write<T>(key: string, value: T, version?: number) {
    const draft: StoredFormDraft<T> = { value, version, savedAt: now() }
    try {
      storage?.setItem(key, JSON.stringify(draft))
    }
    catch {
      // Full or blocked: the form still works, without a draft.
    }
  }

  function remove(key: string) {
    try {
      storage?.removeItem(key)
    }
    catch {
      // Nothing to do.
    }
  }

  /** Every draft's key (never other storage). */
  function keys(): string[] {
    const found: string[] = []
    try {
      if (!storage) return found
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i)
        if (key?.startsWith(FORM_DRAFT_PREFIX)) found.push(key)
      }
    }
    catch {
      // Unreadable: nothing found.
    }
    return found
  }

  /** Signing out on purpose: no draft of anyone stays on this browser. */
  function removeAll() {
    keys().forEach(remove)
  }

  /** Drops drafts past their age (and unreadable ones). */
  function purgeExpired() {
    keys().forEach(key => read(key))
  }

  return { read, write, remove, removeAll, purgeExpired }
}

function parse<T>(raw: string): StoredFormDraft<T> | null {
  try {
    const draft = JSON.parse(raw) as Partial<StoredFormDraft<T>> | null
    if (!draft || typeof draft !== 'object' || typeof draft.savedAt !== 'number' || typeof draft.value !== 'object' || draft.value === null) return null
    if (draft.version !== undefined && typeof draft.version !== 'number') return null
    return { value: draft.value, version: draft.version, savedAt: draft.savedAt }
  }
  catch {
    return null
  }
}

/** "10:42 AM", or "Yesterday, 10:42 AM", or "3 Oct, 10:42 AM": when a draft was last typed. */
export function draftTimeText(savedAt: number, now: number = Date.now(), locale = 'en-US'): string {
  const saved = new Date(savedAt)
  const time = saved.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })
  const today = new Date(now)
  const yesterday = new Date(now)
  yesterday.setDate(today.getDate() - 1)
  if (saved.toDateString() === today.toDateString()) return time
  if (saved.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`
  return `${saved.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, ${time}`
}

/** The browser's `localStorage`, or `undefined` where reading it throws (blocked site data). */
export function browserDraftStorage(): DraftStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  }
  catch {
    return undefined
  }
}
