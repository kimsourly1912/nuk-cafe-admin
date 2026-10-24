import { describe, expect, it } from 'vitest'
import { INSTALL_STEPS, installPlatform } from '../../app/utils/install-app'

// "Install app" (D203): which steps a device gets when the browser can't install by itself.
describe('the install steps for this device', () => {
  it('tells iPhones and iPads (which call themselves a Mac with touch) from Android and computers', () => {
    expect(installPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1', 5)).toBe('ios')
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 5)).toBe('ios')
    expect(installPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', 0)).toBe('desktop')
    expect(installPlatform('Mozilla/5.0 (Linux; Android 15; SM-X210) Chrome/141.0 Safari/537.36', 5)).toBe('android')
    expect(installPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0 Safari/537.36', 0)).toBe('desktop')
  })

  it('has steps for each', () => {
    for (const steps of Object.values(INSTALL_STEPS)) expect(steps.length).toBeGreaterThan(1)
  })
})
