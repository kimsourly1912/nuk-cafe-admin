/**
 * The 3D benchmark's arithmetic (step 3h, D274, docs/plans/shop-designer-scenes.md → Performance
 * check): frame intervals in milliseconds → median and 95th percentile. The 95th percentile is how
 * slow the slowest 5% of frames get, which a stutter shows and an average hides.
 */

export const BENCHMARK = {
  /** Before measuring: shaders compiled, the GPU warm. */
  warmUpMs: 5000,
  /** One orbit: a full turn around the café. */
  runMs: 20_000,
  runs: 3,
} as const

export interface FrameSummary {
  frames: number
  medianMs: number
  p95Ms: number
}

/** The value at `fraction` of the sorted list (nearest rank). */
function rank(sorted: readonly number[], fraction: number): number {
  if (!sorted.length) return 0
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[index]!
}

export function summarizeFrames(intervals: readonly number[]): FrameSummary {
  const sorted = [...intervals].sort((a, b) => a - b)
  const round = (value: number) => Math.round(value * 10) / 10
  return { frames: sorted.length, medianMs: round(rank(sorted, 0.5)), p95Ms: round(rank(sorted, 0.95)) }
}

export interface BenchmarkReport {
  runs: FrameSummary[]
  all: FrameSummary
  quality: string
  pixelRatio: number
  canvas: { width: number, height: number }
  /** From the renderer after the last frame. */
  renderer: { calls: number, triangles: number, geometries: number, textures: number }
  surroundings: string
  /** From opening the 3D view to its first frame. */
  firstFrameMs: number | null
  userAgent: string
}

/** The report as plain text, to copy into a message. */
export function formatReport(report: BenchmarkReport): string {
  const line = (label: string, summary: FrameSummary) => `${label}: median ${summary.medianMs} ms, p95 ${summary.p95Ms} ms (${summary.frames} frames)`
  return [
    `Shop designer 3D benchmark (${report.surroundings})`,
    ...report.runs.map((run, index) => line(`Orbit ${index + 1}`, run)),
    line('All orbits', report.all),
    `Quality ${report.quality}, pixel ratio ${report.pixelRatio}, canvas ${report.canvas.width} × ${report.canvas.height}`,
    `Renderer: ${report.renderer.calls} draw calls, ${report.renderer.triangles} triangles, ${report.renderer.geometries} geometries, ${report.renderer.textures} textures`,
    `First frame: ${report.firstFrameMs === null ? 'not measured' : `${Math.round(report.firstFrameMs)} ms`}`,
    `Browser: ${report.userAgent}`,
  ].join('\n')
}
