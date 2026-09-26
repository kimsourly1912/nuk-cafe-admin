# Schedules plan

Planned with [feature-standard.md](../feature-standard.md) (template §1). Labels: **[Choice]** is a reversible choice made here; **[Open]** is a backend or project-owner contract, with the question listed in [progress.md](../progress.md#open-questions--waiting-on-others).

**Scope decision (user, 2026-09-26):** build create, edit and delete now, using the **safest encoding the evidence allows** for each [Open] item, instead of deferring them. Each such item is marked **verify on first staff login** below. Only what no encoding makes safe stays deferred.

## Evidence gathered

No staff login exists, so nothing authenticated was checked. The dev API's **unauthenticated** `/public/schedules/**` endpoints return the same response shapes, and were read (GET only) on 2026-09-26:

| Fact | Evidence |
|---|---|
| Times come back as `HH:mm` (`"09:00"`, `"23:59"`) | real-API (public GETs, 7 schedules) |
| `timezone` is `"UTC"` on every schedule; requests have no timezone field | real-API (public) + spec |
| `days` come back in random order (a Java `Set`, `uniqueItems: true` in the spec) | real-API (public) + spec |
| `/days-of-week` returns `MONDAY`…`SUNDAY` in enum order with labels `Mon`…`Sun` | real-API (public) |
| The list returns `item_count`, not `items`; `GET /{id}` returns `items[]` (`productId`, `productName`, `price`) | spec + real-API (public `available` returns `items`) |
| Default list order `sortBy=id`, `sortDir=desc`; default page size 10 | spec (`default` values) |
| No schedule has items, and none of the 176 products has `scheduleIds` | real-API (public), so link behavior can't be observed |
| No overnight range (end before start) exists in the data | real-API (public) |

## Purpose and scope

- **Purpose:** staff define when menu items are available (days of the week + a time range).
- **Acceptance criteria:**
  1. The list shows name (+ description), days, time range with timezone, item count and status. Loading, empty, filtered-empty and load-error states per §4.
  2. Filters: search, status, day of week, all in the URL. Page change and bulk selection as in Categories.
  3. Create: name, description, status, days (at least one), start and end time.
  4. Edit: the same fields. The schedule's linked menu items are **shown read-only** and **kept** on save.
  5. Delete (single and bulk): only for schedules with no linked menu items, checked when each delete starts. Linked schedules can't be deleted, and the UI says why.
  6. Update and delete of one schedule never overlap (`lock`).
- **Out of scope:** editing a schedule's items (done from the menu-item form, with Products); `ScheduleSelect` / `useScheduleOptions` (built with their first consumer, the Products form); sort UI; translations (Q5); the `available` endpoint.

## API contract

| Operation | Endpoint | SDK |
|---|---|---|
| List | `GET /staff/schedules` (`search`, `status`, `dayOfWeek`, `page`, `size`, `sortBy`, `sortDir`) | `getPage` |
| Detail | `GET /staff/schedules/{id}` | `getById1` |
| Create | `POST /staff/schedules` (`ScheduleCreateRequest`) | `create1` |
| Update | `PUT /staff/schedules/{id}` (`ScheduleUpdateRequest`) | `update1` |
| Delete | `DELETE /staff/schedules/{id}` | `delete1` |
| Options (later, for `ScheduleSelect`) | `GET /staff/schedules/all` | `getAll1` |
| Not used | `GET /staff/schedules/days-of-week`, `GET /staff/schedules/available` | |

**Request encodings.** Each [Open] item gets the encoding that is safe under every plausible backend meaning:

| # | Question | Label | Encoding used | Why it's the safest | Verify on first staff login |
|---|---|---|---|---|---|
| S1 | Request time format | [Open] backend | `HH:mm`, the format the API returns (`UInputTime`, converted by `utils/time.ts`) | Round-trips what the backend itself produces. A wrong format fails with the backend's validation message; no data is damaged | Create with `08:00` / `17:30`, read it back |
| S2 | Timezone of the times | **Decided by the user (2026-09-26, D33):** stored times are in the record's `timezone` ("UTC"); staff see and enter them in their **browser's** timezone, 12-hour | Converted both ways (`utils/timezone.ts`): display = record zone → browser zone, request = back to the record zone as 24-hour `HH:mm`. Days move with a start that crosses midnight. New schedules assume `UTC` (`SERVER_TIME_ZONE`). An unknown record zone is shown and saved unconverted, labelled | Exact round trip (unit). **Risk (Q13):** the dev descriptions ("Monday to Friday, 8:00am…" on `08:00`) suggest staff may have typed local time into these records; if so they now display 7 h late | Confirm the backend applies schedule times as UTC |
| S3 | Overnight ranges (end before start) | [Open] project owner + backend | **No rule of our own**: the form accepts it; the backend decides | Adding or forbidding it would invent a business rule | Try `22:00`–`02:00` |
| S4 | PUT semantics for `items` (replace, merge, omitted = keep/clear?) | [Open] backend | Edit **re-sends the existing product ids** from a fresh `GET /{id}` | Keeps the links under replace, merge and "omitted = keep" alike. Omitting could clear them under replace; `[]` would clear them. Duplication under an append is unlikely (`uniqueItems`) but is the one case to check | Edit a linked schedule, check its items are unchanged |
| S5 | Other omitted fields on PUT | [Open] backend | Every field is sent: the edited ones from the form, `nameI18n` / `descriptionI18n` copied from the record | Same as Categories: nothing relies on omission | |
| S6 | Deleting a schedule linked to products | [Open] backend (was feature-standard §9 item 8) | **Deferred for linked schedules**: delete is offered only when `item_count` is 0, and the delete re-reads the schedule (`GET /{id}`) right before `DELETE` and refuses if it has items | No encoding makes an unknown destructive effect safe. Unlinked schedules have nothing to cascade to | Does `items` reflect products' `scheduleIds` (same link)? What does deleting a linked one do? |
| S7 | Clearing the description | [Open] backend | Sent as the form's value (`''` when emptied) | `''` is a value, not an omission: it can't be read as "keep". Whether the backend stores `''` or `null` doesn't matter to the UI | |
| S8 | `sortBy` / `sortDir` values | [Open] backend | [Choice] no sort UI, server default (`id desc`) | | |
| S9 | `price` in `items` | [Open] backend (money, feature-standard §7) | Not shown | Currency/units unknown | |
| S10 | Days: at least one required? | [Open] project owner | [Choice] **required** (≥ 1) in the form | The restrictive direction is reversible and a schedule with no day is never available. Existing records all have days | |
| S11 | Start and end time required? | [Open] project owner | [Choice] **required** in the form | Same reasoning; every existing record has both | |

## List

- **Columns:** select, Name (+ description, muted), Days, Time (header "Time (GMT+7)": the viewer's zone; cells "4:00 PM – 6:30 AM (next day)"), Items (`item_count`), Status, actions. Days and times are converted to the viewer's zone (S2).
- **Days display [Choice]:** sorted Mon→Sun (the API's order is random). All 7 → "Every day"; Mon–Fri → "Weekdays"; Sat+Sun → "Weekends"; otherwise "Mon, Tue, Thu". A pure, unit-tested function.
- **Filters:** search, status (`STATUS_FILTER_ITEMS`), day of week (`ANY` + 7 days). All in the URL.
- **Ordering:** server order (S8). **Page size:** 20, as Categories.
- **Row actions:** Edit, Delete. Delete is disabled with "Linked to N menu items" when `item_count > 0`.

## Form (modal)

| Field | Input | Rule |
|---|---|---|
| Name | text | required, trimmed, max 100 |
| Description | textarea | optional, max 500 |
| Days | checkbox group + "Every day", "Weekdays", "Weekends" shortcuts | at least one (S10); sent in Mon→Sun order |
| Start / end time | `UInputTime`, 12-hour (`hour-cycle="12"`), in the viewer's timezone. The form state stays an `HH:mm` string; `parseTime`/`formatTime` convert to and from its `Time` value (unit-tested round trip). An `aria-label` names each field, because the label targets a hidden input | required (S11), `HH:mm` (seconds accepted if a record has them) |
| Status | `STATUS_ITEMS` | required |
| Items | read-only list of linked menu items (edit only) | preserved (S4) |

- **Preserved, not edited:** `nameI18n`, `descriptionI18n` (Q5), `items` (S4).
- **Edit needs the detail record.** The list row has no `items`, so the modal loads `GET /{id}` (`schedules:detail:<id>`). The fields are filled from the row at once; **Save stays disabled until the detail has loaded**. If the detail fails, the modal shows the error with Retry and can't save. The request copies `items` and the i18n maps from the detail.
- **Create** sends `items: []` [Choice]: a new schedule has no links, and `[]` avoids relying on how the backend treats a missing array.

## Relationships

- Products link to schedules (`ProductRecordCreation.scheduleIds`). The menu-item form will use `ScheduleSelect` (multiple) from this feature.
- [Choice] **`ScheduleSelect` + `useScheduleOptions` are built with Products**, their first consumer, so they're tested in real use instead of shipped unused. `index.ts` exports only `schedulesNavigation` for now.
- The schedule form doesn't pick products (user decision, 2026-09-26). No `ProductSelect` is needed yet.

## Mutations

| Mutation | id | key | lock | Notes |
|---|---|---|---|---|
| create | `schedules:create` | trimmed lower-case name | | |
| update | `schedules:update` | id | `schedule:<id>` | |
| remove | `schedules:remove` | id | `schedule:<id>` | confirm; `removes`; batch (no phases); GET-then-DELETE refusal for linked schedules (S6) |

- Messages name the schedule (`Schedule "Lunch" created`).
- **invalidate:** `['schedules', 'products']`. Products will show schedule names; harmless until then.
- **Bulk delete:** only unlinked selected rows are sent; linked rows stay selected and are counted in a note in the confirmation. Failures, skipped (busy) and not-started rows stay selected as in Categories.

## Permissions

[Open] Q6: no role behavior. The backend must enforce.

## Freshness

Defaults only. No polling.

## Edge cases and verification

| Risk | Test |
|---|---|
| Form schema: required name/days/times, time format, description length | unit |
| `toScheduleForm` defaults and values; `toScheduleRequest` re-sends item ids, copies i18n, orders days | unit |
| Days display (every day, weekdays, weekends, sorting) | unit |
| List loading/empty/filtered/error; day filter sent as `dayOfWeek` | e2e |
| Create sends `HH:mm`, ordered days, `items: []` | e2e |
| Edit waits for the detail, re-sends its item ids and i18n, shows items read-only | e2e |
| Edit when the detail fails: error + Retry, no save | e2e |
| Save fails: backend reason shown, input kept | e2e |
| Delete unlinked; linked row's Delete disabled; a schedule linked **since the list loaded** is refused before `DELETE` | e2e |
| Bulk delete sends only unlinked rows; linked rows stay selected | e2e |
| Busy row: bulk delete during a pending edit skips it (`lock`) | e2e |
| All S1–S7 encodings against the real backend | **real-API, pending a staff login** |

## Results (2026-09-26)

All acceptance criteria are met at **unit** and **browser-mock** level. `pnpm lint`, `pnpm typecheck` and `pnpm test` pass (173 tests). Response formats are real-API evidence (public endpoints); **no request encoding has been verified with a staff login**.

| Criterion | Evidence |
|---|---|
| 1 List display | e2e (days order and names, `HH:mm–HH:mm UTC`, item count, description) + unit (`formatDays`, `formatTimeRange`) |
| 2 Filters | e2e: day filter sent as `dayOfWeek` and kept in the URL; search/status/page use the shared list code (tested on Categories) |
| 3 Create | e2e: required-field messages, no request while invalid; body has `HH:mm`, days in week order, `items: []` |
| 4 Edit | e2e: Save disabled until the detail loads; body re-sends `items` ids and `nameI18n`; detail load failure blocks saving until Retry; failed save keeps the input |
| 5 Delete | e2e: unused schedule re-read then deleted; Delete disabled with the reason for a schedule in use; a schedule linked since the list loaded is refused before `DELETE`; bulk delete sends only unused rows, says how many were kept, keeps them selected |
| 6 Lock | e2e: bulk delete skips a schedule whose edit is saving. **Checked to fail** with the update `lock` removed |

Found while testing: `UForm`'s debounced input validation can shift the layout under a click made right after typing (a test-timing issue; pitfall added to progress.md).

**Open, verify on first staff login:** S1–S7 above (Q13–Q17 in progress.md).
