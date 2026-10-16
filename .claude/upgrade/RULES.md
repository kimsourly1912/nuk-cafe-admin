# Upgrade rules

Every `/upgrade-*` command reads this file first. These rules apply to every
dependency upgrade in this repo.

## Scope
- Do only what the current phase or plan step says. Unrelated refactors,
  new features, and style changes are out of scope.
- The project-specific details are in `.claude/upgrade/profile.md`.
  The current run's state is in `upgrade/HANDOFF.md`.

## Git
- Work only on the upgrade branch (`chore/upgrade-<name>`), never on `main`.
- One plan step = one commit: `upgrade(<step-id>): <title>`.
  Phase outputs: `chore(upgrade): <what>`.
- After each commit, push the upgrade branch only: `git push -u origin HEAD`.
  The next session (cloud or local) starts from the pushed branch.
- Never push to `main`, never `--force`, never merge, rebase, reset, amend
  earlier commits, stash, or deploy. The user opens and merges the PR.

## Verification
- Verify with `scripts/upgrade-verify.sh <label>` and compare with
  `upgrade/logs/baseline/SUMMARY.md`. A failure that already existed in the
  baseline with the same errors is acceptable; any new failure is not.
- Read `SUMMARY.md` and only the failing lines of a log. Never paste whole logs.

## Truth sources
- Official migration guides, release notes, CHANGELOGs, and the installed code
  in `node_modules/<pkg>` are the source of truth. Not model memory.
- Every claimed breaking change needs a source link. Unknown means `unknown`, not a guess.

## Quality
- Never use `@ts-ignore`, `any`, `eslint-disable`, skipped or deleted tests,
  pinning to an old version, or weaker auth/authorization/data scoping to make
  checks pass. If no clean fix exists, mark the step `blocked` and explain.
- Changes in the profile's high-risk areas are `risk: high` and must be listed
  for manual testing in `HANDOFF.md`.

## Models and subagents
- Do not switch the session model with `/model` in the middle of a session.
  If the next phase needs a different model, update `HANDOFF.md` and tell the
  user to start a new session.
- Subagents: `upgrade-scanner` (Haiku, read-only search), `bulk-editor`
  (Haiku, one exact mechanical edit), `upgrade-debugger` (Opus, read-only
  diagnosis after two failed fix attempts).
