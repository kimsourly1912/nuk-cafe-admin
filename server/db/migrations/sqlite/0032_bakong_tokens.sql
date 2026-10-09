CREATE TABLE `bakong_tokens` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`sealed` text NOT NULL,
	`expires_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
