CREATE TABLE `order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`position` integer NOT NULL,
	`item_id` text NOT NULL,
	`variation_id` text NOT NULL,
	`item_name` text NOT NULL,
	`detail` text NOT NULL,
	`modifiers` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_lines_amounts_check" CHECK("order_lines"."quantity" between 1 and 20 and "order_lines"."unit_price_minor" >= 0 and "order_lines"."total_minor" = "order_lines"."unit_price_minor" * "order_lines"."quantity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_lines_position_idx` ON `order_lines` (`order_id`,`position`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`business_date` text NOT NULL,
	`pickup_number` integer NOT NULL,
	`status` text DEFAULT 'awaiting_payment' NOT NULL,
	`order_type` text NOT NULL,
	`table_id` text,
	`table_label` text,
	`subtotal_minor` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`placed_at` integer NOT NULL,
	`payment_due_at` integer NOT NULL,
	`cancelled_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`branch_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_status_check" CHECK("orders"."status" in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled')),
	CONSTRAINT "orders_type_check" CHECK(("orders"."order_type" = 'pickup' and "orders"."table_id" is null) or ("orders"."order_type" = 'dine_in' and "orders"."table_id" is not null)),
	CONSTRAINT "orders_amounts_check" CHECK("orders"."subtotal_minor" >= 0 and "orders"."total_minor" >= 0 and "orders"."pickup_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_pickup_number_idx` ON `orders` (`branch_id`,`business_date`,`pickup_number`);--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`,`placed_at`);--> statement-breakpoint
CREATE INDEX `orders_branch_status_idx` ON `orders` (`branch_id`,`status`);