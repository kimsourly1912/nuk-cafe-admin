CREATE TABLE `menu_item_option_sets` (
	`item_id` text NOT NULL,
	`set_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`item_id`, `set_id`),
	FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`set_id`) REFERENCES `menu_option_sets`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `menu_item_variations` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`combination_key` text NOT NULL,
	`price_minor` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'disabled' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "menu_item_variations_status_check" CHECK("menu_item_variations"."status" in ('active', 'disabled', 'retired')),
	CONSTRAINT "menu_item_variations_price_check" CHECK("menu_item_variations"."price_minor" is null or "menu_item_variations"."price_minor" >= 0),
	CONSTRAINT "menu_item_variations_active_price_check" CHECK("menu_item_variations"."status" <> 'active' or "menu_item_variations"."price_minor" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_item_variations_combination_idx` ON `menu_item_variations` (`item_id`,`combination_key`);--> statement-breakpoint
CREATE TABLE `menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_asset_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `menu_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_items_status_check" CHECK("menu_items"."status" in ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE INDEX `menu_items_category_sort_idx` ON `menu_items` (`category_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `menu_items_status_idx` ON `menu_items` (`status`);--> statement-breakpoint
CREATE TABLE `menu_variation_option_values` (
	`variation_id` text NOT NULL,
	`value_id` text NOT NULL,
	PRIMARY KEY(`variation_id`, `value_id`),
	FOREIGN KEY (`variation_id`) REFERENCES `menu_item_variations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`value_id`) REFERENCES `menu_option_values`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `menu_variation_option_values_value_idx` ON `menu_variation_option_values` (`value_id`);