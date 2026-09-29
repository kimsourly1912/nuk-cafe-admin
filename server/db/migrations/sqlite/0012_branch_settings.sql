CREATE TABLE `branch_hours` (
	`branch_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `weekday`, `start_minute`),
	FOREIGN KEY (`branch_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "branch_hours_range_check" CHECK("branch_hours"."weekday" between 1 and 7 and "branch_hours"."start_minute" between 0 and 1439 and "branch_hours"."end_minute" between 1 and 1440 and "branch_hours"."end_minute" <> "branch_hours"."start_minute")
);
--> statement-breakpoint
CREATE TABLE `dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`label` text NOT NULL,
	`area` text,
	`status` text DEFAULT 'active' NOT NULL,
	`qr_version` integer DEFAULT 1 NOT NULL,
	`qr_token_hash` text NOT NULL,
	`qr_rotated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "dining_tables_status_check" CHECK("dining_tables"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_qr_token_hash_idx` ON `dining_tables` (`qr_token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_active_label_idx` ON `dining_tables` (`branch_id`,lower("label")) WHERE "dining_tables"."status" = 'active';--> statement-breakpoint
CREATE INDEX `dining_tables_branch_idx` ON `dining_tables` (`branch_id`);--> statement-breakpoint
ALTER TABLE `organization` ADD `version` integer DEFAULT 1;