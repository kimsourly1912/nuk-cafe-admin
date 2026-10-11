# Marketing: promotions and posting them (owner, 2026-10-11)

The owner asked for a **Marketing** area: cafe owners run promotions and discounts in the app, and post them to their social channels in one click. Scope from the owner:

- **Posters are made elsewhere** (designed by the owner, or with an AI tool) and **uploaded finished**. No poster maker in the app.
- **Channels for now: a Telegram channel and a Facebook Page.** Instagram and TikTok later.
- The owner skipped the mockup round and asked us to design the screens (2026-10-11).

Built in steps:

| Step | What | Status |
|---|---|---|
| **M1** | **Promotions**: the discount on the menu, the checkout and the order; the poster; the admin's Promotions pages; the customer menu's Offers; results (D163) | built, merged |
| **M2a** | **Post to a Telegram channel** (D164): connect it with a code, Post now or at a time, each post's result, orders counted per channel | built, merged |
| **M2b** | **Post to a Facebook Page** in one click ([below](#m2b-post-to-a-facebook-page-planned)) | planned |
| **M3** | **Promote on Facebook**: paid ads with the targeting chosen for the cafe, one click after a one-time setup ([below](#m3-promote-on-facebook-paid-ads-planned)) | planned |

## M1: promotions (D163)

### The rules (decided, the owner delegated them)

| Rule | Decision | Why |
|---|---|---|
| Kinds | **Percent off** (1–100) or **Amount off each item** ($0.01–$1,000) | What cafes run; "buy one get one" and bundles need cart rules: later if asked |
| Applies to | **Chosen items and/or categories** (a main category covers its sub-categories, items added later too), or **the whole menu** | A category promotion keeps working as the menu changes |
| Add-ons | **Keep their price** | An extra shot is not part of "20% off coffee"; also simpler to explain |
| Two promotions on one item | **The bigger discount wins, never both** (a tie: the older promotion) | Stacking surprises owners; "best price" is what customers expect |
| Vouchers (phase 7) | Not combined (decided when vouchers are built) | |
| When | **Calendar days**, all day, from the first to the last day (or no end), **on each branch's clock** | "15–21 Oct" is how owners think; times of day (happy hour) later, through the availability rules |
| Where | **Every branch**, or chosen ones | Most cafes have one branch; the choice shows only with more |
| States | **Draft** (only admins see it), **Published** (scheduled / live / ended by its date), **Ended** by hand. Drafts are deleted; a published promotion is ended, never deleted (orders name it). An ended one can't change or restart: **Run again** copies it | Orders and results keep pointing at what ran |
| Rounding | A percent off is rounded to the nearest cent, half up; a price never goes below $0 | One function (`discountOff`) on the server and the editor's preview |
| Orders | **A snapshot**: each line keeps the price before the promotion and the promotion's name and badge; the line's price is what was paid | A later edit or end never changes an order; the counter and reports explain the lower price |

### How prices flow

```text
GET /public/menu (getPublicMenu)
  catalog (what could sell) → menuAt (now, at this branch) → applyPromotions (running at this branch today)
      each version: priceMinor = after the best promotion, regularPriceMinor = before, promotion = its tag
  └─ the checkout quote and placing an order read the same menu → the same prices by construction
       order_lines: unit_price_minor (paid), regular_unit_price_minor, promotion_id / name / label
```

Prices change only through the menu, so the existing protections hold: a promotion that starts or ends between the menu and the order is caught by the checkout's **PRICES_CHANGED** (D99).

### Data (migration `0036_promotions`)

- `menu_promotions` (tenant, name, description, status, discount kind with percent or amount, scope, starts_on, ends_on, poster asset, ended_at, version) with checks for each rule above.
- `menu_promotion_items`, `menu_promotion_categories`, `menu_promotion_branches`: composite foreign keys inside the tenant; items and categories cascade (only a sample-data reset deletes them), branches restrict.
- `order_lines` + `regular_unit_price_minor`, `promotion_id`, `promotion_name`, `promotion_label` (nullable: older lines have none), and a partial index for a promotion's results.

The server code lives in the **menu** feature (`promotions.*`): promotions change menu prices and link to menu items and categories. Results are an orders read (`promotionResults`), joined in the route.

### API (`/api/c/<slug>/admin/menu/promotions`, `menu: read / write`)

`GET` (all, with phase and links), `POST` (`publish` to publish at once), `GET /{id}`, `PUT /{id}` (the whole promotion at its version), `POST /{id}/publish`, `POST /{id}/end`, `DELETE /{id}` (a draft, at its version), `GET /{id}/results`. The public menu answers each version's `regularPriceMinor` and `promotion`, each item's badge and the live `promotions` (for Offers).

### Screens

- **Promotions** (Marketing in the sidebar): cards with the poster, the badge, what it covers, the dates and "Ends in 5 days"; tabs All / Live / Scheduled / Drafts / Ended, running ones first; search by promotion, item or category.
- **The editor** (`/promotions/new`, `/promotions/<id>/edit`): Details, Discount, What's included (**Choose items**: the menu as a checklist), When (two date pickers, quick lengths, No end date), Branches (only with more than one), Poster; beside it from `lg`, **How customers see it** (the offer card and an example price). Save draft / Publish, or Save changes; a note when another promotion covers the same items.
- **A promotion's page**: the results (orders, items sold, discount given, sales at its price), the details, the poster with Download; Publish, Edit, End now, Delete draft, Run again.
- **Customers**: the badge on the menu card's photo and the sale price with the old one struck through; the item's page; **Offers** at the top of the menu (the poster, the badge, the last day; opening one lists its items); the order panel's "You save"; Review order's badge per line and "Promotions saved you"; the order page's "You saved".
- **Staff**: the counter's order panel and Finished today, and Order history, show the promotion under each line.

### Not in M1

Times of day (happy hour), "buy one get one", a minimum order, codes customers type, a limit per customer, promotions on add-ons, scheduling a post (M2).

## M2a: post to a Telegram channel (D164)

### Connecting a channel

1. Marketing → **Channels** → **Connect a channel**: the dialog makes a one-time code (`/connect ABCD2345EF`, 15 minutes; only its hash is stored).
2. **Open Telegram** (`https://t.me/<bot>?startchannel&admin=post_messages+delete_messages`): the admin picks the channel and adds the bot as an admin that can post. That link carries nothing back to us, hence the code.
3. The admin posts the code in the channel. The webhook gets it as `channel_post`, checks the bot may post there (`getChatMember`), deletes the post and moves the code to **confirm** with the channel's title, @username and subscribers.
4. **Connect channel** in the dialog. Closing at that point cancels it, and the bot leaves the channel.

The webhook must receive `channel_post`: making a code adds it to the webhook's `allowed_updates` when it's missing (same address and secret).

### Data (migration `0037_marketing_channels`)

- `marketing_channels`: kind (`telegram_channel`), the Telegram chat id, title, username, subscribers, status (connected, removed, disconnected), who connected it and when; unique per tenant and chat, so one channel can serve two cafes.
- `marketing_channel_links`: the code's hash, its status (waiting, confirm, connected, cancelled), the channel found, who made it, expiry.
- `marketing_posts`: the promotion and the channel, status (pending, sent, failed, cancelled), the caption and the message as sent (HTML, the poster's key, the button), when, tries, the next try, the post's id and link in Telegram, the reason.
- `orders.source` (`telegram`, `facebook` or null).

### API

| Route | Permission | |
|---|---|---|
| `GET /admin/marketing/channels` | menu: read | Whether this server has a bot, and the channels |
| `POST /admin/marketing/channels/links`, `GET …/links/{id}`, `POST …/links/{id}/confirm`, `…/cancel` | settings: manage | Connecting |
| `POST /admin/marketing/channels/{id}/disconnect` | settings: manage | `{ version }` |
| `GET /admin/menu/promotions/{id}/posts` | menu: read | Latest first |
| `POST /admin/menu/promotions/{id}/posts` | menu: write | `{ channelIds, caption, withPoster, at }` and an `Idempotency-Key`; without `at`, sent in the same request |
| `POST /admin/marketing/posts/{id}/cancel`, `…/retry` | menu: write | `{ version }` |

Scheduled posts: `marketing:deliver-posts` every minute.

### Screens

- **Channels**: the Telegram channels (Connected, or Bot removed with Reconnect; ⋮ Open in Telegram, Disconnect) and a Facebook Page card marked Coming soon.
- **A promotion's page**: **Posts** (Sent with View post, Scheduled with Cancel, Sending or Retrying, Failed with the reason and Try again, Cancelled) and **Post to channels** for a live or scheduled promotion: the channels, the caption started from the promotion, Include the poster, Now or Later (this device's time, up to 30 days), the post as followers see it. Results add "N orders from Telegram posts".
- **The customer menu**: `?promo=<id>` opens that offer (or says it isn't on anymore); `?src=telegram` is kept in the browser for 24 hours and sent with the next order. Both leave the address.

## Facebook: the plan for M2b and M3 (owner, 2026-10-11)

The owner's goals:

1. **One click to post** a promotion to the cafe's Facebook Page.
2. **A page that runs Facebook ads for the cafe owner**: most owners don't know how to boost a post, so the app chooses everything (who sees the ad, where, their age, the budget, how long) and the owner presses one button.

### What Meta requires first (not code; nothing below works for other cafes without it)

Everything here goes through **one Meta app owned by the platform** (not by each cafe). Before any cafe other than the app's own testers can use it, Meta must approve it:

| Requirement | Who | Notes |
|---|---|---|
| **Business Verification** of the platform's company in Meta Business Manager | The platform's owner: company registration documents | Reported to take days to weeks. Needed for advanced access to the ads permissions |
| **App Review** for each permission, with a screencast of the app using it and a written reason per permission | We prepare; the platform's owner submits | Pages: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`. Ads: `ads_management`, `ads_read`, `business_management`. Generic reasons are refused; each needs its own explanation |
| **Marketing API access tier** (renamed from "Standard / Advanced access" on 4 May 2026) | Meta | The full tier is needed to manage other businesses' ad accounts. It reportedly has to be kept up with API use (a minimum number of calls in 15 days, few errors) |
| **Our own domain** (Q4) | The owner | For Facebook Login's redirect address, the app's domain, the privacy policy and the data deletion callback. A `workers.dev` address isn't something we control |
| **Privacy policy, terms, and a data deletion callback** | We build the pages; the owner approves the text | Meta requires them for App Review. The callback deletes a cafe's Facebook data when a person removes the app in Facebook |

**Before approval** the app runs in **development mode**: everything works for the people added to the Meta app as testers (NUK Cafe's owner, its Page and ad account). So we can build and use it on NUK Cafe first, while the review runs.

**Sources** (third-party guides; developers.facebook.com could not be fetched from our build container, so every Meta fact below is **checked again in the spike, M2b.0**): [Meta Ads API: setup and limits (2026)](https://admanage.ai/blog/meta-ads-api), [Facebook API pricing 2026](https://www.blotato.com/blog/facebook-api-pricing), [Ads API permission App Review (2026)](https://singhamandeep.com/facebook-ads-api-permission-app-review/), [Facebook Login for Business](https://developers.facebook.com/docs/facebook-login/facebook-login-for-business/), [Boost an existing Facebook post](https://developers.facebook.com/documentation/ads-commerce/marketing-api/ad-creative/partnership-ads/ads-creation/boost-existing-fb-post), [Ad creative](https://developers.facebook.com/docs/marketing-api/creative), [Budgets](https://developers.facebook.com/documentation/ads-commerce/marketing-api/bidding/overview/budgets.md), [Detailed targeting removed in 2026](https://advlaunch.us/blog/meta-detailed-targeting-removed-2026), [Advantage+ audience vs detailed targeting](https://www.conversios.io/blog/meta-advantage-audience-vs-detailed-targeting-2026-guide/).

### Who pays for ads (decided by design, owner to confirm: QM2)

**Each cafe pays Meta directly, from its own ad account and its own card.** The app only creates and manages the ads. We never hold, charge or pass on ad money.

- **Why:** handling the money would make the platform an ad reseller: credit risk when a cafe doesn't pay, Meta billing in our name, refunds and taxes. A cafe's own ad account keeps the bill, the receipts and the spending limit with the cafe.
- **What the cafe needs once:** a Facebook Page, an ad account in its own Business Manager, and a payment method in it. The setup page checks each and links to Meta's screen when one is missing ("Add a payment method in Facebook").

### M2b: post to a Facebook Page (planned)

**Connect (once):** Marketing → Channels → **Connect Facebook**.

1. **Facebook Login for Business** opens. The owner picks the cafe's Page (and, for M3, its ad account) and allows the app.
2. The cafe's grant is kept as a token **sealed with AES-256-GCM** under a Worker secret, the cafe's id bound in. This reuses the Bakong token's sealing (D148). The token is never sent to the browser.
3. The Page shows on Channels beside the Telegram channel: its name, followers, and Connected or **Reconnect** (the grant expired or was removed).

**Token choice (to confirm in the spike):** Login for Business can give a **business-integration system-user token**. It is meant for automated actions on a client's assets without the person signing in again (scheduled posts, ad syncing). Meta lists it for **Tech Providers** only, so the platform registers as one. The fallback is a user token turned into a Page token, which also doesn't expire for posting; for ads it needs signing in again about every 60 days.

**Posting** reuses M2a as it is:

- The **Post to channels** dialog lists the Page beside the Telegram channel.
- The poster goes up as a photo post (`/{page-id}/photos`) with the caption. The **Order now** link goes in the caption, because a photo post has no button: `?promo=<id>&src=facebook`.
- The same posts list, retries, scheduling, View post, and orders counted per channel ("1 order from Facebook posts").

**Data:** the channel kind `facebook_page` in `marketing_channels`, and `marketing_credentials` (the sealed token, its kind, its expiry, the Page and ad account ids). A deauthorize and data-deletion webhook marks the channel removed and deletes its credentials.

### M3: promote on Facebook (paid ads) (planned)

**The owner's one click:** on a promotion's page, **Promote on Facebook** opens a short dialog with everything already chosen:

> **Show "Coffee week" to people near Riverside**
> People aged 18 and over, within 3 km of your cafe · Facebook and Instagram
> **$3 a day for 5 days · $15 at most** (charged to your Facebook ad account)
> Ends 21 Oct, the promotion's last day
> [ Promote ]   *Change who sees it*

**What the app chooses for the owner** (the reasons are written into the dialog's "Why" note):

| Setting | Default | Why |
|---|---|---|
| **Where** | A circle around each chosen branch's map pin: 3 km in a city, 5 km elsewhere (the owner can choose 1 to 10 km) | A cafe's customers walk or ride there. **Needs the branch's location on a map** (maps step A, not built yet). Radius targeting reportedly fails with several locations in one ad set, so the app makes **one ad set per branch** |
| **Age** | 18 and over, no upper limit | Meta restricts targeting people under 18. Age is one of the only two settings Meta's Advantage+ audience treats as a hard limit (the other is location) |
| **Interests** | None: Meta's **Advantage+ audience** finds the people | Meta retired most detailed-targeting options in January 2026; interests are now only a suggestion to its delivery. Leaving them out avoids ads that stop running |
| **Gender, language** | Everyone | A cafe sells to everyone; adding limits only makes the ad cost more |
| **Placements** | Automatic (Facebook, Instagram, Messenger) | Meta places it where it costs least for the result |
| **Goal** | **People who tap Order now** (the Traffic objective, to the menu at `?promo=<id>&src=facebook_ads`), the poster as the image | The cafe wants orders, not likes. Orders are counted by the app (`orders.source`), as with the Telegram posts. The alternative, "boost the Page post" (the Engagement objective), gets likes and comments but no measured orders: offered as a choice |
| **Budget** | Presets: **Small $3/day**, **Medium $7/day**, **Large $15/day**; a total for the run, never an open-ended budget | A **lifetime budget with an end date** means the owner can't be charged more than the total shown. Meta's minimum daily budget per currency is read from the ad account before showing the presets |
| **When** | From now to the promotion's last day, at most 14 days (the owner can shorten it) | A promotion without an end date still gets an end on its ad |

**Safety (money is spent on the cafe's card, so every guard is tested with the guard removed):**

- **Only a cafe owner** can promote (a new permission, `marketing: ['spend']`). Every action is audited with who did it and the amount.
- **Nothing runs half-made.** The campaign, its ad sets, the creative and the ad are created **paused**. They are switched on only once all of them exist. If a step fails, whatever was created is deleted.
- **One click makes one campaign:** an `Idempotency-Key` per click, as with posts.
- **The total is shown before Promote**, in the ad account's currency, as Meta will charge it.
- **Stop** ends the ad at once. Once the promotion ends, its ad is stopped too (the minute task). **Pause / Resume** are also there.
- **Meta's review:** a new ad is checked by Meta before it runs. The page shows "In review", "Running" or "Not approved: <Meta's reason>" with a link to fix it in Facebook.

**Results** (synced hourly from Meta's insights into our database), on the promotion's page:

- people reached;
- taps on Order now;
- money spent (and what's left);
- **orders from the ad and the sales they brought** (our own count);
- **cost per order**.

**Not in M3:** retargeting (needs the Meta pixel and a cookie banner), lookalike audiences, video ads, A/B tests, an "ideas" assistant.

### The order of work

| # | Step | Needs | Done when |
|---|---|---|---|
| M2b.0 ✋ | **Meta setup and spike** (half a week): create the Meta app in development mode with NUK Cafe's owner as tester. Check on the real API: Login for Business and the token type; a photo post on the Page; a **paused** campaign with a radius ad set, an age minimum and a lifetime budget in USD; Meta's minimum budget and radius limits for Cambodia; how long ad review takes. Write down what differs from this plan | The owner: a Meta developer account, NUK Cafe's Page, an ad account with a card; QM2, QM3 | A spike report; this plan amended |
| — | **Start Business Verification and the domain (Q4)** | The owner | Runs in parallel: it takes weeks |
| Maps A | **The branch's location on a map** (agreed 2026-10-02): a pin on the Branch page, Directions on the menu | Nothing | Needed by M3's targeting |
| M2b | **Connect a Facebook Page and post to it** (testers only until App Review) | M2b.0 | Server tests with a fake Graph API; e2e; posting on NUK Cafe's real Page |
| M3a | **Promote on Facebook** (testers only): setup check (Page, ad account, payment method), the dialog, campaigns created paused then switched on, Stop / Pause, results synced hourly, orders counted | M2b, Maps A | Server tests (each money guard checked by removing it); e2e; one real small ad for NUK Cafe ($1–3) |
| M3b | **App Review submission**: screencasts, a reason per permission, the privacy policy, terms and the data deletion pages | Business Verification, Q4 | Meta approves; then every cafe can connect |

### Decisions for the owner

| # | Question | Suggested |
|---|---|---|
| QM1 | (existing) Facebook for every cafe needs App Review, Business Verification and a domain | Start Business Verification now |
| QM2 | Who pays for the ads | Each cafe from its own ad account and card. The platform never handles ad money |
| QM3 | The ad's goal by default: orders (people tap Order now and go to the menu) or a boosted post (likes, comments) | Orders, with "Boost the post" as a choice |
| QM4 | The budget presets and the most a cafe can spend in one promotion without a second confirmation | $3 / $7 / $15 a day; ask again above $100 in total |
| QM5 | Which company owns the Meta app and is verified | The platform's registered company (the same one that will bill cafes, T3) |
