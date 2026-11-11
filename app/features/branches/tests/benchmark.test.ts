import { describe, expect, it } from 'vitest'
import { formatReport, summarizeFrames } from '../designer/benchmark'

// The 3D benchmark's arithmetic (step 3h, D274).

describe('frame interval summaries', () => {
  it('gives the median and the 95th percentile by nearest rank', () => {
    // 95 smooth frames and 5 slow ones: the median stays smooth, p95 is the edge of the slow ones.
    const intervals = [...Array.from({ length: 95 }, () => 16.7), 40, 50, 60, 70, 80]
    expect(summarizeFrames(intervals)).toEqual({ frames: 100, medianMs: 16.7, p95Ms: 16.7 })
    expect(summarizeFrames([...intervals, 90]).p95Ms).toBe(40)
    expect(summarizeFrames([10, 30, 20])).toEqual({ frames: 3, medianMs: 20, p95Ms: 30 })
    expect(summarizeFrames([])).toEqual({ frames: 0, medianMs: 0, p95Ms: 0 })
  })

  it('reports in plain text, every number named', () => {
    const run = { frames: 1200, medianMs: 16.7, p95Ms: 21.4 }
    const text = formatReport({
      runs: [run, run, run],
      all: { ...run, frames: 3600 },
      quality: 'medium',
      pixelRatio: 1.5,
      canvas: { width: 1200, height: 800 },
      renderer: { calls: 64, triangles: 120_000, geometries: 210, textures: 9 },
      surroundings: 'Neighborhood lane',
      firstFrameMs: 812.4,
      userAgent: 'Test browser',
    })
    expect(text).toContain('(Neighborhood lane)')
    expect(text).toContain('Orbit 3: median 16.7 ms, p95 21.4 ms (1200 frames)')
    expect(text).toContain('All orbits: median 16.7 ms, p95 21.4 ms (3600 frames)')
    expect(text).toContain('Quality medium, pixel ratio 1.5, canvas 1200 × 800')
    expect(text).toContain('64 draw calls, 120000 triangles')
    expect(text).toContain('First frame: 812 ms')
  })
})
