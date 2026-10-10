import { describe, expect, it } from 'vitest'
import type { DraftStorage } from '../../app/utils/form-draft'
import { FORM_DRAFT_MAX_AGE_MS, createFormDraftStore, draftTimeText, formDraftKey } from '../../app/utils/form-draft'

// Unsaved input kept in the browser (D151): keys, expiry, and storage that fails.

function memoryStorage(entries: Record<string, string> = {}): DraftStorage & { entries: Map<string, string> } {
  const map = new Map(Object.entries(entries))
  return {
    entries: map,
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
    key: index => [...map.keys()][index] ?? null,
    get length() {
      return map.size
    },
  }
}

const key = formDraftKey({ tenant: 'nuk', owner: 'user-1', form: 'menu-item', record: 'item-1' })

describe('form drafts', () => {
  it('keys a draft by cafe, person, form and record', () => {
    expect(key).toBe('nuk:draft:nuk:user-1:menu-item:item-1')
    expect(formDraftKey({ tenant: 'nuk', owner: 'user-2', form: 'menu-item', record: 'item-1' })).not.toBe(key)
    expect(formDraftKey({ tenant: 'brown-bean', owner: 'user-1', form: 'menu-item', record: 'item-1' })).not.toBe(key)
    // A colon in a part can't make two keys collide.
    expect(formDraftKey({ tenant: 'a:b', owner: 'c', form: 'f', record: 'r' })).not.toBe(formDraftKey({ tenant: 'a', owner: 'b:c', form: 'f', record: 'r' }))
  })

  it('writes and reads a draft with its version and time', () => {
    const store = createFormDraftStore(memoryStorage(), () => 1000)
    store.write(key, { name: 'Latte' }, 3)
    expect(store.read(key)).toEqual({ value: { name: 'Latte' }, version: 3, savedAt: 1000 })
    store.remove(key)
    expect(store.read(key)).toBeNull()
  })

  it('drops a draft older than seven days, and one it can\'t read', () => {
    const storage = memoryStorage({ 'nuk:draft:broken': '{not json', 'nuk:draft:no-value': '{"savedAt":1}' })
    let now = 0
    const store = createFormDraftStore(storage, () => now)
    store.write(key, { name: 'Latte' })
    now = FORM_DRAFT_MAX_AGE_MS
    expect(store.read(key)).not.toBeNull()
    now = FORM_DRAFT_MAX_AGE_MS + 1
    store.purgeExpired()
    expect([...storage.entries.keys()]).toEqual([])
  })

  it('removes every draft, and nothing else, on sign-out', () => {
    const storage = memoryStorage({ 'nuk:counter-muted': '1' })
    const store = createFormDraftStore(storage)
    store.write(key, { name: 'Latte' })
    store.write(formDraftKey({ tenant: 'nuk', owner: 'user-2', form: 'branch-settings', record: 'b-1' }), { name: 'Riverside' })
    store.removeAll()
    expect([...storage.entries.keys()]).toEqual(['nuk:counter-muted'])
  })

  it('does nothing when storage is missing or throws (private windows, a full quota)', () => {
    const throwing: DraftStorage = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
      key: () => {
        throw new Error('blocked')
      },
      length: 1,
    }
    for (const store of [createFormDraftStore(undefined), createFormDraftStore(throwing)]) {
      expect(() => store.write(key, { name: 'Latte' })).not.toThrow()
      expect(store.read(key)).toBeNull()
      expect(() => store.removeAll()).not.toThrow()
    }
  })

  it('says when a draft was typed: today by its time, then yesterday, then the date', () => {
    const now = new Date(2026, 9, 10, 15, 0).getTime()
    expect(draftTimeText(new Date(2026, 9, 10, 10, 42).getTime(), now)).toBe('10:42 AM')
    expect(draftTimeText(new Date(2026, 9, 9, 22, 5).getTime(), now)).toBe('Yesterday, 10:05 PM')
    expect(draftTimeText(new Date(2026, 9, 3, 9, 0).getTime(), now)).toBe('3 Oct, 9:00 AM')
  })
})
