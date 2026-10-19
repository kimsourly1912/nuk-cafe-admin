CREATE TABLE `support_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`ended_at` integer,
	`ended_by` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `support_grants_tenant_idx` ON `support_grants` (`tenant_id`,`granted_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_grants_tenant_id_unique` ON `support_grants` (`tenant_id`,`id`);--> statement-breakpoint
CREATE TABLE `support_visits` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`opened_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`expires_at` integer NOT NULL,
	`closed_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`grant_id`) REFERENCES `support_grants`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `support_visits_session_idx` ON `support_visits` (`session_id`,`tenant_id`);--> statement-breakpoint
CREATE INDEX `support_visits_grant_idx` ON `support_visits` (`grant_id`);