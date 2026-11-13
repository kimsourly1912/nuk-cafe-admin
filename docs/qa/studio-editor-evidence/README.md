# Studio editor QA evidence

This folder records how Figma's editing tools behave and gives Claude Code steps to reproduce and verify the equivalent behavior in NUK Cafe Studio. Start with the Rectangle tool. The sibling [Studio vs Figma audit](../studio-figma/README.md) contains the existing issue IDs and [implementation plan](../studio-figma/PLAN.md).

| Check ID | Tool | Figma reference | Studio comparison |
|---|---|---|---|
| [RECT-01](checks/RECT-01.md) | Rectangle | [Final mockup](evidence/RECT-01/rectangle-tool-states.png) | Fail: ED-01 to ED-05, ED-09 |
| [CIRC-01](checks/CIRC-01.md) | Circle | [Final mockup](evidence/CIRC-01/circle-tool-states.png) | Fail: ED-06, ED-09 |
| [GUIDE-01](checks/GUIDE-01.md) | Position and alignment guides | [Final mockup](evidence/GUIDE-01/line-guides-states.png) | Mostly pass: ED-08, ED-10 |

## Inspector reference

- [Position: alignment, X/Y, constraints, rotation and flips](inspector/position.md). Studio, read from the code on 2026-11-13: X/Y math, scrubbing, arrows 1 and Shift 10 (ISS-020) and turn buttons both ways are there; flips (ED-07) and aligning one piece to its floor (ED-11) are not.

## Findings

From the Studio run of 2026-11-13 (local build of `main` at `36cc911`). Owner, 2026-11-13: build corner radius, flips, the circle's arc and ring, frame constraints, and more of Figma where it fits a floor plan. Each new stored property changes the saved layout and needs a matching 3D look.

Built in one PR (D280, 2026-11-13; owner: all in one PR, Claude's recommendations): status **Fixed, needs retest** unless noted. Retest each check's steps on staging with a real mouse and trackpad.

| ID | Severity | Type | Finding | Check |
|---|---|---|---|---|
| ED-01 | Medium | Gap | No edge resize: a drag on a side moves the piece; only the four corners resize. **Fixed: sides resize (Shift scales about the middle).** | RECT-01 steps 3, 5 |
| ED-02 | Medium | Bug | Just outside a corner still resizes: the resize hit area reaches 16 px past the corner and rotation starts at 12 px, so 10–16 px out resizes. **Fixed: the corner target reaches 8 px out, the turn area starts there.** | RECT-01 step 7 |
| ED-03 | Medium | Gap | No handles while a piece is under 56 px on screen: at the default fit zoom a 1 m piece can only be moved. **Fixed: handles at any size; under 40 px they sit outside the piece; under 8 px move and turn only.** | RECT-01 step 2 |
| ED-04 | Low | Gap | No size badge under a selected piece; the size shows only beside the pointer while resizing. **Fixed: a size badge under the selection, live while resizing.** | RECT-01 steps 2, 4 |
| ED-05 | Medium | Gap (owner: build) | No corner radius for the rectangle Shape (dots inside the corners, Radius label, Properties field, 3D). **Fixed: `radius`, dots inside the corners, Properties, 3D.** | RECT-01 step 6 |
| ED-06 | Medium | Gap (owner: build) | No arc for the round Shape: sweep, start angle and inner ratio (ring). **Fixed: `arcStart`, `arcSweep`, `arcInner`, three dots, Properties, 3D.** | CIRC-01 |
| ED-07 | Low | Gap (owner: build) | No Flip horizontal or Flip vertical. **Fixed: `flipX`, `flipY`; Shift+H, Shift+V, Properties, menu, 3D.** | Position §4 |
| ED-08 | Low | Gap (owner: build, see question) | No frame constraints. They only act when a frame is resized, and a Studio floor is never resized with its contents. **Won't build now: a floor is never resized with its contents, so constraints would do nothing (D280).** | GUIDE-01, Position §3 |
| ED-09 | Low | Bug | A Shape's name label runs past a small or round shape ("Round block" on a 1 m circle). **Fixed: the name is sized to fit, or left out.** | CIRC-01 |
| ED-10 | Low | Needs check | The middle drag guide runs on to the far wall instead of stopping at the aligned piece. Check against Figma's guide length first. **No change: the guide matched the wall's middle (the floor is 600 cm deep, the block's middle at 300).** | GUIDE-01 |
| ED-11 | Low | Gap | Align works only with several selected; Figma aligns one piece to its frame (here: the floor). **Fixed: the align row aligns one piece to its floor.** | Position §1 |

## Workflow

1. Copy [TEMPLATE.md](TEMPLATE.md) for the next tool. Use one check file per interaction or group of closely related interactions.
2. Record the starting state and the pointer target. Capture what appears before pressing, what changes during the drag, and what remains after release. Include the cursor, outlines, handles, guide lines, badges, tooltip position, and values.
3. Repeat the same actions in Studio on a scratch layout. Review comparable captures and record the Studio build, browser, zoom, and result for each action.
4. Link existing issues when the finding fits. Open a new finding only when the Studio comparison identifies a separate bug, gap, or improvement. Record a suspected code location when verified.
5. Claude Code uses the verification steps in the check file after fixing a confirmed issue. Add new evidence and update the result after retesting.

Use screenshots and recordings as working references. Publish one final mockup per check under `evidence/<check-id>/`. Use a second mockup when the states would be too crowded on one image. Keep the action order and any relevant recording timestamps in the check file. Link the mockup from both the check and this index.
