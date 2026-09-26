CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text,
	`metadata` text,
	`occurred_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `audit_events_target_idx` ON `audit_events` (`target_type`,`target_id`);--> statement-breakpoint
CREATE INDEX `audit_events_occurred_at_idx` ON `audit_events` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`state` text DEFAULT 'temporary' NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "media_assets_state_check" CHECK("media_assets"."state" in ('temporary', 'attached')),
	CONSTRAINT "media_assets_size_check" CHECK("media_assets"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_objectKey_unique` ON `media_assets` (`object_key`);--> statement-breakpoint
CREATE INDEX `media_assets_state_idx` ON `media_assets` (`state`,`created_at`);--> statement-breakpoint
CREATE TABLE `menu_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `menu_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_categories_status_check" CHECK("menu_categories"."status" in ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE INDEX `menu_categories_parent_sort_idx` ON `menu_categories` (`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `menu_products` (
	`id` text PRIMARY KEY NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`price_minor` integer NOT NULL,
	`currency_code` text DEFAULT 'USD' NOT NULL,
	`image_asset_id` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`category_id`) REFERENCES `menu_categories`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`image_asset_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "menu_products_status_check" CHECK("menu_products"."status" in ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "menu_products_price_check" CHECK("menu_products"."price_minor" >= 0),
	CONSTRAINT "menu_products_currency_check" CHECK("menu_products"."currency_code" = 'USD')
);
--> statement-breakpoint
CREATE INDEX `menu_products_category_idx` ON `menu_products` (`category_id`,`status`,`sort_order`);--> statement-breakpoint
CREATE TABLE `menu_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`days` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	`time_zone` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "menu_schedules_status_check" CHECK("menu_schedules"."status" in ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "menu_schedules_days_check" CHECK("menu_schedules"."days" between 1 and 127),
	CONSTRAINT "menu_schedules_time_check" CHECK("menu_schedules"."start_minute" >= 0 and "menu_schedules"."end_minute" <= 1439 and "menu_schedules"."start_minute" < "menu_schedules"."end_minute")
);
--> statement-breakpoint
CREATE TABLE `product_schedules` (
	`product_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	PRIMARY KEY(`product_id`, `schedule_id`),
	FOREIGN KEY (`product_id`) REFERENCES `menu_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`schedule_id`) REFERENCES `menu_schedules`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `product_schedules_schedule_idx` ON `product_schedules` (`schedule_id`);--> statement-breakpoint
CREATE TABLE `product_variant_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`min_select` integer DEFAULT 0 NOT NULL,
	`max_select` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `menu_products`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variant_groups_select_check" CHECK("product_variant_groups"."min_select" >= 0 and ("product_variant_groups"."max_select" is null or ("product_variant_groups"."max_select" >= 1 and "product_variant_groups"."max_select" >= "product_variant_groups"."min_select")))
);
--> statement-breakpoint
CREATE INDEX `product_variant_groups_product_idx` ON `product_variant_groups` (`product_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `product_variant_options` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`price_delta_minor` integer DEFAULT 0 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `product_variant_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "product_variant_options_price_check" CHECK("product_variant_options"."price_delta_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `product_variant_options_group_idx` ON `product_variant_options` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `staff_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "staff_profiles_role_check" CHECK("staff_profiles"."role" in ('admin')),
	CONSTRAINT "staff_profiles_status_check" CHECK("staff_profiles"."status" in ('active', 'disabled'))
);
