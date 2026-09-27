CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
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
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`role` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`inviter_id` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
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
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
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
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text,
	`timezone` text NOT NULL,
	`currency` text DEFAULT 'USD',
	`address` text,
	`phone` text,
	`status` text DEFAULT 'active'
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
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
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	`active_organization_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`role` text,
	`banned` integer DEFAULT false,
	`ban_reason` text,
	`ban_expires` integer,
	`must_change_password` integer DEFAULT false
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);