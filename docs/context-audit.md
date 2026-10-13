# Agent documentation audit

Audit baseline: `327e4cd` on `main`, 2026-10-13. Scope: root agent instructions and `docs/**`; no implementation audit. Inventory used sizes, headings, links and targeted sections before reading the startup rules in full.

## Findings and proposal (before implementation)

- Startup: `AGENTS.md` is 42,137 bytes; `CLAUDE.md` imports it and the 128,708-byte progress log. The 445,422-byte decisions log is referenced, not automatically imported. Root instructions also tell every agent to read progress at every session, amplifying retrieval cost.
- Detailed architecture, CRUD recipes, shell behavior, commands and the shared-component catalog belong to specific tasks. They overlap existing reference pages. Preserve the recipes in five selectively read guides; maintain API signatures in the existing reference pages rather than creating another API standard.
- Keep tenant isolation, permission enforcement, atomic guarded writes, payment idempotency, session boundaries and feature boundaries in startup context. Route UI, forms, server, database, authentication, verification and deployment tasks explicitly to the relevant standards.
- Replace mandatory history loading with a task index, a compact resumption summary and a decision heading index. Preserve every existing decision ID and historical body; section searches supply detail.
- Confirmed contradictions: the server README still calls a branch a Better Auth organization; security.md and D135 define organization = cafe/tenant. Old startup wording calls multi-tenancy "being built" despite completed T1. Its "every other path" customer-site rule omits counter and platform exceptions. Correct these summaries using existing documentation evidence.
- Unresolved status: progress mixes older tables, "awaiting review" notes and a header calling later work merged. Do not turn these into new completion claims. Flag them in the resumption summary. Old decisions D1–D5 describe the replaced Spring SPA; label history without rewriting those entries.

## Architecture and change scope

1. Minimal root `AGENTS.md`; `CLAUDE.md` imports only it. No automatic history imports.
2. `docs/README.md` routes tasks to existing standards and five extracted guides: project map/catalog, app architecture, CRUD, shell/session behavior, development/testing. Reading is by section where possible; a link is not an instruction to traverse its entire graph.
3. `docs/current-state.md` and `docs/decision-index.md` navigate the preserved progress/decision logs and domain plans. No bulk archival move that could break historical anchors.

Modify the root files, stale navigation references, the server README summary, and log introductions; append one documentation decision and progress note. Preserve existing standards and domain plans except targeted link corrections. Add this audit and a per-file inventory. Add no skills or nested instructions: path scope cannot express all cross-cutting tasks, and duplicating agent-specific discovery structures has no measured benefit here.

Trade-off: slightly more documentation on disk and explicit task retrieval, with much less startup context and no loss of recipes. Instructions remain prompts, not a new enforcement mechanism; existing lint, permission checks, tests and CI remain the enforcement layers.

## Validation approach

Compare exact file bytes and approximate tokens (Unicode characters / 4, rounded up; not tokenizer measurements). Evaluate eight tasks using explicit section manifests, including Codex's default instruction cap and Claude imports separately. Check relative file targets and Markdown anchors, automatic import reachability/cycles, all relocated section bodies, decision-ID preservation, and a documentation-only diff. Run the existing required lint, typecheck and unit/server checks; no changed application feature requires new browser tests. Record results and limitations below after implementation.

## Official loading behavior (verified 2026-10-13)

**Codex:** the [official AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md/) documents discovery once per run: global instructions, then Git root through working directory; at most one file per directory, choosing AGENTS.override.md, AGENTS.md, then configured fallback names. Deeper instructions take precedence. The default combined project budget is 32 KiB. This repository has no nested instruction files. That startup algorithm does not establish that every child directory's rules are preloaded when launched at root; inspect applicable nested rules explicitly before editing if added later. CLAUDE.md is not a default fallback unless configured. The [official skills guide](https://developers.openai.com/codex/skills/) describes metadata first, full skill instructions when selected. Skills are useful for reusable workflows, but moving invariants into a skill could make them dependent on activation.

**Claude Code:** [official memory guidance](https://code.claude.com/docs/en/memory) confirms ancestor/current-directory CLAUDE.md loading, descendant instructions when reading/writing/editing files there, and concatenation rather than file replacement. Relative `@` imports resolve from the importing file and expand at launch (recursive depth up to four). Imports reorganize text but retain its context cost. Current docs also describe native AGENTS.md support from v2.1.277, conditional on CLAUDE.md/local files and project-instruction settings; an imported AGENTS.md is deduplicated. Keeping the wrapper import supports older clients and avoids relying on a particular native-support setting. Path-scoped rules can narrow context; unscoped project rules are broad. The [official skills guide](https://code.claude.com/docs/en/skills) describes skill descriptions in context and full bodies on invocation, with activation controls.

**Links versus imports:** ordinary Markdown links are not the documented automatic discovery/import mechanism. Treating them as navigation is this project's retrieval convention, not a guarantee that an agent will never follow a link. Explicit task-reading instructions still cause tool reads. Neither client's Markdown instructions are hard enforcement of security: existing lint, server checks, tests and CI retain that role. No client configuration was changed.

**Nested rules/skills decision:** scoped instructions would be appropriate for genuinely directory-specific exceptions; task routing works across app/server/shared/tests and is portable here. No new nested instruction files, agent-specific skill copies or settings were created. Their differing discovery models make root routing plus shared documentation the smaller maintainable change.

**Fresh-session acceptance checks (not executed here):** launch Codex at root and at a relevant subdirectory and ask it to list instruction sources/task routes; confirm the root is present and no progress/decision log is preloaded. In Claude use `/context` and `/memory` to inspect loaded files, then a small UI task and a server task to inspect selective reads. Check local/global rules, auto memory and instruction settings if observations differ. Version-specific host behavior is not measured by this static audit.

## Measured sizes and estimate model

Bytes below are measured from files. Tokens are estimates `ceil(len(text) / 4)` where `len` counts Unicode characters; they are not actual model input usage. File totals sum the per-file rounded estimates. The unchanged decisions/progress bodies remain accessible; added headings/navigation/one decision increase disk size.

| File / repository context | Before bytes | After bytes | Before est. tokens | After est. tokens |
|---|---:|---:|---:|---:|
| `AGENTS.md` | 42,137 | 6,689 | 10,482 | 1,671 |
| `CLAUDE.md` | 305 | 216 | 77 | 54 |
| `docs/progress.md` | 128,708 | 129,470 | 32,083 | 32,273 |
| `docs/decisions.md` | 445,422 | 447,332 | 111,175 | 111,652 |

Claude repository startup import closure: **42,642 → 1,725 estimated tokens** (96.0% reduction in this modeled closure). Codex default 32 KiB project-cap case: **8,145 → 1,671** (79.5%). An uncapped Codex root would be **10,482 → 1,671**. The old root exceeded the documented default cap by 9,369 bytes, putting its tail at risk; no live cap/truncation trace was collected here.

These exclude system prompts, user/global rules, local memory, host wrappers, source, tool-output overhead and repeated turns. Hosts can inject more than the official discovery chain. No guaranteed billed-token reduction is claimed.

## Eight scenario evaluations

Static retrieval scenarios, not live Claude/Codex experiments. Before automatic context is the startup closure above for every row; after it is the compact root (plus the Claude wrapper). Before *workflow* totals assume the former "start every session here" instruction reads full progress and root; UI tasks also read the four formerly mandatory whole UI standards. Only additional selected existing-document sections are counted once. Former-root recipes are already included before, so their extracted guide sections are not counted twice. After totals count root plus the section manifest, and no automatic history. Claude totals include its wrapper. No whole decision log is counted before: it was never imported.

The totals are estimates for the specified tasks and may grow when a task needs more dependencies. Required docs are the manifests below. All tasks retain global invariants; the risk column states when expansion is still necessary.

| Scenario | Before workflow Codex / Claude | After workflow Codex / Claude | Unnecessary context avoided | Missing-rule risk / expansion |
|---|---:|---:|---|---|
| Change one button label | 59,916 / 59,993 | 3,890 / 3,944 | No progress/history, CRUD or backend context needed. | Copy/action accessibility preserved; reassess if control behavior changes. |
| Fix responsive resource index | 59,916 / 59,993 | 14,329 / 14,383 | No unrelated feature history, forms or data-model domains. | Compact composition, all widths, shell and accessibility remain explicit. |
| Add validated form field | 71,411 / 71,488 | 16,979 / 17,033 | No unrelated plans, deployments or full decision log. | Validation, unsaved input, secret drafts, errors and stale versions retained; expand domain rules for a business field. |
| Fix app API mutation | 51,564 / 51,641 | 13,100 / 13,154 | No UI layout or backend model unless endpoint/contract changes. | Locks, result handling, invalidation and session discard retained; server changes add server route. |
| Add backend menu service | 55,925 / 56,002 | 16,204 / 16,258 | No app layout, unrelated data-model domains or whole histories. | Tenant isolation, permissions, atomic writes and guard tests mandatory; expand relevant menu API/contracts before implementation. |
| Implement orders database migration | 56,531 / 56,608 | 16,497 / 16,551 | No unrelated UI, AI, marketing or whole decision history. | Migration/batch/D1 constraints and two-tenant tests retained; deployment adds deploy/backups/restore instructions. |
| Resume unfinished Telegram marketing work | 45,044 / 45,121 | 6,144 / 6,198 | Other phases and decision bodies excluded until a dependency is found. | Planning/resumption manifest only; verify review/deploy ambiguity then add app/server routes for the actual implementation. |
| Investigate old version-check decision | 44,787 / 44,864 | 4,101 / 4,155 | No complete progress/decision log or unrelated UI standards. | D41 is historical; current write/tenant rules and superseding decisions must be checked before a change. |

### Reproducible section manifests

For a selector, retrieve its heading through the next heading of equal or lower depth. Whole-file selectors are explicit. Deduplicate identical selections. The index row is a single line; bounded searches, not reading the entire 28 KB index, are assumed. Before uses baseline files at `327e4cd`; after uses this branch.

- **Change one button label**: `docs/reference/ui.md` → `## 1. Principles`; `docs/reference/ui.md` → `## 5. Typography`; `docs/reference/ui.md` → `## 9. Action hierarchy`; `docs/reference/ui.md` → `## 12. Accessibility`; `docs/reference/ui-review-checklist.md` → `## Touch and keyboard`; `docs/reference/ui-review-checklist.md` → `## Accessibility`; `docs/reference/ui-review-checklist.md` → `## Tests`.
- **Fix responsive resource index**: `docs/reference/ui.md` → `## 1. Principles`; `docs/reference/ui.md` → `## 2. Color tokens`; `docs/reference/ui.md` → `## 3. Spacing`; `docs/reference/ui.md` → `## 6. Density`; `docs/reference/ui.md` → `## 12. Accessibility`; `docs/reference/ui.md` → `## 13. Page width`; `docs/reference/responsive-layout.md` (whole file); `docs/reference/page-patterns.md` → `## 2. Resource index`; `docs/reference/page-patterns.md` → `## 8. States`; `docs/reference/ui-review-checklist.md` (whole file); `docs/guides/app-shell.md` (whole file); `docs/guides/development.md` → `## Commands`; `docs/guides/development.md` → `## Tests`.
- **Add validated form field**: `docs/reference/forms.md` (whole file); `docs/guides/crud.md` (whole file); `docs/reference/mutations.md` (whole file); `docs/reference/errors.md` → `## `ApiError``; `docs/reference/ui.md` → `## 17. Expected behavior`; `docs/reference/ui-review-checklist.md` → `## Touch and keyboard`; `docs/reference/ui-review-checklist.md` → `## Accessibility`; `docs/reference/ui-review-checklist.md` → `## Tests`; `docs/guides/development.md` → `## Commands`; `docs/guides/development.md` → `## Tests`.
- **Fix app API mutation**: `docs/guides/crud.md` (whole file); `docs/reference/mutations.md` (whole file); `docs/reference/data-fetching.md` → `## `apiFetch``; `docs/reference/data-fetching.md` → `## `useApiQuery``; `docs/reference/data-fetching.md` → `## `invalidate``; `docs/reference/errors.md` (whole file); `docs/guides/development.md` → `## Commands`; `docs/guides/development.md` → `## Tests`.
- **Add backend menu service**: `docs/server/README.md` (whole file); `docs/server/architecture.md` (whole file); `docs/server/security.md` → `## Roles and permissions`; `docs/server/security.md` → `## Checklist for every route`; `docs/server/data-model.md` → `## Overview`; `docs/server/data-model.md` → `### Concepts and admin pages`; `docs/server/data-model.md` → `### Tables`; `docs/server/data-model.md` → `### Rules that keep the UI clean`; `docs/server/data-model.md` → `### Categories API`; `docs/guides/development.md` → `## Adding a full stack feature`; `docs/guides/development.md` → `## Tests`; `docs/feature-standard.md` → `### Open questions: choices vs contracts`; `docs/guides/development.md` → `## Commands`.
- **Implement orders database migration**: `docs/server/README.md` (whole file); `docs/server/architecture.md` (whole file); `docs/server/security.md` → `## Roles and permissions`; `docs/server/security.md` → `## Checklist for every route`; `docs/server/data-model.md` → `## Overview`; `docs/server/data-model.md` → `## Orders & payment`; `docs/server/operations.md` → `## Migrations`; `docs/server/operations.md` → `## Configuration`; `docs/guides/development.md` → `## Commands`; `docs/guides/development.md` → `## Tests`.
- **Resume unfinished Telegram marketing work**: `docs/current-state.md` (whole file); `docs/progress.md` → `### Phase M:`; `docs/progress.md` → `## Open questions`; `docs/plans/marketing.md` → `## M2a:`; `docs/decision-index.md` → `## Domain entry points`; `docs/guides/development.md` → `## Commands`; `docs/guides/development.md` → `## Tests`.
- **Investigate old version-check decision**: `docs/decision-index.md` → `## Domain entry points`; `docs/decision-index.md` → `ROW:D41`; `docs/decisions.md` → `### D41:`; `docs/server/architecture.md` → `## Writing data`; `docs/server/data-model.md` → `## Overview`.

## Preservation and verification results

- Inventoried every root instruction/document under docs; no nested instructions found. Application implementation was not read during the audit. Later verification inspected only package-manager/script names and the exact Categories route's existence to check commands and repair its stale documentation link; no general source audit.
- Compared all nine relocated section bodies from the former AGENTS.md with their five destinations. Bodies are preserved with relative-link rebasing and the documented tenancy/path/page-scope/navigation corrections. Server essentials are retained in root invariants and server standards; startup/resumption rules are replaced with task routes and documentation-maintenance obligations.
- Critical rule review: tenant IDs, per-tenant queries/composite relationships and isolation tests; server authorization/platform separation; stale versions, atomic guards/audit/idempotency; no order/ledger deletion; identity-bound data clearing and stale-response discard; feature public API boundaries; form drafts/locks/unsaved input; owner decisions/mockup workflow; checks, CI/staging/production workflow and documentation updates remain discoverable and required.
- All 166 original decision IDs, titles and bodies preserved, except the removed api.md link now explicitly labelled historical; D167 added. Progress's historical body is retained, with a navigation/work note and stale plain-text navigation labels updated.
- Relative Markdown validation: baseline had two broken links (removed api.md in D41, pre-tenancy Categories route in feature-standard). Both repaired. After: zero missing file targets or Markdown anchors across root instructions and all docs. Fenced examples and inline code targets are excluded; local directory/source links are checked for existence, external sources were verified through browsing. Balanced parentheses and duplicate heading slugs were handled.
- Automatic import graph is exactly CLAUDE.md → AGENTS.md; no cycle, no history reachable, root below the local 8 KiB maintenance budget. All task destinations and 167 index anchors resolve. Markdown link validation does not prove a host's actual context contents.
- `git diff --check` passed; scope review confirms only AGENTS.md, CLAUDE.md and docs Markdown files changed. No application/server code, schema, tests, dependencies or deployment configuration changed.
- **Lint and typecheck passed.** **Unit/server checks: 1,372 passed, 36 failed (105 files: 101 passed, 4 failed).** Observed failures: Better Auth Drizzle schema mismatch (`user.isAnonymous`) and a guest-order SQLite syntax error. No fix was attempted outside the authorized documentation scope. These are reported failures, not a claim that the required suite is green or that their baseline cause has been proven.
- The supplied dependency snapshot made plain pnpm commands try an implicit reinstall and abort without a TTY. Checks were run against installed packages using `pnpm --config.verify-deps-before-run=false lint`, `typecheck`, and `test:unit`; dependency manifests/lockfile were not changed. CI can validate its normal frozen installation. Browser tests were not run: no application feature changed. Actual agent-session token use and client settings were not measured.

## Final file map and remaining trade-offs

Changed: AGENTS.md, CLAUDE.md, docs/feature-standard.md, docs/reference/README.md, docs/server/README.md, docs/progress.md, docs/decisions.md.

Created: docs/README.md, docs/current-state.md, docs/decision-index.md, docs/documentation-inventory.md, docs/context-audit.md, and docs/guides/{project-map,app-architecture,crud,app-shell,development}.md.

Resolved redundant startup loading and mandatory whole-history reads; clarified standards' ownership rather than deleting detailed overlapping recipes. Corrected obsolete multi-tenant status, route/role/page-scope summaries, customer-order email gate (D156/security.md), and dead navigation. Kept unresolved review/staging, old status tables, conflict-reload and cancel-endpoint ambiguities visible in current-state. The logs remain large on disk; explicit section retrieval is necessary. The indexes/snapshot need maintenance, and implicit agent behavior is not a hard enforcement guarantee. Future duplicate recipe reduction can be done per affected API with evidence; this change preserves detail to minimize regression risk.
