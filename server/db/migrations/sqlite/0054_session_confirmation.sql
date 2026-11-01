-- A session's password confirmation before a dangerous action, and the wrong passwords since (D246). Expand only.
ALTER TABLE `session` ADD `confirmed_at` integer;--> statement-breakpoint
ALTER TABLE `session` ADD `confirm_failures` integer DEFAULT 0;