# Options plan (step 3.8b, part 2a; phase 4.2)

Server side: step 3.3 (D58), `docs/server/data-model.md → Options library API`. The admin screen for reusable **option sets** (Size: Small, Regular, Large). Names only: prices live on each menu item's price grid (part 3).

## Purpose and scope
- Purpose: an admin keeps the library of option sets that menu items pick (up to 2 per item) to build their versions.
- In scope:
  1. List every set as a card: name, its active values in order as chips, how many archived values, "Used by N menu items". Tabs Active / Archived with counts; search by name (client-side: small, unpaginated library).
  2. **Create** in a modal: a name and its first values (1–20, unique, typed in order). One request.
  3. **Edit** in a slide-over where **each change is saved at once**, because the API has one call per action and returns the whole set each time: rename the set; add a value (at the end); rename a value; archive and restore a value; reorder the active values (drag, or ↑/↓ on the handle). The editor keeps the latest set it got back, so every call sends the current version.
  4. Archive and restore a set from its card. Archiving a set that items use is allowed (they keep it, D60); the confirmation says how many use it.
- Out of scope: bulk actions [Choice: a small library].

## Rules the screen reflects (the server enforces them)
- A set keeps at least 1 and at most 20 active values: the last active value can't be archived; "Add" is disabled at 20.
- Names up to 40 characters; set names unique among active sets, value names unique within a set (case-insensitive): the server's 409 shows as the toast's message.
- An archived set or value can't be edited; restore it first.

## Mutations
- Create: `option-sets:create` (key: name).
- Every change to one set, including its values: key and lock `option-set:<id>`, so two changes to one set never run at once (the second would fail its version check anyway). A 409 `VERSION_CONFLICT` offers **Reload**, which refetches the set.
- invalidate: `option-sets`, `products` (the item form shows set and value names, part 3).

## Edge cases and verification
- Create form rules and mapping (duplicates, trimming, limits): unit.
- Each editor action sends the version from the previous response; reorder sends every active value; the last active value's Archive is disabled; a version conflict offers Reload: e2e.
- Real-server: create, rename, add, reorder, archive and restore a value, archive and restore the set against `pnpm dev`.
