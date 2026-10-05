PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	CONSTRAINT "assistant_usage_provider_check" CHECK("__new_assistant_usage"."provider" in ('anthropic', 'openai', 'google', 'openai-compatible', 'cloudflare')),
	CONSTRAINT "assistant_usage_outcome_check" CHECK("__new_assistant_usage"."outcome" in ('pending', 'ok', 'error'))
);
--> statement-breakpoint
INSERT INTO `__new_assistant_usage`("id", "tenant_id", "user_id", "day", "feature", "provider", "model", "input_tokens", "output_tokens", "cached_input_tokens", "outcome", "at") SELECT "id", "tenant_id", "user_id", "day", "feature", "provider", "model", "input_tokens", "output_tokens", "cached_input_tokens", "outcome", "at" FROM `assistant_usage`;--> statement-breakpoint
DROP TABLE `assistant_usage`;--> statement-breakpoint
ALTER TABLE `__new_assistant_usage` RENAME TO `assistant_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `assistant_usage_user_day_idx` ON `assistant_usage` (`tenant_id`,`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `assistant_usage_at_idx` ON `assistant_usage` (`at`);