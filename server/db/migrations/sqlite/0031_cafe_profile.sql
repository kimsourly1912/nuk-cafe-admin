-- Step T2b (D143): a cafe's logo, an upload in its media (no foreign key: Better Auth's fields
-- can't reference our tables, D134).
ALTER TABLE `organization` ADD `logo_asset_id` text;
