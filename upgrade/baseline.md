# Baseline — nuxt-ui-latest

Comparison source for every upgrade step (replaces the single run in `upgrade/logs/baseline/SUMMARY.md`).
Taken on commit `82a8e84` (no dependency change), Windows 11, Node 24.17.0, pnpm.
Command: `scripts/upgrade-verify.sh <label> --e2e` (unit mode every step; e2e = one worker, 4 GB heap, as CI/D147).
Logs are git-ignored (`upgrade/logs/baseline-r1`, `baseline-r2`).

## Run summaries

| Check | r1 | r2 |
|---|---|---|
| typecheck | PASS 69s | PASS 86s |
| lint | PASS 63s | PASS 71s |
| test:unit | FAIL, 1 test (1466 passed) | FAIL, 1 test + 1 worker crash (1466 passed) |
| build | PASS 187s | PASS 235s |
| e2e | PASS 46 files / 566 tests, 1231s | FAIL 1 test (565 passed), 1297s |

A first r2 attempt (`baseline-r2-invalid`) is discarded: the e2e build could not open `.data/e2e/db/sqlite.db` (error 14) and `server/tests/health.test.ts > detects overdue outbox work…` timed out. Both did not reappear in the rerun, so they are environment flakes.

The old full-suite baseline failure (459 e2e tests, "heap out of memory") came from running e2e in parallel. Serial e2e is green, so e2e is a usable gate.

## Stable failures (both runs)

- `server/tests/routes.test.ts > cafe routes (D140) > routes outside a cafe's address never act in one` — Q4, see below.

## Flaky (one run only)

| Test / event | r1 | r2 | Note |
|---|---|---|---|
| `test/e2e/modifier-groups.test.ts > new add-on group > clears an error as soon as it's fixed… (D166)` | pass | FAIL | `locator.waitFor` 5 s timeout for "less than the minimum" (line 274). Rerun on its own before treating it as new. |
| Worker crash exit 3221225477 (Windows access violation) | none | `server/features/menu/tests/categories.service.test.ts` | Unhandled error; all tests still counted passed. |
| Same crash, other runs | — | — | `promotions.service.test.ts` (original baseline) and `server/features/orders/tests/reports.service.test.ts` (S0 verify; passes alone, 19 tests). A different file each time ⇒ flaky, native crash in the Windows worker, not tied to one test. |
| `server/tests/health.test.ts > detects overdue outbox work…` | pass | pass (failed once in the discarded attempt) | timeout under load. |

Rule: a worker crash in a different menu test file, or the modifier-groups timeout, is not a new failure if the file passes when run alone (`pnpm exec vitest run --project <p> <file>`).

## Q4 — routes test (known, explained, must not get worse)

`server/tests/routes.test.ts:54` builds the route list with `path.join` (Windows `\` separators) and compares it with a hard-coded list using `/`. The seven route files are the same on both sides; only the separators differ: `cafes\[slug].get.ts`, `me\cafes.get.ts`, `tables\[token].get.ts`, `webhooks\telegram.post.ts` versus `cafes/[slug].get.ts`, etc. So no route is missing or extra; it is a test portability issue on Windows, not a tenant-isolation break (the second assertion, that none of these files call tenant helpers, is not reached here). Not fixed (Q4). Rule: the diff must stay exactly these separator differences; any added or missing file name is a new failure.
