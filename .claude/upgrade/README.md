# Dependency upgrade workflow

Upgrade packages (Nuxt, Nuxt UI, Better Auth, Drizzle, anything) with **one command in one
Claude Code session**, from start to an open PR. Each phase runs on the model it needs, and
the run stops for the owner only on a hard stop (D277).

```bash
claude --permission-mode auto      # or start a session and switch to auto mode
/upgrade nuxt@latest @nuxt/ui@latest
```

Interrupted (terminal closed, limit reached)? Start a session on the run's branch and type
`/upgrade` with no arguments: it resumes from `upgrade/HANDOFF.md`.

---

## 1. What lives where

```text
PERMANENT
.claude/
  commands/upgrade.md          the command: orchestrates every phase (Sonnet, medium)
  agents/
    upgrade-scanner.md           Haiku  – read-only search (phase 1, several in parallel)
    upgrade-researcher.md        Sonnet – breaking changes (phase 2)
    upgrade-planner.md           Opus   – audit + plan, re-plan (phase 3)
    bulk-editor.md               Haiku  – one exact mechanical edit (phase 4)
    upgrade-executor.md          Sonnet – low/medium-risk steps (phase 4)
    upgrade-executor-deep.md     Opus   – high-risk steps, escalations, R and F steps
    upgrade-debugger.md          Opus   – read-only diagnosis after two failed attempts
    upgrade-reviewer.md          Opus   – read-only review of the whole diff (phase 6)
  upgrade/
    README.md                  this file
    RULES.md                   rules every phase and agent follows, incl. the hard stops
    profile.md                 THIS project's stack, scan areas, sources, high-risk areas
    HANDOFF.template.md        template for a run's state file
scripts/upgrade-verify.sh      typecheck / lint / test / build (/ e2e), logs to files
scripts/upgrade-smoke.sh       the deploy's smoke checks against the staging Worker, locally

PER RUN (created in phase 0, removed in phase 7)
upgrade/
  HANDOFF.md                   current state: phase, decisions, done, blocked
  inventory.md                 what the app uses today
  breaking-changes.md          what changed upstream, mapped to the app
  plan.md                      ordered steps
  review.md                    final review
  logs/                        verify, smoke and release logs (gitignored)

HISTORY (kept)
docs/upgrades/<date>-<name>.md   short record of each finished upgrade
```

The command, agents, rules and scripts are generic. Everything specific to this repo is in
`profile.md`. When the stack changes, edit only `profile.md`.

---

## 2. Core ideas

1. **One session, many models.** The command sets its own model (Sonnet). Phases that need
   judgment or a lot of reading run in subagents, each with its own model and a fresh
   context. The main session never switches model, so its prompt cache stays valid, and it
   reads only short reports, so its context stays small.
2. **State in files, not in the chat.** `upgrade/HANDOFF.md` holds the state, committed and
   pushed after every phase and step. Any session can resume.
3. **One plan step = one commit**, pushed to `chore/upgrade-<name>`. Easy to review and revert.
4. **Agents check agents instead of the owner.** The planner audits the research; a separate
   reviewer reviews the diff; release checks compare the build with the baseline.
5. **Decide, record, continue.** Technical questions are decided by Claude and recorded in
   `HANDOFF.md → Decisions`. Business or authorization policy is a hard stop.

---

## 3. The phases

| # | Phase | Who | Output |
|---|---|---|---|
| 0 | Setup, versions, baseline (verify, staging build, smoke, dry-run, startup) | main | `HANDOFF.md`, `logs/baseline/` |
| 1 | Inventory | `upgrade-scanner` ×N (Haiku) | `inventory.md` |
| 2 | Breaking changes | `upgrade-researcher` (Sonnet, high) | `breaking-changes.md` |
| 3 | Audit + plan | `upgrade-planner` (Opus, high) | `plan.md`, decisions |
| 4 | Execute, step by step | `bulk-editor` / `upgrade-executor` / `upgrade-executor-deep` | one commit per step |
| 5 | Release checks: verify + e2e, staging build, `wrangler.json` diff, dry-run, startup, smoke | main | `logs/release/` |
| 6 | Review, R fixes, re-review | `upgrade-reviewer` (Opus, high) | `review.md` |
| 7 | Record, profile lessons, PR | main | `docs/upgrades/…`, the PR |
| 8 | CI, fixed through the `/fix-ci` steps | main + `ci-*` agents | green PR |

Escalation in phase 4: executor (2 attempts) → `upgrade-debugger` → `upgrade-executor-deep`
→ one re-plan by `upgrade-planner` → hard stop. A new release-check failure becomes an `F`
step on `upgrade-executor-deep` (at most two).

---

## 4. When it stops

Only for the hard stops in `RULES.md`: a guard change, an auth-configuration behavior change,
a new database migration, a business or authorization policy question, a module that doesn't
support the target, a step still blocked after every escalation, a Critical finding still open
after the re-review. The stop report says why, where the prepared change is, and the one
thing to do; then `/upgrade` resumes.

You still merge the PR yourself. When a target touches authentication, the PR starts with a
line asking you to test sign-in, sign-out and session expiry on staging first.

---

## 5. Saving tokens

- The main session never reads source code or whole logs; agents read and report.
- Every log is a file under `upgrade/logs/`; agents read only `SUMMARY.md` and failing lines.
- Opus runs only where judgment matters: audit, plan, high-risk steps, diagnosis, review.
- `/usage` (or `/cost`) shows what a run used.

---

## 6. Troubleshooting

| Problem | Fix |
|---|---|
| `/upgrade` not in autocomplete | The file must be in `.claude/commands/` on the branch you started from |
| Subagent not found | Files must be in `.claude/agents/`; type `@agent-` to check |
| It keeps asking for permission | Start in auto mode (`claude --permission-mode auto`); accept-edits mode still asks before commands like `pnpm add` |
| Can't resume | The branch wasn't pushed, or the session started on `main`: check out `chore/upgrade-<name>` |
| Smoke: "No Worker build" | `pnpm build:staging` must run first; `/upgrade` does it |
| Subagents not on Haiku/Opus | Check `CLAUDE_CODE_SUBAGENT_MODEL` is not set; check your org's model allowlist |

Docs: [skills & commands](https://code.claude.com/docs/en/skills) ·
[subagents](https://code.claude.com/docs/en/sub-agents) ·
[permission modes](https://code.claude.com/docs/en/permission-modes) ·
[prompt caching](https://code.claude.com/docs/en/prompt-caching)
