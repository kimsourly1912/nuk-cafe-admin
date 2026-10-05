CREATE TABLE `assistant_import_objects` (
	`object_key` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`delete_requested` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `assistant_import_objects_expiry_idx` ON `assistant_import_objects` (`expires_at`);--> statement-breakpoint
CREATE TABLE `assistant_imports` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`state` text DEFAULT 'uploading' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "assistant_imports_type_check" CHECK("assistant_imports"."mime_type" in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
	CONSTRAINT "assistant_imports_size_check" CHECK("assistant_imports"."byte_size" > 0 and "assistant_imports"."byte_size" <= 5242880),
	CONSTRAINT "assistant_imports_state_check" CHECK("assistant_imports"."state" in ('uploading', 'uploaded')),
	CONSTRAINT "assistant_imports_version_check" CHECK("assistant_imports"."version" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `assistant_imports_objectKey_unique` ON `assistant_imports` (`object_key`);--> statement-breakpoint
CREATE INDEX `assistant_imports_owner_idx` ON `assistant_imports` (`tenant_id`,`user_id`,`expires_at`);