CREATE TABLE `marketing_channel_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`status` text DEFAULT 'waiting' NOT NULL,
	`created_by` text NOT NULL,
	`expires_at` integer NOT NULL,
	`chat_id` text,
	`chat_title` text,
	`chat_username` text,
	`member_count` integer,
	`channel_id` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`channel_id`) REFERENCES `marketing_channels`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "marketing_channel_links_status_check" CHECK("marketing_channel_links"."status" in ('waiting', 'confirm', 'connected', 'cancelled', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_channel_links_code_idx` ON `marketing_channel_links` (`code_hash`);--> statement-breakpoint
CREATE INDEX `marketing_channel_links_expires_idx` ON `marketing_channel_links` (`expires_at`);--> statement-breakpoint
CREATE TABLE `marketing_channels` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`username` text,
	`subscriber_count` integer,
	`status` text DEFAULT 'connected' NOT NULL,
	`connected_by` text,
	`connected_at` integer NOT NULL,
	`removed_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "marketing_channels_kind_check" CHECK("marketing_channels"."kind" in ('telegram_channel')),
	CONSTRAINT "marketing_channels_status_check" CHECK("marketing_channels"."status" in ('connected', 'removed', 'disconnected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_channels_external_idx` ON `marketing_channels` (`tenant_id`,`kind`,`external_id`);--> statement-breakpoint
CREATE INDEX `marketing_channels_external_id_idx` ON `marketing_channels` (`external_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `marketing_channels_tenant_id_unique` ON `marketing_channels` (`tenant_id`,`id`);--> statement-breakpoint
CREATE TABLE `marketing_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`promotion_id` text NOT NULL,
	`channel_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`caption` text NOT NULL,
	`message` text NOT NULL,
	`scheduled_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`external_message_id` text,
	`external_url` text,
	`reason` text,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`sent_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tenant_id`,`promotion_id`) REFERENCES `menu_promotions`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`channel_id`) REFERENCES `marketing_channels`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "marketing_posts_status_check" CHECK("marketing_posts"."status" in ('pending', 'sent', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE INDEX `marketing_posts_due_idx` ON `marketing_posts` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `marketing_posts_promotion_idx` ON `marketing_posts` (`tenant_id`,`promotion_id`,`scheduled_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `source` text;