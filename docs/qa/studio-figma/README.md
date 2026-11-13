# Studio vs Figma QA

Goal: make the Studio floor-plan editor behave like Figma (D278 "Studio canvas follows Figma"). Findings come from manual testing of Figma and https://staging.angder.app (Studio tab). The tester only finds and documents; fixing is done by Claude Code from these files.

Tracker (index and status): the "Studio vs Figma audit" Claude Sheet (tabs Audit, Issues, Test log, How we work). This folder holds the detail the sheet cannot: steps, code pointers and images.

## Layout

```text
docs/qa/studio-figma/
  README.md        this file
  TEMPLATE.md      copy for each new issue
  issues/ISS-xxx.md   one file per issue
  evidence/ISS-xxx/   screenshots and GIFs for that issue
```

## Standard flow per check

1. Pick one Audit check (for example ZP4).
2. Run it in Figma on a scratch page. Capture evidence.
3. Run the same steps in Studio from the same start state. Capture evidence.
4. Compare. Classify as Bug, Gap or Improvement. Rate severity.
5. Read the repo to name the suspected cause. Do not edit code.
6. Write or update `issues/ISS-xxx.md` and add images to `evidence/ISS-xxx/`.
7. Log the test in the sheet "Test log" and the issue in "Issues". Nothing counts as logged until the file and the sheet agree.
8. Claude Code fixes from the issue file, then the issue is retested with new evidence.

## Evidence rules

- Name files `<app>-<nn>-<what>.png|gif`, for example `figma-01-before.png`, `studio-02-after-zoom.gif`.
- Every Fail or Info test has at least one Figma image and one Studio image from the same start state.
- Time-based behavior (speed, easing) gets a GIF or a table of measured numbers, not a single frame.
- Pass results only get an image when the result is not obvious.

## For Claude Code

Read the issue file, fix only what it describes, run its "How to verify", then update the Status in the file and in `docs/progress.md` as usual. Values marked "from memory" or "unverified" are not confirmed; verify before you rely on them.

## Issues

| ID | Severity | Type | Title |
|---|---|---|---|
| [ISS-001](issues/ISS-001.md) | High | Bug | Ctrl/Cmd+wheel zoom is far too fast |
| [ISS-002](issues/ISS-002.md) | Low | Improvement | No message after zoom shortcuts |
| [ISS-003](issues/ISS-003.md) | Medium | Gap | Zoom menu has no typed percent field |
| [ISS-004](issues/ISS-004.md) | Low | Improvement | Zoom menu has no grid, snap or ruler toggles |
| [ISS-005](issues/ISS-005.md) | Low | Gap | Zoom limits differ from Figma |
| [ISS-006](issues/ISS-006.md) | Medium | Gap | Ctrl/Cmd+0 does nothing in Studio |
| [ISS-007](issues/ISS-007.md) | Low | Gap | Tab does not select the next item (owner: do it) |
| [ISS-008](issues/ISS-008.md) | Low | Gap | Right-click menu much smaller than Figma's |
| [ISS-009](issues/ISS-009.md) | Low | Improvement | Yellow ring around the editor (owner: remove it) |
| [ISS-010](issues/ISS-010.md) | Low | Bug | "Zoom to s…" label cut off |
| [ISS-011](issues/ISS-011.md) | Medium | Bug | Shift + drag deselects the piece, no straight-line move |
| [ISS-012](issues/ISS-012.md) | Medium | Gap | Esc during a drag does not cancel it |
