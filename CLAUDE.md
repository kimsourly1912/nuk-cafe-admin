# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

All project instructions live in `AGENTS.md` (shared with Codex and other agents), imported below. Edit `AGENTS.md`, not this file.

@AGENTS.md

## Task-to-doc index

Read the doc that matches your task before you start. `AGENTS.md` (imported above) holds the rules that always apply.

| When the task is... | Read first |
|---|---|
| Building a new feature | `docs/feature-standard.md`, then the feature's plan in `docs/plans/` |
| Changing UI or visual style | `docs/reference/ui.md`, then `docs/reference/page-patterns.md` |
| Changing layout or responsiveness | `docs/reference/responsive-layout.md` |
| Before merging any UI change | `docs/reference/ui-review-checklist.md` |
| Changing server code | `docs/server/README.md`, then the page it links to for the area |
| Changing schema or data model | `docs/server/data-model.md` |
| Changing auth or security | `docs/server/security.md`, `docs/reference/auth.md` |
| Using or changing a shared API or composable | `docs/reference/README.md`, then the linked page |
| Changing forms or unsaved-change behavior | `docs/reference/forms.md` |
| Changing mutations or concurrency | `docs/reference/mutations.md` |
| Checking current status or next steps | `docs/status.md` |
| Checking why something was decided | `docs/decisions-index.md`, then the matching entry in `docs/decisions.md` (by D-number or topic; never the whole file) |
| Writing or changing app (Vue/Nuxt) code in a feature | `docs/app-conventions.md` |
| Changing app-wide behavior (tab titles, refresh on tab focus, offline, leave guards, session loss) | `docs/reference/app-behavior.md` |
| Changing an admin screen | also update its page in `server/features/assistant/help/*.md` (the help assistant's guide); the rule is Rule 7 in `docs/app-conventions.md` |
| Writing a cafe's name into a page, or showing a menu item photo | `docs/reference/README.md` → "Root shared blocks: usage rules" (`useCafe()` / `<CafeLogo>`, `<MenuItemImage>`) |
| Linking to a cafe's page | `docs/app-conventions.md` → "What this is (continued): paths, screens, reference features" (`useTenantPath()`) |
| Running checks, opening a PR, committing, or finishing a step | `docs/workflow.md` |
| Writing, running, or debugging tests | `docs/how-to-verify.md` |
