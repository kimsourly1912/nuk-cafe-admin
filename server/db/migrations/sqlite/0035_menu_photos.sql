ALTER TABLE `media_assets` ADD `parent_id` text REFERENCES media_assets(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `variant` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `placeholder` text;--> statement-breakpoint
ALTER TABLE `media_assets` ADD `edit` text;--> statement-breakpoint
CREATE INDEX `media_assets_parent_idx` ON `media_assets` (`parent_id`);