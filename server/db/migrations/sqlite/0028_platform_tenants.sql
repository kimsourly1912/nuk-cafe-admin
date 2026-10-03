-- Step T1.4b (D139): idempotency keys, the assistant's usage and the sample-data run get their
-- tenant, and audit events may name one. Written by hand like 0024: the tables that need a NOT NULL
-- tenant (or a new primary key) are rebuilt into `__new_…`, the old ones dropped, then renamed.
-- Nothing references these tables, so the order doesn't matter.
-- 
-- 1. Every existing row belongs to NUK Cafe (0024's tenant, else the oldest); a database with such
--    rows and no tenant gets it, as 0024 would have made it.
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`, `status`, `version`)
SELECT '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd', 'NUK Cafe', 'nuk', cast(unixepoch('subsecond') * 1000 as integer), 'active', 1
WHERE NOT EXISTS (SELECT 1 FROM `organization`)
  AND (EXISTS (SELECT 1 FROM `idempotency_keys`) OR EXISTS (SELECT 1 FROM `assistant_usage`) OR EXISTS (SELECT 1 FROM `sample_data_runs`));
--> statement-breakpoint
-- 2. The new tables, each filled with the tenant.
CREATE TABLE `__new_idempotency_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`operation` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
INSERT INTO `__new_idempotency_keys`("id", "tenant_id", "actor_id", "operation", "key", "request_hash", "response", "created_at", "expires_at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "actor_id", "operation", "key", "request_hash", "response", "created_at", "expires_at" FROM `idempotency_keys`;
--> statement-breakpoint
CREATE TABLE `__new_assistant_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`feature` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`input_tokens` integer,
	`output_tokens` integer,
	`cached_input_tokens` integer,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_usage_feature_check" CHECK("__new_assistant_usage"."feature" in ('ping', 'chat', 'menu_item_draft', 'rewrite')),
	CONSTRAINT "assistant_usage_provider_check" CHECK("__new_assistant_usage"."provider" in ('anthropic', 'openai', 'google', 'openai-compatible')),
	CONSTRAINT "assistant_usage_outcome_check" CHECK("__new_assistant_usage"."outcome" in ('pending', 'ok', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_assistant_usage`("id", "tenant_id", "user_id", "day", "feature", "provider", "model", "input_tokens", "output_tokens", "cached_input_tokens", "outcome", "at") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "user_id", "day", "feature", "provider", "model", "input_tokens", "output_tokens", "cached_input_tokens", "outcome", "at" FROM `assistant_usage`;
--> statement-breakpoint
CREATE TABLE `__new_sample_data_runs` (
	`tenant_id` text NOT NULL,
	`id` text NOT NULL,
	`size` text NOT NULL,
	`started_by` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`locked_until` integer,
	PRIMARY KEY(`tenant_id`, `id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sample_data_runs_size_check" CHECK("__new_sample_data_runs"."size" in ('small', 'standard', 'large'))
);
--> statement-breakpoint
INSERT INTO `__new_sample_data_runs`("tenant_id", "id", "size", "started_by", "started_at", "finished_at", "locked_until") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "id", "size", "started_by", "started_at", "finished_at", "locked_until" FROM `sample_data_runs`;
--> statement-breakpoint
-- 3. The old tables go.
DROP TABLE `idempotency_keys`;
--> statement-breakpoint
DROP TABLE `assistant_usage`;
--> statement-breakpoint
DROP TABLE `sample_data_runs`;
--> statement-breakpoint
-- 4. The new tables take the old names.
ALTER TABLE `__new_idempotency_keys` RENAME TO `idempotency_keys`;
--> statement-breakpoint
ALTER TABLE `__new_assistant_usage` RENAME TO `assistant_usage`;
--> statement-breakpoint
ALTER TABLE `__new_sample_data_runs` RENAME TO `sample_data_runs`;
--> statement-breakpoint
-- 5. Their indexes (the idempotency scope now starts with the tenant).
CREATE UNIQUE INDEX `idempotency_keys_scope_idx` ON `idempotency_keys` (`tenant_id`,`actor_id`,`operation`,`key`);
--> statement-breakpoint
CREATE INDEX `idempotency_keys_expires_at_idx` ON `idempotency_keys` (`expires_at`);
--> statement-breakpoint
CREATE INDEX `assistant_usage_user_day_idx` ON `assistant_usage` (`tenant_id`,`user_id`,`day`);
--> statement-breakpoint
CREATE INDEX `assistant_usage_at_idx` ON `assistant_usage` (`at`);
--> statement-breakpoint
-- 6. Audit events may name their tenant (null: the platform's). Every event so far was NUK Cafe's.
ALTER TABLE `audit_events` ADD `tenant_id` text REFERENCES organization(id) ON DELETE restrict;
--> statement-breakpoint
UPDATE `audit_events` SET `tenant_id` = coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1));
--> statement-breakpoint
CREATE INDEX `audit_events_tenant_idx` ON `audit_events` (`tenant_id`,`at`);
