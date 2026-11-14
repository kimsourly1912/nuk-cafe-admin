# QA standard

Draft. Written from the Studio vs Figma QA. Everything up to "Fixed, needs retest" was used in practice. The retest and "Verified" rules (section 5) are not proven yet: confirm or change them after the first retest round.

## 1. Roles

| Role | Does | Does not |
|---|---|---|
| Tester (owner, GPT or Claude in a browser) | Runs the steps, captures evidence, compares with the reference, classifies, writes the issue or check file, retests. | Edit code. Guess a business rule. Mark an issue Verified without new evidence. |
| Fixer (Claude Code) | Reads the issue file, fixes only what it describes, runs "How to verify", sets the status to `Fixed, needs retest`, adds a "Work" note. | Mark an issue `Verified`. Refactor unrelated code. Merge or push without being asked. |
| Owner | Decides policy and scope. Writes the decision in the file with a date. | |

The file is the source of truth. A test counts as logged only when the file and any tracker (the sheet) agree.

## 2. Two kinds of QA

- **Compare with a reference** (for example Figma). Run the same steps in the reference and in our app from the same start state. Differences become issues.
- **Check one tool** step by step. One check file per tool or interaction. Each step has an expected result and a Pass or Fail. Failures link to issues.

## 3. Flow

1. Pick one check (one row or one tool). Write the exact start state.
2. Run it in the reference. Capture evidence.
3. Run the same steps in our app from the same start state. Capture evidence.
4. Compare. Classify (Bug, Gap or Improvement) and rate severity.
5. Read the code to name a suspected cause. Mark it `unverified` until the fixer confirms. Do not edit code.
6. Write the issue or check file. Add images to `evidence/<ID>/`. Update the area README table.
7. The fixer fixes from the file and sets the status.
8. The tester retests with [RETEST.md](_templates/RETEST.md) and new evidence. Pass becomes `Verified`. Fail becomes `Reopened`.

## 4. Status

| Status | Meaning | Who sets it |
|---|---|---|
| Open | Found, ready to fix. | Tester |
| Needs details | Symptom or steps are not clear enough to fix or reproduce. List what is missing. | Tester or fixer |
| Needs owner decision | A policy or scope choice blocks the fix. State the question. | Tester or fixer |
| In progress | Fixer is working on it. | Fixer |
| Fixed, needs retest | Built and tested by the fixer. Waiting for the tester. Not done yet. | Fixer |
| Verified | Retest passed with new evidence. | Tester only |
| Reopened | Retest failed. Add what still happens. | Tester |
| Not reproduced | The fixer could not see it. Tester retests with exact steps. | Fixer |
| Won't fix | Decided not to build. Give the reason and the decision date. | Owner |

Put the date and branch or PR next to the status.

## 5. Retest rules (draft)

- Retest on the deployed app (staging), with a real mouse and trackpad, not only a test runner.
- Follow the file's "How to verify" exactly. Capture new evidence under the same ID folder, named `retest-<app>-<nn>-<what>`.
- `Verified` needs the tester's new evidence for every step in "How to verify". If one step fails, the issue is `Reopened`.
- Keep [RETEST-QUEUE.md](../RETEST-QUEUE.md) current: remove an item when it is `Verified`.

## 6. Severity and type

- Blocker: the feature cannot be used, or data is lost.
- High: a main flow is broken or very hard to use.
- Medium: works, but wrong or missing in a way users will notice.
- Low: small, cosmetic or rare.

Types: **Bug** (does something wrong), **Gap** (the reference has it, we do not), **Improvement** (works, but could feel better).

## 7. Evidence rules

- Name files `<app>-<nn>-<what>.png|jpg|gif`, for example `figma-01-before.png`, `studio-02-after-zoom.gif`.
- Every Fail or Info result has at least one image from the reference and one from our app, from the same start state.
- Anything over time (speed, easing, a toast, a guide line) needs a GIF or a table of measured numbers, not one frame. A single late screenshot misses short feedback (a toast can vanish in 300 ms).
- A Pass gets an image only when the result is not obvious.
- Record: app build or commit, browser, window size, zoom, the input device (mouse, trackpad or scripted).

## 8. Writing steps that an agent can run

- One start state: page, zoom, selection, tool, window size, test data.
- Numbered steps. Each step names the exact target and the action (hover, press, drag, key).
- Say what to see before pressing, during the action and after release.
- Use numbers: pixels, centimetres, percent, degrees. "Smooth" and "fast" are not results.
- If the reference value is from memory or not checked, write `unverified`.

## 9. Agent limits (say them in the file)

- A scripted browser cannot always do real input: holding a key during a drag, trackpad pinch, hardware wheel steps, real hover timing. If a step needs it, write `Not tested: tool cannot <action>` and ask the owner to test by hand. Do not guess a result.
- Do not report a result you did not see. A missing capture is `Needs retest`, not `Pass`.
- When the owner reports a symptom without detail, set `Needs details` and list what to collect (what exactly looks wrong, which step, when).

## 10. Owner decisions

Write each decision in the file: the question, the answer, the date. If a decision changes architecture or stored data, also record it in `docs/decisions.md` as the project does. Do not decide business policy in an agent's own words.

## 11. Code and security notes for fixers

- A fix keeps the project's rules (`AGENTS.md`): tenant scoping, version check with 409 on stale, one atomic batch for layout writes.
- A new guard (version, lock, idempotency) is checked by removing it and seeing a test fail.
- Pure geometry and view math go in small functions with unit tests.
