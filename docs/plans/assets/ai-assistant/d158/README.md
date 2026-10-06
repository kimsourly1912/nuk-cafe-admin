# D158 PDF processing UI captures

Actual built-app browser captures of the approved import composition with synthetic private PDF/review fixtures. They verify UI behavior and layout; they do not prove live model quality, private R2 behavior or real-device CPU/memory use. No Figma/FigJam.

- Initial selection: `pdf-select-390.png`, `pdf-select-1440.png`.
- Active stalled PNG preparation with reachable Stop and the standard batch progress notification: `pdf-processing-390.png`.
- Partial results: `pdf-partial-{320,390,768,1024,1440,1920,844}.png` and `pdf-partial-dark-390.png`.
- Ready review after explicit partial acceptance: `pdf-review-{320,390,768,1024,1440,1920,844}.png` and `pdf-review-dark-390.png`.

The browser checks also exercise keyboard activation, 200% text, fixed saved selection, serial real PNG requests, correction/draft creation, normal and stale toast retries, quota/attempt limits, Stop, expiry/disabled/session cleanup and source comparison. Source evidence/page labels are immutable; creating drafts remains explicit and publishing uses the normal menu workflow.

Regenerate through `pnpm vitest run --project e2e test/e2e/assistant-pdf-processing-ui.test.ts`. This execution environment used a temporary system Chromium executable override, restored after every run; the repository retains its Chrome configuration. Historical D155/D156 captures were restored after regression runs.
