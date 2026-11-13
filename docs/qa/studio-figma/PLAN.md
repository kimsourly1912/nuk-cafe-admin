# Studio follows Figma: unified work plan

Goal: the Studio floor-plan editor behaves like Figma (D278). This plan orders all issues in `issues/` (ISS-001 to ISS-036) into steps that can be built one at a time without breaking the editor. Owner's priority: users must be able to use Studio like Figma.

## Rules for every step (from AGENTS.md)

- Read the issue file first. Fix only what it describes. Use the issue's "How to verify".
- One branch per step, descriptive commits, then stop for review. Small and medium steps in one phase may share one PR, one commit each. A large step gets its own PR. Never merge automatically.
- Read the Studio docs before editing: UI foundation, responsive layout, `docs/server/data-model.md` for layout data, and the decision index (D278).
- Pure geometry and view math go in small tested functions (`designer/geometry.ts` or a new file next to it). Test them with unit tests.
- A new guard (version, lock, idempotency) is checked by removing it and seeing the test fail.
- Layout writes keep the version check (409 on stale) and one atomic batch.
- Update `docs/progress.md` (and a decision entry if the step changes architecture). Set the issue Status in its file when done, then the tester retests with new evidence.
- Do not guess business policy. Items under "Owner decision" wait for an answer.

## Status (2026-11-13)

Built in one PR on `claude/bold-hypatia-sx8nkl` (owner: collect the small and medium steps), waiting for retest: ISS-028, 001, 006, 003, 031, 032, 033, 009, 010, 029, 011, 012, 013, 015, 014, 017, 018, 019, 022, 025, 007, 026. Not reproduced: ISS-024. Deferred: ISS-020 (owner's Shift step), ISS-023 (details). Each issue file has a "Work" note.

Second PR (owner's answers, 2026-11-13): ISS-004 snap step, 031, 011, 017, 022, 026, 025 (command search), 020. Still waiting for the owner or the tester: ISS-002, 005 (range), 008, 016, 023, 024 (retest), 027, 030. Large: ISS-034, Phase 5.

Third PR: ISS-034 (mitred wall corners, snapping to wall faces).

Fourth PR (Phase 5 in one PR, owner): ISS-021 layers with hide and lock, ISS-035 floor frames, floor order, ISS-036 pages and several frames on one canvas, ISS-027 autosave and history (D279). Still waiting for the owner or the tester: ISS-002, 005 (range), 008, 016, 023, 024 (retest), 030; pages without floors hold nothing else yet.

## Phase 1: View and zoom (start here)

Why first: every other check depends on a stable camera.

| Order | Issue | What |
|---|---|---|
| 1.1 | ISS-028 (High) | Canvas must not change when a panel hides, shows or the window resizes. Keep scale and one anchor point as the source of truth, not a viewBox re-fitted to the size. |
| 1.2 | ISS-001 (High) | Ctrl/Cmd + wheel zoom speed like Figma. |
| 1.3 | ISS-006 | Ctrl/Cmd + 0 shortcut. |
| 1.4 | ISS-003 | Typed zoom percent field in the zoom menu. |
| 1.5 | ISS-002, ISS-005 | Zoom messages and limits (retest first, see the files). |
| 1.6 | ISS-031 | Grid look: minor 10 cm, major 100 cm, fade minor when far out. Separate the drawn grid from the snap step. |

Suggested PR: 1.1 alone (view math refactor, unit test "resize keeps scale and anchor"); 1.2 to 1.6 in a second PR.

## Phase 2: Selection, handles, resize and rotate

| Order | Issue | What |
|---|---|---|
| 2.1 | ISS-032 (Medium bug) | Selection and hover frame on the real bounds, fixed pixel handles. |
| 2.2 | ISS-033 | Remove the rotate circle; rotate from just outside a corner; live angle label. |
| 2.3 | ISS-009, ISS-010 | Remove the editor focus ring; fix the cut-off button text. |
| 2.4 | ISS-029 | Live width x height label while drawing and resizing. |
| 2.5 | ISS-011, ISS-012 | Shift + drag moves straight without deselecting; Esc cancels a drag. |
| 2.6 | ISS-013, ISS-015 | Rotate free by default, Shift snaps 15 degrees; Shift and Alt work in resize. |
| 2.7 | ISS-014 | Alt + drag copy feel (details in the file). |
| 2.8 | ISS-030 | Cursors for tools and handles (collect details with the tester first). |

## Phase 3: Snapping and geometry

| Order | Issue | What |
|---|---|---|
| 3.1 | ISS-034 (High) | Snap to wall faces and piece edges; clean wall corners (joins). Own PR. |
| 3.2 | ISS-023 | Smooth Alt gap distances. |
| 3.3 | ISS-016, ISS-017 | Shape and Room drawing keys like Figma (Shift, Alt). Decide the "cut" key for Room first. |
| 3.4 | ISS-018, ISS-019 | Wall tool free by default with Shift 45 degrees; Edit points free. Collect the remaining details first. |
| 3.5 | ISS-004 | Grid, snap and ruler toggles in the zoom menu (owner decision pending). |

## Phase 4: Editing commands

| Order | Issue | What |
|---|---|---|
| 4.1 | ISS-022 | Copy and paste (Ctrl/Cmd + C, V), keep tenant and version rules. |
| 4.2 | ISS-020 | Inspector number fields: Shift+arrow 10, math, label scrubbing. |
| 4.3 | ISS-007, ISS-024 | Tab and Shift+Tab selection; keep selection from 3D back to 2D. |
| 4.4 | ISS-026 | Align and distribute buttons. |
| 4.5 | ISS-025 | Ctrl+/ command search and a shortcut list. |
| 4.6 | ISS-008 | Bigger right-click menu (owner decision pending). |

## Phase 5: Layers, frames and pages (large; own PRs)

Owner answers are in ISS-035 and ISS-036. Build in this order:

1. ISS-021 Layers tree: frames and children, hide, lock, rename, range select.
2. ISS-035 Floor as a frame. Store the frame position as its own offset (`canvasX`, `canvasY`) on the floor. Contents stay in local coordinates, so a move changes one value in one guarded write. The frame position is design-only; 3D, QR and orders do not use it. Tests: move keeps relative positions, stale version returns 409, two-cafe isolation.
3. Floor order as stored data (a level number) with a reorder UI in the Layers panel. Stairs, "show floor below" and 3D keep using the level.
4. ISS-036 Pages: a stored list of pages in the layout (versioned). Migration puts existing floors on a default page named "Floors". Pages panel on top of the left sidebar. A page with frames holds real floors; other pages (Color Palette, Components) are free canvases.
5. Several frames visible on one canvas, side by side, with Shift+2 to zoom to a frame.
6. ISS-027 Autosave and history: owner decision first (draft autosave only, or real layout save under the write rules).

## Owner decisions still open

- ISS-004: which toggles to add and the snap step.
- ISS-008: how far the context menu should go.
- ISS-017: the key for Room "cut".
- ISS-018, ISS-019, ISS-023, ISS-030: details to collect from hand tests.
- ISS-027: autosave meaning.
- ISS-036 step 4: what pages without frames contain.

## After each phase

The tester repeats the Audit checks for the changed rows in Figma and Studio, logs the result in the sheet, and adds new evidence under `evidence/ISS-xxx/`.
