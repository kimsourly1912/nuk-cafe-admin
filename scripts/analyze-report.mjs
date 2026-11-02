// The client bundle as text (D253): the largest packages and chunks by gzip size, read from the
// report `nuxt analyze` writes (rollup-plugin-visualizer's data embedded in client.html), so an agent
// or a progress entry can compare one build with the next. The treemap itself is for people.
//
//   pnpm analyze                                   # builds, then runs this
//   node scripts/analyze-report.mjs [client.html]  # an existing report
import { existsSync, readFileSync } from 'node:fs'

const REPORT = 'node_modules/.cache/nuxt/.nuxt/analyze/client.html'
const file = process.argv[2] ?? REPORT
if (!existsSync(file)) {
  console.error(`No report at ${file}: run \`pnpm analyze\` first.`)
  process.exit(1)
}

const found = /const data = (\{[\s\S]*?\});\s*\n/.exec(readFileSync(file, 'utf8'))
if (!found) {
  console.error(`${file} has no visualizer data (has rollup-plugin-visualizer changed its template?).`)
  process.exit(1)
}
const { nodeParts, nodeMetas } = JSON.parse(found[1])

/** The package a module belongs to, or the app feature or root folder it lives in. */
function ownerOf(id) {
  const pkg = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/.exec(id)
  if (pkg) return pkg[1]
  const feature = /\/app\/features\/([^/]+)\//.exec(id)
  if (feature) return `app/features/${feature[1]}`
  const root = /\/(app|shared)\//.exec(id)
  return root ? `${root[1]}/ (other)` : '(generated)'
}

const owners = new Map()
const chunks = new Map()
for (const meta of Object.values(nodeMetas)) {
  for (const [chunk, partId] of Object.entries(meta.moduleParts)) {
    const { renderedLength, gzipLength } = nodeParts[partId]
    const owner = ownerOf(meta.id)
    const sizes = owners.get(owner) ?? { raw: 0, gzip: 0 }
    sizes.raw += renderedLength
    sizes.gzip += gzipLength
    owners.set(owner, sizes)
    const inChunk = chunks.get(chunk) ?? { gzip: 0, owners: new Map() }
    inChunk.gzip += gzipLength
    inChunk.owners.set(owner, (inChunk.owners.get(owner) ?? 0) + gzipLength)
    chunks.set(chunk, inChunk)
  }
}

const kb = bytes => `${(bytes / 1024).toFixed(1)} kB`
const total = [...owners.values()].reduce((sum, sizes) => sum + sizes.gzip, 0)
console.log(`Client JavaScript, every chunk: ${kb(total)} gzip (sum of modules; a page loads only some).`)
console.log('\nLargest packages and features (gzip, raw):')
for (const [owner, sizes] of [...owners].sort((a, b) => b[1].gzip - a[1].gzip).slice(0, 20)) {
  console.log(`  ${kb(sizes.gzip).padStart(9)}  ${kb(sizes.raw).padStart(10)}  ${owner}`)
}
console.log('\nLargest chunks (gzip) and what fills them:')
for (const [chunk, inChunk] of [...chunks].sort((a, b) => b[1].gzip - a[1].gzip).slice(0, 12)) {
  const top = [...inChunk.owners].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([owner, gzip]) => `${owner} ${kb(gzip)}`).join(', ')
  console.log(`  ${kb(inChunk.gzip).padStart(9)}  ${chunk}  ← ${top}`)
}
