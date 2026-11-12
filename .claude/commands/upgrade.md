---
description: Upgrade dependencies from start to PR in ONE session. Each phase runs on the right model through subagents; stops only for hard stops (D277). No arguments resumes the current run.
argument-hint: "<packages, e.g. nuxt@latest @nuxt/ui@latest> (empty: resume)"
model: sonnet
effort: medium
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git push -u origin HEAD) Bash(git checkout -b chore/upgrade-*) Bash(git rm -r upgrade/) Bash(git restore *) Bash(gh pr create *) Bash(gh run rerun *) Bash(scripts/upgrade-verify.sh *) Bash(scripts/upgrade-smoke.sh *) Bash(pnpm install --frozen-lockfile) Bash(pnpm view *) Bash(pnpm build:staging) Bash(pnpm exec wrangler deploy --dry-run *) Bash(pnpm exec wrangler check startup *) Bash(mkdir *) Bash(cp *) Bash(diff *) Edit(./upgrade/**) Write(./upgrade/**) Write(./node_modules/.cache/upgrade/**) Write(./docs/upgrades/**) Edit(./.claude/upgrade/profile.md)
---

Run a dependency upgrade for `$ARGUMENTS` from start to an open PR, in this one session.

Read first: `.claude/upgrade/RULES.md` and `.claude/upgrade/profile.md`. Follow RULES
exactly: no questions, no `/model`, hard stops only. Do not narrate progress; the owner
reads `upgrade/HANDOFF.md` and the final report. You are the orchestrator: you never read
source code or whole logs, only `HANDOFF.md`, `SUMMARY.md` files and the agents' reports.

After each phase: update `HANDOFF.md` (`Current phase`, `Next`), commit
`chore(upgrade): <phase>` with the run files, and `git push -u origin HEAD`.

## Start or resume

- `$ARGUMENTS` empty and `upgrade/HANDOFF.md` exists: resume. Check you are on the run's
  branch, `git status --porcelain` is empty and the branch matches `origin`; then continue
  from `Current phase`. A step left `in-progress` is restarted: `git restore` its files first.
- `$ARGUMENTS` empty and no `HANDOFF.md`: stop report: "no active run; give the packages".
- `$ARGUMENTS` given and an unfinished `HANDOFF.md` exists: stop report: "a run is active".

## Phase 0 — setup and baseline (you)

1. **Name:** short kebab-case from the targets (`nuxt-ui-4-10`, `nuxt-5`).
2. **Git:** `git status --porcelain` must be empty. On `main`: `git checkout -b chore/upgrade-<name>`.
   On a `chore/upgrade-*` branch: keep it. Anything else: stop report.
3. `node_modules` missing → `pnpm install --frozen-lockfile`.
4. **State:** copy `.claude/upgrade/HANDOFF.template.md` to `upgrade/HANDOFF.md`, fill it in.
   Make sure `upgrade/logs/` is in `.gitignore`.
5. **Versions:** for the targets and the profile's "Key packages": current installed version,
   `pnpm view <pkg> version`, `pnpm view <pkg> peerDependencies --json`. For every installed
   module that depends on a target, check that its latest peer range accepts the target.
6. **Baseline**, in this order (`build:staging` replaces the verify build in `.output`):
   1. `scripts/upgrade-verify.sh baseline`
   2. `pnpm build:staging`, then `cp .output/server/wrangler.json upgrade/logs/baseline/wrangler.json`
   3. `scripts/upgrade-smoke.sh baseline` (the staging Worker under local `wrangler dev`)
   4. `pnpm exec wrangler deploy --dry-run --outdir /tmp/worker-dry --config .output/server/wrangler.json > upgrade/logs/baseline/dry-run.log 2>&1`
   5. `pnpm exec wrangler check startup --config .output/server/wrangler.json --outfile /tmp/startup-baseline.cpuprofile > upgrade/logs/baseline/startup.log 2>&1`

   Fill `HANDOFF.md → Baseline` from `SUMMARY.md`, `smoke.md`, the `Total Upload` line of
   `dry-run.log` and the startup time.

## Phase 1 — inventory (Haiku scanners)

Pick the profile's "Scan areas" relevant to the targets (area A always; a target no area
covers gets a focused area: every import from it and all its config). Launch one
`upgrade-scanner` per area **in one message**, with the area text, the "Folders to skip"
list and the instruction to use its standard output. Merge into `upgrade/inventory.md`
(factual, under ~400 lines, one section per area, `UNSURE` at the end). Check a conflicting
spot yourself with one Grep; never re-scan everything.

## Phase 2 — breaking changes

Call `upgrade-researcher`. It writes `upgrade/breaking-changes.md`.

## Phase 3 — audit and plan

Call `upgrade-planner` (mode A). `STOP` → stop report. Otherwise it wrote `upgrade/plan.md`
and its decisions are in `HANDOFF.md`.

## Phase 4 — execute, step by step

For each step with `status: todo`, in order:

1. Set `status: in-progress` in `plan.md`.
2. Route:
   - `executor: bulk-editor` → `bulk-editor` with the step id, exact `from → to`, scope and
     verify command; if it skipped locations, `upgrade-executor` for those only
   - `risk: high` → `upgrade-executor-deep`
   - otherwise → `upgrade-executor`
3. Result:
   - `DONE` → step 4.
   - `STOP` → `git restore` the step's files, write `HANDOFF.md → Blocked`, stop report.
   - `FAILED` → `upgrade-debugger` (step id, goal, failing command, log path, the attempts),
     then `upgrade-executor-deep` with the diagnosis. `FAILED` again → `git restore` the
     step's files, `upgrade-planner` mode B, then run the re-planned step(s) once on
     `upgrade-executor-deep`. Still `FAILED` → `HANDOFF.md → Blocked`, stop report (rule 6).
4. Set `status: done`, add 1–2 lines to `HANDOFF.md → Done`, the executor's `decided by
   Claude` lines to `Decisions`, and its test checklist to `Manual tests to do`.
5. Commit `upgrade(<id>): <step title>` (include `plan.md` and `HANDOFF.md`) and push.

## Phase 5 — release checks (you)

Results go in `upgrade/logs/release/` (verify creates it; the rest add to it):

1. `scripts/upgrade-verify.sh release --e2e`
2. `pnpm build:staging`, then `diff upgrade/logs/baseline/wrangler.json .output/server/wrangler.json > upgrade/logs/release/wrangler.diff`
   (an empty file means no change)
3. `scripts/upgrade-smoke.sh release`
4. `pnpm exec wrangler deploy --dry-run --outdir /tmp/worker-dry --config .output/server/wrangler.json > upgrade/logs/release/dry-run.log 2>&1`
5. `pnpm exec wrangler check startup --config .output/server/wrangler.json --outfile /tmp/startup-release.cpuprofile > upgrade/logs/release/startup.log 2>&1`

Append one table to `upgrade/logs/release/SUMMARY.md`: each check, PASS/FAIL, compared with
the baseline, and the `Total Upload` and startup time before → after.

A **new** failure compared with the baseline: add a step `F<n>` to `plan.md` (the failing
check, its log path, `risk: high`) and run it through Phase 4 on `upgrade-executor-deep`.
Then rerun the release checks. At most two `F` steps per run; still failing → stop report.

## Phase 6 — review

Call `upgrade-reviewer`. A finding with `stop` → stop report. R steps → run them through
Phase 4 (all on `upgrade-executor-deep`), rerun the release checks once, then call
`upgrade-reviewer` again for a re-review. A Critical still open → stop report (rule 7).

## Phase 7 — finish (you)

1. Write `docs/upgrades/<YYYY-MM-DD>-<name>.md`, at most ~60 lines: versions before → after,
   breaking changes that affected the app (IDs, one line each), decisions (mark the ones
   `decided by Claude`), release-check numbers, surprises and lessons, anything left for later.
2. **Profile lessons:** you may *add* to `.claude/upgrade/profile.md` (a scan area, a source,
   a high-risk item, a smoke step); never remove or weaken anything. Commit it separately:
   `chore(upgrade): profile lessons from <name>`.
3. Write the PR body to `node_modules/.cache/upgrade/pr-body.md`: versions table, affected
   breaking changes, the `decided by Claude` list, release checks before → after, and the
   test checklist from `HANDOFF.md → Manual tests to do`. When a target touches profile
   high-risk area 1 (for example `better-auth`), start the body with
   **"Test sign-in, sign-out and session expiry on staging before production."**
4. `git rm -r upgrade/`, commit `chore(upgrade): finish <name>`, push.
5. `gh pr create --base main --head chore/upgrade-<name> --title "Upgrade <targets>" --body-file node_modules/.cache/upgrade/pr-body.md`. Never merge.

## Phase 8 — CI

Follow `.claude/commands/fix-ci.md` steps 2–9 for this PR, with its limits and stops.

## Reports

Success:

```text
✅ Upgrade ready — PR #<n> <url>
versions: <pkg a → b, ...>
steps: <n> done | decided by Claude: <n> | CI: green
owner: <the bold line from the PR body, or "nothing; merge when you're ready">
```

Stop: the only time the owner acts.

```text
⛔ /upgrade stopped — <run name> (branch chore/upgrade-<name>, pushed)
phase: <n> | step: <id or ->
why: <hard stop rule n / pre-check / limit> — <one sentence>
prepared: <the proposed change, or the file where it is written>
next: <the one action the owner should take; then run /upgrade to resume>
```
