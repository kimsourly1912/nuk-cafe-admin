ALTER TABLE `branches` ADD `paused_until` integer;--> statement-breakpoint
ALTER TABLE `branches` ADD `paused_by` text REFERENCES user(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `branches` ADD `pause_reason` text;