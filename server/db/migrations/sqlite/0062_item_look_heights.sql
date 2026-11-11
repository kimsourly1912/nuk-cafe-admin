-- Shop designer step 3e (QS2): a chair or fixture look's height, the one a new piece starts with
-- (a piece's own height is in its floor's JSON). Hand-edited: drizzle-kit rebuilt the table to add
-- the CHECK, but custom_item_looks is the target of branch_layout_item_looks' foreign key (restrict),
-- so dropping it would fail or lose that link on D1. SQLite checks a column's CHECK when it is added,
-- which is the same rule the schema's `custom_item_looks_height_check` names. Null for looks saved
-- before this release (the kind's default height); the Worker before it never writes the column.
ALTER TABLE `custom_item_looks` ADD `default_height_cm` integer CONSTRAINT "custom_item_looks_height_check" CHECK("default_height_cm" is null or "default_height_cm" between 20 and 300);
