# App-wide behavior

← [API Reference](./README.md)

Things the app shell does for every page, so features don't have to. Each section lists the cases it handles, and where they're tested. **If you change one of these, update the case table and its e2e test.**

- [Browser tab titles](#browser-tab-titles)
- [Data freshness](#data-freshness): other tabs, returning to the tab, reconnect
- [Offline banner](#offline-banner)
- [Leaving with unsaved or in-flight work](#leaving-with-unsaved-or-in-flight-work)
- [Session loss](#session-loss): including login/logout across tabs
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Icons](#icons)

Context that shapes these choices: the portal stays **open all day** on counter tablets and managers' laptops, several staff members edit the same menu, the screen can be **seen by customers**, and cafe **wifi drops**.

---

## Browser tab titles

Every tab reads `<Page> · NUK Cafe Admin`, so staff with several tabs open can tell them apart.

Source: `app/app.vue` (`useHead` + `titleTemplate`), `app/types/page-meta.d.ts`, `app/error.vue`. E2E: `test/e2e/app-shell.test.ts`.

**Every route file sets `title`:**

```ts
// app/pages/categories/index.vue
definePageMeta({ title: 'Categories' })
```

| Case | Tab title |
|---|---|
| Route file with `title` | `Categories · NUK Cafe Admin` |
| Route file without `title` | `NUK Cafe Admin` (add one) |
| Unknown route / fatal error (`error.vue`, rendered instead of `app.vue`) | `Page not found · NUK Cafe Admin` / `Something went wrong · NUK Cafe Admin` |
| Login | `Sign in · NUK Cafe Admin` |

A detail page can override it with `useHead({ title: () => product.value?.name })` in its page component.

---

## Data freshness

Lists stay current in three ways. This is the model TanStack Query, SWR and Pinia Colada use (refetch on visibility when data is stale, and on reconnect), plus cross-tab invalidation:

1. **A save in another tab of this browser** refreshes the same lists in every other tab **at once**, whether the tab is in the background or in a window side by side. `invalidate()` sends the feature names (never data) over a `BroadcastChannel`.
2. **Returning to the tab** refetches data loaded **more than 5 seconds ago**. This covers changes made by other staff on other devices.
3. **The connection coming back** refetches everything loaded.

Source: `app/plugins/data-freshness.client.ts` (VueUse `useBroadcastChannel`, `useDocumentVisibility`, `useOnline`), `app/utils/invalidate.ts` (`invalidate`, `invalidateInThisTab`, `invalidateAll({ olderThanMs })`, load times recorded by `useApiQuery`). E2E: `test/e2e/freshness.test.ts`. Decision: [D22](../decisions.md).

| Case | Behavior |
|---|---|
| Create/edit/delete in tab 1, tab 2 shows the same list | Tab 2 refetches immediately (no need to switch to it) |
| Same, with two windows side by side | Same: the broadcast doesn't depend on visibility. A visibility-only approach misses this case: no `visibilitychange` fires between two visible windows |
| Tab 2 shows another page (Dashboard) | Nothing. The list loads fresh when opened |
| Bulk delete of 10 in tab 1 | One message after the 30ms merge window → one refresh per list in tab 2 |
| The tab that saved | Refreshes once (its own `invalidate`). It doesn't receive its own message, and a received message is never re-sent (`invalidateInThisTab`), so there's no ping-pong |
| Change made on **another device** | Picked up when the user returns to the tab (if the data is ≥ 5s old), or on the next navigation |
| Quick tab switch (data < 5s old) | No refetch |
| Tab visible again while offline | Nothing now; the reconnect refetch covers it |
| Connection lost → back | Every loaded query refetches (and the offline banner hides) |
| Refetch while rows are shown | Old rows stay on screen; `refreshing` is true (small spinner), not `loading` |
| Refetch while a form is open | Form input is untouched (forms copy data into their own state). The list behind it updates |
| Session expired while away | The refetch gets 401 → redirect to login (see [Session loss](#session-loss)) |
| Browser without `BroadcastChannel` | Only return-to-tab and reconnect refetches (every supported browser has it: Safari ≥ 15.4) |
| Malformed message on the channel | Ignored (must be `{ features: string[] }`) |

**Why not the alternatives** (researched 2026-09-26, see D22):
- Listening to `focus` instead of `visibilitychange`: `focus` also fires after alert/confirm dialogs, file pickers, iframes and DevTools, which causes needless refetches. TanStack Query dropped it for this reason.
- Syncing **data** between tabs (TanStack's `broadcastQueryClient`): experimental, fails on non-cloneable values (Vue proxies, Files), and puts cached data on the channel. Sending only feature names is enough: each tab refetches with its own cookies.
- Polling: costs requests all day for changes that are rare. If the orders pickup queue needs live data, poll that screen only (`useIntervalFn`) or use server push once the backend offers it.
- Server push (WebSocket/SSE): the only way to see another device's change instantly. The backend has no such endpoint today.

---

## Offline banner

While the browser reports no connection, a banner at the bottom reads "You're offline: changes can't be saved until the connection is back".

Source: `app/components/OfflineBanner.vue` (mounted in `app/app.vue`, so it shows on login too). E2E: `test/e2e/freshness.test.ts`.

| Case | Behavior |
|---|---|
| Connection lost | Banner appears (`role="status"`) |
| Connection back | Banner hides, data refetches |
| Save while offline | Not blocked: it fails with the network-error toast ("Can't reach the server…"). The banner explains why |
| "Online" but the API is down | No banner (the browser only knows about the network). Load errors show `ApiErrorAlert` with Retry |

---

## Leaving with unsaved or in-flight work

Two checks share one `beforeunload` listener (`app/plugins/leave-guard.client.ts`), attached only while needed:

- **Saves in flight** (`usePendingMutationCount() > 0`): only the browser's "Leave site?" on tab close/reload. In-app navigation is fine, because saves continue in the background.
- **Unsaved form input**: our "Discard unsaved changes?" dialog on route change, modal close and logout, plus the browser's dialog on tab close/reload.

Every case is in [Forms: unsaved changes → Edge cases](./forms.md#edge-cases).

---

## Session loss

| Case | Behavior |
|---|---|
| Session expired (401 from any request) | `clearSession()` → redirect to `/admin/login?redirect=<current page>`. No refresh or retry: Better Auth keeps a live session's cookie fresh itself, so a 401 means it's over. **No unsaved-changes dialog**: staying isn't possible. Open form modals close, toasts clear (see the transition contract below) |
| Admin access removed mid-session (403 `NOT_ADMIN`; removing the role also deletes the sessions, so usually a 401) | Same as a 401 |
| Many requests fail at once | One session change: `clearSession()` is idempotent |
| A customer or branch-staff account signs in on the admin login | `/api/admin/me` answers 403; the account is signed out again and the form says "This account doesn't have access to the admin app." (e2e `auth.test.ts`, both `NOT_ADMIN` and the route gate's `FORBIDDEN`) |
| Signed in on a temporary password, or a route answers 403 `PASSWORD_CHANGE_REQUIRED` | Every admin page goes to `/admin/change-password` until it's changed ([auth → change-password page](./auth.md#public-pages-and-the-change-password-page)) |
| Better Auth refetches its own session (startup, tab focus) | No effect on the staff session: separate state keys (`staff-session:*` vs the module's `auth:*`) |
| Log out with unsaved input | Asks first ([`useLeaveGuard`](./forms.md#useleaveguard)), **before** calling the backend |
| **Logged out in another tab** | This tab goes to `/admin/login?redirect=<current page>` at once. Unsaved input in this tab is lost without a dialog (the session is gone for every tab) |
| **Logged in in another tab** | Tabs waiting on `/admin/login` continue to their `redirect` target. Logged-in tabs re-read the session (it may be a different staff member now) |
| Session expires in one tab | Only that tab redirects. The others find out on their next request (not broadcast) |
| After login | Back to the `redirect` page. Only admin paths: `/admin/x` is allowed; `//other-site.com`, `https://…`, a customer-site path and anything else go to `/admin` (`loginRedirectTarget`). Blocks open redirects through crafted login links |
| A customer-site tab (any path outside `/admin`, D93) | Never reads the admin session: no login redirect, no password-change redirect, and another tab's login or logout leaves it alone (`isAdminPath`; e2e `shop-menu.test.ts` checks `/admin/me` is never called) |

Source: `app/utils/api-fetch.ts`, `app/plugins/api.ts`, `app/plugins/auth-sync.client.ts` (VueUse `useBroadcastChannel`, channel `nuk-cafe-admin:auth`, hook `app:auth-changed` fired by `useAuth().login/logout`), `app/plugins/session-boundary.client.ts`, `app/middleware/*.global.ts`. See [Auth](./auth.md). Tests: `test/unit/api-fetch.test.ts`; e2e `test/e2e/auth.test.ts`, `test/e2e/session.test.ts` (each checked to fail with its mechanism disabled).

### Session-transition contract

Any identity change (login, logout, expiry, a different staff member via another tab) increments `useAuth().generation` synchronously and fires `app:session-changed` (D29). Then:

| Left over from the previous identity | What happens | How |
|---|---|---|
| Responses to requests still in flight | Discarded (silent `aborted`): no data, no toast, no invalidation | `createApiFetch` (`apiFetch`) compares the generation at start and end |
| Query data (`<feature>:` keys) | Cleared; refetched only if someone is signed in | `clearNuxtData` + `refreshNuxtData` |
| Superseded/unmounted query responses | Ignored | Nuxt (promise identity), independent of the above |
| Unsaved forms | Discarded **without** a dialog | `useLeaveGuard().discardAll()` |
| Voluntary logout with unsaved input | Asks first; only "Discard" continues | `useAuth().logout` → `confirmLeave` |
| Open overlays (form modals, confirmations) | Closed | `useOverlay().closeAll()` |
| Toasts ("Reopen" drafts, "Retry failed") | Cleared | `useToast().clear()` |
| Mutation errors, results, "removed" marks | Reset; in-flight calls and record locks stay until they settle | `resetMutationOutcomes()` |

Not covered: browsers without `BroadcastChannel` learn about another tab's account change only on their next request or session check.

### API timeouts and retries

| Case | Behavior |
|---|---|
| Normal request | 30 s (`apiFetch`; uploads pass 120 s). ofetch's automatic retries are **off** (`retry: 0`): a retried write could apply twice |
| 401 / 403 NOT_ADMIN | No retry; the session ends |
| GET network error | Fails at once |

Tests: `test/unit/api-fetch.test.ts`. D27 (partly superseded by D40).

### Cookies and CSRF (review, 2026-09-26)

Auth is Better Auth's HttpOnly session cookie on this same origin (the admin UI and `/api` are one app); the frontend never reads it. Better Auth protects its own routes (`/api/auth`, trusted origins). Our API's writes (POST/PATCH/PUT/DELETE) must carry this site's `Origin` or `Referer` (`server/middleware/origin-check.ts`), so a sibling subdomain can't write with the user's cookie even though `SameSite=Lax` would send it. There are no state-changing GET routes. Verified with a cross-origin POST (403) against `pnpm dev`; production also needs `NUXT_PUBLIC_SITE_URL` set to the real origin.

### Permissions

The admin session carries `permissions` (`resource:action`, D52); only platform admins use the admin app, and they hold every admin permission, so no screen hides anything yet. `useAuth().can('staff:create')` is there for when manager screens exist. Who may do what: [security.md → Roles and permissions](../server/security.md#roles-and-permissions) (D45); the server checks every request.

## Keyboard shortcuts

For staff who use the portal all day. Press **`?`** (or user menu → Keyboard shortcuts) for the list.

| Keys | Where | Action |
|---|---|---|
| `/` | Any page with a `<SearchInput>` | Focus the search (hint `/` shown in the box while empty) |
| `N` | List pages | New item (tooltip on the "New …" button shows it) |
| `Ctrl`+`Enter` (`⌘`+`Enter` on Mac) | Open form modal | Save, including while typing in a field. Runs the form validation first |
| `S` / `R` | Categories | Select mode / Reorder mode (tooltips on the buttons show them) |
| `Esc` | Dialogs | Close (asks first if there are unsaved changes) |
| `Esc` | Categories in Select or Reorder mode | Leave the mode (an unsaved order stays until saved or discarded). Only when no dialog, menu or select is open: those close first. A plain keydown listener, not `defineShortcuts`, which would prevent the default and stop Escape closing menus |
| `?` | Everywhere | Show the shortcut list |

Source: `app/composables/useShortcuts.ts` (`usePageShortcuts`, `useSubmitShortcut`, `SHORTCUTS`) on Nuxt UI `defineShortcuts`, `app/components/ShortcutsHelp.vue`. E2E: `test/e2e/shortcuts.test.ts`.

| Case | Behavior |
|---|---|
| Typing in an input | Single-key shortcuts (`/`, `N`, `?`) don't fire: the key is typed |
| A dialog, menu or open select is on screen | Page shortcuts (`/`, `N`, `?`) don't fire. Otherwise `N` behind an **Edit** form would turn it into "New category" (the overlay is reused). The guard was checked by removing it |
| "Discard unsaved changes?" is over the form | `Ctrl`+`Enter` does nothing (it only acts when one dialog is open) |
| Empty required field + `Ctrl`+`Enter` | Validation message, no request |
| Windows / Linux vs macOS | `meta` = `Ctrl` / `⌘`, and the hints show the right key (`UKbd`) |
| Browser shortcuts (`Ctrl`+`F`, `/` quick find in Firefox) | `/` is taken by the app on list pages (it's prevented only when it acts). Others are untouched |

**Adding a shortcut:** register it with `usePageShortcuts` (page level) or `useSubmitShortcut` (forms), show it in the UI (`UTooltip :kbds`, `UKbd`), and add it to `SHORTCUTS` so `?` lists it.

---

## Icons

Icons are bundled into the client build; nothing is fetched from `api.iconify.design` at runtime (decision D18). Write icon names as **literal strings** (`'i-lucide-tags'`, or a ternary of two literals). A name built at runtime (`` `i-lucide-${x}` ``) isn't found by the build scan and renders blank.
