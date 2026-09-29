CREATE TABLE `counter_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`amount_khr` integer,
	`khr_per_usd` integer,
	`reference` text,
	`collected_by` text NOT NULL,
	`collected_at` integer NOT NULL,
	`return_method` text,
	`returned_by` text,
	`returned_at` integer,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`branch_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`collected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`returned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "counter_payments_method_check" CHECK("counter_payments"."method" in ('cash_usd', 'cash_khr', 'khqr') and "counter_payments"."amount_minor" >= 0),
	CONSTRAINT "counter_payments_khr_check" CHECK(("counter_payments"."method" = 'cash_khr') = ("counter_payments"."amount_khr" is not null and "counter_payments"."khr_per_usd" is not null)),
	CONSTRAINT "counter_payments_return_check" CHECK(("counter_payments"."return_method" is null and "counter_payments"."returned_at" is null and "counter_payments"."returned_by" is null) or ("counter_payments"."return_method" in ('cash', 'khqr') and "counter_payments"."returned_at" is not null and "counter_payments"."returned_by" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `counter_payments_order_idx` ON `counter_payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `counter_payments_branch_idx` ON `counter_payments` (`branch_id`,`collected_at`);--> statement-breakpoint
CREATE TABLE `exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`currency` text DEFAULT 'KHR' NOT NULL,
	`per_usd` integer NOT NULL,
	`effective_from` integer NOT NULL,
	`set_by` text NOT NULL,
	FOREIGN KEY (`set_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "exchange_rates_check" CHECK("exchange_rates"."currency" = 'KHR' and "exchange_rates"."per_usd" between 1000 and 10000)
);
--> statement-breakpoint
CREATE INDEX `exchange_rates_effective_idx` ON `exchange_rates` (`currency`,`effective_from`);--> statement-breakpoint
CREATE TABLE `order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`to_version` integer NOT NULL,
	`actor_id` text,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`note` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "order_events_status_check" CHECK("order_events"."to_status" in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled') and ("order_events"."from_status" is null or "order_events"."from_status" in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled'))),
	CONSTRAINT "order_events_reason_check" CHECK("order_events"."reason" is null or "order_events"."reason" in ('customer_changed_mind', 'item_unavailable', 'other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_events_version_idx` ON `order_events` (`order_id`,`to_version`);--> statement-breakpoint
ALTER TABLE `orders` ADD `paid_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `ready_at` integer;--> statement-breakpoint
ALTER TABLE `orders` ADD `completed_at` integer;