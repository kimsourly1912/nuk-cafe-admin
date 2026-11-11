-- Shop designer step 3b (D273): a custom look's photo, an upload of the cafe's (the media feature
-- attaches and releases it). Nullable: the Worker before this release still reads and writes looks.
ALTER TABLE `custom_furniture_looks` ADD `photo_asset_id` text;