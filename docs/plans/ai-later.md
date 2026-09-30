# AI: options for later

_2026-09-30. Options considered while planning the AI assistant ([ai-assistant.md](ai-assistant.md), D107) and **not** built in the first version, with why, what each would take, and what would make it worth building. Nothing here is decided: the owner picks from this list when a need appears. Keep the list current: when one is built, move it into a plan and a decision entry; when a new idea comes up, add it here._

Each entry: **What**, **Why not now**, **What it takes**, **Build it when**.

## Who can use it

### Assistant for counter staff
- **What:** the same help panel in the counter app (`/counter`), answering only counter questions (taking payment, riel, KHQR, cancelling, sold out).
- **Why not now:** the admin portal is where the questions and the menu work are; counter screens are few and simple.
- **What it takes:** a counter help guide; `assistant: ['use']` granted to branch roles; a route on the counter surface (`/api/counter/{branchId}/assistant/chat`); the panel in the counter layout (a phone-first sheet); its own daily limit per person.
- **Build it when:** new staff keep asking the same counter questions, or staff turnover is high.

### Customer-facing assistant
- **What:** help for customers on the website ("what's vegan?", "how do points work?").
- **Why not now:** a public endpoint is open to anyone (cost and abuse), it needs the menu's details to be complete and correct, and it speaks for the cafe.
- **What it takes:** a public route behind strict rate limits (the WAF rules need the custom domain, Q4) or signed-in customers only; answers limited to the public menu and policies; a firm "ask the staff" fallback; the owner's approval of every policy it quotes.
- **Build it when:** the menu has full descriptions and allergens, and customers ask the same questions at the counter.

## Memory

### Saved conversation history
- **What:** an admin's past chats kept on the server, visible from any device.
- **Why not now:** it stores staff questions (more data to protect), and one-off help rarely needs history.
- **What it takes:** tables `assistant_conversations` (id, user, title, created, updated) and `assistant_messages` (conversation, role, text, created); a list of past chats in the panel; a deletion period (for example 30 days, by a daily task); only the owner of a chat can read it; the session boundary still clears it from the screen.
- **Build it when:** admins ask to return to an earlier answer, or the owner wants to review questions to improve the help guide (then consider the next item instead).

### Question log for improving the help guide
- **What:** keep the questions (not the answers) for a short time, so the owner can see what staff don't understand and improve the guide or the screens.
- **Why not now:** decision A4 records metadata only.
- **What it takes:** a `question` column on `assistant_usage` (or its own table) with a 30-day deletion; an admin report "most asked this month"; staff told that questions are kept.
- **Build it when:** the guide's gaps aren't obvious from feedback.

### Stored preferences
- **What:** explicit settings the assistant follows: reply language, short or detailed answers.
- **Why not now:** the reply language already follows the question; nobody has asked for more.
- **What it takes:** per browser, browser storage and no server change; across devices, a table `assistant_preferences` (user, language, detail, updated). The server adds one line to the request ("Reply in Khmer, briefly"). **Not** AI "memory" that learns silently: unpredictable and hard to reset.
- **Build it when:** admins repeatedly ask for the same style.

## Knowledge

### Help guide editable without a release
- **What:** the owner edits help pages in the admin portal.
- **Why not now:** the guide describes the app, so it changes with the app and is reviewed in the same PR; a table would add an editor, a migration and a second place to keep in sync.
- **What it takes:** a `help_pages` table (screen, title, body, version, updated by), an editor page, audit; the files in the code become the defaults.
- **Build it when:** the owner wants to add cafe-specific procedures (opening checklist, cash-up steps) that aren't about the app.

### Searching a large knowledge base (RAG)
- **What:** instead of sending the whole guide each time, find the few relevant pages and send only those.
- **Why not now:** the guide is small enough (about 10–20 pages) to send whole, which is simpler and more reliable.
- **What it takes:** splitting pages into pieces, embeddings (a vector per piece, from the provider or Cloudflare Workers AI), a vector index (Cloudflare Vectorize), a search step before each question, and a way to rebuild the index when the guide changes.
- **Build it when:** the guide grows past what fits comfortably in one request, or cafe procedures (above) make it large.

### Caching answers on our side
- **What:** save an answer and reuse it for the same question.
- **Why not now:** answers depend on the page and the conversation, identical questions are rare, and saved answers go stale when the guide changes. The provider's prompt caching already makes repeated questions cheap.
- **What it takes:** a key per (question, page, guide version), a store (KV) with expiry, and invalidation on each release.
- **Build it when:** usage shows many identical first questions (then pre-written answers in the guide may be simpler still).

## Menu content

### Translating names and descriptions
- **What:** Khmer (or other languages) for item names and descriptions, suggested by AI and checked by a person.
- **Why not now:** the menu has one `name` and one `description`; the customer site is English only (D97). Translation needs product decisions first.
- **What it takes (decisions first):** which languages; whether customers get a language switch; who checks each translation before it goes live. Then: translated fields in the menu tables (a migration), the public menu in the chosen language, the editor showing each language, and the same "suggest, review, save" flow as Improve wording.
- **Build it when:** the owner decides the languages and the customer site's language switch.

### Bulk improve or translate
- **What:** improve or translate many items at once, reviewed in a list.
- **What it takes:** a batch request (the provider's batch API is cheaper for this), a review screen with accept or reject per item, saves through `executeMany` with each item's `version`.
- **Build it when:** single-item Improve is used a lot.

### Draft from a photo of a paper menu
- **What:** upload a photo of an old menu; the assistant proposes drafts for every item.
- **What it takes:** image input (most supported models read images), a review list of drafts, and the same mapping to existing categories and add-ons.
- **Build it when:** a new branch or a menu rebuild needs many items entered at once.

## Doing, not just suggesting

### The assistant performs actions
- **What:** "mark the large iced latte sold out" and it does it.
- **Why not now:** a model that writes data can be tricked or simply wrong; the first version keeps every change in a person's hands.
- **What it takes:** write tools that call the existing services as the signed-in admin (their permissions, `version` checks, audit), a confirmation step showing exactly what will change before each action, and tests that the assistant can never skip the confirmation.
- **Build it when:** the read-only assistant is trusted and staff ask for shortcuts to frequent actions.

## Operations

### Cloudflare AI Gateway in front of the provider
- **What:** Cloudflare's proxy for AI calls: logs, spending limits, rate limits and switching providers from its dashboard.
- **Why not now:** our usage table and daily limit cover the first version.
- **What it takes:** a gateway in the Cloudflare account; the provider's base URL pointed at it (a setting, no code change).
- **Build it when:** more than one AI feature is live, or the owner wants to see costs in one dashboard.

### Several models by task
- **What:** a cheaper model for simple help questions, a stronger one for drafts.
- **Why not now:** one model is simpler, and one cache namespace (caches are per model).
- **What it takes:** a model setting per feature; the quality check run for each.
- **Build it when:** the monthly cost matters and the quality check shows a cheaper model is good enough for a task.
