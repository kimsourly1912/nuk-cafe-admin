import { describe, expect, it } from 'vitest'
import { computed, reactive } from 'vue'
import { cloneFormValue, isSameFormValue } from '../../app/utils/form-value'

describe('isSameFormValue', () => {
  it('treats empty values as the same', () => {
    expect(isSameFormValue({ a: '' }, { a: undefined })).toBe(true)
    expect(isSameFormValue({ a: null }, {})).toBe(true)
    expect(isSameFormValue({ ids: [] }, { ids: undefined })).toBe(true)
  })

  it('detects changed values', () => {
    expect(isSameFormValue({ name: 'Tea' }, { name: 'Tea ' })).toBe(false)
    expect(isSameFormValue({ id: 1 }, { id: 2 })).toBe(false)
    expect(isSameFormValue({ id: 1 }, { id: '1' })).toBe(false)
    expect(isSameFormValue({ id: 0 }, { id: undefined })).toBe(false)
    expect(isSameFormValue({ on: false }, {})).toBe(false)
  })

  it('compares nested objects and arrays deeply, with order', () => {
    expect(isSameFormValue({ i18n: { en: 'Tea' }, ids: [1, 2] }, { i18n: { en: 'Tea' }, ids: [1, 2] })).toBe(true)
    expect(isSameFormValue({ i18n: { en: 'Tea' } }, { i18n: { en: 'Coffee' } })).toBe(false)
    expect(isSameFormValue({ ids: [1, 2] }, { ids: [2, 1] })).toBe(false)
  })

  it('compares dates by time and files by identity', () => {
    expect(isSameFormValue(new Date(1), new Date(1))).toBe(true)
    const file = new Blob(['a'])
    expect(isSameFormValue({ image: file }, { image: file })).toBe(true)
    expect(isSameFormValue({ image: file }, { image: new Blob(['a']) })).toBe(false)
  })

  it('compares reactive proxies', () => {
    const state = reactive({ name: 'Tea', ids: [1] })
    expect(isSameFormValue(state, { name: 'Tea', ids: [1] })).toBe(true)
  })

  it('is tracked by computed, including nested fields', () => {
    const state = reactive({ name: 'Tea', ids: [1], i18n: { en: 'Tea' } })
    const baseline = cloneFormValue(state)
    const dirty = computed(() => !isSameFormValue(state, baseline))
    expect(dirty.value).toBe(false)
    state.name = 'Coffee'
    expect(dirty.value).toBe(true)
    state.name = 'Tea'
    state.ids.push(2)
    expect(dirty.value).toBe(true)
    state.ids.pop()
    state.i18n.en = 'Coffee'
    expect(dirty.value).toBe(true)
    state.i18n.en = 'Tea'
    expect(dirty.value).toBe(false)
  })
})

describe('cloneFormValue', () => {
  it('copies deeply so later edits do not change the snapshot', () => {
    const state = reactive({ name: 'Tea', ids: [1], i18n: { en: 'Tea' } })
    const snapshot = cloneFormValue(state)
    state.name = 'Coffee'
    state.ids.push(2)
    state.i18n.en = 'Coffee'
    expect(snapshot).toEqual({ name: 'Tea', ids: [1], i18n: { en: 'Tea' } })
  })

  it('keeps files by reference', () => {
    const file = new Blob(['a'])
    expect(cloneFormValue({ image: file }).image).toBe(file)
  })
})
