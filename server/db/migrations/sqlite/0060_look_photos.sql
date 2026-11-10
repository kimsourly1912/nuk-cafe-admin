-- Shop designer step 3b (D273): a custom table look's optional photo, a media_assets id of the same
-- cafe (attached while the look uses it), like a menu item's image. Existing looks have none.
ALTER TABLE `custom_furniture_looks` ADD `photo_asset_id` text;