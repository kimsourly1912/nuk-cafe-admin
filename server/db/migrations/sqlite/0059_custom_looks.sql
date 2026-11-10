-- Shop designer step 3a (D273): a cafe's own table looks, and a placement that names one.
-- Hand-edited: branch_layout_placements is rebuilt (copy, drop, rename) because SQLite can't add a
-- composite foreign key or a table CHECK in place. Nothing references it, so no foreign-key pragma
-- is needed (D1 keeps foreign keys on); the copy fills the new column with NULL (drizzle-kit
-- selected it from the old table, which has none).
CREATE TABLE `custom_furniture_looks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`shape` text NOT NULL,
	`base` text NOT NULL,
	`chair` text NOT NULL,
	`finishes` text NOT NULL,
	`default_width_cm` integer NOT NULL,
	`default_depth_cm` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "custom_furniture_looks_check" CHECK("custom_furniture_looks"."default_width_cm" between 40 and 600 and "custom_furniture_looks"."default_depth_cm" between 40 and 600)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_furniture_looks_tenant_id_idx` ON `custom_furniture_looks` (`tenant_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_furniture_looks_name_idx` ON `custom_furniture_looks` (`tenant_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `__new_branch_layout_placements` (
	`table_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`floor_id` text NOT NULL,
	`x_cm` integer NOT NULL,
	`y_cm` integer NOT NULL,
	`rotation` integer NOT NULL,
	`width_cm` integer NOT NULL,
	`depth_cm` integer NOT NULL,
	`look` text,
	`custom_look_id` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`branch_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`branch_id`,`floor_id`) REFERENCES `branch_layout_floors`(`tenant_id`,`branch_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`custom_look_id`) REFERENCES `custom_furniture_looks`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "branch_layout_placements_check" CHECK("rotation" between 0 and 359 and "width_cm" between 40 and 600 and "depth_cm" between 40 and 600),
	CONSTRAINT "branch_layout_placements_look_check" CHECK(("look" is null) <> ("custom_look_id" is null))
);
--> statement-breakpoint
INSERT INTO `__new_branch_layout_placements`("table_id", "tenant_id", "branch_id", "floor_id", "x_cm", "y_cm", "rotation", "width_cm", "depth_cm", "look", "custom_look_id") SELECT "table_id", "tenant_id", "branch_id", "floor_id", "x_cm", "y_cm", "rotation", "width_cm", "depth_cm", "look", NULL FROM `branch_layout_placements`;--> statement-breakpoint
DROP TABLE `branch_layout_placements`;--> statement-breakpoint
ALTER TABLE `__new_branch_layout_placements` RENAME TO `branch_layout_placements`;--> statement-breakpoint
CREATE INDEX `branch_layout_placements_floor_idx` ON `branch_layout_placements` (`tenant_id`,`branch_id`,`floor_id`);--> statement-breakpoint
CREATE INDEX `branch_layout_placements_look_idx` ON `branch_layout_placements` (`tenant_id`,`custom_look_id`);