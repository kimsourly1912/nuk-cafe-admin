CREATE TABLE `menu_option_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "menu_option_sets_status_check" CHECK("menu_option_sets"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_option_sets_active_name_idx` ON `menu_option_sets` (lower("name")) WHERE "menu_option_sets"."status" = 'active';--> statement-breakpoint
CREATE TABLE `menu_option_values` (
	`id` text PRIMARY KEY NOT NULL,
	`set_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`set_id`) REFERENCES `menu_option_sets`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_option_values_status_check" CHECK("menu_option_values"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `menu_option_values_set_sort_idx` ON `menu_option_values` (`set_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_option_values_active_name_idx` ON `menu_option_values` (`set_id`,lower("name")) WHERE "menu_option_values"."status" = 'active';