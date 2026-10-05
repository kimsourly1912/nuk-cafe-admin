-- Generated with Drizzle Kit 0.31.11; corrected the source copy to select existing columns only.
-- New review columns use their defaults; foreign keys stay enabled (D153).
CREATE TABLE `assistant_import_leases` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`extraction_id` text NOT NULL,
	`deadline` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
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
	CONSTRAINT "assistant_usage_feature_check" CHECK("__new_assistant_usage"."feature" in ('ping', 'chat', 'menu_item_draft', 'rewrite', 'menu_import')),
	CONSTRAINT "assistant_usage_provider_check" CHECK("__new_assistant_usage"."provider" in ('anthropic', 'openai', 'google', 'openai-compatible', 'cloudflare')),
	CONSTRAINT "assistant_usage_outcome_check" CHECK("__new_assistant_usage"."outcome" in ('pending', 'ok', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_assistant_usage`("id", "tenant_id", "user_id", "day", "feature", "provider", "model", "input_tokens", "output_tokens", "cached_input_tokens", "outcome", "at") SELECT "id", "tenant_id", "user_id", "day", "feature", "provider", "model", "input_tokens", "output_tokens", "cached_input_tokens", "outcome", "at" FROM `assistant_usage`;--> statement-breakpoint
DROP TABLE `assistant_usage`;--> statement-breakpoint
ALTER TABLE `__new_assistant_usage` RENAME TO `assistant_usage`;--> statement-breakpoint
CREATE INDEX `assistant_usage_user_day_idx` ON `assistant_usage` (`tenant_id`,`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `assistant_usage_at_idx` ON `assistant_usage` (`at`);--> statement-breakpoint
CREATE TABLE `__new_assistant_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`state` text DEFAULT 'uploading' NOT NULL,
	`review_state` text DEFAULT 'none' NOT NULL,
	`extraction_id` text,
	`extraction_deadline` integer,
	`extraction_error` text,
	`review_rows` text,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_imports_type_check" CHECK("__new_assistant_imports"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
	CONSTRAINT "assistant_imports_size_check" CHECK("__new_assistant_imports"."byte_size" > 0 and "__new_assistant_imports"."byte_size" <= 5242880),
	CONSTRAINT "assistant_imports_state_check" CHECK("__new_assistant_imports"."state" in ('uploading', 'uploaded')),
	CONSTRAINT "assistant_imports_version_check" CHECK("__new_assistant_imports"."version" >= 1),
	CONSTRAINT "assistant_imports_review_state_check" CHECK("__new_assistant_imports"."review_state" in ('none', 'processing', 'ready', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_assistant_imports`("id", "tenant_id", "user_id", "object_key", "file_name", "mime_type", "byte_size", "state", "version", "created_at", "expires_at") SELECT "id", "tenant_id", "user_id", "object_key", "file_name", "mime_type", "byte_size", "state", "version", "created_at", "expires_at" FROM `assistant_imports`;--> statement-breakpoint
DROP TABLE `assistant_imports`;--> statement-breakpoint
ALTER TABLE `__new_assistant_imports` RENAME TO `assistant_imports`;--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_imports_objectKey_unique` ON `assistant_imports` (`object_key`);--> statement-breakpoint
CREATE INDEX `assistant_imports_owner_idx` ON `assistant_imports` (`tenant_id`,`user_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `assistant_imports_processing_idx` ON `assistant_imports` (`tenant_id`,`user_id`,`review_state`,`extraction_deadline`);
