---
description: Upgrade Phase 6 — archive a short record of the run and remove the run state before merge
---

Run **Phase 6 (finish)**. Read `.claude/upgrade/RULES.md` and `upgrade/HANDOFF.md`.

## Pre-checks (stop if any fails)

- All steps in `upgrade/plan.md` are `done` (or explicitly marked out of scope by me).
- No Critical/Important item in `upgrade/review.md` is still open.
- I have confirmed the manual tests are done. If I have not said so in this
  session, ask me and wait.

## Steps

1. Write `docs/upgrades/<YYYY-MM-DD>-<run name>.md` (create the folder if needed),
   at most ~60 lines:
   - versions: before → after (table)
   - breaking changes that affected this app (IDs + one line each)
   - decisions made (from `HANDOFF.md → Decisions`)
   - surprises / lessons that would help the next upgrade
   - anything left for later
2. If a lesson should change how future upgrades run (for example a new
   high-risk area, a new scan area, a better official source), propose the
   exact edit to `.claude/upgrade/profile.md` and ask me before applying it.
3. Remove the run state: `git rm -r upgrade/` (logs are already gitignored).
4. Commit `chore(upgrade): finish <run name>` and push the branch.
5. Tell me the branch is ready for a PR. I open and merge it myself.
