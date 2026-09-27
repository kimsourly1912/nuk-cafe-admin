CREATE TABLE `branch_item_states` (
	`branch_id` text NOT NULL,
	`variation_id` text NOT NULL,
	`sold_out` integer DEFAULT false NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	PRIMARY KEY(`branch_id`, `variation_id`),
	FOREIGN KEY (`branch_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`variation_id`) REFERENCES `menu_item_variations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `branch_item_states_variation_idx` ON `branch_item_states` (`variation_id`);