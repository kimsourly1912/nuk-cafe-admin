-- Written by hand (drizzle-kit would ask whether the table was renamed): the pre-standard table
-- keeps its data under a new name until step 3.8 removes it, and the menu feature takes the name.
ALTER TABLE `menu_categories` RENAME TO `legacy_menu_categories`;
--> statement-breakpoint
DROP INDEX `menu_categories_parent_sort_idx`;
--> statement-breakpoint
CREATE INDEX `legacy_menu_categories_parent_sort_idx` ON `legacy_menu_categories` (`parent_id`,`sort_order`);
--> statement-breakpoint
CREATE TABLE `menu_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `menu_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_categories_status_check" CHECK("menu_categories"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `menu_categories_parent_sort_idx` ON `menu_categories` (`parent_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_categories_top_name_idx` ON `menu_categories` (lower("name")) WHERE "menu_categories"."parent_id" is null and "menu_categories"."status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_categories_sub_name_idx` ON `menu_categories` (`parent_id`,lower("name")) WHERE "menu_categories"."parent_id" is not null and "menu_categories"."status" = 'active';
