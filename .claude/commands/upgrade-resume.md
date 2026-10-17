---
description: Reload the current upgrade run in a fresh session and say exactly what to do next
---

Read `.claude/upgrade/RULES.md`, `upgrade/HANDOFF.md`, and the step list in
`upgrade/plan.md` (if it exists). Do not read source code or logs yet. Do not change anything.

If `upgrade/HANDOFF.md` does not exist, tell me there is no active run and that
`/upgrade-0-setup <packages>` starts one. Stop.

Otherwise run `git branch --show-current`, `git status --short`, `git log --oneline -10`.

Report in at most 10 lines:

1. Run name, current phase, last done step (with hash)
2. Whether git state matches `HANDOFF.md` (warn me about uncommitted changes
   or commits not recorded in HANDOFF)
3. Blocked items, plan issues, pending decisions
4. The exact next command and which model the session should use:
   - Phases 1, 2, 4, 6 → Sonnet
   - Phases 3, 5, or re-planning after a plan issue → Opus
   If this session's model is wrong for the next command, tell me to start a
   new session with the right model. Do not continue.
