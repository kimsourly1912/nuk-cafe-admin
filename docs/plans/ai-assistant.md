# AI assistant plan (phase 9)

_2026-09-30. Owner decisions (this session, "use your defaults"): an assistant for **admins** in the admin portal first; it answers questions about the portal and guides through existing workflows, drafts menu items from a description, and improves menu wording; translation later. **Any AI provider** with the owner's own API key; **the AI suggests, a person saves**; the panel is Nuxt UI's `USidebar` (owner's choice over a slide-over). Built before 6.5b at the owner's request. Decision record: D107. Options decided against for now, and what would bring them back: [ai-later.md](ai-later.md)._

Four steps, each its own PR: **9.0** groundwork, **9.1** the help assistant, **9.2** menu drafts from a description, **9.3** improve wording. 9.1–9.3 have screens, so each starts with the mockup round ([feature-standard.md](../feature-standard.md#designing-a-ui-step-with-mockups-the-owners-workflow)).

## Purpose and scope

- **Purpose:** an admin who doesn't know how to do something in the portal asks in plain words (English or Khmer) and gets short steps with links to the right page; an admin adding a menu item describes it in a sentence and gets a filled-in draft to check; an admin can ask for better wording of an item's name or description.
- **In scope / acceptance criteria:**
  1. The assistant is **off** unless the server has an AI key: its buttons are hidden and its routes answer 404.
  2. Only signed-in admins with `assistant: ['use']` can use it (401 / 403 otherwise).
  3. **9.1** Help: answers come from the reviewed help guide and the page the admin is on; it says "I don't know" rather than guess; it links only to pages in the page list; it replies in the language of the question; the answer streams in.
  4. **9.2** Draft: a description becomes a draft in the **existing** item editor, never a saved item; categories, option sets and add-on groups are picked from those that exist, and anything else is listed as "not found"; prices only when the description states them.
  5. **9.3** Improve wording: 2–3 suggestions for an item's name or description, side by side with the current text; nothing changes until the admin saves the form.
  6. Each admin has a daily limit (100 requests, configurable); past it: 429 with a clear message.
  7. A provider failure (down, timeout, bad key) shows "The assistant can't answer right now" and never breaks the page around it.
  8. The provider is chosen by settings only; the code names no provider outside one file.
- **Out of scope (see [ai-later.md](ai-later.md)):** counter staff; saved conversation history; stored preferences; translation and translated menu fields; editing the help guide without a release; the AI performing actions; customer-facing AI.

## Tech stack (D107)

| Layer | Package | Role |
|---|---|---|
| AI core (server) | `ai` (Vercel AI SDK, 7.x) | One API for every provider: `streamText`, `generateObject`, tools |
| Providers | `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`, `@ai-sdk/openai-compatible` | The supported list; one is chosen by settings |
| Schemas | `@ai-sdk/valibot` + our `valibot` | The AI's structured output uses the same schema library as the app |
| Chat state (browser) | `@ai-sdk/vue` | Holds the conversation, reads the stream |
| UI | Nuxt UI 4.11 (installed): `USidebar`, `UChatMessages`, `UChatPrompt`, `UChatPromptSubmit`, `UChatTool` | Design system first; no custom chat UI |

**[Choice]** Versions pinned in `package.json` when installed (9.0). **Supported** means tested by our quality check (below); another OpenAI-compatible service may work but isn't promised.

**Settings** (runtime config, server only; secrets on Cloudflare):

```text
NUXT_AI_PROVIDER   anthropic | openai | google | openai-compatible
NUXT_AI_MODEL      the provider's model id
NUXT_AI_API_KEY    secret
NUXT_AI_BASE_URL   openai-compatible only
NUXT_AI_DAILY_LIMIT  per admin, default 100
```

The public runtime config carries only `assistant.enabled` (a key is set), so the app knows to show the buttons.

## Boundaries

```text
app/features/assistant/          the panel, the draft and wording dialogs (talks only to /api/admin/assistant)
        ↓ apiFetch, and the AI SDK's chat stream
server/api/admin/assistant/      thin routes: permission, feature switch, validation
        ↓
server/features/assistant/       prompts, provider choice, output checks, usage and limits
        ↓                          ↓
menu feature's public API      AI provider (through the AI SDK)
(reads names; never writes)
```

- **Only the assistant feature knows AI exists.** No other feature imports it on the server. In the app, screens (the item editor, the Menu items list) use its public building blocks (`index.ts`), like any cross-feature picker.
- **The assistant never writes menu data** and has no tool that writes anything. Saving goes through the existing menu service: validation, `version`, draft status, audit.
- **The model remembers nothing.** Each request carries everything it needs (below).

## Where the answers come from

One request to the model, most stable first (so providers that cache the beginning of a request can reuse it):

1. **Rules:** answer only about this portal, from the help guide; say "I don't know" rather than guess; numbered steps; reply in the question's language; never claim to have done anything.
2. **Help guide:** `server/features/assistant/help/*.md`, one file per screen (purpose, common tasks as steps, common errors in plain words), bundled into the server at build time. **[Choice]** Files in the code, not a table: the guide describes the app, so it changes in the same PR as the screen it describes, is reviewed like code, and needs no editor or migration.
3. **Page list:** every admin page with its name and path (`server/features/assistant/pages.ts`); the only links the assistant may give.
4. **The page the admin is on** (its path).
5. **The conversation so far and the new question** (from the browser).

**[Choice] Caching:** only the provider's own prompt caching, which reuses the unchanged beginning (1–3) for a few minutes at a fraction of the price (with Anthropic we mark the cache point through the AI SDK's provider options; others cache long beginnings automatically). No caching of answers on our side: answers depend on the page and the conversation, and would go stale when the guide changes.

**[Choice] Conversation and preferences:** the conversation lives in the browser tab (`useState`, so the session boundary clears it on sign-out or another account, D29) and is sent whole each time; it isn't stored on the server. The reply language follows the question; no stored preferences. Both are in [ai-later.md](ai-later.md).

## API contract (`shared/contracts/assistant.ts`)

All `POST`, admin surface, `assistant: ['use']`; 404 when the assistant is off. Every call first checks and records the daily usage.

| Route | Request | Answer |
|---|---|---|
| `/api/admin/assistant/chat` (9.1) | `{ messages, page }`: the AI SDK's chat messages (last 20, each at most 2,000 characters), `page` an admin path | The AI SDK's UI message stream: text, and `link_to_page` tool results |
| `/api/admin/assistant/menu-item-draft` (9.2) | `{ description }` (10–1,000 characters) | `MenuItemDraft` (below) |
| `/api/admin/assistant/rewrite` (9.3) | `{ field: 'name' \| 'description', text, itemName }` | `{ suggestions: string[] }` (2–3, within the field's limit) |

`MenuItemDraft`: `name`, `description`, `categoryId | null`, `optionSetIds`, `variations` (prices in cents only when stated, else `null`), `modifierGroupIds`, `notFound: { kind: 'category' | 'optionSet' | 'modifierGroup' | 'modifier', name }[]`. It maps onto the item editor's form, not onto `createItem`: the admin completes and saves it.

**Error codes** (`assistant.errors.ts`):
- `AI_UNAVAILABLE` 503: the provider failed, timed out (**[Choice]** 30 s for drafts and wording; a chat stream ends with an error part) or refused the key.
- `AI_LIMIT_REACHED` 429: "You've used today's 100 assistant requests. They reset at midnight (Asia/Phnom_Penh)."
- `AI_INVALID_OUTPUT` 502: the structured output didn't match the schema after one retry.
- 404 `NOT_FOUND` when off; 400 `VALIDATION_FAILED` for a bad request.

**Server rules:**
- **Draft (9.2):** the prompt lists the names of active categories (leaves only, D44), option sets with their values, and add-on groups; the model answers with names; **the server** maps names to ids (case-insensitive, trimmed), puts unknown ones in `notFound`, drops prices not in the description (**[Choice]**: a price the text doesn't state is `null`), and checks the result against the item form's limits.
- **Links (9.1):** `link_to_page` takes a page key from the page list (an enum in its schema); anything else is refused, never shown.
- **Untrusted text:** menu names and the admin's text are data in the prompt. The worst a crafted text can do is produce a bad suggestion the admin rejects: there is no write tool.

## Data model (9.0, one migration)

`assistant_usage`: `id`, `user_id` → user (cascade: usage is the admin's own data), `day` (the local date, Asia/Phnom_Penh), `feature` (`chat` \| `menu_item_draft` \| `rewrite`), `provider`, `model`, `input_tokens`, `output_tokens`, `cached_input_tokens` (null when the provider doesn't say), `outcome`, `at`. Index (`user_id`, `at`). **No question or answer text** (owner, A4).

- **Limit:** before calling the provider, the server inserts the row (`outcome` `pending`) in one batch with a guard (`requireAtMost`: the user's rows with today's `day`, counting this one, at most the limit), so two requests at once can't both take the last slot; after the call it fills in the tokens and the outcome. A failed call still counts (it may have cost tokens). A refused request is not inserted (nothing to record but a 429). So `outcome` is `pending` \| `ok` \| `error`.
- **Retention [Choice]:** rows older than 90 days deleted by a daily task (cost reports need about a quarter).

## Screens (mockups first, per step)

- **9.1 Help panel:** `USidebar` on the right (owner): docked beside the page from `lg` (**[Choice]** `collapsible="offcanvas"`, the page narrows while it's open); below `lg` its own slide-over, full screen on phones. Opened by an "Ask" button in the admin navbar and `Ctrl`/`⌘`+`/` (added to the shortcuts list). Inside: suggested questions for the current page, the messages (`UChatMessages`), link results as buttons (`UChatTool`), the prompt (`UChatPrompt`) with Stop; "Clear chat"; an error row with Try again; "AI can make mistakes: check before you act" under the prompt. **Needs verification:** `USidebar` beside `UDashboardGroup`'s panel (layout and focus); every page still fits at its narrower width.
- **9.2 Draft from description:** "Draft with AI" beside New item on Menu items → a dialog (a sheet on phones) with a text box and an example → the item editor at `/admin/products/new` (D90) filled in, with a banner "Drafted by AI: check everything before saving" and the `notFound` list with links to create them.
- **9.3 Improve:** an "Improve" button beside Name and Description in the item editor → a popover (a sheet on phones) with the suggestions, each with Use; Use replaces the field's text (still unsaved; the unsaved-changes guard applies as usual).

## Mutations and freshness

- The assistant makes no data mutations; its calls go through `useMutation` only for draft and rewrite (`assistant:draft`, `assistant:rewrite`, key = the request, `successMessage: false`, the error toast from `ApiError`), so double clicks are skipped. Chat uses the AI SDK's chat state, disposed on the session boundary.
- Nothing to invalidate. The draft reads the catalog at request time.

## Permissions

- New statement `assistant: ['use']` in `identity.permissions.ts`, granted to `admin` only (**[Choice]**, A1). Counter roles get none (later: [ai-later.md](ai-later.md)).

## Tests and verification

- **Unit:** the name → id mapping and `notFound`; prices kept only when stated; the page list and `link_to_page` enum; the help guide's files all load and every page it links exists.
- **Server** (with the AI SDK's test models; **CI never calls a provider**): 401 / 403 / 404-when-off; the daily limit, including two requests racing for the last slot (checked to fail with the guard removed); a provider error → 503 and a usage row `error`; invalid structured output → one retry → 502; the draft's mapping against a real seeded catalog.
- **e2e** (assistant routes mocked in the browser): opening and closing the panel (docked and on a phone), a streamed answer with a link that navigates, Stop, the error row; draft → editor filled with the banner and `notFound`; Improve → Use → the field changes and the form is dirty.
- **Quality check before each step ships, and whenever the model or provider changes** (manual, spends a little; `scripts/assistant-eval.ts`, not in CI): 25 help questions (English and Khmer), 15 descriptions, 10 wording requests, run against the configured model, with the expected facts per case; the result and cost go in the PR.
- **Staging (9.0):** a streamed answer end to end through the Worker; the Worker's bundle size after adding the packages; how long a request may take there.

## Steps

| Step | Builds | Done when |
|---|---|---|
| **9.0** | Packages; `assistant.model.ts` (the one place naming providers); settings and the feature switch; `assistant: ['use']`; `assistant_usage` + migration + limit + retention task; errors; a hidden `POST /api/admin/assistant/ping` that makes one tiny call (for the staging check), removed in 9.1 | Server tests; the staging check above passes with the owner's key (Q43) |
| **9.1** | The help guide (drafted by the agent from the code, reviewed by the owner), the page list, `/chat`, the panel | e2e; the quality check's help questions |
| **9.2** | `/menu-item-draft`, the dialog, the editor's prefill and banner | e2e; the quality check's descriptions |
| **9.3** | `/rewrite`, the Improve popover | e2e; the quality check's wording cases |

## Open

- **Q43** (owner): the AI provider account and key for staging and production, and a monthly spending cap on that account. Blocks 9.0's staging check. Default: any supported provider; the cap set on the provider's side.
