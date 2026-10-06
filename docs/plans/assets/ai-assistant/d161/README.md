# Complete app evidence (D161, 2026-10-06)

**Implementation ready for code review; Workers Free activation blocked.** The owner chose Free only and held activation until CPU fits. Staging provider/import flags/billing were not changed.

The isolated synthetic complete Nuxt app used deployed revision `045f5b9f258dd896f5bc7488984d52de8bc5d588`, app version `56eca321-3897-48e6-9f19-f540c4ba579a`, private D1/R2, normal Better Auth authorization, Scout extraction and structured Gemma4 help. [HTTP evidence](http-results.json) and [actual application invocation CPU](cpu.json) retain metadata only, excluding credentials/source/answer bodies.

| Gate | Result |
|---|---|
| Protected login / normal synthetic owner sign-in | Passed, HTTP200; unauthenticated owner API401 |
| Image upload/extraction/correction | Passed; expected fixture row, ready review |
| Explicit Create drafts / safe replay | Passed; same item, unpublished draft |
| Discard / private source deletion | Passed; subsequent source404 |
| PDF supplied-page extraction/discard | Passed; test raster, not browser rendering proof |
| Workers Free authenticated CPU | **Failed**: sign-in118ms, image extraction91ms, PDF extraction47ms |
| Structured Gemma4 help quality | Eight passed; case9 provider error; remaining17 unverified |
| Real owner menu / physical phone | Not performed |

The sampled requests returned `ok`; this does not certify the documented10ms Free budget. Cloudflare grants occasional isolate flexibility. Authentication and other existing app endpoints also exceed10ms. A model-only or image-encoding change cannot establish complete-app compliance; no weakening of supported native scrypt, authorization or validation is justified. These are sampled invocations, not a load test or a guarantee of future CPU.

The failed help question was “How do I make customers choose a milk?” One focused native diagnostic with the same synthetic guide/schema returned valid JSON, navigation keys and **At least**1, using12713 input/151 output tokens and reported119.69 neurons. It is not a successful production-route retest. The underlying failure is unclassified on that deployed revision; no cause or budget fix is claimed. Final code adds fixed error-kind/status/finish-reason diagnostics and preserves invalid-output SDK usage. Neither prompts, model selection, limits nor retry policy change. Full help quality remains pending.

Normal CI run37424302386 passed lint/typecheck/audit/unit and all three browser shards. Its live preview job failed and that result remains recorded. Local full1462 unit/server tests, six chat browser checks, targeted Reports URL synchronization test and staging Worker build passed before final diagnostics. Final diagnostics have20 focused server checks; exact-head CI is recorded in progress.

Further metered/deployment CI requires `ASSISTANT_PREVIEW_LIVE=true`, default off. Skipping a live job never certifies this gate. Do not activate staging, add paid CPU overrides or merge based on HTTP success. Code can be reviewed with imports off and the existing staging provider preserved. [Private preview access/cleanup](../../../../../scripts/assistant-preview/README.md).

Official sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [AI Free pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/), [SDK7 structured-output errors](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-no-object-generated-error), [SDK7 API errors](https://ai-sdk.dev/docs/reference/ai-sdk-errors/ai-api-call-error).
