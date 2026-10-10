CREATE TABLE `order_ready_alerts` (
	`order_id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`code_hash` text,
	`link_expires_at` integer NOT NULL,
	`chat_id` text,
	`subscribed_at` integer,
	`notified_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `orders`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_ready_alerts_code_idx` ON `order_ready_alerts` (`code_hash`);--> statement-breakpoint
CREATE INDEX `order_ready_alerts_created_idx` ON `order_ready_alerts` (`created_at`);