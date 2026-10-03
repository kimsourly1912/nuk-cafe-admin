-- D141 follow-up: NUK Cafe's address is `/c/nuk` (the redirects from the old addresses, printed
-- links and the app's default cafe use it). 0024 named the tenant `nuk-cafe` when an old branch
-- organization still held the slug `nuk`, then deleted those organizations, which freed `nuk`.
-- Give NUK Cafe its address back when it has the fallback and nothing else holds `nuk`;
-- anywhere else (a fresh database, `nuk` already right or taken) this changes nothing.
UPDATE `organization` SET `slug` = 'nuk', `version` = `version` + 1
WHERE `id` = '01a0fdb3-d860-7284-bc6b-2f8ab7a1d6cd' AND `slug` = 'nuk-cafe'
  AND NOT EXISTS (SELECT 1 FROM `organization` WHERE `slug` = 'nuk');
