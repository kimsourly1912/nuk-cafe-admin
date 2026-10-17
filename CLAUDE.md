# Claude Code

Shared project rules and task routing:

@AGENTS.md

Keep this wrapper minimal; update the shared rules or their owning guide. Retrieve task documentation as directed there; do not import history here.

## Dependency upgrades

- Package upgrades follow the `/upgrade-*` workflow. Read `.claude/upgrade/README.md` for how it works.
- Rules: `.claude/upgrade/RULES.md`. Stack profile: `.claude/upgrade/profile.md`.
- When an `upgrade/HANDOFF.md` file exists, an upgrade run is active: read it before doing upgrade work.
