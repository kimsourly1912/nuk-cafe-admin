-- When a person last opened a cafe's admin or counter (D248). A new table: expand only.
CREATE TABLE `workspace_visits` (
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`last_active_at` integer NOT NULL,
	PRIMARY KEY(`tenant_id`, `user_id`),
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
