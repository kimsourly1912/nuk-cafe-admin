# Assistant evaluation and document spike (D151)

This is the local tooling for phase 9.C0, before model activation or import implementation. It has no upload routes, private review storage or menu-write commands. Its menus are synthetic fixtures. A schema-valid response is not proof of correct transcription; the quality scorer also checks names, category/size/price associations, stated descriptions, source price evidence and required uncertainty flags.

## Offline checks

Normal `pnpm test:unit` runs the mocked binding lifecycle, SDK/provider/schema and scoring regressions. It never creates a Wrangler proxy or calls a metered model.

With Chrome installed, run the local PDF experiment:

```bash
ASSISTANT_SPIKE=1 pnpm vitest run --project spike server/features/assistant/eval/pdf-render.spike.test.ts --disableConsoleIntercept
```

Set `ASSISTANT_EVAL_CHROMIUM=/absolute/path/to/chromium` to use a browser executable instead of the repo's default Chrome channel. No inference, Cloudflare authentication or deployment is needed. The helper serves the installed PDF.js modules on loopback, loads source bytes into its PDF worker, bounds the document to five pages / 5 MB, validates page selection and renders canvases at most 1,400 pixels per side and 2 million pixels each. This is a desktop-browser experiment, not a tested mobile implementation or a hardened public upload parser.

Checked-in PNG, text-PDF and image-only PDF fixtures come from `menu-cases.ts`, including multiple columns, size prices, missing prices, original USD/KHR/unknown currencies and instructions embedded in the source. `mixed.pdf` has a text first page and raster second page; `six-pages.pdf` exercises the cap. Regenerate deliberately:

```bash
ASSISTANT_SPIKE=1 ASSISTANT_GENERATE_FIXTURES=1 pnpm vitest run --project spike server/features/assistant/eval/fixtures.spike.test.ts
```

PDF metadata may change on regeneration. These files contain no real cafe/customer data. Synthetic coverage does not replace real menu samples or encrypted, blurry, unusual-font/image-codec and phone checks before PDF release.

## Live Workers AI checks — metered, never CI

Use a machine already authenticated with Wrangler and permitted to access Cloudflare. Check its selected account with `pnpm wrangler whoami`. Use normal Wrangler authentication; the app's inference still uses `env.AI`, not an external model API key. Do not paste credentials into reports or chat.

`wrangler.json` is isolated to the `AI` binding; it has no app D1, R2, KV, tasks or secrets. `getPlatformProxy` starts a remote binding session, with no persisted state or automatic env-file loading. The caller disposes it after evaluation and on model setup failure. `ASSISTANT_EVAL_WRANGLER_CONFIG` can select another evaluation-only config, for example to specify a non-secret account id. Do not use the generated app/deployment config for this test.

```bash
ASSISTANT_EVAL=1 NUXT_AI_ENABLED=true NUXT_AI_PROVIDER=cloudflare \
NUXT_AI_MODEL=@cf/google/gemma-4-26b-a4b-it \
pnpm vitest run --project eval server/features/assistant/eval/help.eval.ts --disableConsoleIntercept

ASSISTANT_EVAL=1 NUXT_AI_ENABLED=true NUXT_AI_PROVIDER=cloudflare \
NUXT_AI_MODEL=@cf/google/gemma-4-26b-a4b-it \
pnpm vitest run --project eval server/features/assistant/eval/menu.eval.ts --disableConsoleIntercept
```

PowerShell: set the same environment variables with `$env:NAME = 'value'` before running the command. Run one model at a time. Help evaluation also supports the existing external-provider configuration for comparison. Menu evaluation requires Cloudflare; compare another vision-capable candidate by changing `NUXT_AI_MODEL`. A text-only model cannot pass image/scanned-page cases.

- `ASSISTANT_EVAL` must be exactly `1`; CI excludes the project and the helper also rejects any nonempty `CI` variable before creating a proxy. Incomplete/disabled configuration fails visibly rather than reporting skipped cases as validation.
- Help checks cover the existing 25 questions, approved links and Khmer help-language behavior. They record aggregate SDK tokens and latency and await usage writes. They use an isolated in-memory tenant/database, not app data.
- Menu checks make eight inference calls plus two text-PDF conversions. They compare direct PNG extraction, text conversion followed by structuring, scanned-page rendering followed by vision, and both rendered pages of the mixed PDF. They use AI SDK 7 `generateText` / `Output.object`, a Valibot schema adapter matching the installed provider-utils version, no tools, zero retries and a 60-second inference deadline. Cancelled-before-start calls are refused before invoking the provider.
- Text-PDF conversion uses `AI.toMarkdown` with metadata and embedded-image conversion disabled. Empty, failed and overlong text fail the case. Conversion token counts are **estimates of the converted text**, separate from inference token usage and neurons. The binding conversion API has no abort-signal parameter; its remote timeout/cancellation behavior remains a live check before production use.
- Keep model, date, passing/failing cases, latency and reported tokens in the review result. Record Cloudflare's observed neurons/allocation separately; the SDK token counts do not establish an account-wide allocation balance. Evaluation itself consumes that account's allowance. Source text and full provider bodies are not emitted by the menu scorer.

## Local result, 2026-10-05

Full lint/typecheck, 1,250 unit/server tests in 95 files, six existing assistant browser tests and a staging Worker build passed. Frozen installation preserved all existing dependency/peer resolutions. The Worker retains its AI binding and existing provider/model configuration; evaluation modules and PDF.js are excluded from its bundle. CI access, pre-abort and PDF page-cap regressions fail when their respective guards are removed, then pass after restoration.

Six browser PDF checks passed in Chromium. Text fixtures had a text layer; scanned fixtures had none and produced bounded PNGs. The mixed PDF kept its two source pages and selected-page identity. Oversized-page-count, invalid/duplicated selections and malformed bytes were refused. Under concurrent local checks: scanned rendering took 496–684 ms per page; the mixed two-page render took 787 ms; generated scan PNGs were about 74–76 KB at 1,200 × 1,351 pixels. These are synthetic desktop-browser timings, not mobile or Cloudflare measurements.

**Live checks not run:** this managed environment has no Cloudflare credentials/outbound access. No model is declared proven; staging inference remains on its existing provider. Activation and the private English menu-import/review workflow remain subsequent work.

## Official sources checked before implementation

- [Wrangler platform proxy API](https://developers.cloudflare.com/workers/wrangler/api/#getplatformproxy), checked against installed Wrangler 4.141.0 (`envFiles`, `remoteBindings`, `persist`, typed env and `dispose`).
- [Workers AI SDK 7 binding provider](https://developers.cloudflare.com/agents/models/ai-sdk/), installed Agents 0.26.0.
- [AI SDK structured-output source](https://github.com/vercel/ai/blob/main/content/docs/03-ai-sdk-core/10-generating-structured-data.mdx), installed AI SDK 7.0.122; [Valibot adapter](https://ai-sdk.dev/docs/reference/ai-sdk-core/valibot-schema). Adapter 3.0.51 matches the SDK's provider-utils 5.0.51; 3.0.53 has incompatible unique-symbol TypeScript identities for this SDK version. `@valibot/to-json-schema` 1.8.0 provides conversion, avoiding a second hand-maintained JSON schema.
- [Markdown binding API](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/binding/), [conversion options](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/conversion-options/) and [PDF conversion behavior](https://developers.cloudflare.com/workers-ai/features/markdown-conversion/how-it-works/), checked against installed binding declarations. Conversion is not a documented scanned-page OCR path.
- [PDF.js examples](https://mozilla.github.io/pdf.js/examples/) and [versioned 6.4.299 API source](https://github.com/mozilla/pdf.js/blob/v6.4.299/src/display/api.js), with `getDocument`, worker setup, `getPage`, viewport/canvas rendering, text content and cleanup. Version 6 has no `isEvalSupported` loading option; use its current parameters.
- [Playwright page APIs](https://playwright.dev/docs/api/class-page), installed 1.63.0, for fixture screenshots/printing and browser-side modules. A module script is loaded into the browser rather than serializing a Vite-transformed dynamic import through `page.evaluate`.
- [Native pre-abort check](https://nodejs.org/api/globals.html#abortsignalthrowifaborted). Dev-only PDF.js 6.4.299 requires Node ≥22.13 or ≥24; the existing CI runtime is Node 24. None of these evaluation-only helpers is imported by the production app/Worker.
