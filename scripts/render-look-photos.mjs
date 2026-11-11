// Renders the pictures the built-in looks and pieces ship with (D273, step 3d) into
// public/shop-designer/looks/<id>.webp, from the same 3D builders as the building, so a picture
// always matches what the plan places. Run it again when a built-in model or look changes:
//
//   node scripts/render-look-photos.mjs
//   node scripts/render-look-photos.mjs person cat   (only these pictures)
//
// Serves scripts/look-photos/ with Vite's dev server (through vitest, a direct dependency) to
// playwright-core's Chromium, as the e2e tests launch it (E2E_BROWSER_PATH, or the installed Chrome).
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createViteServer } from 'vitest/node'

const root = fileURLToPath(new URL('..', import.meta.url))
const out = join(root, 'public/shop-designer/looks')
const WIDTH = 480
const HEIGHT = 360

const server = await createViteServer({
  root: join(root, 'scripts/look-photos'),
  configFile: false,
  logLevel: 'warn',
  resolve: { alias: { '#shared': join(root, 'shared') } },
  server: { port: 0, fs: { allow: [root] } },
})
await server.listen()

try {
  // The browser the e2e tests use: E2E_BROWSER_PATH, or the installed Chrome.
  const browser = await chromium.launch(process.env.E2E_BROWSER_PATH ? { executablePath: process.env.E2E_BROWSER_PATH } : { channel: 'chrome' })
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 2 })
  page.on('pageerror', error => console.error(error))
  await page.goto(server.resolvedUrls.local[0])
  await page.waitForFunction(() => 'showLookPhoto' in window, undefined, { timeout: 60_000 })
  const only = process.argv.slice(2)
  const ids = (await page.evaluate(() => window.lookPhotoIds)).filter(id => !only.length || only.includes(id))
  const unknown = only.filter(id => !ids.includes(id))
  if (unknown.length) throw new Error(`No picture named ${unknown.join(', ')}`)
  await mkdir(out, { recursive: true })
  for (const id of ids) {
    await page.evaluate(id => window.showLookPhoto(id), id)
    const png = await page.locator('canvas').screenshot()
    // Down to 480 × 360 WebP in the browser (no image library needed here).
    const webp = await page.evaluate(async ({ data, width, height }) => {
      const image = new Image()
      image.src = `data:image/png;base64,${data}`
      await image.decode()
      const target = document.createElement('canvas')
      target.width = width
      target.height = height
      target.getContext('2d').drawImage(image, 0, 0, width, height)
      return target.toDataURL('image/webp', 0.82).split(',')[1]
    }, { data: png.toString('base64'), width: WIDTH, height: HEIGHT })
    const bytes = Buffer.from(webp, 'base64')
    await writeFile(join(out, `${id}.webp`), bytes)
    console.log(`${id}.webp ${Math.round(bytes.length / 1024)} KB`)
  }
  await browser.close()
}
finally {
  await server.close()
}
