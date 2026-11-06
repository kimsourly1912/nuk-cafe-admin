CREATE INDEX `orders_tenant_customer_status_due_idx` ON `orders` (`tenant_id`,`customer_id`,`status`,`payment_due_at`);
--> statement-breakpoint
PRAGMA optimize;
