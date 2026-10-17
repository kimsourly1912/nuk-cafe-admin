---
description: Upgrade Phase 2 — collect official breaking changes and map them to the inventory
---

Run **Phase 2 (breaking changes)**.

Read first: `.claude/upgrade/RULES.md`, `.claude/upgrade/profile.md`,
`upgrade/HANDOFF.md`, `upgrade/inventory.md`. Do not change code or dependencies.

## Rules

- Use the profile's "Official sources", plus each package's own GitHub
  releases and CHANGELOG. Prefer installed `node_modules/<pkg>/CHANGELOG.md`
  and `<pm> view` when available.
- Do not rely on memory for what changed. No source found → `unknown`.
- Cover **every major and minor release** between current and target, not only the latest.
- Include required transitive upgrades (for example a framework major that
  also bumps its server runtime or router).

## Steps

1. From `HANDOFF.md → Versions`, list the version ranges to cover.
2. Fetch the sources. Extract only: breaking changes, deprecations, changed
   defaults, new required config, removed APIs, renamed props/slots/events/options,
   and official codemods.
3. Map each change to the inventory. When the inventory is not enough, send one
   `upgrade-scanner` subagent with all the exact symbols to search (batch them).
4. Write `upgrade/breaking-changes.md`:

```markdown
# Breaking changes — <run name>
Range: <pkg> <a> → <b>, ...

## Summary
- affected: <n> | not affected: <n> | unknown: <n>
- official codemods: <list or none>

## Changes
| ID | Package | Version | Change | Affected | Where (files/count) | Fix type | Source |
|----|---------|---------|--------|----------|---------------------|----------|--------|

## Details (only affected = yes or unknown)
### C1 — <title>
- what changed:
- how it affects this app:
- fix:
- risk: low | medium | high   (profile high-risk areas = high)

## Module compatibility
| Module | Current | Needed | Supports target? | Source |

## Unknowns that need my decision
```

`Fix type`: `codemod` = official tool; `mechanical` = exact pattern
replacement (bulk-editor); `manual` = needs judgment; `config` = config only.

5. Update `HANDOFF.md`: `Current phase: 2 done (waiting for review)`,
   `Next: /upgrade-3-plan (new OPUS session)`.
6. Commit `chore(upgrade): phase 2 breaking changes` and push the branch.
7. Tell me: counts, high-risk items, unknowns. Ask me to review the file
   before Phase 3.
