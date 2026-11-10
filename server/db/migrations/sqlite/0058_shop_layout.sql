-- Shop designer step 2a (D273). Hand-edited: drizzle-kit rebuilt dining_tables to add a table CHECK, which D1 can't do safely (it ignores PRAGMA foreign_keys=OFF) and its copy selected the new column from the old table. A column CHECK is the same rule.
ALTER TABLE `dining_tables` ADD `seats` integer DEFAULT 2 NOT NULL CONSTRAINT "dining_tables_seats_check" CHECK("seats" between 1 and 20);--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_branch_id_idx` ON `dining_tables` (`tenant_id`,`branch_id`,`id`);--> statement-breakpoint
CREATE TABLE `branch_layouts` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	PRIMARY KEY(`tenant_id`, `branch_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `branch_layout_floors` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`height_cm` integer NOT NULL,
	`has_roof` integer NOT NULL,
	`geometry` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `branch_id`, `id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branch_layouts`(`tenant_id`,`branch_id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "branch_layout_floors_check" CHECK("branch_layout_floors"."position" between 0 and 9 and "branch_layout_floors"."height_cm" between 200 and 800)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branch_layout_floors_position_idx` ON `branch_layout_floors` (`tenant_id`,`branch_id`,`position`);
--> statement-breakpoint
CREATE TABLE `branch_layout_placements` (
	`table_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`floor_id` text NOT NULL,
	`x_cm` integer NOT NULL,
	`y_cm` integer NOT NULL,
	`rotation` integer NOT NULL,
	`width_cm` integer NOT NULL,
	`depth_cm` integer NOT NULL,
	`look` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`,`table_id`) REFERENCES `dining_tables`(`tenant_id`,`branch_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`branch_id`,`floor_id`) REFERENCES `branch_layout_floors`(`tenant_id`,`branch_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "branch_layout_placements_check" CHECK("branch_layout_placements"."rotation" between 0 and 359 and "branch_layout_placements"."width_cm" between 40 and 600 and "branch_layout_placements"."depth_cm" between 40 and 600)
);
--> statement-breakpoint
CREATE INDEX `branch_layout_placements_floor_idx` ON `branch_layout_placements` (`tenant_id`,`branch_id`,`floor_id`);
--> statement-breakpoint

