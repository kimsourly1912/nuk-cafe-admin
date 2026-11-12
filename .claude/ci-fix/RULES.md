# CI fix rules

`/fix-ci` and every `ci-*` agent read this file first. It decides what an automatic fix may
touch, and when the run must stop for the owner (D276).

## Scope

- Fix only the failures in the triage label. No refactors, no style changes, no new features.
- Read only: the saved log, the files the log names, their direct imports, and the PR's diff
  (`git diff origin/<base>...HEAD`). Do not scan the repository.
- Before editing, classify the change and read the matching row of `AGENTS.md` → "Load
  context for the task" (bounded reads only). Project conventions still apply to a fix.

## Never edit

- `.github/**`, `.claude/**`, `server/db/migrations/**`, `patches/**`
- `pnpm-lock.yaml`, dependency entries in `package.json`, `.env*`
- `node_modules/**`, `.output/**`, `.nuxt/**`, `test-results/**`

## Never run

- `git commit`, `push`, `reset`, `checkout`, `rebase`, `stash`, `merge`, `clean` (agents).
  Only the `/fix-ci` main session commits and pushes, as its steps say.
- `pnpm install`/`add`/`remove`/`update`, or anything that changes dependencies.
- Deploy or migrate commands: `pnpm deploy:*`, `pnpm db:migrate:*`, `wrangler deploy`
  (except `--dry-run`), `wrangler d1 … --remote`, or anything else that reaches Cloudflare.

## Tests

A fix makes the code meet the test, not the test meet the code. Never:

- delete a test, or add `.skip`, `.todo`, `.only`, or a `skipIf`
- loosen an assertion, remove an expectation, or raise a timeout
- add `allowBrowserProblems(...)` or a new `slow` tag to make a test pass
- update a snapshot without saying why the new output is correct

A test may change only when **this PR's own diff** intentionally changed the behavior the test
checks. The fixer then quotes the PR diff line that changed the behavior.

## No suppressions

No `any`, `as unknown as`, a new `!` non-null assertion to silence an error, `@ts-ignore`,
`@ts-expect-error`, `eslint-disable`, or an empty `catch`. Fix the cause.

## Hard stops: prepare, do not apply

When the right fix needs one of these, do **not** edit. Return `STOP` with the reason and the
proposed diff as text. The owner applies it.

1. **A guard changes.** Adding, removing or changing any of: a permission check, a tenant
   filter (`tenant_id` or the tenant in a query), a version / `expectedRevision` / 409 check,
   an idempotency key, a guard or audit row inside a `db.batch`, a session or origin check.
2. **A sensitive path changes:**
   - `server/auth.config.ts`, `server/middleware/**`, `server/db/**`
   - `server/features/identity/**`, `server/features/tenants/**`, `server/features/platform/**`
   - `server/features/orders/**`
   - `server/api/c/[slug]/admin/khqr/**`, `server/api/c/[slug]/admin/staff/**`
3. **Labels that are never auto-fixed:** `deploy`, `dependency`, `workflow`.

Rule 1 applies in every file, not only the paths in rule 2.

## Checks

| Failed step | Local command |
|---|---|
| Lint | `pnpm lint:fix`, then `pnpm lint` |
| Typecheck | `pnpm typecheck` |
| Unit tests | `pnpm test:unit` (one file first: `pnpm test:unit <file>`) |
| E2E tests | `pnpm test:e2e <failing files>` |

After the failing check passes, run `pnpm lint`, `pnpm typecheck` and `pnpm test:unit`.
An e2e run that aborts with exit code 134 needs more heap: rerun it with
`NODE_OPTIONS=--max-old-space-size=4096`. Read only the failing lines of any output.
