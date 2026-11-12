---
description: Fix a failed PR's CI from start to end. Triage picks the model, a fixer fixes, a separate reviewer approves, then commit, push to the PR branch and watch CI. Stops only for critical cases (D276).
argument-hint: "[PR number] (default: the PR of the current branch)"
model: sonnet
effort: medium
allowed-tools: Bash(git add *) Bash(git commit *) Bash(git push origin HEAD:*) Bash(git restore *) Bash(git clean -f -- *) Bash(gh run rerun *) Bash(mkdir *) Edit(./node_modules/.cache/ci-fix/**) Write(./node_modules/.cache/ci-fix/**)
---

Fix the failed CI of PR `$ARGUMENTS` (empty: the PR of the current branch) without asking the
owner, except for the stops below. Read `.claude/ci-fix/RULES.md` first.

The owner wants **no questions and no progress narration**. Print one report at the end:
the success report, or a stop report. Never ask for confirmation mid-run.

## Limits

- At most **2 fix attempts** per `/fix-ci` run. An attempt is one fixer call. A rerun of a
  `flaky` job is not an attempt, and each failure is rerun at most once.
- Push only with `git push origin HEAD:<headRefName>`. Never `--force`, `-f`,
  `--force-with-lease`, a `+` refspec, `main`, or any other branch.
- Never merge, deploy, migrate, edit `.github/**`, or change dependencies.

## 1. Pre-checks: stop report on any failure

1. `gh auth status` succeeds.
2. `gh pr view $ARGUMENTS --json number,url,state,headRefName,baseRefName,isCrossRepository`:
   the PR is `OPEN`, not cross-repository, and `headRefName` is the current branch
   (`git branch --show-current`), which is not `main`.
3. `git status --porcelain` is empty. Otherwise stop: the owner commits or stashes first.
4. `git fetch origin <baseRefName> <headRefName>`, then `git rev-parse HEAD` equals
   `git rev-parse origin/<headRefName>`. Otherwise stop: pull or push first.
5. `node_modules` exists.

## 2. Find the run

`gh run list --branch <headRefName> --workflow ci.yml --limit 10 --json databaseId,headSha,status,conclusion`

Take the newest run whose `headSha` is `HEAD`.

- None → stop: no CI run for this commit.
- In progress → `gh run watch <id> --exit-status --interval 30`, then continue.
- Succeeded → print `CI is already green for PR #<n>.` and end.

## 3. Save the evidence

`D = node_modules/.cache/ci-fix/<runId>/attempt-<n>` (`mkdir -p`).

- `gh run view <id> --json jobs > D/jobs.json`
- `gh run view <id> --log-failed > D/failed-log.txt`
- If an `e2e` job failed: `gh run download <id> --pattern "e2e-failures-*" --dir D/e2e-failures`
- From attempt 2 or after a rerun: write `D/previous.json` with the earlier label, what was
  changed (or `rerun`), and the result.

## 4. Triage

Call the `ci-triage` agent with the path `D`. It returns JSON. If the JSON is invalid, use
`{ "category": "logic", "confidence": "low" }` with the error lines you can see.

## 5. Route by label

| Label | Action |
|---|---|
| `workflow`, `deploy`, `dependency` | Stop report. `deploy`: a failed staging deploy is fixed before new work (AGENTS.md). `dependency`: an audit or lockfile change goes to `/upgrade`. |
| `flaky` | If not rerun yet: `gh run rerun <id> --failed`, then go to step 9 with that run. Already rerun: treat as `logic`. |
| `mechanical`, confidence `high` | `ci-fixer-fast` |
| `mechanical` with lower confidence, or `logic` | `ci-fixer-deep` |

Give the fixer: the triage JSON, the path `D`, `baseRefName`, and on attempt 2 what was tried
and why it failed or was rejected.

## 6. Fixer result

- `FIXED` → step 7.
- `STOP` → make sure the tree is clean (step "Undo"), save the fixer's proposed diff to
  `D/proposed.diff`, stop report.
- `ESCALATE` or `FAILED` → undo; if an attempt is left, call `ci-fixer-deep` with the
  earlier output. Otherwise stop report.

## 7. Review

Call the `ci-reviewer` agent with the triage JSON, the fixer's output and `baseRefName`.

- `APPROVE` → step 8.
- `REJECT` → `git diff > D/rejected.diff`, undo; if an attempt is left, call
  `ci-fixer-deep` with the findings. Otherwise stop report.
- `STOP` → `git diff > D/proposed.diff`, undo, stop report. The change is prepared, not
  applied.

## 8. Commit and push

1. `git add -- <each file in git status --porcelain>`. Never `git add -A` or `git add .`.
2. `git commit -m "fix(ci): <failed step> — <cause in a few words>" -m "Run <runId>, label <category>, fixed by <agent>."`
3. `git push origin HEAD:<headRefName>`. If it is rejected (the branch moved on GitHub),
   stop report: never pull, rebase or force. The commit stays local for the owner.

## 9. Watch CI

Poll `gh run list --branch <headRefName> --workflow ci.yml --limit 1 --json databaseId,headSha,status`
every 15 s for up to 3 minutes until a run for the new `HEAD` appears (for a rerun, use the
same run id). Then `gh run watch <id> --exit-status --interval 30`.

- Green → success report.
- Red → if an attempt is left, go to step 3 with the new run. Otherwise stop report.

## Undo

Remove the fixer's uncommitted changes. The tree was clean at the start, so everything in
`git status --porcelain` is the fixer's:

- `git restore --staged --worktree -- .`
- For each `??` line: `git clean -f -- <path>`

## Reports

Success (nothing else):

```text
✅ CI green — PR #<n> <url>
fixed: <cause> (label <category>, <agent>)
commits: <short sha> <subject>
```

Stop: this is the only time the owner needs to act.

```text
⛔ /fix-ci stopped — PR #<n> <url>
why: <hard stop / label / attempts used up / pre-check>
failure: <job › step: first error line>
diagnosis: <root cause in one or two sentences, or "not diagnosed">
prepared: <D/proposed.diff | D/rejected.diff | nothing> (not applied)
committed and pushed this run: <short shas, or none>
next: <the one action the owner should take>
```
