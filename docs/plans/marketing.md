# Marketing: promotions and posting them (owner, 2026-10-11)

The owner asked for a **Marketing** area: cafe owners run promotions and discounts in the app, and post them to their social channels in one click. Scope from the owner:

- **Posters are made elsewhere** (designed by the owner, or with an AI tool) and **uploaded finished**. No poster maker in the app.
- **Channels for now: a Telegram channel and a Facebook Page.** Instagram and TikTok later.
- The owner skipped the mockup round and asked us to design the screens (2026-10-11).

Built in two steps:

| Step | What | Status |
|---|---|---|
| **M1** | **Promotions**: the discount on the menu, the checkout and the order; the poster; the admin's Promotions pages; the customer menu's Offers; results (D163) | built, awaiting review |
| **M2** | **Post to channels**: connect a Telegram channel and a Facebook Page; Post now or at a time; per-channel results; tracked menu links | planned |

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

## M2: post to channels (planned)

- **Connect a Telegram channel**: add the cafe's bot as an admin of the channel, then send the code the page shows in the channel (the same one-time link pattern as D112). Posting uses the Bot API's `sendPhoto` with the caption and a button to the menu.
- **Connect a Facebook Page**: "Continue with Facebook" (Facebook Login for Business), choose the Page; the Page token sealed per cafe like the Bakong token (D148). Posting uses the Graph API (`/{page-id}/photos`).
  - **Needs, before other cafes can use it:** a Meta app with **App Review** for `pages_manage_posts` and `pages_read_engagement`, **Business Verification**, a privacy policy page and **our own domain** (Q4). Until then it works only for the people added to the Meta app as testers (the owner's own Page).
- **Post dialog** on a promotion's page: the channels with a preview each (the poster, the caption with the menu link added), **Post now** or **at a time**; delivered through the outbox with retries (D113); each channel's result (Posted with **View post**, or Failed with the reason and Try again / Reconnect).
- **Tracked links**: the menu link in a post carries `?utm_source=telegram|facebook&p=<promotion>`, so the promotion's page can show visits and orders per channel.
