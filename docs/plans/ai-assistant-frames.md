# AI assistant visual proposal

_2026-10-05. Owner requested a diagram and generated frames. Owner approved the layouts as the implementation reference (D148); behavior not yet implemented. [Active revision plan](ai-assistant-cloudflare.md), D146._

## Design brief

- Audience: the current cafe's owner importing an existing menu; source image or PDF is sufficient, no chat question required.
- Entry: **Import menu** on Menu items. The existing Assistant panel remains help chat and can link to import; the longer review flow gets a focused workspace.
- Sequence: Upload and choose pages → Extract → Review/correct/exclude → explicitly Create drafts → results → existing item editor and separate publishing workflow.
- Visual foundation: Nuxt UI defaults; amber primary and stone neutral from `app/app.config.ts`; semantic warnings/success; no per-screen theme, gradients, glass or oversized mobile controls. Generated images illustrate composition and copy; exact styling still comes from the component system (D74).
- Desktop 1440: the cafe sidebar and navbar remain; upload uses a centered source card, review places the source beside editable rows, the reviewed selection has one primary creation action.
- Phone 390: focused upload/page selection, stacked review rows, a pushed full-screen item correction view, sticky bottom actions. The source is available through **View source** instead of squeezing two columns into a phone.
- Shared draft: applying an item correction returns to review without saving menu data. Unsaved-change protection spans the import flow.
- Facts: six example rows; four ready/selected, one unclear price, one possible duplicate. Completion creates four unpublished drafts and reports two excluded rows.
- The correction screen is a separate interaction example: applying its corrected and selected row would increase the selection to five. The completion screen illustrates the original four-row selection, not the result after that correction. Actual counts must follow the current selected rows.
- Empty/invalid prices can remain null for a draft under existing menu rules. Required category/library ambiguities are resolved or the row excluded. A warning is not an invented model certainty percentage.
- D148 confirms English-only import and private sources/reviews expiring after 24 hours, resumable after reload and deleted on discard. The frames do not establish background processing, native PDF OCR or final file caps.

## Frame set

| Frame | Composition and copy | Meaning |
|---|---|---|
| 01 Desktop upload | Selected `cafe-menu.pdf`, 2.4 MB, three selected page thumbnails, **Extract menu** | The file/page selection stage; no menu writes |
| 02 Desktop review | Source on left; six review rows on right; unclear price and possible duplicate warnings; **Create 4 drafts** | Selected valid rows only; everything is still unsaved |
| 03 Phone sequence | Upload, review list, Chocolate latte correction, completion | Compact has distinct steps; **Apply to review** does not save an item; completion opens normal drafts |

Additional required states for implementation: extraction progress with Stop; invalid/encrypted/unreadable file; partially extracted pages with Retry failed pages; empty extraction; quota/capacity failure; missing category; failed create preserving edits; partial creation with retry of failed rows only; discard warning. These are specified here but not all pictured in this initial frame set.

## Diagram and generation status

- Editable workflow source: [ai-assistant-workflow.mmd](ai-assistant-workflow.mmd).
- Owner-confirmed delivery (2026-10-05, D147): generate frames and display them directly in chat. Do not use Figma or FigJam. The earlier FigJam attempt produced no board and is closed; no team/organization selection or retry is pending. Requested diagrams use local rendering and inline chat images.
- Local workflow: [PNG](assets/ai-assistant/workflow.png), [SVG](assets/ai-assistant/workflow.svg), [Graphviz source](assets/ai-assistant/workflow.dot). Includes help chat and import through the same planned binding, review, menu commands, failed-row retries and separate publishing.
- Generated frames: [desktop upload](assets/ai-assistant/01-desktop-upload.png), [desktop review](assets/ai-assistant/02-desktop-review.png), [phone flow](assets/ai-assistant/03-phone-flow.png).
- Reproducible prompt record: [generation-prompts.json](assets/ai-assistant/generation-prompts.json).
- Generation artifacts to correct in implementation: the phone board adds drink thumbnails that are not extracted product photos; use the existing empty-image treatment unless a real item image exists. The source-price typography, menu artwork and cafe name are illustrative; always display the actual uploaded source and selected cafe. The phone board's spacing and button styling are approximate; use existing Nuxt UI component defaults and semantic tokens.
- Verification: all three frames generated, local diagram rendered and visually inspected, relative asset links checked, documentation whitespace checked. Image generation does not verify extraction, menu saves or model quality. No app code, schema, configuration or deployment changed.

## Review and handoff

The owner confirmed generated frames displayed directly in chat as the project's design delivery workflow (D147). The owner approved these desktop/phone layouts in D148. Implement with the existing Nuxt UI standards and the generation-artifact corrections above; normal implementation checks still apply. Record corrections and accepted composition in the active plan/decisions before building the new screens.

Generation prompts are stored with the assets so the next agent can reproduce the proposed copy and composition. Keep follow-up frames consistent with the active plan and existing components; generated mockups are not a second design system.

## Implemented screens (D155)

The owner-approved D148 layouts are implemented using the repository's Nuxt UI defaults. Entry is Import menu on Menu items; compact widths use a source modal and a separate correction route. Desktop review keeps source and rows together; upload/correction use the standard `page-narrow` cap. Prices are flat editable rows to avoid sideways scrolling. Saved categories/prices are shown separately from immutable source prices. Apply to review saves privately; Create drafts confirms an explicit serial batch, locks successful rows and exposes correction/retry/duplicate confirmation for failures.

Accepted slice adaptations: source cap is 5 MB (not an illustrative generated value); no menu-source-as-photo action; existing libraries only; PDF upload/resume/download/discard with an honest pending notice, rather than unimplemented page selection. Imports remain hidden by default and live model quality remains unverified.

Actual browser screenshots are saved in [assets/ai-assistant/d155/](assets/ai-assistant/d155/): upload, review and correction at 320, 390, 768, 1024, 1440, 1920 and landscape 844×390, plus dark review at 390. These are browser-mock UI evidence, not live model or staging evidence.


## PDF preparation adaptation (D156)

The approved upload/page-selection frame now has page controls and a single source preview. Controls sit beside the source from `sm`, above on phones; retaining one bounded canvas limits phone memory. Filename takes its own compact toolbar row. Page choices are addressable through `pages` query metadata; the source is still private/24-hour. PDF extraction stays visibly pending. No active Extract menu/page-retry/model controls are implied before the server slice exists.

Actual synthetic-source screenshots: [assets/ai-assistant/d156/](assets/ai-assistant/d156/) at 320, 390, 768, 1024, 1440, 1920 and 844×390 plus dark 390. Browser checks also use keyboard selection and 200% text. These show PDF preparation under the current CSP; they do not validate OCR/model quality or actual phone performance.

### D158 implemented PDF processing states

Continue the approved D148 composition: fixed selected pages, saved per-page progress, read-only partial evidence, explicit Retry unfinished pages and confirmed Review successful pages, followed by existing corrections/Create drafts. During processing Stop sits beside status; at compact widths the shared batch progress notification covered a bottom Stop button. Keep the initial/retry/partial actions in the standard bottom bar. Ready PDF comparison is beside rows on expanded screens or View source pages in the existing compact modal. Use the whole ready-review source pane for the canvas; splitting it again makes the PDF text too small. Actual browser captures are saved in `assets/ai-assistant/d158/` and delivered inline in chat; no Figma/FigJam. Local captures use synthetic fixtures and prove layout, not live model quality.
