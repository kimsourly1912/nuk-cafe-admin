CREATE TABLE `telegram_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`connected_by` text,
	`connected_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_sent_at` integer,
	`blocked_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`connected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "telegram_destinations_kind_check" CHECK("telegram_destinations"."kind" in ('private', 'group')),
	CONSTRAINT "telegram_destinations_status_check" CHECK("telegram_destinations"."status" in ('connected', 'blocked', 'disconnected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_destinations_chat_idx` ON `telegram_destinations` (`chat_id`);--> statement-breakpoint
CREATE INDEX `telegram_destinations_status_idx` ON `telegram_destinations` (`status`);--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`chat_id` text,
	`chat_title` text,
	`member_count` integer,
	`destination_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`destination_id`) REFERENCES `telegram_destinations`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "telegram_links_kind_check" CHECK("telegram_links"."kind" in ('private', 'group')),
	CONSTRAINT "telegram_links_status_check" CHECK("telegram_links"."status" in ('waiting', 'confirm', 'connected', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_code_idx` ON `telegram_links` (`code_hash`);--> statement-breakpoint
CREATE INDEX `telegram_links_expires_idx` ON `telegram_links` (`expires_at`);