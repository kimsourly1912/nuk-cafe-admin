# Upgrade rules

`/upgrade` and every `upgrade-*` agent read this file first. These rules apply to every
dependency upgrade in this repo (D277).

## Scope
- Do only what the current phase or plan step says. Unrelated refactors,
  new features, and style changes are out of scope.
- The project-specific details are in `.claude/upgrade/profile.md`.
  The current run's state is in `upgrade/HANDOFF.md`.

## Running without the owner
- The run goes from start to PR without asking the owner. It stops only for a hard stop
  (below). Never ask a question mid-run; decide, record, continue.
- **Technical decisions** (order of steps, which official migration to follow, how to adapt
  a call to a new API) are decided by the agent that meets them and recorded in
  `HANDOFF.md → Decisions` as `decided by Claude: <choice> — <reason> — <source>`.
- **Business or authorization policy** is never decided by an agent (AGENTS.md). It is a
  hard stop.

## Hard stops: prepare, do not apply
Stop the run, write the reason and the prepared change in `HANDOFF.md → Blocked`, commit and
push the state, and report. Never work around a stop.

1. **A guard changes.** A step would add, remove or change a permission check, a tenant
   filter, a version / `expectedRevision` / 409 check, an idempotency key, a guard or audit
   row inside a `db.batch`, or a session, cookie, CSRF or origin check
   (`.claude/ci-fix/RULES.md` → Hard stops, rule 1). A mechanical API rename inside such
   code (same behavior, new name) is not a guard change; it runs on `upgrade-executor-deep`.
2. **Auth configuration changes behavior:** `server/auth.config.ts` options, Better Auth
   plugins, cookie or session options. Renames with the same behavior follow rule 1.
3. **A new database migration** is needed, or a migration or `server/db/**` schema changes.
4. **An open question is business or authorization policy.**
5. **A module does not support the target** and the only ways on are pinning, forking or a
   new patch. Re-creating the documented `@nuxt/ui` patch (profile, area B) is not a stop.
6. **Still blocked** after the executor's two attempts, `upgrade-debugger`, `upgrade-executor-deep`
   and one re-plan by `upgrade-planner`.
7. **Critical review findings remain** after one round of R fixes and one re-review.

## Git
- Work only on the upgrade branch (`chore/upgrade-<name>`), never on `main`.
- One plan step = one commit: `upgrade(<step-id>): <title>`.
  Phase outputs: `chore(upgrade): <what>`. Only the `/upgrade` main session commits.
- After each commit, push the upgrade branch only: `git push -u origin HEAD`.
- At the end, open the PR with `gh pr create`. Never merge it.
- Never push to `main`, never `--force`, never merge, rebase, reset, amend
  earlier commits, stash, deploy, or apply a migration to a remote database.

## Verification
- Verify with `scripts/upgrade-verify.sh <label>` and compare with
  `upgrade/logs/baseline/SUMMARY.md`. A failure that already existed in the
  baseline with the same errors is acceptable; any new failure is not.
- Read `SUMMARY.md` and only the failing lines of a log. Never paste whole logs.

## Truth sources
- Official migration guides, release notes, CHANGELOGs, and the installed code
  in `node_modules/<pkg>` are the source of truth. Not model memory.
- Every claimed breaking change needs a source link. Unknown means `unknown`, not a guess.
  An `unknown` is settled with the profile's `npm pack` diff before it is planned around.

## Quality
- Never use `@ts-ignore`, `any`, `eslint-disable`, skipped or deleted tests,
  pinning to an old version, or weaker auth/authorization/data scoping to make
  checks pass. If no clean fix exists, the step is `blocked`.
- Changes in the profile's high-risk areas are `risk: high`. They run on
  `upgrade-executor-deep`, and are listed in the PR's test checklist.

## Models
The `/upgrade` command runs on Sonnet in one session, from start to end. Every phase that
needs judgment or a lot of reading runs in a subagent with its own model and a fresh context.
The main session reads only `HANDOFF.md`, `SUMMARY.md` files and the agents' short reports.
Never use `/model` during a run.

| Work | Agent | Model / effort |
|---|---|---|
| Inventory search | `upgrade-scanner` (several in parallel) | Haiku / medium |
| Breaking changes | `upgrade-researcher` | Sonnet / high |
| Audit + plan, re-plan | `upgrade-planner` | Opus / high |
| `executor: bulk-editor` steps | `bulk-editor` | Haiku / low |
| `risk: low` and `medium` steps | `upgrade-executor` | Sonnet / medium |
| `risk: high` steps, escalations | `upgrade-executor-deep` | Opus / high |
| Diagnosis after two failed attempts | `upgrade-debugger` | Opus / high |
| Final review | `upgrade-reviewer` | Opus / high |
