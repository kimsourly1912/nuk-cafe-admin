-- Shop designer step 3d (D273): a cafe's own chair and fixture looks, and which of them each saved
-- floor's furniture uses. The pieces are in the floor's JSON, so the save writes one row per floor
-- and look: the composite foreign key (tenant, look, kind) refuses another cafe's look, one of
-- another kind, and (restrict) the delete of a look in use. New tables only: the Worker before this
-- release keeps working (it writes no item looks).
CREATE TABLE `custom_item_looks` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`finishes` text NOT NULL,
	`default_width_cm` integer NOT NULL,
	`default_depth_cm` integer NOT NULL,
	`photo_asset_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "custom_item_looks_check" CHECK("custom_item_looks"."default_width_cm" between 10 and 2000 and "custom_item_looks"."default_depth_cm" between 10 and 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `custom_item_looks_tenant_id_kind_idx` ON `custom_item_looks` (`tenant_id`,`id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `custom_item_looks_name_idx` ON `custom_item_looks` (`tenant_id`,lower("name"));--> statement-breakpoint
CREATE TABLE `branch_layout_item_looks` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`floor_id` text NOT NULL,
	`look_id` text NOT NULL,
	`kind` text NOT NULL,
	`pieces` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `branch_id`, `floor_id`, `look_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`,`floor_id`) REFERENCES `branch_layout_floors`(`tenant_id`,`branch_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`look_id`,`kind`) REFERENCES `custom_item_looks`(`tenant_id`,`id`,`kind`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "branch_layout_item_looks_check" CHECK("branch_layout_item_looks"."pieces" between 1 and 200)
);
--> statement-breakpoint
CREATE INDEX `branch_layout_item_looks_look_idx` ON `branch_layout_item_looks` (`tenant_id`,`look_id`);
