---
description: Upgrade Phase 0 — start a new upgrade run, record versions, run baseline verify
argument-hint: "<packages, e.g. nuxt@latest @nuxt/ui@latest>"
---

Start **Phase 0** of a dependency upgrade.

Targets: `$ARGUMENTS`. If empty, stop and ask me which packages to upgrade.

Read first: `.claude/upgrade/RULES.md` and `.claude/upgrade/profile.md`.
Do NOT change any dependency in this phase. Do NOT fix existing errors.

## Steps

1. **Run name.** Make a short kebab-case name from the targets, for example
   `nuxt-ui-4-10` or `nuxt-5`. Use it as `<name>` below.

2. **No overlapping runs.** If `upgrade/HANDOFF.md` already exists, read its
   `Current phase`. If that run is not finished, STOP and tell me. Do not overwrite it.

3. **Git.**
   - `git status` must be clean (except kit files). If not, stop and tell me.
   - If the current branch is `main`/`master`, create the run branch:
     `git checkout -b chore/upgrade-<name>`.
   - If already on a `chore/upgrade-*` branch, keep it.

4. **Package manager.** Detect it from the lockfile. Use only that one.
   If `node_modules` is missing (fresh cloud VM), install with the frozen
   lockfile (`npm ci`, `pnpm install --frozen-lockfile`, `bun install --frozen-lockfile`).

5. **Create run state.** Copy `.claude/upgrade/HANDOFF.template.md` to
   `upgrade/HANDOFF.md` and fill in run name, targets, branch, package manager, date.
   Make sure `upgrade/logs/` is in `.gitignore` (add it if missing).

6. **Versions.** Record current installed versions of the target packages and
   of every package in the profile's "Key packages" list.
   For each target: `<pm> view <pkg> version` and
   `<pm> view <pkg> peerDependencies --json`. Record the exact target version.
   For every installed module/plugin that depends on a target, check whether its
   latest version's peer range accepts the target. Registry unreachable →
   write `Needs verification`.

7. **Baseline.** Run `scripts/upgrade-verify.sh baseline`. Read only
   `upgrade/logs/baseline/SUMMARY.md` and the first failing lines. Fill the
   `Baseline` table.

8. **Finish.** Set `Current phase: 0 done`,
   `Next: /upgrade-1-inventory (Sonnet session — this one is fine)`.
   Commit `chore(upgrade): start <name> run` and push the branch (see RULES).

## Report to me (short)

- current → target table
- modules whose peer range does NOT support the target yet (possible blockers)
- baseline: which checks pass / fail before any change
- anything that needs my decision
