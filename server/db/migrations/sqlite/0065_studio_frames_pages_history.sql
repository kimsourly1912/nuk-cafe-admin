-- Studio follows Figma, Phase 5 (D278 follow-up; ISS-021, ISS-027, ISS-035, ISS-036). Expand only:
-- a new history table, and design-only columns (nullable or with defaults), so the Worker before this
-- release keeps working. branch_layout_versions: a layout snapshot at most every 10 minutes of saves,
-- the last 50 kept (the save's batch). Floors: their frame on Studio's canvas (null: never placed,
-- Studio lays it out beside the others), page, hidden and locked. Placements: hidden and locked.
-- Layouts: Studio's pages (JSON, checked by the shared layoutSchema).
CREATE TABLE `branch_layout_versions` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`version` integer NOT NULL,
	`saved_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`saved_by` text,
	`snapshot` text NOT NULL,
	PRIMARY KEY(`tenant_id`, `branch_id`, `version`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`saved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branch_layouts`(`tenant_id`,`branch_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `branch_layout_floors` ADD `canvas_x_cm` integer;--> statement-breakpoint
ALTER TABLE `branch_layout_floors` ADD `canvas_y_cm` integer;--> statement-breakpoint
ALTER TABLE `branch_layout_floors` ADD `page_id` text;--> statement-breakpoint
ALTER TABLE `branch_layout_floors` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_layout_floors` ADD `locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_layout_placements` ADD `hidden` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_layout_placements` ADD `locked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `branch_layouts` ADD `pages` text;