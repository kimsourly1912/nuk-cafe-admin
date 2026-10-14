ALTER TABLE `job_cursors` ADD `succeeded_at` integer;--> statement-breakpoint
ALTER TABLE `job_cursors` ADD `processed` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `job_cursors` ADD `failures` integer DEFAULT 0 NOT NULL;