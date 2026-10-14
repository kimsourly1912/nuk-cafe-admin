# Documentation navigation

Start with [AGENTS.md](../AGENTS.md), classify the task, then read the relevant sections. This index and every ordinary Markdown link are navigation, not automatic imports or a request to read all linked files. Search headings before opening large pages:

```bash
rg -n '^#{1,3} ' docs/reference/forms.md
sed -n '267,289p' docs/reference/forms.md
rg -n '^### D(135|140|141):' docs/decisions.md
```

Use the returned line numbers and stop at the next heading at the same level. For a decision, stop at the next `### D…` heading, including its lower-level subsections. Expand context when an affected rule references a dependency, not because the document has more links.

## Task-specific rules

| Work | First relevant documents | Expand for |
|---|---|---|
| UI copy/button | [UI](reference/ui.md): typography, actions, accessibility; [review checklist](reference/ui-review-checklist.md) affected items | Layout changes: page patterns and responsive rules |
| Responsive UI | [Responsive layout](reference/responsive-layout.md), [page patterns](reference/page-patterns.md), UI, review checklist | [UI standardization plan](plans/ui-standardization.md) for rollout/owner decisions; shell section if touched |
| Forms | [Forms](reference/forms.md), UI §17, [CRUD](guides/crud.md) | Mutations/errors, schema mapping and verification in [feature standard](feature-standard.md) |
| Queries/writes | [Data fetching](reference/data-fetching.md), [mutations](reference/mutations.md), [errors](reference/errors.md), CRUD | Relevant helpers and server domain invariants if the API changes |
| App boundaries | [App architecture](guides/app-architecture.md) | [Feature public APIs](reference/features.md), reference index, domain plan |
| Server | [Server index](server/README.md), [architecture](server/architecture.md), [security](server/security.md) route checklist | Affected [data-model](server/data-model.md) domain; operations for side effects/jobs |
| Auth/tenant isolation | Security identity/roles/sessions/request protection; [auth](reference/auth.md), [shell](guides/app-shell.md) | [App behavior](reference/app-behavior.md) session contract; [multi-tenant](plans/multi-tenant.md) for boundary changes |
| Database/payment | Data-model domain, architecture versions/batches/idempotency, security permissions | [Operations](server/operations.md) migrations/configuration, [KHQR](plans/khqr.md), domain plan |
| Deploy/operations | Operations environments/configuration/deploys/backups/monitoring | [Release check](plans/release-check.md), progress environment notes and open questions |
| New feature | [Feature standard](feature-standard.md), applicable standards and domain plan | [Blueprint](plans/system-blueprint.md) journeys; mockup/owner workflow for new screens |
| Tests | [Development](guides/development.md) commands/checks/tests | [Progress](progress.md) "How to verify" for affected harness/flake; reference edge-case tables |
| Shared helper | [Reference index](reference/README.md) Pages/API table or [catalog](guides/project-map.md#shared-building-blocks-root-auto-imported) | Only the helper's owning section in ui-helpers/app-behavior/etc. |

The five guides preserve former root instructions: project identity/resource/catalog map, app feature boundaries, CRUD recipes, authentication/shell, and development/checks/conventions. They are mandatory for tasks in their scope, retrieved by section. API signatures and behavior live in the existing reference pages; update the owning page and affected guide summary together.

## Authority and history

- **Always required:** root security, tenant, permission, data-integrity, session and architecture invariants; verification and documentation maintenance rules.
- **Task-specific:** current feature standard and reference/server pages; extracted guide rules; accepted domain-plan requirements. `[Open]`, `[Proposed]` and deferred plan items do not authorize behavior. New screens retain the feature standard's mockup workflow unless the owner waived it.
- **Historical/on demand:** completed phases, old implementation evidence and decision context. A plan can contain both current domain rules and completed steps. Check current status before resuming it.

Read [current-state navigation](current-state.md) only for resumption/planning, then the relevant progress section. Search [decision index](decision-index.md) by ID/domain, read that entry and follow-ups when changing a pattern. D1–D5 describe a replaced stack; D39/D43/D71/D95/D135/D140/D141 explain subsequent changes. Earlier dates and "verified then" evidence are not current deployment status. Preserve existing IDs and anchors.

Root invariants apply everywhere. Task standards own their details; newer explicitly accepted decisions can supersede older rules, but must be reflected in the standards. When current documents disagree without an explicit supersession, record the conflict and defer only the dependent work. The known conflicts in [current-state](current-state.md) are not permission to invent policy.

## Maintenance and agent loading

Keep `CLAUDE.md` as a small wrapper importing only root `AGENTS.md`. Do not add history, this index or guides to its import graph. Keep root guidance below 8 KiB as a local maintenance budget (not an agent limit). No nested instruction files or skills are needed for this structure; future directory-specific rules must keep universal invariants and account for the different discovery models.

Update progress and current-state when active work/blockers change. Append/update decisions and regenerate the heading index when an ID/title changes. Regenerate by extracting each `### D<number>:` heading in order and linking its GitHub heading slug; retain the domain navigation and history notice. The [audit](context-audit.md) and [baseline inventory](documentation-inventory.md) are evaluation artifacts, not required task context.

Codex and Claude discovery, links versus imports, skills, estimates and manual fresh-session checks are documented with official sources in the audit. Settings/user memory/host wrappers can add context; verify the actual loaded files in each client.
