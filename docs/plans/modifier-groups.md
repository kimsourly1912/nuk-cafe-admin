# Add-ons plan (step 3.8b, part 2b; phase 4.3)

Server side: step 3.4 (D59) and 3.5b (D61), `docs/server/data-model.md → Add-ons library API`. The admin screen for reusable **add-on groups** (Milk: Whole, Oat +$0.50) with default prices and selection rules. The API and folder say *modifier groups*; the screen says *Add-ons*.

## Purpose and scope
- Purpose: an admin keeps the library of extras that menu items offer; each item can use its own rules and prices (set in the item form, part 3).
- In scope:
  1. Cards: name, the rules in words ("Required · choose 1", "Optional · up to 2"), the add-ons with default prices and a pre-selected mark, archived ones counted, "Offered by N menu items". Tabs Active / Archived, search (client-side).
  2. **Create** in a modal: name, *at least* / *at most* (or no limit), the first add-ons with prices and "pre-selected". The server's selection rules (`selectionProblem`, now in the shared contract) are checked before sending, with the same messages.
  3. **Edit** in a slide-over, each change saved at once like Options (D67): the name; the rules (checked against the active add-ons first); an add-on's name and price together; "pre-selected" on tick; add; archive; restore; reorder.
  4. Archive and restore a group; archiving one that items offer is allowed (they keep it, D61).
- Out of scope: bulk actions; per-item overrides (the item form, part 3).

## Rules the screen reflects
- 1–30 active add-ons; prices whole cents, $0–$100; names up to 40, unique (case-insensitive).
- Minimum ≤ active add-ons; maximum empty (no limit) or ≥ 1 and ≥ minimum; pre-selected add-ons ≤ maximum.

## Mutations
- Create: `modifier-groups:create` (key: name). Every change to one group: key and lock `modifier-group:<id>`.
- invalidate: `modifier-groups`, `products`.

## Edge cases and verification
- The form's rules (the server's messages), prices to cents, wording: unit.
- The version chain across rules, price, pre-selected and add; a refused change shown inside the editor; rules checked before sending; the last add-on can't be archived: e2e.
- Real-server: create, a refused second pre-selection, price, add, reorder, rules, archive.
