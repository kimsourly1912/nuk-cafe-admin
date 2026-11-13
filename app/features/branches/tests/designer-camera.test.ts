import { describe, expect, it } from 'vitest'
import { fitBounds, followCanvas, panBy, parseZoomPercent, planToScreen, screenToPlan, visibleRect, wheelZoomFactor, ZOOM_LIMITS, zoomAt } from '../designer/camera'
import type { Camera } from '../designer/camera'

const camera: Camera = { x: 100, y: 50, scale: 1.96 }
const close = (point: { x: number, y: number }) => ({ x: Number(point.x.toFixed(6)), y: Number(point.y.toFixed(6)) })

describe('the plan camera (ISS-028)', () => {
  it('a resize keeps the zoom and the plan point at the top-left; only the visible part grows or shrinks', () => {
    const wide = visibleRect(camera, { width: 1200, height: 700 })
    const narrow = visibleRect(camera, { width: 960, height: 700 })
    expect(wide).toMatchObject({ x: 100, y: 50 })
    expect(narrow).toMatchObject({ x: 100, y: 50 })
    expect(wide.width * camera.scale).toBeCloseTo(1200)
    expect(narrow.width * camera.scale).toBeCloseTo(960)
    expect(narrow.height).toBe(wide.height)
  })

  it('a panel left of the canvas hides and shows: every plan point stays where it was on the screen', () => {
    const point = { x: 420, y: 310 }
    const canvasBefore = { x: 240, y: 56 }
    const canvasAfter = { x: 0, y: 56 }
    const pageBefore = planToScreen(camera, point)
    const moved = followCanvas(camera, canvasBefore, canvasAfter)
    const pageAfter = planToScreen(moved, point)
    expect(moved.scale).toBe(camera.scale)
    expect(close({ x: pageAfter.x + canvasAfter.x, y: pageAfter.y + canvasAfter.y })).toEqual(close({ x: pageBefore.x + canvasBefore.x, y: pageBefore.y + canvasBefore.y }))
    // Showing it again comes back exactly.
    expect(close(followCanvas(moved, canvasAfter, canvasBefore))).toEqual(close(camera))
  })

  it('screen and plan coordinates convert both ways', () => {
    const point = { x: 333, y: -12 }
    expect(close(screenToPlan(camera, planToScreen(camera, point)))).toEqual(point)
  })

  it('zooms around a point that stays put on screen, within the limits', () => {
    const at = { x: 400, y: 300 }
    const zoomed = zoomAt(camera, at, 2)
    expect(zoomed.scale).toBeCloseTo(3.92)
    expect(close(screenToPlan(zoomed, planToScreen(camera, at)))).toEqual(at)
    expect(zoomAt(camera, at, 100).scale).toBe(ZOOM_LIMITS.max)
    expect(zoomAt(camera, at, 0.0001).scale).toBe(ZOOM_LIMITS.min)
    const stopped = zoomAt({ ...camera, scale: ZOOM_LIMITS.max }, at, 2)
    expect(close(screenToPlan(stopped, planToScreen({ ...camera, scale: ZOOM_LIMITS.max }, at)))).toEqual(at)
  })

  it('pans by screen pixels at the current zoom', () => {
    expect(panBy({ x: 0, y: 0, scale: 2 }, 100, -50)).toEqual({ x: 50, y: -25, scale: 2 })
  })

  it('fits bounds whole and centred, with the margin and the smallest span', () => {
    const size = { width: 1000, height: 500 }
    const fitted = fitBounds({ minX: 0, minY: 0, maxX: 800, maxY: 600 }, size, { margin: 100 })
    expect(fitted.scale).toBeCloseTo(500 / 800)
    const rect = visibleRect(fitted, size)
    expect(rect.x + rect.width / 2).toBeCloseTo(400)
    expect(rect.y + rect.height / 2).toBeCloseTo(300)
    expect(fitBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, size, { margin: 0, minSpan: 200 }).scale).toBeCloseTo(500 / 200)
  })

  it('Ctrl/⌘+wheel zooms in small, capped steps like Figma (ISS-001)', () => {
    expect(wheelZoomFactor(0)).toBe(1)
    expect(wheelZoomFactor(-19)).toBeCloseTo(Math.exp(0.095))
    expect(wheelZoomFactor(19) * wheelZoomFactor(-19)).toBeCloseTo(1)
    // A mouse notch (100 px) is capped at 19 px: about 10 %, not 2.7 times.
    expect(wheelZoomFactor(100)).toBe(wheelZoomFactor(19))
    expect(wheelZoomFactor(-1000)).toBe(wheelZoomFactor(-19))
    expect(wheelZoomFactor(-100)).toBeGreaterThan(1.09)
    expect(wheelZoomFactor(-100)).toBeLessThan(1.11)
    expect(wheelZoomFactor(100)).toBeLessThan(1)
  })

  it('reads a typed zoom percentage, and nothing else (ISS-003)', () => {
    expect(parseZoomPercent('150')).toBe(150)
    expect(parseZoomPercent(' 150 % ')).toBe(150)
    expect(parseZoomPercent('62,5')).toBe(62.5)
    expect(parseZoomPercent('99999')).toBe(99999)
    for (const text of ['', 'abc', '0', '-50', '1e3', '15a', '%']) expect(parseZoomPercent(text)).toBeNull()
  })
})
