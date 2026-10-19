CREATE TABLE `job_runs` (
	`job` text PRIMARY KEY NOT NULL,
	`last_run_at` integer NOT NULL,
	`last_success_at` integer,
	`last_failure_at` integer,
	`failures_in_a_row` integer DEFAULT 0 NOT NULL
);
