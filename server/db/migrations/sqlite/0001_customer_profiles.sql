CREATE TABLE `customer_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`member_code` text NOT NULL,
	`phone` text,
	`marketing_opt_in` integer DEFAULT false NOT NULL,
	`anonymized_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `customer_profiles_member_code_idx` ON `customer_profiles` (`member_code`);