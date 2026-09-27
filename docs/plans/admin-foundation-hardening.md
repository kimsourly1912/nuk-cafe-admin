# Admin foundation hardening plan

> **Historical (2026-09-27).** Written against the former Spring API. Its UI behavior notes still explain the current screens, but its API contracts, encodings and [Open] backend questions no longer apply. The server is now defined by the [server standard](../server/README.md); the session and error handling parts are replaced by Better Auth and apiFetch (D40).

Planned with [feature-standard.md](../feature-standard.md) before Schedules. Scope: the shared foundation and the Categories reference feature. **Out of scope:** Schedules, Products, image upload, translations, any generic CRUD framework.

Labels as in the standard: **[Choice]** is a reversible implementation choice, recorded here. **[Open]** is a backend or project-owner contract; nothing here guesses one.

Status per item (updated at the end of the work): **Done**, **Deferred** (with its blocker), or **Not a gap** (checked, already correct).

## Inventory (before this work)

| Area | Exists | Gap found by reading code/tests |
|---|---|---|
| API layer (`app/utils/api-fetch.ts`, `plugins/api.ts`) | Envelope → `ApiError`, single-flight refresh on 401/NC1000, SDK `timeout: 30_000` | Refresh request has **no timeout**. A 401 **after** a successful refresh+retry is thrown without expiring the session. Concurrent failures can call `onSessionExpired` repeatedly and start new refreshes after expiry. ofetch's **implicit GET retry** reuses the first attempt's `signal`: after a timeout the retry fails instantly, after a network error it runs **without** a timeout |
| Mutation engine (`app/utils/mutation.ts`) | Per-mutation key dedupe, batch with Stop / Retry failed | `key in record` lookups break for keys like `constructor`, `__proto__`, `toString`. **No exclusion across mutations**: bulk delete can overlap an update of the same category |
| Categories list | `isBusy` row UI, select-all, batch delete, last-page step-back watch | Select-all includes busy rows and `removeSelected` doesn't re-select skipped rows. No committed tests for busy rows, Stop, Retry failed, last-page step-back, selection reset |
| Test harness (`test/e2e/support/mock-api.ts`) | `mockApi`, `MockFailure`, `pageOf` | Unmocked `/api/**` calls get `success: true, data: null`, which **hides** missing handlers. Delayed responses and paginated handlers are hand-rolled per test |
| Session boundaries | Cross-tab login/logout broadcast, expiry redirect | Query data, mutation errors/`removed` marks, toasts (incl. "Reopen" drafts), open overlays and dirty-form registrations **survive** a logout/expiry/account change. Mutation responses from the old session can still toast and invalidate in the new one. An open form modal stays over `/login` after expiry |
| CategorySelect | Loading state, `noneLabel`, `excludeId` | Load error shows an empty list; a current value not in the options shows blank; inactive categories offered as new selections although eligibility is [Open] (Q9) |
| Unsaved guard | Modal close, back, reload, save, mid-save tested (e2e) | Untested: failed save keeps input + stays dirty; browser **forward**; logout-from-another-tab with a dirty form; expiry with a dirty form |
| Lists | URL state, search, empty states tested | Untested: selection reset on filter/page change, out-of-order responses, loading text |
| Freshness | Cross-tab invalidation, stale-on-return, reconnect tested | Untested: overlapping refreshes (older response must not win) |

## Items and acceptance criteria

### 1. API and mutation correctness
1. **Refresh timeout** [Choice: 10 s]. A hung `/staff/auth/refresh` fails as `timeout` within 10 s. *Accept:* unit test with a never-resolving refresh.
2. **Timeouts on normal requests** [Choice: disable ofetch's implicit retries]. The SDK's 30 s applies **per attempt**. The only retry is our single post-refresh retry, which gets its own 30 s. *Accept:* unit test proving `retry: 0` is passed; real-ofetch unit test showing the default GET retry behavior that motivated it; documented worst case.
3. **Refresh transport failure vs rejection** [Choice]. A refresh that times out or can't reach the server fails the request with that error and does **not** log the user out. Only a definitive refresh rejection expires the session. *Accept:* unit tests for both.
4. **Expire exactly once, never loop.** A second 401 after a successful refresh+retry expires the session. Concurrent failures expire once. After expiry, no further refresh until a request succeeds again. *Accept:* unit tests for concurrent 401s, refresh failure, refresh timeout, second 401.
5. **Prototype-safe keys.** `constructor`, `__proto__`, `toString`, `hasOwnProperty` work as mutation keys. *Accept:* unit regression tests.
6. **Cross-mutation record locks.** Mutations that declare the same `lock` (e.g. `category:7`) never overlap. The check-and-reserve is synchronous at request start, after confirmation and per batch item. Different records run in parallel. Skipped items are reported with the reason. *Accept:* unit tests (update vs delete, lock taken while confirming, batch skip, parallel records); e2e bulk delete during a pending update.
7. **Categories list behaviors.** Select-all/busy rows, partial failure, Stop, Retry failed, last-page-after-delete. *Accept:* e2e tests, each verified to fail if its behavior is removed where practical.

### 2. Test harness
1. **Unmocked requests fail visibly.** Answered with HTTP 501 + recorded; the test fails in `afterEach`. Intentional handlers are explicit. *Accept:* all e2e tests pass with the strict harness.
2. **Helpers only where reused:** `deferred()` (delayed responses), `paginatedHandler()`, `failures.*` presets. *Accept:* each used by ≥ 2 tests.
3. Browser-mock evidence stays separate from real-API evidence in progress.md.

### 3. Session boundaries and security-sensitive UI
1. **Session-transition contract.** On any identity change (login, logout, expiry, account change, in this tab or another):
   - a session **generation** increments;
   - responses to requests started in an older generation are discarded (`ApiError` kind `aborted`, silent);
   - API query data is cleared, and refetched only when a user is signed in;
   - mutation errors/results/`removed` marks reset; toasts and overlays close;
   - dirty forms are discarded without a dialog.

   Voluntary logout still asks about unsaved changes **first**. *Accept:* e2e: cross-tab login/logout, expiry during a request (form modal gone, no dialog), switching users in one browser with a stale response released after the switch.
2. **CSRF review.** Document the cookie flow, what the frontend guarantees, and the exact backend questions. No client-side token. *Accept:* section in `app-behavior.md` + questions in progress.md.
3. **Permissions (Q6).** Prepare a matrix of questions only. No role-based UI. *Accept:* matrix in `app-behavior.md`; no code.

### 4. Forms, lists, freshness
1. **Unsaved guard** gaps tested: failed save, forward, cross-tab logout with a dirty form, expiry with a dirty form. Fix any demonstrated gap in the existing guard; no second guard.
2. **Lists:** selection reset on filter/page change; out-of-order responses; loading text. **Pickers:** `CategorySelect` shows a load error with Retry and a label for a current value that isn't in the options. Inactive categories are no longer offered as **new** selections while Q9 is open, following the standard's deferral rule; an existing inactive value stays visible. *Accept:* e2e.
3. **Freshness:** overlapping refreshes can't let an older response win. `navigator.onLine` stays a hint (banner + refetch on reconnect only, no write queue). No global polling. *Accept:* e2e for overlap; existing tests keep passing.

### 5. Open contracts (investigate, document, don't guess)
Q7 (parent clearing), Q8 (concurrent edits), Q9 (inactive eligibility), CSRF questions, Q6 (roles). *Accept:* each has its question, owner, affected behavior and what stays deferred, in progress.md.

## Choices made here (reversible)
- Refresh timeout 10 s; ofetch automatic retries off (`retry: 0`).
- Refresh transport failure → request fails with that error, session kept.
- Record locks are opt-in per mutation (`lock`), not automatic, because only the feature knows which operations conflict.
- Conflicting single actions get an error toast ("Another action on … is still in progress"). Same-mutation double submits stay silent.
- Unmocked e2e requests → HTTP 501 + test failure.

## Results (2026-09-26)

All evidence below is **unit** or **browser-mock** (real Chrome, mocked API). **No authenticated real-API verification** was possible (no staff login). Suite: `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass (146 tests: 83 unit/nuxt + 63 e2e; the e2e project passed 3 full runs in a row after raising its `expect.poll` timeout, see progress.md pitfalls). Where noted, a test was checked to **fail with its fix or mechanism removed**.

| Item | Status | Evidence |
|---|---|---|
| 1.1 Refresh timeout | Done: `REFRESH_TIMEOUT_MS` 10 s | unit, incl. a real-ofetch test with fake timers |
| 1.2 Timeouts per attempt, ofetch retries off | Done: `retry: 0`; worst case 30 + 10 + 30 s documented | unit; real-ofetch test shows the default GET retry |
| 1.3 Transport failure keeps the session | Done | unit (timeout, network) |
| 1.4 Expire once, no loop | Done: expiry per identity generation | unit (concurrent 401s, refresh failure, second 401, later calls); e2e (one refresh on a second 401) |
| 1.5 Prototype-safe keys | Done: null-prototype records + `in` | unit for 5 keys; **plus** a reactivity test added after the first version (`hasOwnProperty`) broke busy rows (found by e2e) |
| 1.6 Record locks | Done: `lock` option, Categories update/remove | unit (conflict, lock during confirmation, while queued, parallel records, release on failure, batch skips); e2e fails without `lock` |
| 1.7 Categories list behaviors | Done: skipped rows stay selected; tests for busy row vs bulk delete, Stop, Retry failed, last-page step-back, selection reset | e2e `categories-bulk.test.ts` |
| 2.1 Strict harness | Done | a throwaway test with a removed handler failed as expected |
| 2.2 Helpers | Done: `deferred` (5+ tests), `paginatedHandler` (list-page, bulk), `failures` (auth, categories, session, bulk, pickers, unsaved) | |
| 2.3 Evidence kept separate | Done in progress.md | |
| 3.1 Session-transition contract | Done (D29) | e2e `session.test.ts`: expiry during a save, other-tab logout with a dirty form, switching users (late mutation response + persistent toast), late list response. The boundary and the generation check were each disabled once and the matching tests failed. The late **list** response is also dropped by Nuxt itself (promise identity), so that test passes either way |
| 3.2 CSRF review | Done as documentation: app-behavior.md → "Cookies and CSRF"; Q10–Q12 | no frontend change justified without a contract |
| 3.3 Permissions | Question matrix only (app-behavior.md → Permissions), no role behavior | **Blocked on Q6** (project owner) |
| 4.1 Unsaved guard | Tested: failed save, forward, expiry and other-tab logout with dirty forms (reload, back, modal close, save, mid-save were already tested) | Voluntary logout with a dirty **modal** isn't reachable (the modal covers the user menu), and no page form exists: **not browser-tested** |
| 4.2 Lists and pickers | Done. **Found and fixed:** a slow older response blocked and then overwrote newer results (Nuxt `watch` queueing, D30); blur validation made the first click on the picker's Retry miss (D31) | e2e (both fail without their fix) |
| 4.3 Freshness | Overlap test: an older refresh response can't replace a newer one (Nuxt cancel semantics). No global polling added; `navigator.onLine` still only drives the banner and the reconnect refetch | e2e |
| 5 Open contracts | Documented: Q6–Q12 with owner and deferred behavior. The spec has no descriptions, `nullable` flags or status filters that answer Q7–Q9; nothing was inferred from mocks | spec inspected (unauthenticated `api-docs` only) |

**Left incomplete, with blockers:**
- Q7 (parent clearing): the Category form still sends an omitted `mainCategoryId` to clear. Behavior is unchanged and unverified. *Blocker:* backend contract or a real-API check.
- Q8 (concurrent edits): no client conflict handling. *Blocker:* backend behavior/version field.
- Role-based UI (Q6) and any CSRF-related frontend change (Q10–Q12). *Blocker:* project owner / backend answers.
- Real-API verification of every authenticated flow. *Blocker:* a staff login.
