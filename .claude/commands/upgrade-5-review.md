---
description: Upgrade Phase 5 — final review of the full upgrade diff (use an Opus session)
argument-hint: "[base branch, default main]"
---

Run **Phase 5 (final review)**. This session should be on Opus.
Base branch: `$ARGUMENTS` (default `main`). Do not edit source code.

Read first: `.claude/upgrade/RULES.md`, `.claude/upgrade/profile.md`,
`upgrade/HANDOFF.md`, `upgrade/plan.md`, `upgrade/breaking-changes.md`.

## Inputs

- `git log --oneline <base>..HEAD`
- `git diff <base>...HEAD --stat`, then the diff per area. Skip the lockfile
  body; check only resolved versions of the target and key packages.
- `scripts/upgrade-verify.sh final` → `upgrade/logs/final/SUMMARY.md`

## Review focus, in this order

1. Every item in the profile's **High-risk areas**, in its listed order.
2. App behavior: data fetching, SSR vs client, routing, middleware, error pages.
3. UI: forms and validation, tables, overlays, toasts, theming, accessibility.
4. Hygiene: leftover compatibility flags, `@ts-ignore`, `any`, disabled rules,
   skipped tests, debug logs, unrelated changes.
5. Coverage: every `affected: yes` item in `breaking-changes.md` is handled by a done step.

## Write `upgrade/review.md`

```markdown
# Upgrade review — <run name>
Base: <base> | Commits: <n> | Verify (final): <summary>

## Critical
### R1 — <title>
- where: file:line
- problem → why it matters → recommended fix
- executor: sonnet | bulk-editor

## Important
## Improvement
## Optional

## Breaking-change coverage
| ID | Handled by | OK? |

## Manual test checklist (final)
```

Add each Critical/Important finding to `plan.md` as a step `R<n>` with `status: todo`.

## Finish

- Update `HANDOFF.md`: `Current phase: 5 done`, and
  `Next: /upgrade-4-execute R1-... (Sonnet)` or, if nothing blocking,
  `Next: manual test, then /upgrade-6-finish`.
- Commit `chore(upgrade): phase 5 review` and push the branch.
- Tell me: counts by severity, and whether it is safe to merge after manual testing.
