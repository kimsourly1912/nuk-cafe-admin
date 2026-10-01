-- Step 10.4 (D119): the "server_error" notification kind. SQLite can't change a CHECK in place, so
-- the table is rebuilt: copy, drop, rename. Nothing references notification_rules, so no foreign
-- key pragma is needed (D1 keeps foreign keys on).
CREATE TABLE `__new_notification_rules` (
	`kind` text NOT NULL,
	`destination_id` text NOT NULL,
	`attach_csv` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`kind`, `destination_id`),
	FOREIGN KEY (`destination_id`) REFERENCES `telegram_destinations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notification_rules_kind_check" CHECK("kind" in ('new_order', 'payment', 'closing_summary', 'server_error'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_rules`("kind", "destination_id", "attach_csv", "created_by", "created_at") SELECT "kind", "destination_id", "attach_csv", "created_by", "created_at" FROM `notification_rules`;--> statement-breakpoint
DROP TABLE `notification_rules`;--> statement-breakpoint
ALTER TABLE `__new_notification_rules` RENAME TO `notification_rules`;
