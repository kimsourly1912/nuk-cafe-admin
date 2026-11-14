# QA

How we find, record, fix and retest bugs and improvements. Testers can be a person, GPT or Claude working in a browser. Fixes are made by Claude Code. Agents: start with [STANDARD.md](STANDARD.md) section 0.

| File | Use |
|---|---|
| [STANDARD.md](STANDARD.md) | The rules: roles, flow, status, severity, evidence. Read first. |
| [RETEST-QUEUE.md](RETEST-QUEUE.md) | Everything built and waiting for a retest, with who can test it and the steps. |
| [VERIFIED.md](VERIFIED.md) | Items that passed a retest, with date, commit and evidence. |
| [_templates/ISSUE.md](_templates/ISSUE.md) | One finding (bug, gap or improvement). |
| [_templates/CHECK.md](_templates/CHECK.md) | One tool or interaction, step by step, Pass or Fail. |
| [_templates/RETEST.md](_templates/RETEST.md) | The result of a retest. |
| [_templates/INBOX.md](_templates/INBOX.md) | Raw notes while the owner reports findings one by one (mode A). |
| [_templates/AGENT-PROMPT.md](_templates/AGENT-PROMPT.md) | Prompt to paste into GPT or Claude to start a browser test session. |

## Start a new QA area

```text
docs/qa/<area>/
  README.md          goal, reference, one status table (ID, severity, type, status, title)
  issues/ISS-xxx.md  from _templates/ISSUE.md
  checks/<ID>.md     from _templates/CHECK.md
  evidence/<ID>/     screenshots and GIFs
  INBOX.md           raw owner reports, emptied at "done" (mode A)
  SMOKE.md           about 10 checks to re-run before a release (from Verified items)
```

History: the first area, "Studio vs Figma" (ISS-001 to ISS-036) and the editor checks (RECT-01, CIRC-01, GUIDE-01, ED-01 to ED-11), was removed from this folder on 2026-11-14 after its rules were extracted here. The full files and images stay in git history before that change. What still needs a retest is in [RETEST-QUEUE.md](RETEST-QUEUE.md).
