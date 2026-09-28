-- The pre-standard menu (D41), replaced by the new menu API (step 3.8b, D70). Children before parents: with foreign keys on (always on D1), DROP TABLE first deletes the rows, which a `restrict` reference from remaining rows would refuse.
DROP TABLE `product_variant_options`;--> statement-breakpoint
DROP TABLE `product_variant_groups`;--> statement-breakpoint
DROP TABLE `product_schedules`;--> statement-breakpoint
DROP TABLE `menu_products`;--> statement-breakpoint
DROP TABLE `menu_schedules`;--> statement-breakpoint
-- Sub-categories first: the parent reference is `restrict`, checked row by row as the table empties.
DELETE FROM `legacy_menu_categories` WHERE `parent_id` IS NOT NULL;--> statement-breakpoint
DROP TABLE `legacy_menu_categories`;--> statement-breakpoint
DROP TABLE `legacy_media_assets`;
