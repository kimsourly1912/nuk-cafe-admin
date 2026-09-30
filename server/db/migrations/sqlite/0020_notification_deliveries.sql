CREATE TABLE `notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`destination_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`subject` text NOT NULL,
	`message` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`destination_id`) REFERENCES `telegram_destinations`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notification_deliveries_status_check" CHECK("notification_deliveries"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_dedupe_idx` ON `notification_deliveries` (`destination_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_due_idx` ON `notification_deliveries` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_created_idx` ON `notification_deliveries` (`created_at`);--> statement-breakpoint
CREATE TABLE `notification_rules` (
	`kind` text NOT NULL,
	`destination_id` text NOT NULL,
	`attach_csv` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`kind`, `destination_id`),
	FOREIGN KEY (`destination_id`) REFERENCES `telegram_destinations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notification_rules_kind_check" CHECK("notification_rules"."kind" in ('new_order', 'payment', 'closing_summary'))
);
