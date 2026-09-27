CREATE TABLE `menu_item_modifier_groups` (
	`item_id` text NOT NULL,
	`group_id` text NOT NULL,
	`sort_order` integer NOT NULL,
	`rules_overridden` integer DEFAULT false NOT NULL,
	`min_select` integer,
	`max_select` integer,
	PRIMARY KEY(`item_id`, `group_id`),
	FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `menu_modifier_groups`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_modifier_groups_rules_check" CHECK(not "menu_item_modifier_groups"."rules_overridden" or ("menu_item_modifier_groups"."min_select" >= 0 and ("menu_item_modifier_groups"."max_select" is null or ("menu_item_modifier_groups"."max_select" >= 1 and "menu_item_modifier_groups"."max_select" >= "menu_item_modifier_groups"."min_select"))))
);
--> statement-breakpoint
CREATE INDEX `menu_item_modifier_groups_group_idx` ON `menu_item_modifier_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `menu_item_modifier_prices` (
	`item_id` text NOT NULL,
	`modifier_id` text NOT NULL,
	`price_delta_minor` integer NOT NULL,
	PRIMARY KEY(`item_id`, `modifier_id`),
	FOREIGN KEY (`item_id`) REFERENCES `menu_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`modifier_id`) REFERENCES `menu_modifiers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "menu_item_modifier_prices_price_check" CHECK("menu_item_modifier_prices"."price_delta_minor" >= 0)
);
