CREATE TABLE `khqr_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`currency` text NOT NULL,
	`amount` integer NOT NULL,
	`khr_per_usd` integer,
	`account_id` text NOT NULL,
	`merchant_name` text NOT NULL,
	`qr` text NOT NULL,
	`md5` text NOT NULL,
	`bill_number` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`branch_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "khqr_charges_check" CHECK("khqr_charges"."currency" in ('USD', 'KHR') and "khqr_charges"."amount" > 0 and ("khqr_charges"."currency" = 'KHR') = ("khqr_charges"."khr_per_usd" is not null) and "khqr_charges"."expires_at" > "khqr_charges"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `khqr_charges_md5_idx` ON `khqr_charges` (`md5`);--> statement-breakpoint
CREATE INDEX `khqr_charges_order_idx` ON `khqr_charges` (`order_id`,`currency`,`expires_at`);--> statement-breakpoint
CREATE TABLE `khqr_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`account_id` text NOT NULL,
	`merchant_name` text NOT NULL,
	`merchant_city` text NOT NULL,
	`currencies` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "khqr_settings_check" CHECK("khqr_settings"."id" = 'default' and "khqr_settings"."currencies" in ('USD', 'KHR', 'USD,KHR'))
);
--> statement-breakpoint
ALTER TABLE `counter_payments` ADD `khqr_charge_id` text REFERENCES khqr_charges(id);