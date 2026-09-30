CREATE TABLE `assistant_usage` (
	`id` text PRIMARY KEY NOT NULL,
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
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_usage_feature_check" CHECK("assistant_usage"."feature" in ('ping', 'chat', 'menu_item_draft', 'rewrite')),
	CONSTRAINT "assistant_usage_provider_check" CHECK("assistant_usage"."provider" in ('anthropic', 'openai', 'google', 'openai-compatible')),
	CONSTRAINT "assistant_usage_outcome_check" CHECK("assistant_usage"."outcome" in ('pending', 'ok', 'error'))
);
--> statement-breakpoint
CREATE INDEX `assistant_usage_user_day_idx` ON `assistant_usage` (`user_id`,`day`);--> statement-breakpoint
CREATE INDEX `assistant_usage_at_idx` ON `assistant_usage` (`at`);