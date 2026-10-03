-- Step T1.4a (D138): Telegram chats, links, rules and deliveries get their tenant, and outbox
-- messages may name one. Written by hand like 0024: D1 ignores `PRAGMA foreign_keys=OFF`, so the
-- tables are rebuilt into `__new_…` (children pointing at the new chats), the old ones dropped
-- children first, then renamed.
-- 
-- 1. Every existing row belongs to NUK Cafe (0024's tenant, else the oldest); a database with
--    chats and no tenant gets it, as 0024 would have made it.
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`, `status`, `version`)
SELECT '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd', 'NUK Cafe', 'nuk', cast(unixepoch('subsecond') * 1000 as integer), 'active', 1
WHERE NOT EXISTS (SELECT 1 FROM `organization`)
  AND (EXISTS (SELECT 1 FROM `telegram_destinations`) OR EXISTS (SELECT 1 FROM `telegram_links`));
--> statement-breakpoint
-- 2. The new tables, chats first, each filled with the tenant. The chats' `(tenant_id, id)` index
--    exists before their children are copied (a foreign key needs it).
CREATE TABLE `__new_telegram_destinations` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "telegram_destinations_kind_check" CHECK("__new_telegram_destinations"."kind" in ('private', 'group')),
	CONSTRAINT "telegram_destinations_status_check" CHECK("__new_telegram_destinations"."status" in ('connected', 'blocked', 'disconnected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_destinations_tenant_id_unique` ON `__new_telegram_destinations` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_telegram_destinations`("id", "tenant_id", "chat_id", "kind", "title", "status", "connected_by", "connected_at", "last_sent_at", "blocked_at", "version", "created_at", "updated_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "chat_id", "kind", "title", "status", "connected_by", "connected_at", "last_sent_at", "blocked_at", "version", "created_at", "updated_at" FROM `telegram_destinations`;
--> statement-breakpoint
CREATE TABLE `__new_telegram_links` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`destination_id`) REFERENCES `__new_telegram_destinations`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "telegram_links_kind_check" CHECK("__new_telegram_links"."kind" in ('private', 'group')),
	CONSTRAINT "telegram_links_status_check" CHECK("__new_telegram_links"."status" in ('waiting', 'confirm', 'connected', 'cancelled', 'expired'))
);
--> statement-breakpoint
INSERT INTO `__new_telegram_links`("id", "tenant_id", "code_hash", "kind", "status", "created_by", "expires_at", "chat_id", "chat_title", "member_count", "destination_id", "created_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "code_hash", "kind", "status", "created_by", "expires_at", "chat_id", "chat_title", "member_count", "destination_id", "created_at" FROM `telegram_links`;
--> statement-breakpoint
CREATE TABLE `__new_notification_rules` (
	`tenant_id` text NOT NULL,
	`kind` text NOT NULL,
	`destination_id` text NOT NULL,
	`attach_csv` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`kind`, `destination_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`tenant_id`,`destination_id`) REFERENCES `__new_telegram_destinations`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_rules_kind_check" CHECK("__new_notification_rules"."kind" in ('new_order', 'payment', 'closing_summary', 'server_error'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_rules`("tenant_id", "kind", "destination_id", "attach_csv", "created_by", "created_at") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "kind", "destination_id", "attach_csv", "created_by", "created_at" FROM `notification_rules`;
--> statement-breakpoint
CREATE TABLE `__new_notification_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`destination_id`) REFERENCES `__new_telegram_destinations`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notification_deliveries_status_check" CHECK("__new_notification_deliveries"."status" in ('pending', 'sent', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_notification_deliveries`("id", "tenant_id", "kind", "destination_id", "dedupe_key", "subject", "message", "status", "attempts", "next_attempt_at", "last_error", "created_at", "sent_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "kind", "destination_id", "dedupe_key", "subject", "message", "status", "attempts", "next_attempt_at", "last_error", "created_at", "sent_at" FROM `notification_deliveries`;
--> statement-breakpoint
-- 3. The old tables go, children first, so no ON DELETE rule finds a row to act on.
DROP TABLE `notification_deliveries`;
--> statement-breakpoint
DROP TABLE `notification_rules`;
--> statement-breakpoint
DROP TABLE `telegram_links`;
--> statement-breakpoint
DROP TABLE `telegram_destinations`;
--> statement-breakpoint
-- 4. The new tables take the old names; SQLite rewrites the children's references as it goes.
ALTER TABLE `__new_telegram_destinations` RENAME TO `telegram_destinations`;
--> statement-breakpoint
ALTER TABLE `__new_telegram_links` RENAME TO `telegram_links`;
--> statement-breakpoint
ALTER TABLE `__new_notification_rules` RENAME TO `notification_rules`;
--> statement-breakpoint
ALTER TABLE `__new_notification_deliveries` RENAME TO `notification_deliveries`;
--> statement-breakpoint
-- 5. Their other indexes.
CREATE UNIQUE INDEX `telegram_destinations_chat_idx` ON `telegram_destinations` (`tenant_id`,`chat_id`);
--> statement-breakpoint
CREATE INDEX `telegram_destinations_chat_id_idx` ON `telegram_destinations` (`chat_id`);
--> statement-breakpoint
CREATE INDEX `telegram_destinations_status_idx` ON `telegram_destinations` (`tenant_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_links_code_idx` ON `telegram_links` (`code_hash`);
--> statement-breakpoint
CREATE INDEX `telegram_links_expires_idx` ON `telegram_links` (`expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_dedupe_idx` ON `notification_deliveries` (`destination_id`,`dedupe_key`);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_due_idx` ON `notification_deliveries` (`status`,`next_attempt_at`);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_created_idx` ON `notification_deliveries` (`created_at`);
--> statement-breakpoint
CREATE INDEX `notification_deliveries_tenant_created_idx` ON `notification_deliveries` (`tenant_id`,`created_at`);
--> statement-breakpoint
-- 6. Outbox messages may name their tenant: the orders' events do; account emails are the
--    platform's (null).
ALTER TABLE `outbox_messages` ADD `tenant_id` text REFERENCES organization(id) ON DELETE restrict;
--> statement-breakpoint
UPDATE `outbox_messages` SET `tenant_id` = coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)) WHERE `kind` LIKE 'orders.%';
