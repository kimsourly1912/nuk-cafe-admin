# App-wide behavior

← [API Reference](./README.md)

Things the app shell does for every page, so features don't have to. Each section lists the cases it handles, and where they're tested. **If you change one of these, update the case table and its e2e test.**

- [Browser tab titles](#browser-tab-titles)
- [Data freshness](#data-freshness): refresh when the user comes back
- [Offline banner](#offline-banner)
- [Leaving with unsaved or in-flight work](#leaving-with-unsaved-or-in-flight-work)
- [Session loss](#session-loss)
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

Lists refetch when the user **comes back to the tab after 30 seconds or more**, and when the **connection comes back**. Another staff member may have changed the menu in the meantime.

Source: `app/plugins/data-freshness.client.ts` (VueUse `useDocumentVisibility`, `useOnline`) → [`invalidateAll()`](./data-fetching.md#invalidateall). E2E: `test/e2e/freshness.test.ts`. Decision: [D22](../decisions.md).

| Case | Behavior |
|---|---|
| Tab hidden ≥ 30s, then shown again | Every loaded list/query refetches |
| Quick tab switch (< 30s) | Nothing: no refetch storm while staff alt-tab |
| Tab shown again while offline | Nothing now; the reconnect refetch covers it |
| Connection lost → back | Every loaded query refetches (and the offline banner hides) |
| Refetch while rows are shown | Old rows stay on screen; `refreshing` is true (small spinner), not `loading` |
| Refetch while a form is open | Form input is untouched (forms copy data into their own state). The list behind it updates |
| Refetch after the session expired while away | The request gets 401 → refresh fails → redirect to login (see [Session loss](#session-loss)) |
| Other queries that shouldn't refetch | Not supported yet. All `<feature>:` keys refetch. Add an opt-out if a costly query appears |

Not done: polling (live updates while the tab is visible). If orders need it later, use `useIntervalFn` for that screen only (the pickup queue) instead of globally.

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
| After login | Back to the `redirect` page (only same-site paths starting with `/`) |

Source: `app/utils/api-fetch.ts`, `app/plugins/api.ts`, `app/middleware/*.global.ts`. See [Auth](./auth.md). E2E: `test/e2e/auth.test.ts`.

---

## Icons

Icons are bundled into the client build; nothing is fetched from `api.iconify.design` at runtime (decision D18). Write icon names as **literal strings** (`'i-lucide-tags'`, or a ternary of two literals). A name built at runtime (`` `i-lucide-${x}` ``) isn't found by the build scan and renders blank.
