CREATE TABLE `sample_data_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`size` text NOT NULL,
	`started_by` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`locked_until` integer,
	CONSTRAINT "sample_data_runs_size_check" CHECK("sample_data_runs"."size" in ('small', 'standard', 'large'))
);
