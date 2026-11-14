# Upgrade handoff — <name>

> Single source of truth between sessions for THIS upgrade run.
> Every session reads this first and updates it before it ends.
> Created from `.claude/upgrade/HANDOFF.template.md` by `/upgrade` (phase 0).

Run: <name>
Targets: <e.g. nuxt@latest @nuxt/ui@latest>
Branch: chore/upgrade-<name>
Package manager: <pnpm | bun | npm | yarn>
Started: <date>

Current phase: 0 in progress
Next: <phase> (run /upgrade to resume)

## Versions

| Package | Current | Target | Notes |
|---|---|---|---|

## Baseline (before any change)

| Check | Result | Notes |
|---|---|---|
| typecheck | | |
| lint | | |
| test | | |
| build | | |
| smoke (local build) | | |
| staging build | | |
| Total Upload (dry-run) | | |
| startup time | | |

## Decisions

<!-- Q1: question — decided by Claude: <choice> — <reason> — <source> -->
<!-- Business or authorization policy is never decided here: it is a hard stop (RULES.md). -->

## Done

<!-- S1 (abc1234): short summary -->

## Blocked

<!-- S5: hard stop rule <n> or what fails, what was tried, debugger result, log path, the prepared change -->

## Plan issues

<!-- S6: why the plan looks wrong -->

## Manual tests to do

<!-- from risk: high steps; goes into the PR's test checklist -->
