---
description: Upgrade Phase 1 — map what the app uses today, with parallel Haiku scanners
---

Run **Phase 1 (inventory)**.

Read first: `.claude/upgrade/RULES.md`, `.claude/upgrade/profile.md`, `upgrade/HANDOFF.md`.
No fixes, no dependency changes, no opinions.

## Step 1 — Choose scan areas

From the profile's "Scan areas", pick the areas relevant to the targets in
`HANDOFF.md`. Area A (dependencies & config) is always included. If a target is
not covered by any area, add a focused area yourself: all imports from that
package and all config for it.

## Step 2 — Launch one `upgrade-scanner` subagent per area, in parallel

Send all of them in ONE message so they run at the same time. Give each scanner:
- the exact area text from the profile
- the "Folders to skip" list from the profile
- the instruction to return its standard output format

## Step 3 — Merge into `upgrade/inventory.md`

```markdown
# Inventory — <run name>
Generated: <date> | Targets: <targets>

## 1. Dependencies, modules & config
## 2. <one section per scanned area>
...
## UNSURE (from scanners)
```

Keep it factual and compact (target: under ~400 lines). Tables are fine.
If two scanners disagree, or a result looks wrong, check that one spot yourself
with Grep/Read. Do not re-scan everything.

## Step 4 — Finish

- Update `HANDOFF.md`: `Current phase: 1 done`, `Next: /upgrade-2-changes (Sonnet)`.
- Commit `chore(upgrade): phase 1 inventory` and push the branch.
- Tell me in 5 lines: biggest areas of usage, and anything UNSURE.
