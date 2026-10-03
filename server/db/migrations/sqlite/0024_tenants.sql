-- Step T1.1 (D134, D135): an organization is now a tenant (a cafe business), and branches are our
-- own table. Written by hand: drizzle-kit rebuilds tables with `PRAGMA foreign_keys=OFF`, which D1
-- ignores, and dropping the old `orders` would then run its children's ON DELETE rules.
-- 
-- 1. The existing data becomes the tenant "NUK Cafe" (slug `nuk`), created only when the database
--    holds anything (a fresh database, e.g. the tests', gets no tenant).
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`, `timezone`, `status`, `version`)
SELECT '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd', 'NUK Cafe',
  CASE WHEN EXISTS (SELECT 1 FROM `organization` WHERE `slug` = 'nuk') THEN 'nuk-cafe' ELSE 'nuk' END,
  cast(unixepoch('subsecond') * 1000 as integer), 'Asia/Phnom_Penh', 'active', 1
WHERE EXISTS (SELECT 1 FROM `user`) OR EXISTS (SELECT 1 FROM `organization`);
--> statement-breakpoint
-- 2. Branches keep their ids: every `branch_id` stays valid.
CREATE TABLE `branches` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`address` text,
	`phone` text,
	`status` text DEFAULT 'active' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "branches_status_check" CHECK("branches"."status" in ('active', 'archived'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `branches_tenant_id_unique` ON `branches` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `branches` (`id`, `tenant_id`, `name`, `timezone`, `currency`, `address`, `phone`, `status`, `version`, `created_at`)
SELECT `id`, (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), `name`, `timezone`, coalesce(`currency`, 'USD'), `address`, `phone`, coalesce(`status`, 'active'), coalesce(`version`, 1), `created_at`
FROM `organization` WHERE `id` <> '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd';
--> statement-breakpoint
-- 3. Branch memberships become branch_staff rows; their people become members of the tenant, and
--    the cafe's admins (the old global `admin` role) its owners.
CREATE TABLE `branch_staff` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`branch_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "branch_staff_role_check" CHECK("branch_staff"."role" in ('manager', 'staff'))
);
--> statement-breakpoint
CREATE INDEX `branch_staff_user_idx` ON `branch_staff` (`user_id`);
--> statement-breakpoint
INSERT INTO `branch_staff` (`tenant_id`, `branch_id`, `user_id`, `role`, `created_at`)
SELECT `b`.`tenant_id`, `m`.`organization_id`, `m`.`user_id`, `m`.`role`, `m`.`created_at`
FROM `member` `m` JOIN `branches` `b` ON `b`.`id` = `m`.`organization_id`
WHERE `m`.`role` IN ('manager', 'staff');
--> statement-breakpoint
INSERT INTO `member` (`id`, `organization_id`, `user_id`, `role`, `created_at`)
SELECT lower(hex(randomblob(16))), '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd', `u`.`id`,
  CASE WHEN (',' || coalesce(`u`.`role`, '') || ',') LIKE '%,admin,%' THEN 'owner' ELSE 'member' END,
  cast(unixepoch('subsecond') * 1000 as integer)
FROM `user` `u`
WHERE EXISTS (SELECT 1 FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd')
  AND ((',' || coalesce(`u`.`role`, '') || ',') LIKE '%,admin,%' OR EXISTS (SELECT 1 FROM `branch_staff` `s` WHERE `s`.`user_id` = `u`.`id`));
--> statement-breakpoint
-- Nobody is a super admin yet: the seed task or a super admin grants it (T2).
UPDATE `user` SET `role` = 'customer' WHERE (',' || coalesce(`role`, '') || ',') LIKE '%,admin,%';
--> statement-breakpoint
-- 4. The tables pointing at a branch, and the orders family, are rebuilt with `tenant_id` and
--    composite foreign keys. Parents first; each new child points at its new parent.
CREATE TABLE `__new_branch_hours` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`start_minute` integer NOT NULL,
	`end_minute` integer NOT NULL,
	PRIMARY KEY(`branch_id`, `weekday`, `start_minute`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "branch_hours_range_check" CHECK("__new_branch_hours"."weekday" between 1 and 7 and "__new_branch_hours"."start_minute" between 0 and 1439 and "__new_branch_hours"."end_minute" between 1 and 1440 and "__new_branch_hours"."end_minute" <> "__new_branch_hours"."start_minute")
);
--> statement-breakpoint
INSERT INTO `__new_branch_hours`("tenant_id", "branch_id", "weekday", "start_minute", "end_minute") SELECT (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "branch_id", "weekday", "start_minute", "end_minute" FROM `branch_hours`;
--> statement-breakpoint
CREATE TABLE `__new_dining_tables` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`label` text NOT NULL,
	`area` text,
	`status` text DEFAULT 'active' NOT NULL,
	`qr_version` integer DEFAULT 1 NOT NULL,
	`qr_token_hash` text NOT NULL,
	`qr_rotated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "dining_tables_status_check" CHECK("__new_dining_tables"."status" in ('active', 'archived'))
);
--> statement-breakpoint
INSERT INTO `__new_dining_tables`("id", "tenant_id", "branch_id", "label", "area", "status", "qr_version", "qr_token_hash", "qr_rotated_at", "version", "created_at", "updated_at") SELECT "id", (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "branch_id", "label", "area", "status", "qr_version", "qr_token_hash", "qr_rotated_at", "version", "created_at", "updated_at" FROM `dining_tables`;
--> statement-breakpoint
CREATE TABLE `__new_branch_item_states` (
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`variation_id` text NOT NULL,
	`sold_out` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`branch_id`, `variation_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`variation_id`) REFERENCES `menu_item_variations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_branch_item_states`("tenant_id", "branch_id", "variation_id", "sold_out", "updated_by", "updated_at") SELECT (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "branch_id", "variation_id", "sold_out", "updated_by", "updated_at" FROM `branch_item_states`;
--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
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
	`paid_at` integer,
	`ready_at` integer,
	`completed_at` integer,
	`cancelled_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`customer_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "orders_status_check" CHECK("__new_orders"."status" in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled')),
	CONSTRAINT "orders_type_check" CHECK(("__new_orders"."order_type" = 'pickup' and "__new_orders"."table_id" is null) or ("__new_orders"."order_type" = 'dine_in' and "__new_orders"."table_id" is not null)),
	CONSTRAINT "orders_amounts_check" CHECK("__new_orders"."subtotal_minor" >= 0 and "__new_orders"."total_minor" >= 0 and "__new_orders"."pickup_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_tenant_id_unique` ON `__new_orders` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_orders`("id", "tenant_id", "branch_id", "customer_id", "business_date", "pickup_number", "status", "order_type", "table_id", "table_label", "subtotal_minor", "total_minor", "currency", "placed_at", "payment_due_at", "paid_at", "ready_at", "completed_at", "cancelled_at", "version", "created_at", "updated_at") SELECT "id", (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "branch_id", "customer_id", "business_date", "pickup_number", "status", "order_type", "table_id", "table_label", "subtotal_minor", "total_minor", "currency", "placed_at", "payment_due_at", "paid_at", "ready_at", "completed_at", "cancelled_at", "version", "created_at", "updated_at" FROM `orders`;
--> statement-breakpoint
CREATE TABLE `__new_khqr_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
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
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `__new_orders`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "khqr_charges_check" CHECK("__new_khqr_charges"."currency" in ('USD', 'KHR') and "__new_khqr_charges"."amount" > 0 and ("__new_khqr_charges"."currency" = 'KHR') = ("__new_khqr_charges"."khr_per_usd" is not null) and "__new_khqr_charges"."expires_at" > "__new_khqr_charges"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `khqr_charges_tenant_id_unique` ON `__new_khqr_charges` (`tenant_id`,`id`);
--> statement-breakpoint
INSERT INTO `__new_khqr_charges`("id", "tenant_id", "order_id", "branch_id", "currency", "amount", "khr_per_usd", "account_id", "merchant_name", "qr", "md5", "bill_number", "created_by", "created_at", "expires_at") SELECT "id", (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "order_id", "branch_id", "currency", "amount", "khr_per_usd", "account_id", "merchant_name", "qr", "md5", "bill_number", "created_by", "created_at", "expires_at" FROM `khqr_charges`;
--> statement-breakpoint
CREATE TABLE `__new_counter_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`method` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`amount_khr` integer,
	`khr_per_usd` integer,
	`reference` text,
	`khqr_charge_id` text,
	`collected_by` text NOT NULL,
	`collected_at` integer NOT NULL,
	`return_method` text,
	`returned_by` text,
	`returned_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`collected_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`returned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `__new_orders`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`khqr_charge_id`) REFERENCES `__new_khqr_charges`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "counter_payments_method_check" CHECK("__new_counter_payments"."method" in ('cash_usd', 'cash_khr', 'khqr') and "__new_counter_payments"."amount_minor" >= 0),
	CONSTRAINT "counter_payments_khr_check" CHECK(("__new_counter_payments"."method" = 'cash_khr') = ("__new_counter_payments"."amount_khr" is not null and "__new_counter_payments"."khr_per_usd" is not null)),
	CONSTRAINT "counter_payments_return_check" CHECK(("__new_counter_payments"."return_method" is null and "__new_counter_payments"."returned_at" is null and "__new_counter_payments"."returned_by" is null) or ("__new_counter_payments"."return_method" in ('cash', 'khqr') and "__new_counter_payments"."returned_at" is not null and "__new_counter_payments"."returned_by" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_counter_payments`("id", "tenant_id", "order_id", "branch_id", "method", "amount_minor", "amount_khr", "khr_per_usd", "reference", "khqr_charge_id", "collected_by", "collected_at", "return_method", "returned_by", "returned_at") SELECT "id", (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "order_id", "branch_id", "method", "amount_minor", "amount_khr", "khr_per_usd", "reference", "khqr_charge_id", "collected_by", "collected_at", "return_method", "returned_by", "returned_at" FROM `counter_payments`;
--> statement-breakpoint
CREATE TABLE `__new_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`position` integer NOT NULL,
	`item_id` text NOT NULL,
	`variation_id` text NOT NULL,
	`item_name` text NOT NULL,
	`category_id` text,
	`category_name` text,
	`detail` text NOT NULL,
	`modifiers` text NOT NULL,
	`unit_price_minor` integer NOT NULL,
	`quantity` integer NOT NULL,
	`total_minor` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `__new_orders`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_lines_amounts_check" CHECK("__new_order_lines"."quantity" between 1 and 20 and "__new_order_lines"."unit_price_minor" >= 0 and "__new_order_lines"."total_minor" = "__new_order_lines"."unit_price_minor" * "__new_order_lines"."quantity")
);
--> statement-breakpoint
INSERT INTO `__new_order_lines`("id", "tenant_id", "order_id", "position", "item_id", "variation_id", "item_name", "category_id", "category_name", "detail", "modifiers", "unit_price_minor", "quantity", "total_minor", "note") SELECT "id", (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "order_id", "position", "item_id", "variation_id", "item_name", "category_id", "category_name", "detail", "modifiers", "unit_price_minor", "quantity", "total_minor", "note" FROM `order_lines`;
--> statement-breakpoint
CREATE TABLE `__new_order_events` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`order_id` text NOT NULL,
	`to_version` integer NOT NULL,
	`actor_id` text,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`note` text,
	`at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `__new_orders`(`tenant_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "order_events_status_check" CHECK("__new_order_events"."to_status" in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled') and ("__new_order_events"."from_status" is null or "__new_order_events"."from_status" in ('awaiting_payment', 'preparing', 'ready', 'completed', 'cancelled'))),
	CONSTRAINT "order_events_reason_check" CHECK("__new_order_events"."reason" is null or "__new_order_events"."reason" in ('customer_changed_mind', 'item_unavailable', 'other'))
);
--> statement-breakpoint
INSERT INTO `__new_order_events`("id", "tenant_id", "order_id", "to_version", "actor_id", "from_status", "to_status", "reason", "note", "at") SELECT "id", (SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), "order_id", "to_version", "actor_id", "from_status", "to_status", "reason", "note", "at" FROM `order_events`;
--> statement-breakpoint
-- 5. The old tables go, children first, so no ON DELETE rule finds a row to act on.
DROP TABLE `order_events`;
--> statement-breakpoint
DROP TABLE `order_lines`;
--> statement-breakpoint
DROP TABLE `counter_payments`;
--> statement-breakpoint
DROP TABLE `khqr_charges`;
--> statement-breakpoint
DROP TABLE `orders`;
--> statement-breakpoint
DROP TABLE `branch_item_states`;
--> statement-breakpoint
DROP TABLE `dining_tables`;
--> statement-breakpoint
DROP TABLE `branch_hours`;
--> statement-breakpoint
-- 6. The old branch organizations go (with their memberships and invitations), then the branch
--    columns of organization.
DELETE FROM `organization` WHERE `id` IN (SELECT `id` FROM `branches`);
--> statement-breakpoint
UPDATE `session` SET `active_organization_id` = NULL;
--> statement-breakpoint
ALTER TABLE `organization` DROP COLUMN `timezone`;
--> statement-breakpoint
ALTER TABLE `organization` DROP COLUMN `currency`;
--> statement-breakpoint
ALTER TABLE `organization` DROP COLUMN `address`;
--> statement-breakpoint
ALTER TABLE `organization` DROP COLUMN `phone`;
--> statement-breakpoint
-- 7. The new tables take the old names; SQLite rewrites the children's references as it goes.
ALTER TABLE `__new_orders` RENAME TO `orders`;
--> statement-breakpoint
ALTER TABLE `__new_khqr_charges` RENAME TO `khqr_charges`;
--> statement-breakpoint
ALTER TABLE `__new_counter_payments` RENAME TO `counter_payments`;
--> statement-breakpoint
ALTER TABLE `__new_order_lines` RENAME TO `order_lines`;
--> statement-breakpoint
ALTER TABLE `__new_order_events` RENAME TO `order_events`;
--> statement-breakpoint
ALTER TABLE `__new_branch_hours` RENAME TO `branch_hours`;
--> statement-breakpoint
ALTER TABLE `__new_dining_tables` RENAME TO `dining_tables`;
--> statement-breakpoint
ALTER TABLE `__new_branch_item_states` RENAME TO `branch_item_states`;
--> statement-breakpoint
-- 8. Their indexes.
CREATE INDEX `branch_item_states_variation_idx` ON `branch_item_states` (`variation_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `counter_payments_order_idx` ON `counter_payments` (`order_id`);
--> statement-breakpoint
CREATE INDEX `counter_payments_branch_idx` ON `counter_payments` (`branch_id`,`collected_at`);
--> statement-breakpoint
CREATE INDEX `counter_payments_returned_idx` ON `counter_payments` (`branch_id`,`returned_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_qr_token_hash_idx` ON `dining_tables` (`qr_token_hash`);
--> statement-breakpoint
CREATE UNIQUE INDEX `dining_tables_active_label_idx` ON `dining_tables` (`branch_id`,lower("label")) WHERE "dining_tables"."status" = 'active';
--> statement-breakpoint
CREATE INDEX `dining_tables_branch_idx` ON `dining_tables` (`branch_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `khqr_charges_md5_idx` ON `khqr_charges` (`md5`);
--> statement-breakpoint
CREATE INDEX `khqr_charges_order_idx` ON `khqr_charges` (`order_id`,`currency`,`expires_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_events_version_idx` ON `order_events` (`order_id`,`to_version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `order_lines_position_idx` ON `order_lines` (`order_id`,`position`);
--> statement-breakpoint
CREATE INDEX `order_lines_item_idx` ON `order_lines` (`item_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_pickup_number_idx` ON `orders` (`branch_id`,`business_date`,`pickup_number`);
--> statement-breakpoint
CREATE INDEX `orders_customer_idx` ON `orders` (`customer_id`,`placed_at`);
--> statement-breakpoint
CREATE INDEX `orders_branch_status_idx` ON `orders` (`branch_id`,`status`);
--> statement-breakpoint
CREATE INDEX `orders_branch_date_idx` ON `orders` (`branch_id`,`business_date`);
--> statement-breakpoint
CREATE INDEX `orders_status_due_idx` ON `orders` (`status`,`payment_due_at`);
