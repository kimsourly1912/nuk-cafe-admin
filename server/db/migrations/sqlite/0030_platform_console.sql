-- Step T2a (D142): the platform console. `tenant_slugs` keeps every address a cafe has had (the
-- current one too), a reason when a cafe is paused, and an index for the usage numbers.
CREATE TABLE `tenant_slugs` (
	`slug` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `tenant_slugs_tenant_idx` ON `tenant_slugs` (`tenant_id`);--> statement-breakpoint
ALTER TABLE `organization` ADD `suspended_reason` text;--> statement-breakpoint
CREATE INDEX `orders_tenant_placed_idx` ON `orders` (`tenant_id`,`placed_at`);--> statement-breakpoint
-- Every existing cafe's current address is in the history from the start.
INSERT INTO `tenant_slugs` (`slug`, `tenant_id`, `created_at`) SELECT `slug`, `id`, `created_at` FROM `organization`;
