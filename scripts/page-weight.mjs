// What a page needs on a first visit (D253): the scripts and stylesheets the browser loads to show
// it, with their gzip size computed from the built files, apart from what it only prefetches when
// idle (`Sec-Purpose: prefetch`: Nuxt's hints for other pages). A plain request count mixes the two.
//
// Run against a production build of this checkout, served locally with data (the menu needs a cafe):
//   node .output/server/index.mjs            # after `pnpm build` or `pnpm analyze`
//   node scripts/page-weight.mjs http://localhost:3000 /c/nuk:390 /c/nuk:1440 /sign-in:390
// Chrome: the installed Google Chrome, or E2E_BROWSER_PATH (the same variable as the e2e suite).
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'

const [origin, ...pages] = process.argv.slice(2)
if (!origin || !pages.length) {
  console.error('Usage: node scripts/page-weight.mjs <origin> <path>:<width> [<path>:<width> …]')
  process.exit(1)
}
const PUBLIC = join(process.cwd(), '.output', 'public')
const kb = bytes => `${(bytes / 1024).toFixed(1)} kB`

/** A built file's gzip size (level 9); `undefined` when the served build isn't this checkout's. */
function gzipOf(path) {
  const file = join(PUBLIC, path)
  return existsSync(file) ? gzipSync(readFileSync(file), { level: 9 }).length : undefined
}

const browser = await chromium.launch(process.env.E2E_BROWSER_PATH ? { executablePath: process.env.E2E_BROWSER_PATH } : { channel: 'chrome' })
let missing = 0
for (const page of pages) {
  const [path, width = '390'] = page.split(':')
  const context = await browser.newContext({ viewport: { width: Number(width), height: Number(width) < 640 ? 844 : 900 } })
  const tab = await context.newPage()
  const needed = new Set()
  const prefetched = new Set()
  tab.on('request', async (request) => {
    const address = new URL(request.url())
    if (address.origin !== origin || !/\.(?:js|css)$/.test(address.pathname)) return
    const purpose = (await request.allHeaders())['sec-purpose'] ?? ''
    ;(purpose.includes('prefetch') ? prefetched : needed).add(address.pathname)
  })
  await tab.goto(`${origin}${path}`, { waitUntil: 'networkidle' })
  for (const file of needed) prefetched.delete(file)

  const sizes = [...needed].map(file => ({ file, gzip: gzipOf(file) }))
  missing += sizes.filter(size => size.gzip === undefined).length
  const sum = (list, ext) => list.filter(size => size.file.endsWith(ext)).reduce((total, size) => total + (size.gzip ?? 0), 0)
  const js = sizes.filter(size => size.file.endsWith('.js'))
  const prefetchGzip = [...prefetched].reduce((total, file) => total + (gzipOf(file) ?? 0), 0)
  console.log(`\n${path} at ${width}px: needs JS ${js.length} files ${kb(sum(sizes, '.js'))}, CSS ${kb(sum(sizes, '.css'))} (gzip); prefetches ${prefetched.size} files ${kb(prefetchGzip)} when idle`)
  for (const size of js.sort((a, b) => (b.gzip ?? 0) - (a.gzip ?? 0)).slice(0, 6)) console.log(`  ${kb(size.gzip ?? 0).padStart(9)}  ${size.file}`)
  await context.close()
}
await browser.close()
if (missing) console.error(`\n${missing} file(s) weren't in .output/public: the server isn't serving this checkout's build.`)
