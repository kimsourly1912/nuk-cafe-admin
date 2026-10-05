# Assistant server API

The server feature exports through `#server/features/assistant`. Routes use `requireAssistant(event)` for tenant/owner permission checks and request binding resolution; other features must not import its internals. [Operations and activation](../server/operations.md#configuration), [active revision](../plans/ai-assistant-cloudflare.md).

## Settings and model

- `assistantSettingsFrom(raw: RawAssistantSettings): AssistantSettings | null`: `null` means disabled. `cloudflare` requires `enabled: true` or `'true'`, a complete `@cf/vendor/model` id and no base URL. It does not use an API key. Legacy providers preserve key-based enablement when `enabled` is empty; explicit false disables any provider. Enabled incomplete settings throw 500 `AI_NOT_CONFIGURED`.
- `languageModel(settings: AssistantSettings, binding?: CloudflareAiBinding): LanguageModel`: builds the selected SDK model. Cloudflare requires the request's `env.AI` and uses `agents/models/ai-sdk`; missing or malformed binding throws `AI_NOT_CONFIGURED`. It does not make a network call until inference starts. Other providers keep their existing adapters.
- `CloudflareAiBinding` is the installed provider's `AISettings['binding']` type. It is an injected dependency for tests, never returned to the browser.
- `providerFailureMessage(provider: string, error: unknown): string`: safe stream-error copy. Cloudflare status 429 names capacity/allocation and the UTC reset; other failures use the generic unavailable message. Raw provider bodies are not returned.

```ts
import { assistantSettingsFrom, languageModel } from '#server/features/assistant'
import type { CloudflareAiBinding } from '#server/features/assistant'

function configuredModel(binding: CloudflareAiBinding) {
  const settings = assistantSettingsFrom({
    enabled: true,
    provider: 'cloudflare',
    model: '@cf/google/gemma-4-26b-a4b-it', // Evaluation candidate; live quality is still unverified.
  })
  if (!settings) throw new Error('Assistant disabled')
  return languageModel(settings, binding)
}
```

## Existing help and usage

**Binding access (D150):** installed Nuxt 4.5.2 uses Nitro 2.13.4. `requireAssistant(event)` reads `event.context.cloudflare?.env?.AI`, the [documented Nitro 2 binding path](https://v2.nitro.build/deploy/providers/cloudflare#direct-access-to-cloudflare-bindings), after permission checking. `server/types/cloudflare.d.ts` augments H3's request context once; route glue needs no inline assertion. A Node request may have no Cloudflare context, so Cloudflare settings still require the model's missing-binding guard. NuxtHub 0.10 [removed `hubAI()`](https://hub.nuxt.com/docs/getting-started/migration#ai-autorag); do not revive its older helper or copy Nitro 3's `event.req.runtime` API.

**AI SDK 7 streaming (D150):** the service records aggregate tokens from `onEnd({ usage })`, including every tool-call step. The evaluator reads `result.usage`. The chat route passes `result.stream` into standalone `toUIMessageStream({ stream, onError })`, then `createUIMessageStreamResponse({ stream })`. This preserves the browser's SSE protocol, navigation tool parts and safe provider-error copy. `totalUsage`, `onFinish` and result response methods still work as compatibility aliases in v7, but are deprecated; see the [official v7 migration guide](https://github.com/vercel/ai/blob/main/content/docs/08-migration-guides/23-migration-guide-7-0.mdx). `result.finalStep.usage` would count only the last step and must not replace aggregate accounting. Covered by `assistant.service.test.ts` (two-step totals, SSE headers/tools and safe failed streams) and `server/tests/assistant.test.ts` (binding resolution and permission order).

`chatWithAssistant` keeps the approved help guide, validated latest conversation, navigation tool and SDK message stream. Its `StreamHooks` now accepts an optional `abortSignal`; it combines this with the provider deadline. Aborted calls finish the usage reservation as `error`. Cloudflare has no automatic inference retry; legacy retry behavior stays unchanged. Binding cancellation is locally tested; remote client-disconnect behavior still needs a Worker check.

`startUsage`, `finishUsage`, `assistantStatus` and `purgeAssistantUsage` retain per-owner/per-cafe accounting and 90-day metadata-only cleanup. Migration `0032_assistant_cloudflare` adds the provider without relabelling old rows. The app's request counter is separate from Cloudflare's account-wide inference allocation.

Image/PDF import APIs, private source storage and persisted reviews are not implemented in this first integration change. D148 confirms their English-only scope and 24-hour retention; do not infer that they exist from the model's image/structured-output compatibility tests.

## Evaluation tooling (D151)

[The evaluation README](../../server/features/assistant/eval/README.md) has the current commands and official sources. `ASSISTANT_EVAL=1` outside CI opens an isolated Wrangler `AI` proxy for Cloudflare and injects it into the existing help service, disposing it after checks; incomplete settings fail rather than skip. Menu evaluation uses strict Valibot-derived structured output and scores actual source associations/uncertainty, with synthetic image/text/scanned/mixed PDF fixtures. `ASSISTANT_SPIKE=1` runs separate local browser PDF checks without inference. The DTO and renderer are private evaluation code, not API contracts or production upload handling. Tokens, conversion estimates and account-wide neurons remain distinct. Live quality/conversion results are still pending Cloudflare access.
