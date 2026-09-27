-- Written by hand (drizzle-kit would ask whether the table was renamed): the pre-standard table
-- keeps its rows under a new name until step 3.8 removes it, and the media feature takes the name.
ALTER TABLE `media_assets` RENAME TO `legacy_media_assets`;
--> statement-breakpoint
DROP INDEX `media_assets_objectKey_unique`;
--> statement-breakpoint
DROP INDEX `media_assets_state_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `legacy_media_assets_objectKey_unique` ON `legacy_media_assets` (`object_key`);
--> statement-breakpoint
CREATE INDEX `legacy_media_assets_state_idx` ON `legacy_media_assets` (`state`,`created_at`);
--> statement-breakpoint
CREATE TABLE `media_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`sha256` text NOT NULL,
	`state` text DEFAULT 'temporary' NOT NULL,
	`uploaded_by` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`state_changed_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	CONSTRAINT "media_assets_state_check" CHECK("media_assets"."state" in ('temporary', 'attached')),
	CONSTRAINT "media_assets_size_check" CHECK("media_assets"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_assets_objectKey_unique` ON `media_assets` (`object_key`);
--> statement-breakpoint
CREATE INDEX `media_assets_purge_idx` ON `media_assets` (`state`,`state_changed_at`);
