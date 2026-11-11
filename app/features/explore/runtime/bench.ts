import type { FrameSummary } from '~/features/branches'

/**
 * Explore's walk benchmark (`?bench=walk`, D275, docs/plans/explore.md → E1): the character walks
 * a scripted loop from the street, through the door, to the counter and back, while every frame
 * interval is recorded. The gate: on the owner's Android phone the 95th percentile stays at or
 * under 33.3 ms; on a 60 Hz desktop the median is about 16.7 ms.
 */

export const WALK_BENCHMARK = {
  warmUpMs: 3000,
  runMs: 20_000,
  runs: 3,
  phoneP95Ms: 33.3,
} as const

export interface WalkReport {
  runs: FrameSummary[]
  all: FrameSummary
  quality: string
  pixelRatio: number
  canvas: { width: number, height: number }
  renderer: { calls: number, triangles: number, geometries: number, textures: number }
  firstFrameMs: number | null
  userAgent: string
}

export function formatWalkReport(report: WalkReport): string {
  const line = (label: string, summary: FrameSummary) => `${label}: median ${summary.medianMs} ms, p95 ${summary.p95Ms} ms (${summary.frames} frames)`
  return [
    'Explore walk benchmark (E1)',
    ...report.runs.map((run, index) => line(`Walk ${index + 1}`, run)),
    line('All walks', report.all),
    `Phone gate (p95 ≤ ${WALK_BENCHMARK.phoneP95Ms} ms): ${report.all.p95Ms <= WALK_BENCHMARK.phoneP95Ms ? 'passed' : 'missed'}`,
    `Quality ${report.quality}, pixel ratio ${report.pixelRatio}, canvas ${report.canvas.width} × ${report.canvas.height}`,
    `Renderer: ${report.renderer.calls} draw calls, ${report.renderer.triangles} triangles, ${report.renderer.geometries} geometries, ${report.renderer.textures} textures`,
    `First frame: ${report.firstFrameMs === null ? 'not measured' : `${Math.round(report.firstFrameMs)} ms`}`,
    `Browser: ${report.userAgent}`,
  ].join('\n')
}
