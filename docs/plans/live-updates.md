# Live updates with Durable Objects and WebSockets (later)

_2026-09-30. The owner asked to look at Cloudflare Durable Objects and WebSockets for order tracking (6.5b) and to keep the idea as a plan for later. Decision: polling now (D114), this plan when it's needed. Not scheduled; it becomes a numbered step when the owner asks for it._

## Why not now

- A customer's order changes about 3 times in ~15 minutes (paid → preparing → ready → completed). Polling every 10 seconds while the page is visible shows each change within ~10 s; the counter already polls every 10 s (D102).
- Pushing doesn't remove polling's safety net: a phone that locks its screen drops the socket, so "refetch when the tab comes back" (D22) stays either way. Pushing only makes a change appear sooner **while someone watches the page**.
- What it adds is spread over the whole app: a different deploy preset, an authenticated upgrade, a publish path that also works on Node (local dev and e2e), reconnects, and a failure mode ("the socket is silently dead") that's harder to see than a failed request.
- Cost is not the reason: with the Hibernation API an idle socket isn't billed for duration; the Workers free plan includes 100,000 Durable Object requests a day, and messages the server sends are free (Cloudflare pricing, checked 2026-09-30).

## When to do it

As one step for **the counter and the customer's tracking together**, when one of these holds:

- the counter's 10-second delay for a new order (and its chime) is a real complaint;
- the cafe is on the Workers paid plan with its own domain (Q4), and the release checks can cover a new moving part;
- polling's request volume becomes noticeable (it isn't at one cafe: ~200 orders a day × ~60 small reads ≈ 12,000 requests a day).

## Design (checked against the repository, Nitro 2.13.4 and crossws 0.3.5)

```
Counter: Mark ready (or pay, complete, cancel; a customer's cancel; the expiry task)
   ↓
the order's batch commits (D1), with its outbox event (as today: orders.placed / orders.paid, D113)
   ↓
the outbox handler: publish("branch:<branchId>", "orders") and publish("order:<orderId>", "changed")
   ↓
the Durable Object pushes a tiny "changed" message to the sockets on those topics
   ↓
each page refetches through its normal query (useApiQuery), which checks the session as always
```

- **Our own small Durable Object class, not crossws' pub/sub.** Nitro 2.13.4 has a `cloudflare-durable` preset (one `$DurableObject` named `server`, WebSockets through crossws 0.3.5 on the Hibernation API). But crossws' server-side `publish(topic)` walks the peers **kept in memory**, and after hibernation that set is empty until a socket sends something (checked in `crossws/dist/adapters/cloudflare-durable.mjs` and its `adapterUtils`): a publish from the server would silently reach nobody. Instead, one class per branch (`idFromName(branchId)`) accepts each socket with Cloudflare's own **tags** (`ctx.acceptWebSocket(server, ['order:<id>'])`, or `['queue']` for the counter) and publishes with `ctx.getWebSockets(tag)`, which works after hibernation. It's exported from the Worker entry next to Nitro's handler, with its binding and migration in `wrangler.json`; checked on staging before merging.
- **Messages carry no data, only "changed".** The page refetches the order or the queue with its normal `apiFetch`, so authorization stays in the existing routes, and a missed message costs at most one poll interval.
- **Subscribing is authorized on the server:** the upgrade request carries the session cookie; `/api/shop/orders/{id}/live` subscribes only the order's own customer to `order:<id>`; `/api/counter/{branchId}/live` subscribes only staff of that branch (`requireBranchPermission`). Topics are never chosen by the client.
- **Publishing lives in the notifications path**, next to the Telegram alerts (D113): orders keep writing neutral outbox events; the orders code doesn't learn about sockets. Missing events (ready, complete, cancel, expire) are added to `ORDER_EVENTS`.
- **Local dev and e2e (Node):** there is no Durable Object on the `node-server` preset. A small `publish()` in `server/utils` calls the branch's Durable Object on Cloudflare and an in-process list of sockets (Nitro's crossws WebSocket handler) on Node, so the e2e suite exercises the same pages.
- **Client:** one composable per screen already owns freshness (`useOrderLive` in orders, the counter's queue). It opens the socket while the page is visible, refetches on "changed", reconnects with backoff, and **keeps polling at a slow rate (60 s) as a fallback**; the page itself doesn't change.

## Risks to test when it's built

| Risk | Test |
|---|---|
| Someone listens to another customer's order | server: the upgrade for another customer's order is 404, a signed-out one 401 |
| Staff of another branch listen to a branch's queue | server: 403 for a branch the person doesn't work at |
| A lost message leaves a page stale | e2e: drop the socket; the fallback poll and tab-return refetch still update it |
| A publish fails and fails the order | the publish runs in the outbox handler after the order committed; a failure is retried, never rolls back the order |
| Hibernation loses subscriptions | tags live with the socket, not in memory; a test publishes after the object was evicted (Cloudflare's `vitest-pool-workers` can evict) |
| The preset change breaks deploys | staging deploy and smoke check before merging; the e2e build stays on Node |

## Out of scope

Push notifications to phones (Web Push), SMS, sound on the customer's page, sending order data over the socket.
