-- Studio builder plan Phase 5 (D284): a cafe's saved groups, pieces and walls under a name placed again
-- as new copies on any floor. Expand only: a new table, nothing reads it before this release.
-- Hand-written (the generator could not resolve the auth schema in the agent's container); the
-- statements follow drizzle-kit's output for custom_item_looks.
CREATE TABLE `layout_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`pieces` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `layout_groups_name_idx` ON `layout_groups` (`tenant_id`,lower("name"));
