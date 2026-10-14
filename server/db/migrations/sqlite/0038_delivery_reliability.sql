CREATE TABLE `job_cursors` (
	`job` text PRIMARY KEY NOT NULL,
	`cursor` text,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `media_object_deletions` (
	`object_key` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`next_attempt_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `media_object_deletions_due_idx` ON `media_object_deletions` (`next_attempt_at`);--> statement-breakpoint
ALTER TABLE `marketing_posts` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `notification_deliveries` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `outbox_messages` ADD `claim_token` text;--> statement-breakpoint
CREATE INDEX `outbox_messages_order_idx` ON `outbox_messages` (`tenant_id`, `kind`, json_extract(`payload`, '$.orderId'));--> statement-breakpoint
CREATE INDEX `outbox_messages_expiry_idx` ON `outbox_messages` (`kind`,`created_at`);--> statement-breakpoint
CREATE INDEX `outbox_messages_sent_idx` ON `outbox_messages` (`status`,`sent_at`);
