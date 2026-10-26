# Menu import plan (step 9.2)

_2026-10-26. Owner request: "we create menu items by hand, one by one; let the admin upload a file (PDF or a photo) and have AI turn it into menu items, categories, options and add-ons." Owner decisions this session: **"use your defaults"** for every choice below. Decision record: [D211](../decisions.md#d211-menu-import-from-a-pdf-or-photos-replaces-step-92-2026-10-26). It replaces the planned 9.2 ("a menu item drafted from a description", [ai-assistant.md](ai-assistant.md)) with one pipeline that serves both, and builds the deferred "Draft from a photo of a paper menu" ([ai-later.md](ai-later.md))._

Steps, each its own PR:

| # | Step | Done when |
|---|---|---|
| **9.2** | This plan, the decision and the mockup brief | The owner approves the mockups (frames reviewed together, [feature standard](../feature-standard.md#designing-a-ui-step-with-mockups-the-owners-workflow)) |
| **9.2a** | Server: upload, reading, matching, the import itself, cleanup, quality check | Server tests (two cafes, guards removed fail); staging checks below |
| **9.2b** | App: the Import menu pages from the approved frames; the help page | e2e; screenshots 1440 and 390 |
| **9.2c** | "Describe an item": a sentence read by the same pipeline, opening the item editor filled in (the old 9.2) | e2e; the quality check's descriptions |

## What others do (research, 2026-10-26)

Every product found keeps a person between the AI and the live menu:

- **Lightspeed** (O-Series): upload a menu, the AI extracts it, the merchant reviews and edits, then imports. Only for a back office with **no products yet**: merging into an existing menu is the hard part.
- **Lightspeed Kounta** (2026): names, prices and modifiers inside option sets reviewed and edited before anything is imported.
- **Wix Restaurants**: the AI's menu is saved **as a draft**; text only, photos in a PDF are not extracted.
- **Square**: PDF, JPG, PNG or a link; built in the background, an email when ready (often within 24 hours).
- **Joe Coffee**: the AI writes a spreadsheet to check and import.
- **Google Business Profile**: reads multi-page PDF menus.

What we take: a draft in **our own terms** (categories, options with a price grid, add-on groups), reviewed before import; items saved as drafts; adding to an existing menu, but never changing what is there.

## Purpose and scope

- **Purpose:** an admin setting up a cafe (or rebuilding its menu) uploads the menu they already have, as a PDF or photos, checks what was read, and gets every item as a draft in one step instead of entering 50 items by hand.
- **In scope / acceptance criteria:**
  1. **Off without an AI key**, like the assistant (D108): the button is hidden and every route answers 404.
  2. Only admins with both `menu:write` and `assistant:use` (401 / 403 otherwise).
  3. **Files:** one PDF (at most 10 MB) **or** 1–10 photos (JPG, PNG, WebP, HEIC; made smaller in the browser to at most 2000 px, JPEG). Anything else is refused before reading.
  4. **Reading streams:** items appear as they are found; a failure keeps the files, so **Try again** needs no new upload.
  5. **The AI only reads.** It answers names and amounts in a fixed shape; it never chooses ids and writes nothing. The server turns names into our records and checks every limit.
  6. **Review before import:** every item, category, option set and add-on group is shown, editable, with **New**, **Already on your menu** or **Needs attention**; nothing is written until **Import**.
  7. **Only adds.** Existing items, categories, option sets and add-on groups are never changed, with one exception the admin sees and can switch off: new **values** added to an existing option set (adding a value changes no item, D44).
  8. **Items are saved as drafts**, never published. Customers see nothing until an admin publishes them (the existing Publish and bulk Publish, D125).
  9. **One import, one atomic write** with its guards and audit; importing twice is impossible (the import's status and an idempotency key).
  10. **Per cafe:** an import, its files and its matches belong to one cafe; another cafe's import is 404 (two-cafe test).
  11. **Daily limit** per admin and cafe, separate from the assistant's questions: **10 readings a day** (`NUXT_AI_IMPORT_DAILY_LIMIT`).
  12. **Kept 7 days**, then the import and its files are deleted.
- **Out of scope (later, [ai-later.md](ai-later.md)):** updating prices or items already on the menu ("sync from a new menu"); spreadsheets (CSV/XLSX: structured data needs no AI, a separate importer); a link to a website; cropping item photos out of the menu; translated names (D45: English only); availability rules; reading in the background with an email when done.

## Mental model

```text
Upload            the browser shrinks photos; the server stores the files (private R2) and an import row
   ↓
Read              AI: the files → a raw menu in a fixed shape (names, sections, prices, sizes, extras)
   ↓
Normalize         server, no AI: cents, trimming, duplicates, our limits, warnings; stored on the import
   ↓
Match             server, no AI, on every read and again at import: names → this cafe's records
   ↓
Review            the admin: edit, untick, choose new or existing; kept in this browser (D151)
   ↓
Import            one batch through the menu feature's statements; items as drafts; audit
   ↓
Publish           the existing Menu items screens
```

**Matching is never stored.** The import keeps only the normalized reading. "Already on your menu" is worked out against the menu as it is now, each time the review opens and again inside the import, so a category someone created meanwhile is matched, not duplicated.

## Boundaries

```text
app/features/menu-import/            the Import menu pages (talks only to /api/c/<slug>/admin/menu-imports)
        ↓ apiFetch
server/api/c/[slug]/admin/menu-imports/   thin routes: switch, permissions, validation, idempotency
        ↓
server/features/menu-import/         the import row, files, normalize, match, the import batch
        ↓                    ↓                       ↓
assistant (public)     menu (public)              media (public)
readMenu(files)        libraryForImport(...)      private object storage helpers
the only AI caller     importStatements(...)
```

- **The assistant stays the only feature that knows AI exists** (D107). It gains `readMenu(settings, files, onPartial)`: the prompt, the schema, the provider call, usage. It reads no database table but its own usage.
- **The menu feature owns every menu write.** It gains `libraryForImport(db, tenantId)` (active categories, option sets with values, add-on groups with add-ons, item names) and `importStatements(db, actor, plan)` (the guards and inserts for categories, option sets, values, add-on groups and items, built from the same repository functions `createItem` uses, plus one audit row per created record). Menu import never writes `menu_*` tables itself, the way menu runs media's `attachStatements` today.
- **Menu import owns the workflow:** the `menu_imports` row, its files, normalizing, matching, the review contract, the batch that runs the menu statements with its own status guard.
- **The app feature is its own** (`app/features/menu-import/`); Menu items links to it. It imports nothing from `products` except through `index.ts`.

## API contract (`shared/contracts/menu-import.ts`)

| Route | Body / query | Returns |
|---|---|---|
| `GET /api/c/<slug>/admin/menu-imports` | | This cafe's imports from the last 7 days, newest first: `id`, `status`, `createdBy` (name), `createdAt`, `source` (`pdf` \| `photos`, page count), `itemCount` |
| `POST /api/c/<slug>/admin/menu-imports` | multipart: `files` | 201 `{ id }`, status `uploaded`. Files checked by their headers (type, size), stored privately under `t/<tenant>/imports/<id>/` |
| `POST /api/c/<slug>/admin/menu-imports/<id>/read` | | Streamed: the partial reading as it grows, then the result. Takes a daily slot first (429 `AI_LIMIT_REACHED`). From `uploaded` or `failed` only (409 otherwise) |
| `GET /api/c/<slug>/admin/menu-imports/<id>` | | The import: `status`, `version`, `pages`, `reading` (normalized), `matches` (computed now), `warnings` |
| `GET /api/c/<slug>/admin/menu-imports/<id>/pages/<n>` | | One stored page (image or the PDF), private, `Cache-Control: private` |
| `POST /api/c/<slug>/admin/menu-imports/<id>/import` | `{ version, review }`, `Idempotency-Key` | 200 counts created, status `imported`. 409 `VERSION_CONFLICT` / `IMPORT_NOT_READY` / `MENU_CHANGED` (a name taken meanwhile: the review reloads its matches) |
| `DELETE /api/c/<slug>/admin/menu-imports/<id>` | `?version=` | 204: the row and its files |

**Statuses:** `uploaded` → `reading` → `ready` \| `failed` → `imported`. A `reading` older than 3 minutes counts as `failed` (the connection dropped). **Cancel** while reading stops the request; the slot stays used and the import offers Try again.

**The reading** (what the AI must answer; the server checks it with Valibot):

```text
sections[]        name, parent (a section name or null), page
  items[]         name, description?, page,
                  prices[]      { options: { [setName]: valueName }, amount, currency: USD | KHR }
                  addOnGroups[] (group names)
optionSets[]      name, values[]           e.g. Size: Small, Medium, Large
addOnGroups[]     name, addOns[] { name, amount, currency }, minSelect?, maxSelect?
```

**The review** (what the browser sends to import): the reading's keys with the admin's edits, each item's `selected`, and per category, option set and add-on group `{ use: 'new', name } | { use: 'existing', id }`. The server checks it whole against the contract limits and matches again; it never trusts an id it didn't just find in this cafe.

## Business rules the server enforces

| Case | Rule |
|---|---|
| **A price in riel only** | Converted with the cafe's riel rate (exchange rates), rounded to the cent; the item **needs attention**: "Converted from 10,000៛ at 4,100៛ = $2.44" |
| **Both "$2.50 / 10,000៛"** | The USD amount is used |
| **No price** | The version is created switched off with no price; an item with **no** priced version can't be imported (unticked, "Add a price") because every item needs one active version |
| **Over $1,000** (`MAX_VARIATION_PRICE_MINOR`) | Needs attention; can't be imported until fixed |
| **Sizes as columns, "Hot / Iced"** | Option sets with a price grid |
| **A third option dimension** | Needs attention: at most 2 option sets per item (D44); the admin picks two or splits the item |
| **More than 20 values, more than 10 add-on groups on an item** | Needs attention (the existing limits) |
| **A section with both items and sub-sections** | Its items go to a new sub-category "Other" under it, with a warning (items only in leaf categories, D44) |
| **Category match** | Same name (case and spaces ignored) at the same level among active categories. An existing parent that holds items can't take sub-categories: warning |
| **Option set match** | Same name; values matched by name. Values not in the existing set are listed: "Add Medium to Size" (on by default, can be switched off, then those versions are left out) |
| **Add-on group match** | Same name **and** every add-on found exists in it: used as is (its prices stay). Otherwise **Create new** is the default with a different name, because adding an add-on to a group changes every item that uses it (D44) |
| **Item match** | An item of any status but archived with the same name anywhere in the cafe: **Already on your menu**, unticked |
| **A name taken by a new record** | The suggested name gets " (imported)"; the admin can rename |
| **Two admins import at once** | Both may read; the import batch carries the menu's name-unique indexes and a guard per "existing" record (still active), so the loser gets `MENU_CHANGED` and reviews again |
| **Text in the file that gives orders** ("ignore your instructions…") | Only data in the fixed shape comes back; there are no tools; everything is shown as plain text and imported only by a person. A quality check case |
| **Too many items for one batch** | At most **200 items per import** (422 `IMPORT_TOO_LARGE` beyond). **[Needs verification in 9.2a]** whether D1 accepts that many statements in one batch on the Workers plan (1,000 queries per invocation on Paid, 50 on Free). If not, the import runs one category per batch, each all-or-nothing, with the categories done recorded on the import so Try again continues |

## Mutations and freshness (app)

- `useApiQuery` for the list and the import; `useMutation` for upload, discard and import. The streamed reading goes through `apiFetch` (`responseType: 'stream'`), as the assistant's chat does (D109).
- The review's edits are kept in this browser with `useUnsavedChanges({ draft })` (D151, key `menu-import` / the import's id): Restore after a refresh, removed on import, discard or sign-out.
- After import, invalidate the menu's lists (items, categories, option sets, add-on groups) and the home page's setup steps.
- Session change clears the import screens like every identity-bound query.

## Settings and cost

- The same provider and model as the assistant (D107: one model). **If the quality check shows the model misses too much on real menus**, 9.2a adds the "model per task" setting from [ai-later.md](ai-later.md) (`NUXT_AI_IMPORT_MODEL`) instead of changing the help assistant's model.
- `assistant_usage` gains `kind` (`chat` \| `menu_import`); each limit counts its own kind. One reading: one row, its tokens, `ok` or `error`.
- Reading: 120 s timeout (the chat's 30 s is too short for a 4-page menu), **no automatic retry** (it costs money; the admin presses Try again).
- **[Needs verification in 9.2a]** on staging: the structured-output call in the installed `ai@7` (`streamObject` or `streamText` with an output schema, checked against its docs, not memory); PDF and image input for the configured provider; CPU per request (the file read and base64 encoding of a 10 MB file, the partial JSON parsing), given the Free plan's 10 ms limit found in the release check.

## Cleanup and lifecycle

| What | When it goes |
|---|---|
| The import row and its files in R2 | 7 days after upload (`menu-import:purge`, daily), or on Discard |
| An admin's account removed | Their imports go with it (cascade); what was imported stays, as any menu change |
| The records created | Ordinary menu records: archived, deleted and published as usual (D200) |
| Audit | `menu.import.read`, `menu.import.import` (counts per kind) and the menu's own `create` rows per record, all naming the tenant |

## Quality check

`server/features/assistant/eval/menu-import.eval.ts`, on request only (`ASSISTANT_EVAL=1`), never in CI: 10–15 menus (a one-page cafe menu, a two-column board photographed at an angle, sizes in columns, riel only, both currencies, Khmer and English, a 4-page PDF, a menu with an instruction hidden in it, a page that isn't a menu). Measures: items found, prices exact, option sets recognised, add-on groups recognised, nothing invented. **The owner supplies real menus** (with permission) where possible; the rest are made up.

## Edge cases and verification

| Risk | Test |
|---|---|
| Another cafe's import, page or matches | server `menu-import.tenants.test.ts`: 404 for every route; matching sees only its own records; the batch refuses another cafe's "existing" id. Each tenant filter removed fails a test |
| Importing twice (double click, retry) | server: the same key replays; a second import of an `imported` row is 409. Guard removed fails |
| A matched record archived or a name taken before import | server: `MENU_CHANGED`, nothing written (race tests, as the menu's own) |
| Limits (files, 200 items, prices, 2 option sets, the daily limit) | server; the limit's race (two readings for the last slot), as D108 |
| Partial failure | server: one invalid row refuses the whole import, nothing written |
| Normalizing and matching | unit: cents, riel conversion, sizes to a grid, "Other" sub-category, name collisions, add-on group rules |
| The AI answers nonsense or the wrong shape | server with `MockLanguageModel`: refused with "We couldn't read this menu", the slot counted |
| Files | server: wrong type by header, too large, 11 photos, a PDF renamed `.jpg` |
| Purge | server: rows and objects older than 7 days gone, newer kept |
| The flow | e2e (9.2b), the read route mocked with the SDK's stream: upload, items appearing, review edits restored after reload, import, drafts on Menu items |
| Real reading | the quality check against the staging provider; one real PDF through the staging Worker |

## Mockup brief (for the owner's image tool)

**Where it lives:** Menu items gets **Import menu** (a secondary button beside **New item**, and in the empty state "No menu items yet: **Import your menu** from a PDF or photos, or **Add an item**"). The home page's "Set up your cafe" menu step offers it too. Pages: `/c/<slug>/admin/products/import` and `/c/<slug>/admin/products/import/<id>`.

**Style rules for every frame:** the existing admin portal: Nuxt UI, left sidebar, page header with title and actions, white cards on a light grey page, primary green buttons, light mode (dark mode follows the tokens). English. No cafe name hard-coded: "Your cafe". Desktop **1440** wide and phone **390** wide. Compact, touch-friendly on phones. Badges: **New** (neutral), **Already on your menu** (grey), **Needs attention** (amber). Prices like `$2.50`.

**Out of scope for the frames:** editing photos, translations, availability rules, publishing (done on Menu items), any chat or assistant panel.

### Prompt 1: Import menu, start page (desktop 1440 and phone 390)

> Design an admin web page for a café management portal, desktop 1440 px and phone 390 px, in the style of Nuxt UI (clean, white cards on light grey, left sidebar on desktop, green primary buttons). Page title "Import menu", breadcrumb "Menu items › Import menu". One large card: a dashed drop zone "Drop a PDF or photos of your menu here", with buttons "Choose files" and, on phone only, "Take photo". Under it a small grey line: "One PDF up to 10 MB, or up to 10 photos. AI reads your menu; you check everything before anything is added. Items are added as drafts." Show the state **after choosing 3 photos**: three page thumbnails in a row, each with "Page 1", "Page 2", "Page 3", a remove (×) button, and drag handles to reorder; buttons "Read menu" (primary) and "Clear". Under the card a section "Recent imports" with a simple list: "menu-2026.pdf · Ready to review · Sokha · Today 10:42" with a "Review" button; "3 photos · Imported 48 items · Yesterday"; "board.jpg · Couldn't read · Try again"; a grey note "Imports are kept for 7 days." Also include a small second frame of the **error state**: a red inline message in the drop zone "This file is too large: at most 10 MB." and a third small frame of the **daily limit** state: an amber alert "You've used today's 10 menu readings. Try again tomorrow." with "Read menu" disabled.

### Prompt 2: Reading the menu (desktop 1440 and phone 390)

> Same portal style. Page title "Import menu", subtitle "menu-2026.pdf · 4 pages". A card with a progress header "Reading your menu…" with a slim indeterminate progress bar and a grey line "This takes up to a minute. Keep this page open." Below, items appear live, grouped under category headings: "Coffee" with rows "Latte — $3.50 / $4.00 / $4.50", "Americano — $2.50", then "Tea" with "Jasmine tea — $2.00", the last row shown as a faint skeleton (still coming). A counter on the right: "18 items found". A "Cancel" text button. Second frame: **failed** state: an amber alert "We couldn't read this menu. Your files are kept." with buttons "Try again" (primary) and "Choose other files", and a grey hint "Clear, straight photos in good light read best." Phone frames stack everything in one column; the found items list scrolls.

### Prompt 3: Review, the main screen (desktop 1440 and phone 390)

> Same portal style. Page title "Review your menu", subtitle "Found 52 items in 6 categories. Check everything, then import. Items are added as drafts." **Desktop: two columns.** Left column (about 40%), sticky: the menu page image with page tabs "Page 1 2 3 4" and zoom buttons; a faint highlight box around the item currently selected on the right. Right column (60%): filter tabs "All 52", "Needs attention 4", "Already on your menu 3". First a card **"Options and add-ons found"**: rows "Size — Small, Medium, Large" with a select "Use existing: Size" and a small note "Add Medium to Size" with a checkbox ticked; "Temperature — Hot, Iced" with badge "New"; "Milk — Whole, Oat +$0.50, Soy +$0.50" with select "Create new: Milk (imported)" and grey note "Your Milk group has no Soy: a new group keeps your current items unchanged." Then category cards: "Coffee" (badge "New category") listing item rows; each row has a checkbox, the item name in bold, a one-line description in grey, a price summary ("3 sizes · $3.50–$4.50" or "$2.50"), small chips for add-on groups ("Milk", "Extra shot"), a status badge, and an "Edit" button. Show one row with amber "Needs attention · Converted from 10,000៛" , one row unticked with grey "Already on your menu", one row with amber "Add a price" and its checkbox disabled. A category "Breakfast › Other" with a small amber note "Items moved to Other: a category can hold items or sub-categories, not both." **Sticky footer bar**: "48 of 52 items selected" and a primary button "Import 48 items". **Phone 390:** one column; tabs at the top "Items" and "Menu pages"; the options card collapsed to "4 options and add-ons · Review"; item rows as compact cards; the sticky footer button full width.

### Prompt 4: Edit one item (desktop slide-over and phone bottom sheet)

> Same portal style. A right-side slide-over on desktop (bottom sheet on phone) titled "Edit item", with the source crop of the menu at the top (a small image of where it was found, "Page 2"). Fields: "Name" (Latte), "Description" (optional), "Category" (a select showing "Coffee › Espresso drinks", with a badge "New"), "Options" showing chips "Size", "Temperature", then a **price grid** table with rows Small / Medium / Large and columns Hot / Iced, each cell a price input ($3.50, $4.00 …), one cell empty with a switch "Off". "Add-ons": chips "Milk (new)", "Extra shot" with an "Add group" button. An amber alert at the top: "Converted from 14,000៛ at 4,100៛ = $3.41. Check the price." Footer buttons "Done" (primary) and "Cancel". Note in grey: "Changes are kept on this device until you import."

### Prompt 5: Confirm and done (desktop 1440 and phone 390)

> Same portal style. Frame A: a centered modal "Import 48 items?" with a short summary list: "5 new categories", "1 new option set (Temperature) and 1 value added to Size", "2 new add-on groups", "48 menu items as drafts"; a grey line "Nothing on your menu is changed. Customers see these items only after you publish them."; buttons "Import" (primary) and "Back to review". Frame B: the importing state, the modal's button showing a spinner "Importing…". Frame C: a success page: a large check icon, "48 items added as drafts", a grey line "Add photos and check prices, then publish them.", buttons "Review drafts" (primary, goes to Menu items filtered to drafts) and "Import another". Frame D: an error state in the modal: amber alert "Someone changed the menu while you were reviewing (the category “Coffee” now exists). We've updated the review." with "Back to review".
</content>
</invoke>
