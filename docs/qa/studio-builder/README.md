# Studio builder QA

Goal: make Studio flexible enough for an owner to build their own shop freely (walls, floors, doors, finishes, custom pieces), without losing precision or data integrity. Plan and target design: [Studio flexible builder plan](../../plans/studio-builder.md).

Found on 2026-11-14 by Claude, reading `main` at `06bf118` and running unit probes against the designer code, plus two problems the owner reported by hand. Nothing here was tested in a browser on staging yet; each file says what still needs a browser check (STANDARD.md §9).

Rules: [QA standard](../STANDARD.md). Issue numbers continue after the Studio vs Figma area (ISS-001 to ISS-036, in git history).

## Status

| ID | Severity | Type | Status | Title |
|---|---|---|---|---|
| [ISS-037](issues/ISS-037.md) | High | Bug | Fixed, needs retest | Removing a corner can make the layout impossible to save |
| [ISS-038](issues/ISS-038.md) | High | Bug | Fixed, needs retest | Explore is switched off for customers without warning when the street door goes |
| [ISS-039](issues/ISS-039.md) | Medium | Bug | Fixed, needs retest | A floor outline can cross itself and still saves |
| [ISS-040](issues/ISS-040.md) | Medium | Bug | Fixed, needs retest | Grid shows only 1–2 lines when zoomed in, and lines look blurry |
| [ISS-041](issues/ISS-041.md) | Medium | Improvement | Steps 1–2 fixed, needs retest; step 3 open | 3D is slow to open and rebuilds the whole building and street on every edit |
| [ISS-042](issues/ISS-042.md) | Low | Bug | Fixed, needs retest | Copy, duplicate and paste keep the same door and window ids |
| [ISS-043](issues/ISS-043.md) | Medium | Bug | Fixed, needs retest | The editor lets a floor go over its limits, then autosave stops |
| [ISS-044](issues/ISS-044.md) | Low | Bug | Fixed, needs retest | Remove-floor dialog says "undo until you save", but autosave saves at once |
| [ISS-045](issues/ISS-045.md) | Medium | Gap | Fixed, needs retest | A new floor always starts as a copy of the floor below |
| [ISS-046](issues/ISS-046.md) | Medium | Gap | Fixed, needs retest | Outer walls and the floor surface cannot be deleted |

## Suggested fix order

1. ISS-038 (customers affected), then ISS-037 and ISS-039 (layouts that cannot save or draw wrong). With ISS-042, ISS-043 and ISS-044 they fit one PR (plan Phase 0).
2. ISS-041 step 1 (keep 3D mounted) can join that PR; the rest of ISS-041 is plan Phase 5.
3. ISS-040 is plan Phase 2.
4. ISS-045 and ISS-046 are solved by the contract v2 change (plan Phase 1), after the owner's decisions.

## Phase 0 fix (2026-11-14, branch `ccr-e78bff39-u70ma7`)

ISS-037, 038, 039, 042, 043, 044 and ISS-041 step 1 are built in one PR. Owner decisions that day: a corner delete drops openings without warning (ISS-037); an edit that removes Explore's street door asks first, then turns Explore off (ISS-038, plan D7). Retest steps: each issue's "How to verify" and [RETEST-QUEUE.md](../RETEST-QUEUE.md) section B.

**Saved data still to check (owner, read-only).** The contract now refuses crossing outlines (ISS-039) and repeated door/window ids (ISS-042). The editor repairs repeated ids when it loads a layout, but a saved crossing outline would stop autosave until it is dragged straight. Claude's read-only D1 query was blocked in this session. Run this on staging and production before deploying:

```sql
-- Repeated door/window ids per branch (the editor repairs these on load).
WITH ops AS (
  SELECT f.tenant_id, f.branch_id, json_extract(o.value, '$.id') AS id
  FROM branch_layout_floors f, json_each(f.geometry, '$.edges') e, json_each(e.value, '$.openings') o
  UNION ALL
  SELECT f.tenant_id, f.branch_id, json_extract(o.value, '$.id')
  FROM branch_layout_floors f, json_each(f.geometry, '$.walls') w, json_each(json_extract(w.value, '$.openings')) o
)
SELECT tenant_id, branch_id, id, count(*) FROM ops GROUP BY 1, 2, 3 HAVING count(*) > 1;
-- Outlines to check with isSimpleOutline (SQL cannot test crossings): export them.
SELECT tenant_id, branch_id, id, json_extract(geometry, '$.outline') FROM branch_layout_floors;
```

