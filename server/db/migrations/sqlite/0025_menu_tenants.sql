-- Step T1.2 (D136): the menu and its uploads get their tenant. Written by hand like 0024_tenants:
-- D1 ignores `PRAGMA foreign_keys=OFF`, so every table is rebuilt into `__new_…` (children pointing
-- at the new parents), the old ones dropped children first, then renamed.
-- 
-- 1. Every existing row belongs to the one tenant 0024 created ("NUK Cafe"; else the oldest). A database with menu
--    rows but no tenant (none exists in practice) gets it here, as 0024 would have made it.
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`, `status`, `version`)
SELECT '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd', 'NUK Cafe', 'nuk', cast(unixepoch('subsecond') * 1000 as integer), 'active', 1
WHERE NOT EXISTS (SELECT 1 FROM `organization`)
  AND (EXISTS (SELECT 1 FROM `menu_categories`) OR EXISTS (SELECT 1 FROM `menu_option_sets`) OR EXISTS (SELECT 1 FROM `menu_modifier_groups`)
    OR EXISTS (SELECT 1 FROM `menu_availability_rules`) OR EXISTS (SELECT 1 FROM `media_assets`));
--> statement-breakpoint
-- 2. The new tables, parents first, each filled with the tenant. A parent's `(tenant_id, id)`
--    index exists before its children are copied (a foreign key needs it).
CREATE TABLE `__new_menu_option_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_option_sets_status_check" CHECK("__new_menu_option_sets"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_option_sets_tenant_id_unique` ON `__new_menu_option_sets` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_option_sets`("id", "tenant_id", "name", "status", "version", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "name", "status", "version", "created_at", "updated_at" FROM `menu_option_sets`;
--> statement-breakpoint
CREATE TABLE `__new_menu_option_values` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`set_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`set_id`) REFERENCES `__new_menu_option_sets`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_option_values_status_check" CHECK("__new_menu_option_values"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_option_values_tenant_id_unique` ON `__new_menu_option_values` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_option_values`("id", "tenant_id", "set_id", "name", "sort_order", "status", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "set_id", "name", "sort_order", "status", "created_at", "updated_at" FROM `menu_option_values`;
--> statement-breakpoint
CREATE TABLE `__new_menu_modifier_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`min_select` integer DEFAULT 0 NOT NULL,
	`max_select` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_modifier_groups_status_check" CHECK("__new_menu_modifier_groups"."status" in ('active', 'archived')),
	CONSTRAINT "menu_modifier_groups_select_check" CHECK("__new_menu_modifier_groups"."min_select" >= 0 and ("__new_menu_modifier_groups"."max_select" is null or ("__new_menu_modifier_groups"."max_select" >= 1 and "__new_menu_modifier_groups"."max_select" >= "__new_menu_modifier_groups"."min_select")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_modifier_groups_tenant_id_unique` ON `__new_menu_modifier_groups` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_modifier_groups`("id", "tenant_id", "name", "min_select", "max_select", "status", "version", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "name", "min_select", "max_select", "status", "version", "created_at", "updated_at" FROM `menu_modifier_groups`;
--> statement-breakpoint
CREATE TABLE `__new_menu_modifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`price_delta_minor` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`group_id`) REFERENCES `__new_menu_modifier_groups`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_modifiers_status_check" CHECK("__new_menu_modifiers"."status" in ('active', 'archived')),
	CONSTRAINT "menu_modifiers_price_check" CHECK("__new_menu_modifiers"."price_delta_minor" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_modifiers_tenant_id_unique` ON `__new_menu_modifiers` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_modifiers`("id", "tenant_id", "group_id", "name", "price_delta_minor", "is_default", "sort_order", "status", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "group_id", "name", "price_delta_minor", "is_default", "sort_order", "status", "created_at", "updated_at" FROM `menu_modifiers`;
--> statement-breakpoint
CREATE TABLE `__new_menu_availability_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_availability_rules_status_check" CHECK("__new_menu_availability_rules"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_availability_rules_tenant_id_unique` ON `__new_menu_availability_rules` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_availability_rules`("id", "tenant_id", "name", "status", "version", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "name", "status", "version", "created_at", "updated_at" FROM `menu_availability_rules`;
--> statement-breakpoint
CREATE TABLE `__new_menu_availability_windows` (
	`tenant_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	PRIMARY KEY(`rule_id`, `weekday`, `start_minute`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`rule_id`) REFERENCES `__new_menu_availability_rules`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "menu_availability_windows_range_check" CHECK("__new_menu_availability_windows"."weekday" between 1 and 7 and "__new_menu_availability_windows"."start_minute" between 0 and 1439 and "__new_menu_availability_windows"."end_minute" between 1 and 1440 and "__new_menu_availability_windows"."end_minute" <> "__new_menu_availability_windows"."start_minute")
);
--> statement-breakpoint
INSERT INTO `__new_menu_availability_windows`("tenant_id", "rule_id", "weekday", "start_minute", "end_minute") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "rule_id", "weekday", "start_minute", "end_minute" FROM `menu_availability_windows`;
--> statement-breakpoint
CREATE TABLE `__new_menu_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`parent_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`parent_id`) REFERENCES `__new_menu_categories`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_categories_status_check" CHECK("__new_menu_categories"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_categories_tenant_id_unique` ON `__new_menu_categories` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_categories`("id", "tenant_id", "parent_id", "name", "description", "sort_order", "status", "version", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "parent_id", "name", "description", "sort_order", "status", "version", "created_at", "updated_at" FROM `menu_categories` ORDER BY "parent_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `__new_menu_category_availability` (
	`tenant_id` text NOT NULL,
	`category_id` text NOT NULL,
	`rule_id` text NOT NULL,
	PRIMARY KEY(`category_id`, `rule_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`category_id`) REFERENCES `__new_menu_categories`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`rule_id`) REFERENCES `__new_menu_availability_rules`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_menu_category_availability`("tenant_id", "category_id", "rule_id") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "category_id", "rule_id" FROM `menu_category_availability`;
--> statement-breakpoint
CREATE TABLE `__new_menu_items` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`category_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_asset_id` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`category_id`) REFERENCES `__new_menu_categories`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_items_status_check" CHECK("__new_menu_items"."status" in ('draft', 'active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_items_tenant_id_unique` ON `__new_menu_items` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_items`("id", "tenant_id", "category_id", "name", "description", "image_asset_id", "status", "sort_order", "version", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "category_id", "name", "description", "image_asset_id", "status", "sort_order", "version", "created_at", "updated_at" FROM `menu_items`;
--> statement-breakpoint
CREATE TABLE `__new_menu_item_option_sets` (
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`set_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	PRIMARY KEY(`item_id`, `set_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `__new_menu_items`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`set_id`) REFERENCES `__new_menu_option_sets`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_menu_item_option_sets`("tenant_id", "item_id", "set_id", "sort_order") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "item_id", "set_id", "sort_order" FROM `menu_item_option_sets`;
--> statement-breakpoint
CREATE TABLE `__new_menu_item_variations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`combination_key` text NOT NULL,
	`price_minor` integer,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'disabled' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `__new_menu_items`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "menu_item_variations_status_check" CHECK("__new_menu_item_variations"."status" in ('active', 'disabled', 'retired')),
	CONSTRAINT "menu_item_variations_price_check" CHECK("__new_menu_item_variations"."price_minor" is null or "__new_menu_item_variations"."price_minor" >= 0),
	CONSTRAINT "menu_item_variations_active_price_check" CHECK("__new_menu_item_variations"."status" <> 'active' or "__new_menu_item_variations"."price_minor" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_item_variations_tenant_id_unique` ON `__new_menu_item_variations` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_menu_item_variations`("id", "tenant_id", "item_id", "combination_key", "price_minor", "currency", "status", "sort_order", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "item_id", "combination_key", "price_minor", "currency", "status", "sort_order", "created_at", "updated_at" FROM `menu_item_variations`;
--> statement-breakpoint
CREATE TABLE `__new_menu_variation_option_values` (
	`tenant_id` text NOT NULL,
	`variation_id` text NOT NULL,
	`value_id` text NOT NULL,
	PRIMARY KEY(`variation_id`, `value_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`variation_id`) REFERENCES `__new_menu_item_variations`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`value_id`) REFERENCES `__new_menu_option_values`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_menu_variation_option_values`("tenant_id", "variation_id", "value_id") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "variation_id", "value_id" FROM `menu_variation_option_values`;
--> statement-breakpoint
CREATE TABLE `__new_menu_item_modifier_groups` (
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`group_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`rules_overridden` integer DEFAULT false NOT NULL,
	`min_select` integer,
	`max_select` integer,
	PRIMARY KEY(`item_id`, `group_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `__new_menu_items`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`group_id`) REFERENCES `__new_menu_modifier_groups`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_modifier_groups_rules_check" CHECK(not "__new_menu_item_modifier_groups"."rules_overridden" or ("__new_menu_item_modifier_groups"."min_select" >= 0 and ("__new_menu_item_modifier_groups"."max_select" is null or ("__new_menu_item_modifier_groups"."max_select" >= 1 and "__new_menu_item_modifier_groups"."max_select" >= "__new_menu_item_modifier_groups"."min_select"))))
);
--> statement-breakpoint
INSERT INTO `__new_menu_item_modifier_groups`("tenant_id", "item_id", "group_id", "sort_order", "rules_overridden", "min_select", "max_select") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "item_id", "group_id", "sort_order", "rules_overridden", "min_select", "max_select" FROM `menu_item_modifier_groups`;
--> statement-breakpoint
CREATE TABLE `__new_menu_item_modifier_prices` (
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`modifier_id` text NOT NULL,
	`price_delta_minor` integer NOT NULL,
	PRIMARY KEY(`item_id`, `modifier_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `__new_menu_items`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`modifier_id`) REFERENCES `__new_menu_modifiers`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_modifier_prices_price_check" CHECK("__new_menu_item_modifier_prices"."price_delta_minor" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_menu_item_modifier_prices`("tenant_id", "item_id", "modifier_id", "price_delta_minor") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "item_id", "modifier_id", "price_delta_minor" FROM `menu_item_modifier_prices`;
--> statement-breakpoint
CREATE TABLE `__new_menu_item_availability` (
	`tenant_id` text NOT NULL,
	`item_id` text NOT NULL,
	`rule_id` text NOT NULL,
	PRIMARY KEY(`item_id`, `rule_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `__new_menu_items`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`rule_id`) REFERENCES `__new_menu_availability_rules`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_menu_item_availability`("tenant_id", "item_id", "rule_id") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "item_id", "rule_id" FROM `menu_item_availability`;
--> statement-breakpoint
CREATE TABLE `__new_branch_item_states` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`variation_id` text NOT NULL,
	`sold_out` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`branch_id`, `variation_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`variation_id`) REFERENCES `__new_menu_item_variations`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_branch_item_states`("tenant_id", "branch_id", "variation_id", "sold_out", "updated_by", "updated_at") SELECT "tenant_id", "branch_id", "variation_id", "sold_out", "updated_by", "updated_at" FROM `branch_item_states`;
--> statement-breakpoint
CREATE TABLE `__new_media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`state` text DEFAULT 'temporary' NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`state_changed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "media_assets_state_check" CHECK("__new_media_assets"."state" in ('temporary', 'attached')),
	CONSTRAINT "media_assets_size_check" CHECK("__new_media_assets"."byte_size" > 0)
);
--> statement-breakpoint
INSERT INTO `__new_media_assets`("id", "tenant_id", "object_key", "mime_type", "byte_size", "sha256", "state", "uploaded_by", "created_at", "state_changed_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "object_key", "mime_type", "byte_size", "sha256", "state", "uploaded_by", "created_at", "state_changed_at" FROM `media_assets`;
--> statement-breakpoint
-- 3. The old tables go, children first, so no ON DELETE rule finds a row to act on.
DROP TABLE `branch_item_states`;
--> statement-breakpoint
DROP TABLE `menu_variation_option_values`;
--> statement-breakpoint
DROP TABLE `menu_item_modifier_prices`;
--> statement-breakpoint
DROP TABLE `menu_item_modifier_groups`;
--> statement-breakpoint
DROP TABLE `menu_item_option_sets`;
--> statement-breakpoint
DROP TABLE `menu_item_availability`;
--> statement-breakpoint
DROP TABLE `menu_category_availability`;
--> statement-breakpoint
DROP TABLE `menu_availability_windows`;
--> statement-breakpoint
DROP TABLE `menu_item_variations`;
--> statement-breakpoint
DROP TABLE `menu_items`;
--> statement-breakpoint
-- Sub-categories first: the self-reference is `restrict`.
DELETE FROM `menu_categories` WHERE `parent_id` IS NOT NULL;
--> statement-breakpoint
DROP TABLE `menu_categories`;
--> statement-breakpoint
DROP TABLE `menu_availability_rules`;
--> statement-breakpoint
DROP TABLE `menu_modifiers`;
--> statement-breakpoint
DROP TABLE `menu_modifier_groups`;
--> statement-breakpoint
DROP TABLE `menu_option_values`;
--> statement-breakpoint
DROP TABLE `menu_option_sets`;
--> statement-breakpoint
DROP TABLE `media_assets`;
--> statement-breakpoint
-- 4. The new tables take the old names; SQLite rewrites the children's references as it goes.
ALTER TABLE `__new_menu_option_sets` RENAME TO `menu_option_sets`;
--> statement-breakpoint
ALTER TABLE `__new_menu_option_values` RENAME TO `menu_option_values`;
--> statement-breakpoint
ALTER TABLE `__new_menu_modifier_groups` RENAME TO `menu_modifier_groups`;
--> statement-breakpoint
ALTER TABLE `__new_menu_modifiers` RENAME TO `menu_modifiers`;
--> statement-breakpoint
ALTER TABLE `__new_menu_availability_rules` RENAME TO `menu_availability_rules`;
--> statement-breakpoint
ALTER TABLE `__new_menu_availability_windows` RENAME TO `menu_availability_windows`;
--> statement-breakpoint
ALTER TABLE `__new_menu_categories` RENAME TO `menu_categories`;
--> statement-breakpoint
ALTER TABLE `__new_menu_category_availability` RENAME TO `menu_category_availability`;
--> statement-breakpoint
ALTER TABLE `__new_menu_items` RENAME TO `menu_items`;
--> statement-breakpoint
ALTER TABLE `__new_menu_item_option_sets` RENAME TO `menu_item_option_sets`;
--> statement-breakpoint
ALTER TABLE `__new_menu_item_variations` RENAME TO `menu_item_variations`;
--> statement-breakpoint
ALTER TABLE `__new_menu_variation_option_values` RENAME TO `menu_variation_option_values`;
--> statement-breakpoint
ALTER TABLE `__new_menu_item_modifier_groups` RENAME TO `menu_item_modifier_groups`;
--> statement-breakpoint
ALTER TABLE `__new_menu_item_modifier_prices` RENAME TO `menu_item_modifier_prices`;
--> statement-breakpoint
ALTER TABLE `__new_menu_item_availability` RENAME TO `menu_item_availability`;
--> statement-breakpoint
ALTER TABLE `__new_branch_item_states` RENAME TO `branch_item_states`;
--> statement-breakpoint
ALTER TABLE `__new_media_assets` RENAME TO `media_assets`;
--> statement-breakpoint
-- 5. Their other indexes (names and per-tenant uniques).
CREATE UNIQUE INDEX `menu_option_sets_active_name_idx` ON `menu_option_sets` (`tenant_id`,lower("name")) WHERE "menu_option_sets"."status" = 'active';
--> statement-breakpoint
CREATE INDEX `menu_option_values_set_sort_idx` ON `menu_option_values` (`set_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_option_values_active_name_idx` ON `menu_option_values` (`set_id`,lower("name")) WHERE "menu_option_values"."status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_modifier_groups_active_name_idx` ON `menu_modifier_groups` (`tenant_id`,lower("name")) WHERE "menu_modifier_groups"."status" = 'active';
--> statement-breakpoint
CREATE INDEX `menu_modifiers_group_sort_idx` ON `menu_modifiers` (`group_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_modifiers_active_name_idx` ON `menu_modifiers` (`group_id`,lower("name")) WHERE "menu_modifiers"."status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_availability_rules_active_name_idx` ON `menu_availability_rules` (`tenant_id`,lower("name")) WHERE "menu_availability_rules"."status" = 'active';
--> statement-breakpoint
CREATE INDEX `menu_categories_parent_sort_idx` ON `menu_categories` (`parent_id`,`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_categories_top_name_idx` ON `menu_categories` (`tenant_id`,lower("name")) WHERE "menu_categories"."parent_id" is null and "menu_categories"."status" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_categories_sub_name_idx` ON `menu_categories` (`parent_id`,lower("name")) WHERE "menu_categories"."parent_id" is not null and "menu_categories"."status" = 'active';
--> statement-breakpoint
CREATE INDEX `menu_category_availability_rule_idx` ON `menu_category_availability` (`rule_id`);
--> statement-breakpoint
CREATE INDEX `menu_items_category_sort_idx` ON `menu_items` (`category_id`,`sort_order`);
--> statement-breakpoint
CREATE INDEX `menu_items_tenant_status_idx` ON `menu_items` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_item_variations_combination_idx` ON `menu_item_variations` (`item_id`,`combination_key`);
--> statement-breakpoint
CREATE INDEX `menu_variation_option_values_value_idx` ON `menu_variation_option_values` (`value_id`);
--> statement-breakpoint
CREATE INDEX `menu_item_modifier_groups_group_idx` ON `menu_item_modifier_groups` (`group_id`);
--> statement-breakpoint
CREATE INDEX `menu_item_availability_rule_idx` ON `menu_item_availability` (`rule_id`);
--> statement-breakpoint
CREATE INDEX `branch_item_states_variation_idx` ON `branch_item_states` (`variation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_objectKey_unique` ON `media_assets` (`object_key`);
--> statement-breakpoint
CREATE INDEX `media_assets_purge_idx` ON `media_assets` (`state`,`state_changed_at`);
--> statement-breakpoint
CREATE INDEX `media_assets_tenant_idx` ON `media_assets` (`tenant_id`,`created_at`);
