CREATE TABLE `menu_promotion_branches` (
	`tenant_id` text NOT NULL,
	`promotion_id` text NOT NULL,
	`branch_id` text NOT NULL,
	PRIMARY KEY(`promotion_id`, `branch_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`promotion_id`) REFERENCES `menu_promotions`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `menu_promotion_categories` (
	`tenant_id` text NOT NULL,
	`promotion_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`promotion_id`, `category_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`promotion_id`) REFERENCES `menu_promotions`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`category_id`) REFERENCES `menu_categories`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_promotion_categories_category_idx` ON `menu_promotion_categories` (`category_id`);--> statement-breakpoint
CREATE TABLE `menu_promotion_items` (
	`tenant_id` text NOT NULL,
	`promotion_id` text NOT NULL,
	`item_id` text NOT NULL,
	PRIMARY KEY(`promotion_id`, `item_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`promotion_id`) REFERENCES `menu_promotions`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`item_id`) REFERENCES `menu_items`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `menu_promotion_items_item_idx` ON `menu_promotion_items` (`item_id`);--> statement-breakpoint
CREATE TABLE `menu_promotions` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`discount_kind` text NOT NULL,
	`percent` integer,
	`amount_minor` integer,
	`scope` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text,
	`poster_asset_id` text,
	`ended_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_promotions_status_check" CHECK("menu_promotions"."status" in ('draft', 'published', 'ended') and ("menu_promotions"."status" = 'ended') = ("menu_promotions"."ended_at" is not null)),
	CONSTRAINT "menu_promotions_discount_check" CHECK(("menu_promotions"."discount_kind" = 'percent' and "menu_promotions"."percent" between 1 and 100 and "menu_promotions"."amount_minor" is null) or ("menu_promotions"."discount_kind" = 'amount' and "menu_promotions"."amount_minor" between 1 and 100000 and "menu_promotions"."percent" is null)),
	CONSTRAINT "menu_promotions_scope_check" CHECK("menu_promotions"."scope" in ('menu', 'selected')),
	CONSTRAINT "menu_promotions_dates_check" CHECK("menu_promotions"."ends_on" is null or "menu_promotions"."ends_on" >= "menu_promotions"."starts_on")
);
--> statement-breakpoint
CREATE INDEX `menu_promotions_tenant_status_idx` ON `menu_promotions` (`tenant_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `menu_promotions_tenant_id_unique` ON `menu_promotions` (`tenant_id`,`id`);--> statement-breakpoint
ALTER TABLE `order_lines` ADD `regular_unit_price_minor` integer;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `promotion_id` text;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `promotion_name` text;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `promotion_label` text;--> statement-breakpoint
CREATE INDEX `order_lines_promotion_idx` ON `order_lines` (`promotion_id`) WHERE "order_lines"."promotion_id" is not null;