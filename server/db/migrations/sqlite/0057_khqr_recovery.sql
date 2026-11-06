CREATE TABLE `khqr_review_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`order_id` text NOT NULL,
	`charge_id` text NOT NULL,
	`reason` text NOT NULL,
	`received_currency` text NOT NULL,
	`received_amount` integer NOT NULL,
	`bank_hash` text,
	`bank_reference` text,
	`found_by` text,
	`found_at` integer NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`return_method` text,
	`return_currency` text,
	`return_amount` integer,
	`returned_at` integer,
	`return_reference` text,
	`return_note` text,
	`returned_by` text,
	`return_recorded_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`found_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`returned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`charge_id`) REFERENCES `khqr_charges`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`order_id`) REFERENCES `orders`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`tenant_id`,`branch_id`) REFERENCES `branches`(`tenant_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "khqr_review_cases_check" CHECK("khqr_review_cases"."reason" in ('paid_otherwise', 'order_cancelled', 'amount_mismatch') and "khqr_review_cases"."received_currency" in ('USD', 'KHR') and "khqr_review_cases"."received_amount" > 0 and "khqr_review_cases"."version" >= 1),
	CONSTRAINT "khqr_review_cases_return_check" CHECK(("khqr_review_cases"."status" = 'open' and "khqr_review_cases"."return_method" is null and "khqr_review_cases"."return_currency" is null and "khqr_review_cases"."return_amount" is null and "khqr_review_cases"."returned_at" is null and "khqr_review_cases"."return_note" is null and "khqr_review_cases"."returned_by" is null and "khqr_review_cases"."return_recorded_at" is null and "khqr_review_cases"."return_reference" is null) or ("khqr_review_cases"."status" = 'returned' and "khqr_review_cases"."return_method" in ('cash', 'khqr') and "khqr_review_cases"."return_currency" in ('USD', 'KHR') and "khqr_review_cases"."return_amount" > 0 and "khqr_review_cases"."returned_at" is not null and length("khqr_review_cases"."return_note") > 0 and "khqr_review_cases"."returned_by" is not null and "khqr_review_cases"."return_recorded_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `khqr_review_cases_charge_idx` ON `khqr_review_cases` (`tenant_id`,`charge_id`);--> statement-breakpoint
CREATE INDEX `khqr_review_cases_status_idx` ON `khqr_review_cases` (`tenant_id`,`status`,`found_at`);--> statement-breakpoint
ALTER TABLE `khqr_charges` ADD `recovery_state` text DEFAULT 'open' NOT NULL CHECK (`recovery_state` in ('open', 'done', 'stopped'));--> statement-breakpoint
ALTER TABLE `khqr_charges` ADD `recovery_next_at` integer;--> statement-breakpoint
ALTER TABLE `khqr_charges` ADD `recovery_attempts` integer DEFAULT 0 NOT NULL CHECK (`recovery_attempts` >= 0);--> statement-breakpoint
ALTER TABLE `khqr_charges` ADD `recovery_claim_token` text;--> statement-breakpoint
ALTER TABLE `khqr_charges` ADD `recovery_problem` text;--> statement-breakpoint
ALTER TABLE `khqr_charges` ADD `recovery_checked_at` integer;--> statement-breakpoint
CREATE INDEX `khqr_charges_recovery_idx` ON `khqr_charges` (`recovery_next_at`) WHERE "khqr_charges"."recovery_state" = 'open';--> statement-breakpoint
CREATE INDEX `khqr_charges_tenant_recovery_idx` ON `khqr_charges` (`tenant_id`,`recovery_state`,`expires_at`);--> statement-breakpoint
UPDATE `khqr_charges` SET `recovery_state` = 'done' WHERE EXISTS (SELECT 1 FROM `counter_payments` WHERE `counter_payments`.`tenant_id` = `khqr_charges`.`tenant_id` AND `counter_payments`.`khqr_charge_id` = `khqr_charges`.`id`);--> statement-breakpoint
UPDATE `khqr_charges` SET `recovery_state` = 'stopped' WHERE `recovery_state` = 'open' AND `expires_at` <= cast(unixepoch('subsecond') * 1000 as integer) - 86400000;
