# Installable app plan (D202)

_2026-10-24. **Step 1 built** (see progress). Owner decision (this session, the recommendation accepted): make the cafe's **counter** and **admin** installable as apps (home-screen icon, full screen, no browser bar) with a **web app manifest only**: no service worker, no offline work, no Web Push. A service worker is a later, separate step with its own trigger (below). No new screen: no mockup round._

## Why

The counter runs all day on a tablet (D149: wake lock, chime, stale warning). In a browser tab, staff can close the tab or swipe to another one, the address bar takes space, and the tablet has to be opened through the browser each morning. An installed app starts from its own icon, full screen, as its own window.

What a PWA usually adds is already built or deliberately not wanted:

| Part | Status |
|---|---|
| Screen kept on, chime, sound unlock, stale warning | Built (D149, D150) |
| Offline notice, refetch on reconnect | Built (D22) |
| New build offered with Reload | Built (D149) |
| Offline orders and payments | **Not wanted:** prices, versions, idempotency and the single atomic batch are the server's (D39–D45). The offline banner already says saves wait for the connection |
| Caching API answers in a service worker | **Not wanted:** identity-bound data would outlive the session and cross cafes on a shared tablet |
| Web Push | Out of scope (live-updates plan); customers get "ready" on Telegram (D157) |

## Flow

```text
Staff open the counter (or the admin) in Chrome / Safari on the tablet
   ↓
app.vue's head: <link rel="manifest" href="/c/<slug>/counter.webmanifest">   (admin pages: admin.webmanifest)
   ↓
GET /c/<slug>/counter.webmanifest   (or admin.webmanifest)
   ↓  server/middleware/31.cafe-pages.ts (existing): unknown cafe 404, paused 403, former address 302
   ↓
route (thin, one per workspace): the cafe's profile, the builder, the headers
   ↓
tenants service: getCafeProfile(db, slug) (existing, public: name, logo, status)
   ↓
tenants feature: webManifest(profile, app) → JSON (pure function)
   ↓
Content-Type: application/manifest+json · Cache-Control: no-cache
   ↓
Browser menu → Install app / Add to Home Screen
```

## The manifest

| Field | Counter | Admin | Why |
|---|---|---|---|
| `id` | `/c/<slug>/counter` | `/c/<slug>/admin` | Distinct ids: one device can install both, and several cafes |
| `name` | `<Cafe> Counter` | `<Cafe> Admin` | The cafe's own name, as the tab title already reads (`app.vue`). No hardcoded cafe name |
| `short_name` | `Counter` | `Admin` | Under the home-screen icon the cafe name is usually cut |
| `start_url` | `/c/<slug>/counter` | `/c/<slug>/admin` | The counter's branch picker; the admin's dashboard. A signed-out start goes to sign-in as today |
| `scope` | `/c/<slug>/counter` | `/c/<slug>/admin` | The workspace (D204): Chrome offers Install only outside every installed app's scope, so `/` let a device hold one app from the site. Sign-in is inside; Your cafes and account pages open with the browser's bar |
| `display` | `standalone` | `standalone` | Full screen with the system status bar; `fullscreen` hides the clock and battery staff rely on |
| `icons` | generic set | generic set | See Icons |
| `background_color`, `theme_color` | the app's light background and primary | same | The splash screen; one value only (the manifest has no dark variant) |

No `orientation`: tablets are used both ways (the counter's three columns from `sm`).

**Placement:**

```text
server/
  routes/c/[slug]/counter.webmanifest.get.ts   thin: profile, builder, headers
  routes/c/[slug]/admin.webmanifest.get.ts     the same for the admin
  features/tenants/
    web-manifest.ts                            webManifest(profile, app): pure
    index.ts                                   export webManifest
    tests/web-manifest.test.ts
app/
  app.vue                                      the manifest link + iOS meta, for admin and counter paths
public/pwa/                                    icons (committed)
```

The builder sits in the tenants feature because it's a view of the cafe profile, which that feature owns; the route stays transport only. `app.vue` already knows the workspace (`isAdminPath`, `isCounterPath`) and the cafe name, and covers the counter's own sign-in and branch picker (layout `auth`), so no layout grows head logic.

**Head (admin and counter paths only):** `link rel="manifest"`, `link rel="apple-touch-icon"`, `meta name="mobile-web-app-capable" content="yes"`, `meta name="apple-mobile-web-app-title"` (the cafe name), `meta name="theme-color"` with light and dark `media`. The customer site and the platform console get none (step 1 scope).

## Icons

A generic coffee-cup icon, the same mark `CafeLogo` shows for a cafe without a logo, on the primary colour: `192.png`, `512.png`, `maskable-512.png` (safe zone), `apple-touch-icon-180.png`. Drawn once as an SVG (lucide's `coffee` in white on amber-800, 60 % of the side, 50 % for the maskable one) and rendered to PNG with the pre-installed Chromium through Playwright, no project dependency; the PNGs are committed. To redraw: render the same SVG at each size (any SVG-to-PNG tool works).

**Not the cafe's logo (QW1, answered in D204: one platform icon for every cafe, replaced by the platform's logo once QT1 names it):** a manifest icon must be a PNG at the size it declares. Logos are WebP up to 1600 px (`IMAGE_MAX_EDGE`), square only since the crop (D185), and the Worker can't resize images (no `sharp` on Workers). Using logos means making 192/512 PNGs when the logo is saved: a separate step if the owner wants it.

## Security and integrity

- Public data only: exactly what `GET /api/cafes/<slug>` already returns (name, logo, status). No session read, no tenant id in the output.
- Tenant resolution and paused/moved handling are the existing middleware's. Two static routes rather than one `[app]` parameter: nothing to allowlist, and no parameter route next to the cafe's own pages.
- CSP: `default-src 'self'` already covers `manifest-src`; no header change.
- No service worker means nothing is cached by us: `/api/**` stays `no-store`, D149's update flow is untouched.

## Edge cases

| Case | Behavior |
|---|---|
| Unknown cafe | 404 (middleware, "Cafe not found") |
| Paused cafe | 403 `TENANT_SUSPENDED` for the manifest; an installed app still opens and shows the paused page |
| Cafe address changed (D142) | Old manifest URL 302s to the new one. An installed app keeps its old `id`/`start_url`; its start redirects (302) and works. Reinstall gives the new name and address |
| Cafe renamed | `no-cache`: the browser picks up the new name on its next manifest check (Chrome updates installed apps on its own schedule; iOS keeps the name given at install) |
| Any other `/c/<slug>/<x>.webmanifest` | 404 (no route) |
| Signed out at start | The start page sends to sign-in as in a tab (counter: `/c/<slug>/counter/sign-in`; admin: `/c/<slug>/admin/login`), inside the app |
| Offline at start | The browser's own offline page (Chrome has a default one); once loaded, the offline banner as today |
| Two cafes, or a cafe's counter and admin, on one tablet | Separate apps: no scope covers another's start page (D204) |

## Tests

- **Unit** `web-manifest.test.ts`: fields per app; the cafe's name in `name`; slug in `id`/`start_url`; icon entries and sizes.
- **E2E, real server** (`cafes.test.ts`): content type and `no-cache`; `admin`/`counter` 200, anything else 404; unknown cafe 404; paused 403; former address 302; **two-cafe isolation:** cafe A's manifest names A and A's paths only, B's names B. Guard checks: the admin route reading another cafe's profile fails the isolation test; the manifest linked on every page fails the menu test.
- **E2E**: a counter page and an admin page (their sign-in pages) carry `rel="manifest"` pointing at their own cafe and app; the customer menu has none.
- **Manual (recorded in progress):** install on Android Chrome and on an iPad (Safari, Add to Home Screen) from staging; opens full screen at the right page; sign-in and a cafe switch stay in the app; the chime and wake lock work installed. iOS: check which page Add to Home Screen starts on (manifest `start_url` or the current page): not verified yet.

## Rollout

Installing ties the app to the domain. Staging installs are for testing only; cafes are asked to install once the production domain exists (Q4). Help: a short page for the assistant ("Install the counter as an app"), steps for Android and iPad.

## Step 1b: Install app in the user menus (D203, built)

**Install app** in the counter's and the admin's user menus, hidden inside the installed app: the browser's own dialog when it offered one, else a modal with the steps for this device (`useInstallApp`, `InstallAppModal`). See D203.

## Later: a service worker (step 2, not scheduled)

Only when slow loads on cafe Wi-Fi are a real complaint, or the install prompt (which still needs a fetch handler in Chrome) is wanted. Precache the build's static files only; never HTML or `/api/**`; updates go through `NewVersionBanner` (D149). Library: `@vite-pwa/nuxt` (vite-pwa organization) once its announced rebuild on `unplugin-pwa` ships; `@serwist/nuxt` if that doesn't work with our Nuxt and Cloudflare build. Comparison in D202.
