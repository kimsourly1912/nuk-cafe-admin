CREATE TABLE `tenant_notes` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`contact_name` text,
	`contact_phone` text,
	`notes` text,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_by` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
