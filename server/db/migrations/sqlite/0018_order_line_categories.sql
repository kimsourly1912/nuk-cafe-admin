ALTER TABLE `order_lines` ADD `category_id` text;--> statement-breakpoint
ALTER TABLE `order_lines` ADD `category_name` text;--> statement-breakpoint
CREATE INDEX `order_lines_item_idx` ON `order_lines` (`item_id`);--> statement-breakpoint
CREATE INDEX `counter_payments_returned_idx` ON `counter_payments` (`branch_id`,`returned_at`);--> statement-breakpoint
-- Lines placed before this migration (staging test orders only; nothing is in production) take
-- their item's category now. A line whose item is gone keeps null (8.1, D110).
UPDATE `order_lines` SET `category_id` = (SELECT `category_id` FROM `menu_items` WHERE `menu_items`.`id` = `order_lines`.`item_id`), `category_name` = (SELECT `menu_categories`.`name` FROM `menu_items` JOIN `menu_categories` ON `menu_categories`.`id` = `menu_items`.`category_id` WHERE `menu_items`.`id` = `order_lines`.`item_id`);
