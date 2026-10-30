-- One membership per person and cafe (D134, D235). Better Auth generates `member` and can't declare
-- a two-column unique index, so this one is written by hand and kept out of the snapshot (drizzle-kit
-- would otherwise generate a DROP for it). Expand only: every write replaces a person's row by
-- delete then insert in one batch (`staff.repository.ts`), so the old Worker keeps working.
-- Deletes nothing: if a duplicate exists, this fails and the deploy stops before the new Worker.
-- Check first: select organization_id, user_id, count(*) from member group by 1, 2 having count(*) > 1;
CREATE UNIQUE INDEX `member_organization_user_unique` ON `member` (`organization_id`,`user_id`);
