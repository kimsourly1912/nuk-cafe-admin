CREATE TABLE `menu_availability_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "menu_availability_rules_status_check" CHECK("menu_availability_rules"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_availability_rules_active_name_idx` ON `menu_availability_rules` (lower("name")) WHERE "menu_availability_rules"."status" = 'active';--> statement-breakpoint
CREATE TABLE `menu_availability_windows` (
	`rule_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `weekday`, `start_minute`),
	FOREIGN KEY (`rule_id`) REFERENCES `menu_availability_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "menu_availability_windows_range_check" CHECK("menu_availability_windows"."weekday" between 1 and 7 and "menu_availability_windows"."start_minute" between 0 and 1439 and "menu_availability_windows"."end_minute" between 1 and 1440 and "menu_availability_windows"."end_minute" <> "menu_availability_windows"."start_minute")
);
--> statement-breakpoint
CREATE TABLE `menu_category_availability` (
	`category_id` text NOT NULL,
	`rule_id` text NOT NULL,
	PRIMARY KEY(`category_id`, `rule_id`),
	FOREIGN KEY (`category_id`) REFERENCES `menu_categories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `menu_availability_rules`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `menu_category_availability_rule_idx` ON `menu_category_availability` (`rule_id`);--> statement-breakpoint
CREATE TABLE `menu_item_availability` (
	`item_id` text NOT NULL,
	`rule_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `rule_id`),
	FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`rule_id`) REFERENCES `menu_availability_rules`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `menu_item_availability_rule_idx` ON `menu_item_availability` (`rule_id`);