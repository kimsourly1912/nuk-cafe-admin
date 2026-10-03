-- Step T1.3 (D137): customer profiles, the KHQR settings and the riel rate get their tenant. Written
-- by hand: drizzle-kit would ask whether `khqr_settings.id` became `tenant_id`. Nothing references
-- these tables, so each is rebuilt alone: copied with the tenant, dropped, renamed.
-- 
-- 1. Every existing row belongs to NUK Cafe (0024's tenant, else the oldest); a database with rows
--    here and no tenant gets it, as 0024 would have made it.
INSERT INTO `organization` (`id`, `name`, `slug`, `created_at`, `status`, `version`)
SELECT '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd', 'NUK Cafe', 'nuk', cast(unixepoch('subsecond') * 1000 as integer), 'active', 1
WHERE NOT EXISTS (SELECT 1 FROM `organization`)
  AND (EXISTS (SELECT 1 FROM `customer_profiles`) OR EXISTS (SELECT 1 FROM `khqr_settings`) OR EXISTS (SELECT 1 FROM `exchange_rates`));
--> statement-breakpoint
-- 2. A profile per account and tenant; member codes unique within a tenant.
CREATE TABLE `__new_customer_profiles` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`member_code` text NOT NULL,
	`phone` text,
	`marketing_opt_in` integer DEFAULT false NOT NULL,
	`anonymized_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_customer_profiles`("tenant_id", "user_id", "member_code", "phone", "marketing_opt_in", "anonymized_at", "created_at") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "user_id", "member_code", "phone", "marketing_opt_in", "anonymized_at", "created_at" FROM `customer_profiles`;
--> statement-breakpoint
-- 3. One KHQR settings row per tenant (the single `default` row before).
CREATE TABLE `__new_khqr_settings` (
	`tenant_id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`account_id` text NOT NULL,
	`merchant_name` text NOT NULL,
	`merchant_city` text NOT NULL,
	`currencies` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "khqr_settings_check" CHECK("__new_khqr_settings"."currencies" in ('USD', 'KHR', 'USD,KHR'))
);
--> statement-breakpoint
INSERT INTO `__new_khqr_settings`("tenant_id", "enabled", "account_id", "merchant_name", "merchant_city", "currencies", "version", "updated_by", "updated_at") SELECT coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "enabled", "account_id", "merchant_name", "merchant_city", "currencies", "version", "updated_by", "updated_at" FROM `khqr_settings`;
--> statement-breakpoint
-- 4. Each tenant's riel rates.
CREATE TABLE `__new_exchange_rates` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`currency` text DEFAULT 'KHR' NOT NULL,
	`per_usd` integer NOT NULL,
	`effective_from` integer NOT NULL,
	`set_by` text NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`set_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "exchange_rates_check" CHECK("__new_exchange_rates"."currency" = 'KHR' and "__new_exchange_rates"."per_usd" between 1000 and 10000)
);
--> statement-breakpoint
INSERT INTO `__new_exchange_rates`("id", "tenant_id", "currency", "per_usd", "effective_from", "set_by") SELECT "id", coalesce((SELECT `id` FROM `organization` WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd'), (SELECT `id` FROM `organization` ORDER BY `created_at`, `id` LIMIT 1)), "currency", "per_usd", "effective_from", "set_by" FROM `exchange_rates`;
--> statement-breakpoint
-- 5. The old tables go and the new ones take their names, with their indexes.
DROP TABLE `customer_profiles`;
--> statement-breakpoint
DROP TABLE `khqr_settings`;
--> statement-breakpoint
DROP TABLE `exchange_rates`;
--> statement-breakpoint
ALTER TABLE `__new_customer_profiles` RENAME TO `customer_profiles`;
--> statement-breakpoint
ALTER TABLE `__new_khqr_settings` RENAME TO `khqr_settings`;
--> statement-breakpoint
ALTER TABLE `__new_exchange_rates` RENAME TO `exchange_rates`;
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_profiles_member_code_idx` ON `customer_profiles` (`tenant_id`,`member_code`);
--> statement-breakpoint
CREATE INDEX `exchange_rates_effective_idx` ON `exchange_rates` (`tenant_id`,`currency`,`effective_from`);
