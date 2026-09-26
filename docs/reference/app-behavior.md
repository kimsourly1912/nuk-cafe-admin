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
| Session expired while away | The refetch gets 401 → refresh fails → redirect to login (see [Session loss](#session-loss)) |
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
| Access token expired | One `/staff/auth/refresh` (shared by concurrent requests), then the request is retried. The user notices nothing |
| Refresh fails | `clearSession()` → redirect to `/login?redirect=<current page>`. **No unsaved-changes dialog**: staying isn't possible |
| Log out with unsaved input | Asks first ([`useLeaveGuard`](./forms.md#useleaveguard)), **before** calling the backend |
| **Logged out in another tab** | This tab goes to `/login?redirect=<current page>` at once. Unsaved input in this tab is lost without a dialog (same as a refresh failure: the session is gone for every tab) |
| **Logged in in another tab** | Tabs waiting on `/login` continue to their `redirect` target. Logged-in tabs re-read the session (it may be a different staff member now) |
| Refresh fails in one tab | Only that tab redirects. The others find out on their next request (not broadcast: the failure could be one tab's network) |
| After login | Back to the `redirect` page. Only paths on this site: `/x` is allowed; `//other-site.com`, `https://…` and anything else go to `/` (`loginRedirectTarget`). Blocks open redirects through crafted login links |

Source: `app/utils/api-fetch.ts`, `app/plugins/api.ts`, `app/plugins/auth-sync.client.ts` (VueUse `useBroadcastChannel`, channel `nuk-cafe-admin:auth`, hook `app:auth-changed` fired by `useAuth().login/logout`), `app/middleware/*.global.ts`. See [Auth](./auth.md). E2E: `test/e2e/auth.test.ts` (the two cross-tab tests were checked to fail with the broadcast disabled).

---

## Keyboard shortcuts

For staff who use the portal all day. Press **`?`** (or user menu → Keyboard shortcuts) for the list.

| Keys | Where | Action |
|---|---|---|
| `/` | Any page with a `<SearchInput>` | Focus the search (hint `/` shown in the box while empty) |
| `N` | List pages | New item (tooltip on the "New …" button shows it) |
| `Ctrl`+`Enter` (`⌘`+`Enter` on Mac) | Open form modal | Save, including while typing in a field. Runs the form validation first |
| `Esc` | Dialogs | Close (asks first if there are unsaved changes) |
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
