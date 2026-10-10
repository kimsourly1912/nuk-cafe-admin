import type { Page } from 'playwright-core'
import { createPage, url } from '@nuxt/test-utils/e2e'
import { describe, expect, inject, it } from 'vitest'
import type { UploadedPhoto } from '#shared/contracts/media'
import type { MenuItem, MenuItemSummary } from '#shared/contracts/menu-items'
import type { PublicMenu } from '#shared/contracts/public-menu'
import { setupE2e } from './support/mock-api'
import { asNewVisitor, clientHeaders } from './support/client-address'

await setupE2e()

// Menu photos (D158) on the built server and its seeded database, no mocks: a photo uploaded as the
// editor makes it (the source and three files), checked by the server, attached to Brown Bean's
// only item, and shown by the customer menu as a square card and a 4:3 item page with two sizes.
// Brown Bean (the second seeded cafe) so NUK Cafe's menu stays as other files expect it.

const seed = inject('shopSeed')
const cafe = seed.secondCafe
const origin = new URL(url('/')).origin

async function signIn(person: { email: string, password: string }) {
  const response = await fetch(url('/api/auth/sign-in/email'), { method: 'POST', headers: { 'content-type': 'application/json', origin, ...clientHeaders() }, body: JSON.stringify(person) })
  expect(response.status).toBe(200)
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
}

/** A WebP of `width` × `height` drawn in the page, as the editor's canvas makes them. */
async function webp(page: Page, width: number, height: number): Promise<Uint8Array> {
  return new Uint8Array(await page.evaluate(async ([w, h]) => {
    const canvas = document.createElement('canvas')
    canvas.width = w!
    canvas.height = h!
    const context = canvas.getContext('2d')!
    context.fillStyle = '#7a4b2a'
    context.fillRect(0, 0, w!, h!)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(b => resolve(b!), 'image/webp', 0.8))
    return [...new Uint8Array(await blob.arrayBuffer())]
  }, [width, height]))
}

const EDIT = { focus: { x: 0.5, y: 0.5 }, card: { zoom: 1, x: 0.5, y: 0.5, adjusted: false }, detail: { zoom: 1, x: 0.5, y: 0.5, adjusted: false }, fill: '#7a4b2a' }
const PLACEHOLDER = 'data:image/webp;base64,UklGRhIAAABXRUJQVlA4IAYAAAAwAQCdASo='

async function photoForm(page: Page, sizes: { card?: [number, number] } = {}) {
  const body = new FormData()
  const file = async (name: string, w: number, h: number) => body.append(name, new Blob([await webp(page, w, h)], { type: 'image/webp' }), `${name}.webp`)
  await file('source', 1600, 1200)
  await file('card', ...(sizes.card ?? [480, 480]))
  await file('detail', 1200, 900)
  await file('detailSmall', 600, 450)
  body.append('edit', JSON.stringify(EDIT))
  body.append('placeholder', PLACEHOLDER)
  return body
}

const api = (path: string, cookie: string, init: RequestInit = {}) =>
  fetch(url(`/api/c/${cafe.slug}${path}`), { ...init, headers: { origin, cookie, ...init.headers } })

describe('a menu photo, end to end (D158)', () => {
  it('is checked by the server, private at its source, and shown square on the menu and 4:3 on the item page', { timeout: 90_000 }, async () => {
    const page = await createPage()
    await asNewVisitor(page)
    await page.goto(url(`/c/${cafe.slug}`), { waitUntil: 'hydration' })
    const cookie = await signIn(seed.customers.beanOwner)

    // A file of the wrong size is refused, naming it.
    const wrong = await api('/admin/media/photos', cookie, { method: 'POST', body: await photoForm(page, { card: [500, 500] }) })
    expect(wrong.status).toBe(400)
    expect((await wrong.json()).data.fieldErrors).toEqual({ card: ['Must be 480 × 480'] })

    const uploaded = await api('/admin/media/photos', cookie, { method: 'POST', body: await photoForm(page) })
    expect(uploaded.status).toBe(201)
    const photo = await uploaded.json() as UploadedPhoto
    expect(photo.image.placeholder).toBe(PLACEHOLDER)
    for (const file of [photo.image.card, photo.image.detail, photo.image.detailSmall!]) {
      const served = await fetch(url(file))
      expect(served.status).toBe(200)
      expect(served.headers.get('content-type')).toBe('image/webp')
    }
    // The source: to the cafe's admins only, never under /media.
    const source = await api(`/admin/media/photos/${photo.id}/source`, cookie)
    expect(source.status).toBe(200)
    expect(source.headers.get('cache-control')).toBe('private, no-store')
    expect((await api(`/admin/media/photos/${photo.id}/source`, '')).status).toBe(401)
    expect((await fetch(url(`/media/t/tenant-2/source/${photo.id}.webp`))).status).toBe(404)
    // How it was made, for the editor.
    expect((await (await api(`/admin/media/photos/${photo.id}`, cookie)).json()).edit).toEqual(EDIT)

    // The item uses it.
    const list = await (await api('/admin/menu/items?page=1&pageSize=20', cookie)).json() as { items: MenuItemSummary[] }
    const row = list.items.find(i => i.name === cafe.itemName)!
    const item = await (await api(`/admin/menu/items/${row.id}`, cookie)).json() as MenuItem
    const saved = await api(`/admin/menu/items/${row.id}`, cookie, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: item.version, imageId: photo.id }) })
    expect(saved.status).toBe(200)
    expect((await saved.json() as MenuItem).image).toEqual({ id: photo.id, url: photo.image.card, display: photo.image })
    const menu = await (await fetch(url(`/api/c/${cafe.slug}/public/menu?branchId=${cafe.branchId}`))).json() as PublicMenu
    const listed = menu.categories.flatMap(c => [...c.items, ...c.categories.flatMap(s => s.items)]).find(i => i.id === row.id)!
    expect(listed).toMatchObject({ imageUrl: photo.image.card, image: photo.image })

    try {
      // On the menu: the square card file, loaded lazily.
      await page.goto(url(`/c/${cafe.slug}`), { waitUntil: 'hydration' })
      const card = page.getByRole('article', { name: cafe.itemName }).locator(`img[src="${photo.image.card}"]`)
      await card.waitFor()
      expect(await card.getAttribute('loading')).toBe('lazy')
      // The item page: 4:3, two sizes for the browser to choose from, loaded at once.
      await page.goto(url(`/c/${cafe.slug}?item=${row.id}`), { waitUntil: 'hydration' })
      const detail = page.getByRole('dialog').locator(`img[src="${photo.image.detail}"]`)
      await detail.waitFor()
      expect(await detail.getAttribute('srcset')).toBe(`${photo.image.detailSmall} 600w, ${photo.image.detail} 1200w`)
      expect(await detail.getAttribute('loading')).toBe('eager')
      const box = (await detail.boundingBox())!
      expect(box.width / box.height).toBeCloseTo(4 / 3, 1)
    }
    finally {
      // Brown Bean's item as other files expect it: no photo.
      const now = await (await api(`/admin/menu/items/${row.id}`, cookie)).json() as MenuItem
      await api(`/admin/menu/items/${row.id}`, cookie, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ version: now.version, imageId: null }) })
    }
  })
})
