ALTER TABLE `assistant_imports` ADD `pdf_review` text;--> statement-breakpoint
ALTER TABLE `assistant_usage` ADD `import_source_id` text;--> statement-breakpoint
ALTER TABLE `assistant_usage` ADD `source_page_number` integer;