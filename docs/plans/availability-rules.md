# Availability rules plan (step 3.8b, part 1)

Server side: step 3.7 (D63), `docs/server/data-model.md → Availability rules API`. This is the admin screen for it. It replaces the Schedules screen, which stays until Categories and Menu items move to the new API (part 3), because the old Menu-items form still picks schedules.

## Purpose and scope
- Purpose: an admin defines when things are sold ("Breakfast": weekdays 7:00–11:00) and later attaches rules to categories and menu items in their forms.
- In scope:
  1. List every rule as a card: name, its windows in words ("Mon–Fri · 7:00 AM – 11:00 AM", overnight marked "(next day)"), how many menu items and categories use it.
  2. Status tabs Active / Archived with counts; search by name (client-side: the library is small and unpaginated).
  3. Create and edit in a modal: a name and one or more rows of *days + start + end*. A row expands to one window per day; the API's windows are grouped back into rows by identical times.
  4. Archive (disabled with "In use by …" when items or categories use it) and restore.
  5. Server errors: an overlap (422 `AVAILABILITY_WINDOWS` on `windows.<i>`) marks the row it came from; a name clash, a stale version and "in use" show the server's message.
- Out of scope: the rule picker in the category and item forms (part 3, when those forms move); bulk actions [Choice: a small library, archiving one at a time is enough].

## API contract
`shared/contracts/menu-availability.ts`: `GET/POST /api/admin/menu/availability-rules`, `PATCH …/{id}` (`{ version, name?, windows? }`, windows replaced whole), `POST …/{id}/archive|restore` (`{ version }`). Permission `menu:read` / `menu:write` (admins).

## Form
- Name: required, max 40.
- Rows: at least one; each needs at least one day and both times. An end of 12:00 AM means midnight at the end of the day (sent as 1440); an end before the start runs into the next day. Start = end is refused. At most 21 windows in total.
- Times are the branch's local time (the cafe's zone); the form says so.

## Mutations
- `availability-rules:create` (key: name), `:update`, `:archive`, `:restore` (key and lock `availability-rule:<id>`).
- invalidate: `availability-rules` (later also `categories`, `products`, whose forms show rule names).

## Edge cases and verification
- Row ↔ window mapping, grouping, midnight end, overnight: unit tests.
- Overlap error marks the right row; archive disabled while in use; restore; version conflict keeps the form open: e2e.
- Real-server: create, edit, archive, restore against `pnpm dev`.
