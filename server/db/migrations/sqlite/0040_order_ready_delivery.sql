ALTER TABLE `order_ready_alerts` ADD `subscription_id` text;--> statement-breakpoint
ALTER TABLE `order_ready_alerts` ADD `claim_token` text;--> statement-breakpoint
ALTER TABLE `order_ready_alerts` ADD `claim_until` integer;--> statement-breakpoint
ALTER TABLE `order_ready_alerts` ADD `attempts` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `order_ready_alerts` ADD `retry_at` integer;--> statement-breakpoint
CREATE INDEX `order_ready_alerts_due_idx` ON `order_ready_alerts` (`retry_at`);