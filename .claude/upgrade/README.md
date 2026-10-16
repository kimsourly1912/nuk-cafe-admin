# Dependency upgrade workflow

A reusable workflow for upgrading packages (Nuxt, Nuxt UI, Better Auth, Drizzle,
anything) with Claude Code, using the right model per task to save tokens.

---

## 1. What lives where

```text
PERMANENT (committed once, reused for every upgrade)
.claude/
  commands/upgrade-*.md      saved prompts → /upgrade-0-setup … /upgrade-6-finish
  agents/                    helpers with their own model
    upgrade-scanner.md         Haiku – read-only search
    bulk-editor.md             Haiku – one exact mechanical edit
    upgrade-debugger.md        Opus  – read-only diagnosis
  upgrade/
    README.md                this file
    RULES.md                 rules every upgrade command follows
    profile.md               THIS project's stack, scan areas, sources, high-risk areas
    HANDOFF.template.md      template for a run's state file
scripts/upgrade-verify.sh    typecheck / lint / test / build, logs to files
CLAUDE.md                    3-line pointer (see CLAUDE.md.snippet)

PER RUN (created by /upgrade-0-setup, deleted by /upgrade-6-finish)
upgrade/
  HANDOFF.md                 current state: phase, decisions, done, blocked
  inventory.md               what the app uses today
  breaking-changes.md        what changed upstream, mapped to the app
  plan.md                    ordered steps
  review.md                  final review
  logs/                      verify logs (gitignored)

HISTORY (kept)
docs/upgrades/<date>-<name>.md   short record of each finished upgrade
```

**Generic vs. project-specific.** The commands, agents, rules and script work
for any package. Everything specific to this repo (Nuxt, Nuxt UI, NuxtHub,
Better Auth, Drizzle) is in `profile.md`. When the stack changes, edit only
`profile.md`.

---

## 2. Core ideas (why it is built this way)

1. **One model per session.** Each model has its own prompt cache. Switching
   model in a long session makes the next turn re-read everything uncached.
   Pick the model in the first message of a session, when the context is empty.
2. **Other models through subagents.** A subagent is a separate helper
   conversation with its own model and fresh context. The main session calls
   it like a tool and receives only its short report. No model switch, no cache loss.
3. **State in files, not in the chat.** Every session starts from
   `upgrade/HANDOFF.md`. New sessions are cheap, and the work is resumable.
4. **One plan step = one commit, pushed to the upgrade branch.** Easy to
   review and revert. The next session (cloud or local) starts from the pushed branch.
5. **You approve at two points:** after breaking changes (Phase 2) and after
   the plan (Phase 3). You merge the PR yourself.

---

## 3. One-time install

On your machine, from the repo root:

```bash
git checkout main && git pull
git checkout -b chore/add-upgrade-workflow

# copy the kit (adjust the path to where you unzipped it)
cp -r ~/Downloads/upgrade-kit/.claude .
cp -r ~/Downloads/upgrade-kit/scripts .
chmod +x scripts/upgrade-verify.sh

# keep verify logs out of git
grep -qxF 'upgrade/logs/' .gitignore || echo 'upgrade/logs/' >> .gitignore
```

Then:

1. Append the content of `CLAUDE.md.snippet` to your existing `CLAUDE.md`
   (don't replace your file).
2. Open `.claude/upgrade/profile.md` and fix anything that is not true for this repo.
3. Check `package.json` has a `typecheck` script (`"typecheck": "nuxt typecheck"`)
   and that `test` does not run in watch mode (`vitest run`).
4. Test the script: `scripts/upgrade-verify.sh smoke && cat upgrade/logs/smoke/SUMMARY.md`
   (then `rm -rf upgrade`).
5. Commit, push, merge to `main` through a normal PR.

From now on every branch has the workflow.

---

## 4. Running an upgrade (cloud sessions at claude.ai/code)

For each session: **New session** on the repo → first message `/model <x>` →
second message the command. When a session is done, start a new one.

| # | First message | Then | You do after |
|---|---|---|---|
| A | `/model sonnet` | `/upgrade-0-setup nuxt@latest @nuxt/ui@latest`, then `/upgrade-1-inventory` | Skim `upgrade/inventory.md` |
| B | `/model sonnet` | `/upgrade-2-changes` | **Review `breaking-changes.md`** (most valuable 10 minutes) |
| C | `/model opus` | `/upgrade-3-plan` | Discuss the plan in this session, answer `Decisions` in `HANDOFF.md`, commit |
| D… | `/model sonnet` | `/upgrade-4-execute S1-S3`, next session `S4-S6`, … | Manual-test `risk: high` steps locally |
| E | `/model opus` | `/upgrade-5-review` | Read `review.md`; fix `R*` items with `/upgrade-4-execute R1-R2` (Sonnet) |
| F | `/model sonnet` | `/upgrade-6-finish` | Open and merge the PR |

**Effort per session** (set it together with the model, before the first message):

| Session | Model | Effort | Why |
|---|---|---|---|
| A setup + inventory | Sonnet | medium | Mechanical; the Haiku scanners do the reading |
| B breaking changes | Sonnet | **high** | A missed breaking change is the most expensive mistake |
| C plan | Opus | **high** | Ordering and risk judgment |
| D execute (low/medium-risk steps) | Sonnet | medium | Clear scope, verify catches errors |
| D execute (a `risk: high` step) | Sonnet | **high** | Auth, data, server behavior; run it alone in its own session |
| E review | Opus | **high** (xhigh if the diff touches auth heavily) | Security review |
| F finish | Sonnet | low | Writing a short summary |

Subagents set their own effort in `.claude/agents/*.md`: scanner `medium`,
bulk-editor `low`, debugger `high`. Changing effort mid-session can invalidate
the prompt cache on Sonnet and Haiku (not on Opus 5.5), so set it at the start.

**Session A starts on `main`.** `/upgrade-0-setup` creates the
`chore/upgrade-<name>` branch and pushes it. **All later sessions must start on that branch.**

Lost? New Sonnet session → `/upgrade-resume`. It tells you the next command and model.

**Small upgrade** (patch/minor, few affected items): you can run A to D in one
Sonnet session and skip E.

**Terminal instead of cloud:** start with `claude --model sonnet` instead of
`/model sonnet`, and `/clear` works between phases.

---

## 5. What runs automatically

You only type the slash commands. The commands tell the main Claude when to use helpers:

| Command | Helpers it calls |
|---|---|
| `/upgrade-1-inventory` | several `upgrade-scanner` (Haiku) in parallel |
| `/upgrade-2-changes` | `upgrade-scanner` for extra lookups |
| `/upgrade-4-execute` | `bulk-editor` (Haiku) for mechanical steps; `upgrade-debugger` (Opus) after 2 failed fixes |

They appear as task blocks in the same chat. You don't talk to them.

---

## 6. Escalation

| Situation | What happens |
|---|---|
| Same error after 2 fix attempts | `upgrade-debugger` (Opus subagent) diagnoses |
| Debugger fix fails | Step `blocked`, details in `HANDOFF.md`, session stops |
| Plan looks wrong | `HANDOFF.md → Plan issues`, session stops → new Opus session re-plans affected steps |
| Docs unclear | Marked `unknown`, you decide |

---

## 7. Saving tokens

- Don't paste logs into the chat; point to `upgrade/logs/<label>/…`.
- New session when the current one gets long. HANDOFF makes it cheap.
- Avoid `opusplan`; it switches models every time plan mode toggles.
- `/usage` shows usage; newer versions show the prompt-cache hit ratio.
- Wrong direction? `/rewind` (terminal) instead of arguing. It keeps the cache.

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `/upgrade-…` not in autocomplete | Files must be in `.claude/commands/` on the branch the session cloned |
| Subagent not found | Files must be in `.claude/agents/`; type `@agent-` to check |
| Session can't see last session's work | The branch wasn't pushed, or the new session started on `main` |
| `npm` not installed in cloud VM | Add the install command to the cloud environment's setup script, or let the command install it |
| typecheck always SKIP | Add a `typecheck` script |
| Test step hangs | `test` runs vitest in watch mode; use `vitest run` |
| It tries to push to `main`, force push, reset, stash | Deny. Say: `Follow .claude/upgrade/RULES.md` |
| Subagents not on Haiku/Opus | Check `CLAUDE_CODE_SUBAGENT_MODEL` is not set; check your org's model allowlist |

Docs: [skills & commands](https://code.claude.com/docs/en/skills) ·
[subagents](https://code.claude.com/docs/en/sub-agents) ·
[prompt caching](https://code.claude.com/docs/en/prompt-caching) ·
[cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web)
