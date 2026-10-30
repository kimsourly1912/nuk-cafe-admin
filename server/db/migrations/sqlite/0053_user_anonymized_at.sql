-- When the daily cleanup emptied an idle guest (D229, D236); account erasure will set it too. Expand only.
ALTER TABLE `user` ADD `anonymized_at` integer;