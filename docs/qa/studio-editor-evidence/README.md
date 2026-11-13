# Studio editor QA evidence

This folder records how Figma's editing tools behave and gives Claude Code steps to reproduce and verify the equivalent behavior in NUK Cafe Studio. Start with the Rectangle tool. The sibling [Studio vs Figma audit](../studio-figma/README.md) contains the existing issue IDs and [implementation plan](../studio-figma/PLAN.md).

| Check ID | Tool | Figma reference | Studio comparison |
|---|---|---|---|
| [RECT-01](checks/RECT-01.md) | Rectangle | [Final mockup](evidence/RECT-01/rectangle-tool-states.png) | Needs test |
| [CIRC-01](checks/CIRC-01.md) | Circle | [Final mockup](evidence/CIRC-01/circle-tool-states.png) | Needs test |
| [GUIDE-01](checks/GUIDE-01.md) | Position and alignment guides | [Final mockup](evidence/GUIDE-01/line-guides-states.png) | Needs test |

## Inspector reference

- [Position: alignment, X/Y, constraints, rotation and flips](inspector/position.md)

## Workflow

1. Copy [TEMPLATE.md](TEMPLATE.md) for the next tool. Use one check file per interaction or group of closely related interactions.
2. Record the starting state and the pointer target. Capture what appears before pressing, what changes during the drag, and what remains after release. Include the cursor, outlines, handles, guide lines, badges, tooltip position, and values.
3. Repeat the same actions in Studio on a scratch layout. Review comparable captures and record the Studio build, browser, zoom, and result for each action.
4. Link existing issues when the finding fits. Open a new finding only when the Studio comparison identifies a separate bug, gap, or improvement. Record a suspected code location when verified.
5. Claude Code uses the verification steps in the check file after fixing a confirmed issue. Add new evidence and update the result after retesting.

Use screenshots and recordings as working references. Publish one final mockup per check under `evidence/<check-id>/`. Use a second mockup when the states would be too crowded on one image. Keep the action order and any relevant recording timestamps in the check file. Link the mockup from both the check and this index.
