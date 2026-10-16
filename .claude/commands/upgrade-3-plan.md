---
description: Upgrade Phase 3 — write the ordered upgrade plan (use an Opus session)
---

Run **Phase 3 (plan)**. This session should be on Opus. If it is not, tell me and stop.

Read only: `.claude/upgrade/RULES.md`, `.claude/upgrade/profile.md`,
`upgrade/HANDOFF.md`, `upgrade/inventory.md`, `upgrade/breaking-changes.md`.
Open source files only to resolve a specific doubt. Do not change code or dependencies.

## What a good plan looks like

- **Small steps.** Each step leaves the app in a state where verify can run.
  One step = one commit.
- **Order by dependency.** Typical order (adjust to the facts):
  1. Pre-upgrade fixes that work on the *current* version (remove deprecated
     usage, enable forward-compatibility flags). Safest steps first.
  2. Bump the core package together with its required peers.
  3. Run official codemods, one per step.
  4. Fix profile high-risk areas (server, auth, data) **before** UI.
  5. Bump dependent libraries.
  6. Mechanical renames (bulk-editor).
  7. Manual changes, one area or component per step.
  8. Tooling (lint, test, typecheck).
  9. Remove temporary compatibility flags.
- Do not mix a dependency bump with code changes in one step unless the app
  cannot build otherwise. If so, say why.
- Steps touching profile high-risk areas are `risk: high`.
- Prefer official codemods and documented migrations over custom changes.

## Write `upgrade/plan.md`

```markdown
# Upgrade plan — <run name>
Targets: <pkg@version, ...> | Based on breaking-changes.md (C1..Cn)

## Strategy (5–10 lines)
Why this order. What is risky. What we do NOT change.

## Steps
### S1 — <title>
- status: todo        # todo | in-progress | done | blocked
- covers: C3, C7
- executor: sonnet | bulk-editor | codemod
- risk: low | medium | high
- files: <globs or list>
- change: <precise; for bulk-editor give exact from → to and scope>
- verify: `scripts/upgrade-verify.sh S1` (+ any extra check)
- done when: <observable condition>

## Manual test checklist
<the profile's smoke test + items specific to this upgrade>

## Open questions (must be answered before execution)
- Q1: ...

## Not in scope
```

## Finish

- Update `HANDOFF.md`: `Current phase: 3 done (waiting for approval)`, copy
  the open questions into `Decisions` as `pending`,
  `Next: /upgrade-4-execute S1-... (Sonnet)`.
- Commit `chore(upgrade): phase 3 plan` and push the branch.
- Show me: number of steps, high-risk steps, open questions. Then stop.
  I will discuss changes with you here, then approve.
