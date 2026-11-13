# Studio editor QA evidence

This folder records how Figma's editing tools behave and gives Claude Code steps to reproduce and verify the equivalent behavior in NUK Cafe Studio. Start with the Rectangle tool. The sibling [Studio vs Figma audit](../studio-figma/README.md) contains the existing issue IDs and [implementation plan](../studio-figma/PLAN.md).

| Check ID | Tool | Figma reference | Studio comparison |
|---|---|---|---|
| [RECT-01](checks/RECT-01.md) | Rectangle | Recording reviewed on 2026-11-13 | Needs test |

## Workflow

1. Copy [TEMPLATE.md](TEMPLATE.md) for the next tool. Use one check file per interaction or group of closely related interactions.
2. Record the starting state and the pointer target. Capture what appears before pressing, what changes during the drag, and what remains after release. Include the cursor, outlines, handles, guide lines, badges, tooltip position, and values.
3. Repeat the same actions in Studio on a scratch layout. Capture comparable evidence and record the Studio build, browser, zoom, and result for each action.
4. Link existing issues when the finding fits. Open a new finding only when the Studio comparison identifies a separate bug, gap, or improvement. Record a suspected code location when verified.
5. Claude Code uses the verification steps in the check file after fixing a confirmed issue. Add new evidence and update the result after retesting.

Keep screenshots in `evidence/<check-id>/`. Use `figma-<nn>-<state>` and `studio-<nn>-<state>` filenames. Use a recording or timestamped sequence when the timing matters. Track each comparison in this folder's index and check file.
