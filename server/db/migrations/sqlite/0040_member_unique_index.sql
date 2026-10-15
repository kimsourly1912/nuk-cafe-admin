-- A person has one membership per cafe (D134). Better Auth's `member` table has no such constraint,
-- and the staff list and counts join it, so a second row would list the person twice.
-- Expand-only for the Worker: staff writes already delete and insert a person's row in one batch,
-- and the cafe's creator is a new cafe's only member, so the previous Worker keeps working.
--
-- Step 1: keep one row per (cafe, person) if any pair has several: the owner row first (never
-- remove the only owner), then the oldest, then the lowest id. Expected to delete nothing: no
-- supported write creates a duplicate. Check first: select organization_id, user_id, count(*)
-- from member group by 1, 2 having count(*) > 1.
DELETE FROM `member` WHERE `id` IN (
  SELECT `id` FROM (
    SELECT `id`, row_number() OVER (
      PARTITION BY `organization_id`, `user_id`
      ORDER BY (`role` = 'owner') DESC, `created_at`, `id`
    ) AS `position`
    FROM `member`
  ) WHERE `position` > 1
);--> statement-breakpoint
-- Step 2: the database refuses a second one from now on. Its first column also serves lookups by
-- cafe, so `member_organizationId_idx` is now redundant; it stays until a later release (contract).
CREATE UNIQUE INDEX `member_organization_user_unique` ON `member` (`organization_id`,`user_id`);
