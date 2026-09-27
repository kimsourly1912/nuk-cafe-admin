CREATE TABLE `menu_modifier_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`min_select` integer DEFAULT 0 NOT NULL,
	`max_select` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "menu_modifier_groups_status_check" CHECK("menu_modifier_groups"."status" in ('active', 'archived')),
	CONSTRAINT "menu_modifier_groups_select_check" CHECK("menu_modifier_groups"."min_select" >= 0 and ("menu_modifier_groups"."max_select" is null or ("menu_modifier_groups"."max_select" >= 1 and "menu_modifier_groups"."max_select" >= "menu_modifier_groups"."min_select")))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_modifier_groups_active_name_idx` ON `menu_modifier_groups` (lower("name")) WHERE "menu_modifier_groups"."status" = 'active';--> statement-breakpoint
CREATE TABLE `menu_modifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`price_delta_minor` integer DEFAULT 0 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `menu_modifier_groups`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_modifiers_status_check" CHECK("menu_modifiers"."status" in ('active', 'archived')),
	CONSTRAINT "menu_modifiers_price_check" CHECK("menu_modifiers"."price_delta_minor" >= 0)
);
--> statement-breakpoint
CREATE INDEX `menu_modifiers_group_sort_idx` ON `menu_modifiers` (`group_id`,`sort_order`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_modifiers_active_name_idx` ON `menu_modifiers` (`group_id`,lower("name")) WHERE "menu_modifiers"."status" = 'active';