# QA standard

The rules for finding, recording, fixing and retesting problems in this project. Every QA agent and every fixer reads this file first. People: read [GUIDE.md](GUIDE.md) instead.

Status of these rules: sections 1 to 4 and 6 to 12 were used in practice (Studio vs Figma QA, 2026-11). Section 5 (retest and Verified) is not proven yet. After the first retest round, confirm or change it and remove this note.

## 0. Read order

1. This file. Start the session with `QA mode A, area <area>` or `QA mode B, area <area>` (section 3a).
2. The area README (`docs/qa/<area>/README.md`) if it exists: goal, reference, status table.
3. The issue or check file you were given.
4. `AGENTS.md` (project rules), only for fixers, and only the sections the task needs.

Pick the template you need from `_templates/`:

| You are | Template |
|---|---|
| Recording one finding | `ISSUE.md` |
| Checking one tool step by step | `CHECK.md` |
| Retesting a fix | `RETEST.md` |
| Starting a browser test session with GPT or Claude | `AGENT-PROMPT.md` |

## 1. Roles

| Role | Does | Does not |
|---|---|---|
| Tester (owner, GPT or Claude in a browser) | Runs the steps, captures evidence, compares with the reference, classifies, writes the issue or check file, retests. | Edit app code. Decide a business rule. Mark an issue `Verified` without new evidence. |
| Fixer (Claude Code) | Reads the issue file, fixes only what it describes, runs "How to verify", sets the status to `Fixed, needs retest`, fills the "Work" section. | Mark an issue `Verified`. Refactor unrelated code. Merge or push to main without being asked. |
| Owner | Decides policy and scope. Writes the decision in the file with a date. | |

The repo file is the only source of truth. Do not keep a second tracker (a sheet, a board). A spreadsheet may be used as a personal worksheet, but nothing counts until the file says it.

## 2. Two kinds of QA

- **Compare with a reference** (for example Figma). Run the same steps in the reference and in our app from the same start state. Differences become issues.
- **Check one tool** step by step. One check file per tool or interaction. Each step has an expected result and a Pass or Fail. Failures link to issues.

## 3. Flow

1. Pick one check (one row or one tool). Write the exact start state.
2. Run it in the reference. Capture evidence.
3. Run the same steps in our app from the same start state. Capture evidence.
4. Compare. Classify (Bug, Gap or Improvement) and rate severity.
5. Read the code to name a suspected cause. Mark it `unverified` until the fixer confirms. Do not edit code.
6. Write the issue or check file. Put images in `evidence/<ID>/`. Update the area README table.
7. The fixer fixes from the file and sets the status.
8. The tester retests with `RETEST.md` and new evidence. Pass becomes `Verified`. Fail becomes `Reopened`.

Do one check at a time. Write its file before you start the next one.

## 3a. Two ways to collect findings (same flow after intake)

Start the session with one line so the agent knows the mode: `QA mode A, area <area>` or `QA mode B, area <area>`.

| | Mode A: owner reports | Mode B: paired browser session |
|---|---|---|
| Who finds it | The owner, one report at a time | The owner and an agent, testing together |
| Evidence | The owner's screenshots and words | The agent captures, plus the owner's |
| Reference value | `unverified` unless the owner states it | Checked in the reference during the session |
| Reproduced by the agent | No, not yet | Yes, or `Not tested: tool cannot <action>` |

**Mode A.** The agent does not write issue files while the owner is still reporting. It appends each report to `docs/qa/<area>/INBOX.md` (from [_templates/INBOX.md](_templates/INBOX.md)): the owner's own words, the time, and any image saved under `evidence/inbox/`. The agent does not invent expected values, steps or causes. When the owner says "done", the agent:

1. Merges duplicates and checks each report against existing issues.
2. Writes one issue file per finding (`ISSUE.md`). A report without clear steps is `Needs details`, with the questions listed. A report with steps is `Open`.
3. Sets `Found:` to `owner by eye` and keeps unverified reference values marked `unverified`.
4. Updates the area README table, then clears the inbox (git history keeps it).

**Mode B.** Follow the flow in section 3. Set `Found:` to `paired session, agent reproduced` (or `... not reproduced` for steps the agent could not do).

Either way, the result is the same files: issue file, evidence, README table row. The fixer does not need to know which mode produced it, only the `Found:` line, which tells how far to trust the steps.

## 4. Status

| Status | Meaning | Who sets it |
|---|---|---|
| Open | Found, ready to fix. | Tester |
| Needs details | The symptom or steps are not clear enough to fix or reproduce. List what is missing. | Tester or fixer |
| Needs owner decision | A policy or scope choice blocks the fix. State the question. | Tester or fixer |
| In progress | The fixer is working on it. | Fixer |
| Fixed, needs retest | Built and tested by the fixer. Waiting for the tester. Not done yet. | Fixer |
| Verified | Retest passed with new evidence. | Tester only |
| Reopened | Retest failed. Add what still happens. | Tester |
| Not reproduced | The fixer could not see it. The tester retests with exact steps. | Fixer |
| Won't fix | Decided not to build. Give the reason and the decision date. | Owner |
| Closed, not built | Built on purpose differently or not at all, nothing left to test. Give the reason. | Owner |

Write the date and the branch or PR next to every status change.

## 5. Retest rules (draft)

- Retest on the deployed app (staging), with a real mouse and trackpad, not only a test runner. Record the deployed commit.
- Follow the file's "How to verify" exactly. Save new evidence under the same ID folder, named `retest-<app>-<nn>-<what>`.
- `Verified` needs the tester's new evidence for every step. If one step fails, the issue is `Reopened`.
- A step the agent cannot do is `Not tested`, not `Pass`. The issue stays `Fixed, needs retest` until a person does that step by hand.
- Check the regression test named in the issue (section 11). If it is missing, say so in the retest result.

### Retest queue (`RETEST-QUEUE.md`)

One table per area. Every row has these columns:

| Column | Content |
|---|---|
| ID | Issue or check ID, with severity |
| Status | `Fixed, needs retest`, `Reopened` or `Waiting for ...` |
| Who | `Agent` (a scripted browser can do every step), `By hand` (needs a held key, trackpad, real wheel or timing), or `Both` |
| Reference value | What the reference does, with numbers |
| Steps and expected result | Short, exact. The issue file has the full steps. |

### Verified log (`VERIFIED.md`)

When an item is `Verified`, move its row from the queue to `VERIFIED.md` with: ID, date, deployed commit, tester, evidence path. Never just delete a row. Keep the issue file and its evidence until it is in the log, then it may be removed (git history keeps it).

### Smoke list

Each area keeps a short list (about 10 checks) of the items that reached `Verified`, in `docs/qa/<area>/SMOKE.md`. Re-run it before a release and after a large change to that area.

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
- Record: app build or commit, browser, window size, zoom, input device (mouse, trackpad or scripted).
- Do not put personal data, real customer data, secrets or tokens in a screenshot. Crop or hide them.

## 8. Writing steps that an agent can run

- One start state: page, zoom, selection, tool, window size, test data.
- Numbered steps. Each step names the exact target and the action (hover, press, drag, key).
- Say what to see before pressing, during the action and after release.
- Use numbers: pixels, centimetres, percent, degrees. "Smooth" and "fast" are not results.
- If a reference value is from memory or not checked, write `unverified`.
- One step, one result. Do not combine two checks in one step.

## 9. Agent limits (say them in the file)

- A scripted browser cannot always do real input: holding a key during a drag, trackpad pinch, hardware wheel steps, real hover timing, cursor shape. If a step needs it, write `Not tested: tool cannot <action>` and ask the owner to test by hand. Do not guess a result.
- Do not report a result you did not see. A missing capture is `Needs retest`, not `Pass`.
- When the owner reports a symptom without detail, set `Needs details` and list what to collect (what exactly looks wrong, which step, when).
- Do not decide a product rule in your own words. Ask, and write the answer with a date.

## 10. Test safety (tester)

- Use test data or a scratch page. Do not change real customer, order, payment or layout data.
- Never press Save, Publish, Submit, Delete or any action that writes real data unless the owner said so for that check. If a check needs it, the owner says which record to use.
- Leave the app as you found it: undo, discard or reload test changes. Say in the file what you changed and how you restored it.
- Do not log in with real credentials unless the owner gave you the account for this test. Never write passwords or tokens in a file.
- The tester pushes only evidence and QA files, only to the QA branch the owner named. No PR and no merge without being asked.

## 11. Owner decisions and fixes

Owner decisions: write each one in the file with the question, the answer and the date. If a decision changes architecture or stored data, also record it in `docs/decisions.md`, as the project does.

Fixer rules (details in `AGENTS.md`):

- A fix keeps tenant scoping, the version check (409 on stale) and one atomic batch for layout writes.
- A new guard (version, lock, idempotency, permission) is checked by removing it and seeing a test fail.
- Pure geometry and view math go in small functions with unit tests.
- Every fixed issue names a **regression test** (unit or e2e) in its "Work" section, or says why none is possible.
- Update `docs/progress.md` and the issue status. Do not set `Verified`.

## 12. Definition of done

An issue is done only when all of these are true:

1. The fixer set `Fixed, needs retest` with branch or PR and the regression test.
2. The tester retested on staging with new evidence and set `Verified`.
3. The row moved from `RETEST-QUEUE.md` to `VERIFIED.md`.
4. The area README table and, if used, `SMOKE.md` are current.
