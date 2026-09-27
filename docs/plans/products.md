# Products ("Menu items") plan

> **Historical (2026-09-27).** Written against the former Spring API. Its UI behavior notes still explain the current screens, but its API contracts, encodings and [Open] backend questions no longer apply. The server is now defined by the [server standard](../server/README.md); menu items, options and add-ons are defined in the [data model](../server/data-model.md#menu) (D44).

Planned with [feature-standard.md](../feature-standard.md) (template §1). Labels: **[Choice]** is a reversible choice made here; **[Open]** is a backend or project-owner contract, listed in [progress.md](../progress.md#open-questions--waiting-on-others). Unanswered contracts follow D32: the encoding that is safe under every plausible backend meaning, marked **verify on first staff login**.

**User decisions (2026-09-26):** variants editor is **phase 2** (shown read-only, kept on save); prices are **US dollars**; images: **upload and replace only**, no "remove"; the form opens in a **slide-over**.

## Evidence gathered

No staff login. The dev API's unauthenticated `/public/products/**` endpoints (GET only, 2026-09-26, 176 products) and the spec:

| Fact | Evidence |
|---|---|
| Prices are decimals in major units: `6.22`, `16.99`, `0.67`; 99 of 176 have cents | real-API (public) |
| Images: `imageUrl` on S3 (`…/public/product/2026/07/28/<uuid>`) + `imageUuid` (a different uuid: the file record's id). 104 of 176 have one | real-API (public) |
| `POST /staff/products/upload` (multipart `file`, optional `ownerId` uuid) returns `FileUploadResponse { id, url, contentType, sizeBytes, visibility, … }` | spec |
| Variants: groups (`variantName`, `requiredSelection`, `allowMultipleSelection`, `sortOrder`) with options (`optionName`, `price`, `sortOrder`), all with ids. 6 of 176 products use them | real-API (public) + spec |
| `nameI18n` / `descriptionI18n` are empty on every product | real-API (public) |
| Create requires `categoryId`, `price` (≥ 0), `productName`; update has no required fields and **no `sortOrder`** | spec |
| The list (`ProductResponse`) has `nameI18n`, `sortOrder`, `category`, `variants`, `scheduleIds`; the detail (`ProductDetailResponse`) lacks the i18n maps but adds `schedules` | spec |
| List filters: `productName` (not `search`), `categoryId`, `minPrice`, `maxPrice`, `status`; default sort `id asc`, size 10 | spec |

## Purpose and scope

- **Purpose:** staff manage the menu items customers order.
- **Acceptance criteria:**
  1. List: image thumbnail, name (+ description), category, price (`$6.22`), status. Loading/empty/filtered/error states per §4. Filters: name search, category, status, in the URL. Bulk delete.
  2. Create: image, name, category, price, description, schedules, status.
  3. Edit: the same fields. Variants shown read-only and **kept unchanged**; translations kept.
  4. Image: pick a JPEG/PNG/WebP ≤ 5 MB, preview, upload at once; replace. Save waits for a running upload.
  5. Delete (single + bulk) with confirmation.
  6. Update and delete of one product never overlap (`lock`).
  7. `ScheduleSelect` (multiple) + `useScheduleOptions`, exported from schedules, used by the form.
- **Out of scope (phase 2+):** variant editor; sort order (drag and drop per category); price-range filter; translations (Q5); removing an image; editing items from the schedule form.

## API contract

| Operation | Endpoint | SDK |
|---|---|---|
| List | `GET /staff/products` | `getPage1` |
| Create | `POST /staff/products` | `create2` |
| Update | `PUT /staff/products/{id}` | `update2` |
| Delete | `DELETE /staff/products/{id}` | `delete2` |
| Upload | `POST /staff/products/upload` | `upload` (own 120 s timeout) |
| Schedule options | `GET /staff/schedules/all` | `getAll1` |
| Not used yet | `GET /staff/products/{id}`, `/all`, `/category/{id}`, `PUT /sort-order` | |

**Request encodings:**

| # | Question | Label | Encoding used | Why it's the safest | Verify on first staff login |
|---|---|---|---|---|---|
| P1 | Currency and units | **Decided** (user): USD, major units | Input and display in dollars with 2 decimals (`UInputNumber` currency format). Sent as a number rounded to cents | Matches every price in the data | |
| P2 | Variant update semantics (ids kept, omitted = deleted?) | [Open] backend | Edit **re-sends the existing variants unchanged**, with their ids, in `sortOrder` order. Create sends `[]` | Unchanged data with ids is correct under replace and merge. Omitting could delete them under replace | Edit a product with variants; check they're unchanged |
| P3 | Image fields on update | [Open] backend | Re-sends the current `imageUrl` + `imageUuid`; a replaced image sends the upload's `url` + `id` | Never relies on omission meaning "keep" | Replace an image, reload |
| P4 | Removing an image | [Open] backend | **Deferred** (user decision): not offered | Clearing semantics unknown | |
| P5 | Upload limits and cleanup | [Open] backend | [Choice] our own limit: JPEG/PNG/WebP ≤ 5 MB (a constant). Abandoned uploads (form cancelled, image replaced) are not cleaned up; `ownerId` not sent | Restrictive and reversible; backend errors still shown | What the backend accepts; whether orphans matter |
| P6 | `scheduleIds` on update | [Open] backend | Always sends the full list the form shows (existing ids unless changed) | Correct under replace; the same list under merge | Add/remove a schedule |
| P7 | Translations, sort order | [Open] (Q5) / spec | `nameI18n`, `descriptionI18n` copied from the list row. `sortOrder` isn't in the update request, so it can't be wiped | | |
| P8 | Eligible categories and schedules for a **new** link | [Open] (Q9) | Inactive ones not offered as new choices; an existing inactive or unknown one stays visible (feature-standard §6) | Deferral, not a rule | |

## List

- **Columns:** select, image (40 px thumbnail or placeholder icon) + name + description, category, price, status, actions.
- **Filters:** `productName` (search input), `categoryId` (`CategorySelect` with "All categories", inactive included: filtering isn't a new link), `status`. All in the URL.
- **Order:** server default (`id asc`). **Page size:** 20.

## Form (slide-over)

| Field | Input | Rule |
|---|---|---|
| Image | preview + Upload/Replace button (`useFileDialog`) | optional; type and size checked before upload |
| Name | text | required, max 100 |
| Category | `CategorySelect` (required, no "none") | required |
| Price | `UInputNumber`, USD, step 0.01, min 0 | required, ≥ 0, ≤ 10 000 [Choice] |
| Description | textarea | max 500 |
| Schedules | `ScheduleSelect` (multiple) | optional |
| Status | `STATUS_ITEMS` | required |
| Variants | read-only summary (edit only) | kept (P2) |

## Relationships

- Uses `CategorySelect` (categories) and `ScheduleSelect` (schedules, built now).
- `CategorySelect` gets an `includeInactive` prop for filters.
- Exports nothing but `productsNavigation` yet (a `ProductSelect` waits for its first consumer).

## Mutations

| Mutation | id | key | lock |
|---|---|---|---|
| create | `products:create` | trimmed lower-case name | |
| update | `products:update` | id | `product:<id>` |
| remove | `products:remove` | id | `product:<id>` (confirm, `removes`, batch) |
| upload | `products:upload` | the form instance | (no record yet) |

- **invalidate:** `['products', 'schedules']` (schedules show an item count and their items).

## Permissions / Freshness

Q6 open; defaults only.

## Edge cases and verification

| Risk | Test |
|---|---|
| Schema, defaults, mapping (variants/i18n/image/schedules kept, price rounded) | unit |
| Money formatting | unit |
| List display, category filter sent as `categoryId`, search as `productName` | e2e |
| Create with an uploaded image: body has `imageUrl`/`imageUuid` from the upload | e2e |
| Wrong type / too large file rejected without a request | e2e |
| Save disabled while uploading | e2e |
| Edit re-sends variants, i18n, image and schedules; changing schedules sends the new list | e2e |
| `ScheduleSelect`: inactive not offered, current inactive kept visible | e2e |
| Delete | e2e |
| P2–P6 against the real backend | **real-API, pending a staff login** |

## Results (2026-09-26)

Phase 1 is built. Evidence is **unit** and **browser-mock**; response formats are real-API evidence (public endpoints); **no request encoding has been verified with a staff login**.

| Criterion | Evidence |
|---|---|
| 1 List + filters | e2e: image, category, `$3.50`, status; search sent as `productName`, category as `categoryId` and kept in the URL; empty state |
| 2 Create | e2e: required-field messages first; uploaded image's `url`/`id` in the body, category, rounded price, schedules, `variants: []` |
| 3 Edit | e2e: variants listed read-only and re-sent unchanged with ids; translations, image and schedules re-sent; failed save keeps the input |
| 4 Image | e2e: wrong type and > 5 MB rejected without a request; Save disabled during an upload; an upload failure toasts and keeps the previous image |
| 5 Delete | e2e (single); bulk uses the shared code tested on Categories |
| 6 Lock | Same `lock` pattern as Categories/Schedules (engine unit tests); no product-specific e2e |
| 7 `ScheduleSelect` | e2e: an inactive selected schedule stays visible and is kept; inactive ones aren't offered |

**Found while testing:** `aria-label` on the pickers landed on their wrapper, so the combobox had no accessible name (fixed, D34); the mock harness crashed on multipart bodies (fixed); a squeezed search box when a picker was given a width class (fixed).

**Open, verify on first staff login:** P2–P6 (Q18, Q19 in progress.md).

## Phase 2: variant editor (2026-09-26)

**User decisions:** send the full list and **verify the reply** (warn on any difference); reorder by **drag and drop** (D35).

| Criterion | Evidence |
|---|---|
| Add, rename, remove groups and options; required / "pick several" switches; option prices (USD, rounded) | e2e: the request body lists kept rows with ids, new rows without, removed rows absent, in the order shown |
| Reorder by keyboard (↑/↓ on a focused handle, focus kept) | e2e; **checked to fail** without the focus restore |
| Reorder by mouse drag | e2e (`dragTo` on the handle) |
| Server kept a removed variant → warning | e2e (a mock that ignores removals); unit for `variantMismatches` (extra, missing, order, new ids are fine) |
| Validation: group name, option names and prices, at least one option | unit + e2e (nothing is sent) |
| Reorder counts as unsaved | e2e |
| Translations of kept rows copied by id | unit |

**Verify on first staff login (Q18):** does the backend delete omitted variants/options, keep ids, and save the list order? The warning will say so if it doesn't.
