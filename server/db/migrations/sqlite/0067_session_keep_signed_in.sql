-- Keep me signed in (D286): an owner's workspace session lasts 30 days from sign-in instead of one. Expand only.
ALTER TABLE `session` ADD `keep_signed_in` integer DEFAULT false;
