---
description: Upgrade Phase 4 — implement plan steps one by one, verify, commit, push (Sonnet session)
argument-hint: "<step range, e.g. S1-S3, S5, or R1-R2>"
---

Run **Phase 4 (execute)** for steps: `$ARGUMENTS`.

Read first: `.claude/upgrade/RULES.md`, `upgrade/HANDOFF.md`, `upgrade/plan.md`,
and the `breaking-changes.md` items listed in each step's `covers`.
If the range starts with `R`, also read `upgrade/review.md`.

## Pre-checks (stop if any fails)

- On the upgrade branch, not `main`. Working tree clean.
- No `Decisions` item in `HANDOFF.md` is still `pending`.
- Each step in the range is `todo` or `in-progress`, and all earlier steps are `done`.
- `node_modules` exists; if not (fresh cloud VM), install with the frozen lockfile.

## Loop — for each step, in order

1. Set the step `status: in-progress` in `plan.md`.
2. **Implement exactly the step**, nothing outside its `files` and `change`.
   - `executor: codemod` → run the official codemod, then review its diff.
   - `executor: bulk-editor` → call the `bulk-editor` subagent with step id,
     exact `from → to`, scope, and verify command. Then fix only the locations
     it **skipped**, yourself.
   - `executor: sonnet` → make the change yourself.
   - Dependency bumps: project package manager, exact versions from the plan,
     then install. Never edit the lockfile by hand.
3. **Verify**: `scripts/upgrade-verify.sh <step-id>`, compare with the baseline (see RULES).
4. **If verify shows a new failure:**
   - Attempts 1 and 2: fix it yourself, inside the step's scope.
   - Still failing → call the `upgrade-debugger` subagent with: step id, goal,
     failing command, log path, both attempts and why they failed. Apply its
     minimal fix if it stays inside the step's scope.
   - Still failing, or the fix needs a plan change → `status: blocked`, write
     the details in `HANDOFF.md → Blocked`, **stop the loop**, tell me.
5. **Done:** set `status: done` (with short hash after commit), add 1–2 lines
   to `HANDOFF.md → Done`, add manual tests for `risk: high` steps to
   `HANDOFF.md → Manual tests to do`.
   Commit `upgrade(<id>): <step title>` (include plan.md and HANDOFF.md), then push.

## Rules

- Plan seems wrong (impossible step, wrong order, missing change)? Do not
  improvise. Write it in `HANDOFF.md → Plan issues` and stop. The plan is fixed
  in a new Opus session.
- Getting long? Finish the current step, update `HANDOFF.md`, and tell me to
  start a new session with the next range.

## Report to me (short)

- steps done (with hashes), blocked steps, new manual-test items
- the exact next command, e.g. `/upgrade-4-execute S4-S6` in a new Sonnet session,
  or `/upgrade-5-review` in a new Opus session when all steps are done
