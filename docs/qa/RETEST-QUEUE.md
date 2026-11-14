# Retest queue

Status of every item below: **Fixed, needs retest** (owner retests), unless the "Waiting for" column says otherwise. Built on branch `claude/bold-hypatia-sx8nkl` and later PRs #307 to #313. Follow [STANDARD.md](STANDARD.md) section 5: retest on staging with a real mouse and trackpad, save new evidence, then set the item to Verified and remove it here.

Original issue files, steps and images (ISS-001 to ISS-036, RECT-01, CIRC-01, GUIDE-01, ED-01 to ED-11): in git history, before the commit that added this file, under `docs/qa/studio-figma/` and `docs/qa/studio-editor-evidence/`.

## A. Studio vs Figma issues

| ID | What to retest | Steps and expected result |
|---|---|---|
| ISS-028 (High) | Canvas stays still when a panel hides or shows | Hide and show the left panel and the inspector; resize the window. Zoom label and plan position do not change. Nothing cut off. No blank strip. Check at 77% and 196%. |
| ISS-001 (High) | Ctrl/Cmd+wheel zoom speed | One notch changes zoom about 10%, not 2.7x. Trackpad pinch stays smooth. GIF for one notch and ten notches. |
| ISS-006 | Ctrl/Cmd+0 | Zoom becomes 100%. Browser page zoom does not change. |
| ISS-003 | Typed zoom percent | Type 150 + Enter: 150%. Type 99999: clamps to max. Letters: ignored. |
| ISS-005 | Zoom limits | Zoom to both limits (2% to 25,600%) and read the label. |
| ISS-031, ISS-004 | Grid size and snap | Grid cells look the same as Figma at 100%. Moves, drops, Room, Shape, walls, corners and resizes land on whole cm. Arrows 1 cm, Shift 10 cm. Ctrl/Cmd turns smart guides off. (Ruler, grid and snap toggles in the zoom menu are not built; owner did not ask.) |
| ISS-032 | Hover and select frame | Frame touches the piece edge at 50%, 100% and 400%. Rotated pieces too. |
| ISS-033 | Rotate handle | No circle floating on select. Pointer just outside a corner shows the rotate cursor and rotating works. Resize still works from corners and sides. |
| ISS-009 | Focus ring | After clicking the canvas, then Escape, Ctrl+A and Tab: no yellow ring. Fields and buttons in panels keep their normal focus ring. |
| ISS-010 | "Zoom to s…" label | Select two items at 1280 and 1568 px width: no label is cut off. |
| ISS-029 | Live size label | Drag a shape, a room and a resize handle: the label shows and matches the inspector after release. |
| ISS-011 | Shift + drag | Shift + drag of a selected table moves it straight across or down and keeps it selected. Shift + click adds or removes it. Works on a group and a wall. With something selected, Shift + drag on an unselected piece adds it and moves the whole set (one undo); Escape drops it. |
| ISS-012 | Esc during drag | Drag a table, press Esc before release: it jumps back, undo list unchanged. Same for a wall, a wall end and a group. |
| ISS-013 | Rotate | Angle follows the pointer freely. Shift snaps to 15°. The angle shows while rotating and the key is in the shortcut list. |
| ISS-015 | Resize modifiers | Shift + corner keeps the ratio. Alt + corner grows around the center. Both: ratio around center. Size shows while dragging. |
| ISS-014 | Alt + drag copy | Original stays, copy lands where released, one undo removes the copy. A table asks which table; cancel leaves the plan unchanged. **By hand only** (Claude's tool cannot hold Alt during a drag). Judge the feel against Figma. |
| ISS-016 | Shape click | Press S, click once: 100 x 100 cm block, selected, tool back to Select. S then O, click: round block. Drag still makes the dragged size. |
| ISS-017 | Shape and Room keys | Shift lock/release mid-drag changes the preview with no mouse move. Alt draws from the center. Shift + Alt both. `O` is free, Shift makes a circle. Room has an Add / Cut choice (Add each time Room starts). |
| ISS-018 | Wall tool | Free diagonal by default. Shift gives 0/45/90. Preview and result agree. Clicking the first point closes the loop. Esc finishes and leaves the tool. |
| ISS-019 | Edit points | Corner moves freely. Shift constrains. Double-click on a side adds a corner. Delete removes one. Esc leaves. One undo step each. |
| ISS-020 | Number fields | Shift + arrow steps by 10. Math (for example `10*5`) commits the result. Dragging the label scrubs, one undo step. Enter commits, Escape reverts. Out-of-range shows "Kept within limits". |
| ISS-021 | Layers list | Shift+click range, Ctrl/Cmd+click toggle, hover outline on the plan, eye (hide), lock, double-click rename. Hidden: not drawn or picked. Locked: not picked or dragged on the plan, still editable in Layers and Properties. 3D, Explore, QR and orders ignore both. |
| ISS-022 | Copy and paste | Ctrl+C then Ctrl+V makes a copy (50 cm on, further each paste; other floor: same place). A table asks which table. One undo removes it. |
| ISS-025 | Command search and shortcuts | Ctrl/Cmd+/ opens command search. `?` opens the shortcut list. Every key in the list works. Also in the right-click menu. |
| ISS-026 | Align and distribute | With two pieces: align. With three or more: distribute across and down (outer two stay, equal gaps). One undo step. |
| ISS-007 | Tab selection | With the canvas focused, Tab walks all items in a fixed order, Shift+Tab goes back, Esc then Tab moves browser focus again. Tab in a form field still moves between fields. |
| ISS-008 | Right-click menu | Copy, Paste here, order, Hide, Lock: each works from the menu and from its shortcut, for one item and for a multi-selection. |
| ISS-034 (High) | Snap to walls and clean corners | Move the stairs to the wall: snaps flush with the wall face. All four wall corners look clean (mitred). Two pieces can be placed touching. |
| ISS-035 | Floor as a frame | Select the frame and drag it: everything inside moves together. Save and reload: same relative positions. |
| ISS-036 | Pages and frames | Create two pages with frames, switch pages, move frames, reload: structure and positions kept. 3D view and table QR still work. Shift+2 zooms to a frame. |
| ISS-027 | Autosave and history | Autosave 2 s after the last change (at most 10 s behind). Stops while a conflict or problem is shown. Save layout saves at once. History lists snapshots (at most one per 10 minutes, last 50). Restore loads one as an undo step. |
| ISS-030 | Cursors | Cursors match tools and handles. **First tell us which cursors are wrong** (not said yet). |

## B. Editor checks (RECT-01, CIRC-01, GUIDE-01)

Retest each check's steps on staging with a real mouse and trackpad. Capture the pointer just before pressing and at least one frame during each drag.

| ID | What to retest | Expected |
|---|---|---|
| ED-01 | Side resize | A drag on a side resizes (Shift scales about the middle). It does not move the piece. |
| ED-02 | Corner zone | Corner resize target reaches 8 px out. Just outside that, the turn cursor shows and rotate works. |
| ED-03 | Handles on small pieces | Handles show at any size. Under 40 px they sit outside the piece. Under 8 px: move and turn only. |
| ED-04 | Size badge | A size badge under the selection, live while resizing. |
| ED-05 | Corner radius | Dots inside the corners, `Radius` field in Properties, 3D matches. |
| ED-06 | Round shape arc | Three dots (sweep, start angle, inner ratio), Properties fields, 3D matches. |
| ED-07 | Flips | Shift+H and Shift+V, Properties buttons, menu, 3D matches. |
| ED-09 | Name label | Name fits a small or round shape, or is left out. |
| ED-10 | Drag guide length | No change made. Confirm the middle guide matches the wall's middle. |
| ED-11 | Align one piece | The align row aligns one piece to its floor. |
| ED-08 | Frame constraints | Not built on purpose (a floor is never resized with its contents). Nothing to retest. |

## C. Waiting for the owner or the tester first

| ID | Waiting for |
|---|---|
| ISS-002 | Recheck: press Shift+1, Shift+2, Ctrl+0, Ctrl +/-. Capture within 300 ms. Is a zoom toast shown? (If it was missed, it is fixed only after a toast is confirmed absent.) |
| ISS-023 | Describe what is "not smooth" in the Alt gap lines (late update, flicker, only after a pointer move, wrong lines). Claude found the lines already follow the Alt key alone. |
| ISS-024 | Selection from 3D back to 2D. Could not be reproduced. Retest with the toolbar's 2D button. If it fails, write the exact steps. |
| ISS-036 step 4 | Decide what a page without frames contains (Color Palette, Components). |
| ISS-004 | Owner: do you want ruler, grid and snap toggles in the zoom menu? Not built. |

## B. Studio builder Phase 0 (ISS-037 to ISS-044, branch `ccr-e78bff39-u70ma7`)

Issue files: [studio-builder/issues](studio-builder/issues/). Built from code and unit tests, plus one e2e step for ISS-038. Nothing here was checked in a browser by Claude.

| ID | What to retest | Steps and expected result |
|---|---|---|
| ISS-038 (High) | Removing the street door asks first | Branch with a pin, Explore on, street door chosen. Each of these asks "Turn off Explore?": Remove floor (ground floor; its dialog says it), Delete on the door's wall, the door's remove button in the edge panel, deleting a corner so the door no longer fits. Cancel: nothing changes, Explore still on. Agree: Explore off after the save; Undo brings the door and Explore back. |
| ISS-037 (High) | Corner delete keeps the layout savable | Open side next to a wall with a door: delete the corner between them. No door on the joined side, status goes back to Saved. Railing next to a wall with a window: the window goes, doors stay as gates. |
| ISS-039 | No crossing outline | Edit points: drag a corner across the far side. The drag stops at the last good place; on release the outline does not cross. Typing a length that would cross is refused with "Outline not changed". 3D floor matches the plan. |
| ISS-042 | Copied doors are separate | Duplicate (and copy and paste) an inside wall with a door. Each door can be edited on its own; the layout saves. |
| ISS-043 | Floor limits | With about 150 pieces, duplicate 60: refused, toast "A floor holds at most 200 pieces of furniture.", nothing added, status stays Saved. |
| ISS-044 | Remove-floor text | The dialog ends "You can undo this." Undo after the autosave brings the floor back. |
| ISS-041 step 1 | 3D stays open | Orbit in 3D, switch to 2D and back: same camera, no loading. Edit in 2D, back to 3D: the edit shows. |

## C. Studio builder: contract v2 and grid (ISS-040, 041, 045, 046, branch `ccr-e78bff39-u70ma7`)

Owner decisions D1–D6 (2026-11-14) in the [plan](plans/studio-builder.md). Read with "How to verify" in each [issue file](studio-builder/issues/).

| ID | What to retest | Steps and expected result |
|---|---|---|
| ISS-046 | Real delete | Select an outer wall: Delete removes it (and its doors), Undo brings it back. Layers → Floor surface: Delete removes the surface, its walls stay. A street-door wall still asks first. 3D and Explore show the same. |
| ISS-045 | Empty new floor | Add floor: empty, floor below shown faintly, Draw outline open. Copy walls from floor below: surface and walls appear (no doors), one Undo removes them. An empty floor saves and reloads; 3D shows nothing for it. |
| D282 | Old layouts unchanged | Open a branch saved before this change: the plan and 3D look as before (walls outside the floor, corners clean, doors and windows in place); Explore still opens at the street door. |
| D282 | Room and Edit points | Room beside the floor: one L-shaped surface, no wall left between the two parts. Room apart: a second surface. Cut through the middle: two surfaces. Edit points: a dragged corner takes its two walls along; a new corner splits the wall; a removed corner joins them. |
| D3 | Wall structure | Select a wall: set Thickness 30, Height 150, Stands Right: the plan band and 3D wall change; "Use the type's thickness and height" puts them back. |
| ISS-040 | Grid | At 2 %, 100 %, 400 % and the maximum: finer lines appear as you zoom in (1 cm at the maximum, about 5 lines across), lines sharp in light and dark. |
| ISS-041 step 2 | Street not rebuilt | Neighborhood lane on: move a chair in 2D, switch to 3D: the street does not flicker or rebuild; drag an outer corner: it does. |

## D. Doors, windows and pieces built as wanted (D283, branch `ccr-e78bff39-u70ma7`)

| What | Steps and expected result |
|---|---|
| Door shape | Select a wall with a door: set Height 240, Opens Out, Hinge End. The plan's swing line moves to the other end and the other side; 3D's door is taller with the handle at the free end. Door leaf off: no swing on the plan, no leaf in 3D; in Explore the street door, if it is that one, has no door to push. |
| Window shape | Set Sill 30 and Height 200: the 3D window runs from 30 to 230 cm (cut at the wall's top). |
| Above the floor | Select a shelf, Above the floor 150: in 3D it hangs 1.5 m up; in Explore you walk under it. Stairs and people have no such field. |

