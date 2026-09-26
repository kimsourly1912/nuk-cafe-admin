import { describe, expect, it } from 'vitest'
import { describeZone, zoneLabel } from '../utils/timezone'

describe('schedule timezones', () => {
  it('labels zones briefly', () => {
    expect(zoneLabel('Asia/Phnom_Penh')).toBe('GMT+7')
    expect(zoneLabel('UTC')).toBe('UTC')
  })

  it('describes a zone by id and offset, and falls back to the id for unknown zones', () => {
    expect(describeZone('Asia/Phnom_Penh')).toBe('Asia/Phnom_Penh (GMT+7)')
    expect(describeZone('UTC')).toBe('UTC')
    expect(describeZone('Mars/Olympus')).toBe('Mars/Olympus')
  })
})
