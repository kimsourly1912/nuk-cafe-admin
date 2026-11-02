# Live updates with Durable Objects and WebSockets (later)

_2026-09-30. The owner asked to look at Cloudflare Durable Objects and WebSockets for order tracking (6.5b) and to keep the idea as a plan for later. Decision: polling now (D114), this plan when it's needed._

_Revised 2026-11-02 (D250): rechecked against the code and Cloudflare's current docs. The publish moved out of the outbox (it runs once a minute), the objects and routes became per cafe (D135), and Workers Paid on `angder.app` is in place. Still not scheduled; it becomes a numbered step when the owner asks for it._

## Why not now

- A customer's order changes about 3 times in ~15 minutes (paid → preparing → ready → completed). Polling every 10 seconds while the page is visible shows each change within ~10 s; the counter polls every 10 s too (D102, `QUEUE_REFRESH_MS`, `ORDER_REFRESH_MS`).
- Pushing doesn't remove polling's safety net: a phone that locks its screen drops the socket, so "refetch when the tab comes back" (D22) stays either way. Pushing only makes a change appear sooner **while someone watches the page**.
- What it adds is spread over the whole app: a Durable Object class in the app's Worker, an authenticated upgrade, a publish path that also works on Node (local dev and e2e), reconnects, and a failure mode ("the socket is silently dead") that's harder to see than a failed request.
- Cost is not the reason (Cloudflare pricing, rechecked 2026-11-02): opening a socket is one Durable Object request; messages the server sends are free; incoming messages count 20 to 1; a hibernated object isn't billed for duration. Workers Paid includes 1 million Durable Object requests a month. At ~200 orders a day this stays inside the included amount.

## Products considered (2026-11-02)

| Product | Fit |
|---|---|
| **Durable Objects + WebSocket Hibernation** | **Chosen.** One object holds a branch's sockets and sends to them by tag (`ctx.getWebSockets(tag)`), also after hibernation. Already used in production by the watchdog (D224) |
| KV | No: changes take up to ~60 s to reach other locations, and it can't push to a browser |
| Queues | No: moves work between server jobs; it can't reach a browser |
| Realtime (formerly Calls) / RealtimeKit | No: WebRTC audio and video, far more than a "changed" signal |
| Server-Sent Events from a plain Worker | No: every request is separate, so a publish can't reach other open connections without a Durable Object anyway |

## When to do it

As one step for **the counter and the customer's tracking together**, when one of these holds:

- the counter's 10-second delay for a new order (and its chime) is a real complaint;
- polling's request volume becomes noticeable (it isn't at one cafe: ~200 orders a day × ~60 small reads ≈ 12,000 requests a day).

The earlier condition "Workers Paid with its own domain" is met since D211 (`angder.app`), so it no longer blocks the step; the owner's need decides.

## Design (rechecked against the repository on 2026-11-02)

```
Counter: pay, mark ready, complete, cancel; a customer's cancel; the expiry task
   ↓
the order's db.batch commits (D1), with its outbox event as today (D113)
   ↓
after the commit: waitUntil(publish({ tenantId, branchId, orderId }))
   ↓
the branch's Durable Object "<tenantId>:<branchId>" sends "changed" to the sockets tagged "queue" and "order:<orderId>"
   ↓
each page refetches through its normal query (useApiQuery), which checks the session as always;
a slow poll (60 s) and the tab-return refetch (D22) stay as the safety net
```

- **Publish right after the commit, not from the outbox.** The outbox is delivered by `platform:deliver-outbox` **once a minute** (`server/tasks/platform/deliver-outbox.ts`), so publishing from its handler would be slower than today's 10 s polling. The signal is sent with `event.waitUntil(…)` after the batch commits (the assistant chat route already passes `waitUntil` this way). It is best effort and not retried: a message carries no data, so a lost one costs at most one fallback poll. It never rolls back or fails the order: the commit already happened, and a publish error is logged, not returned.
- **Where the publish call lives.** The orders services keep writing their neutral outbox events and don't learn about sockets. Each order write route calls one small `publishOrderChanged(event, ref)` from `server/utils/live.ts` after its service returns; the routes already know the cafe, branch and order. The expiry task (`server/tasks/orders/expire-unpaid.ts`) needs the expired orders' branch and id from `expireUnpaidOrders`' report, then publishes per branch. Confirm this split when building; the rule to keep is that the orders feature doesn't import the live code.
- **Our own small Durable Object class, not crossws' pub/sub.** On 2026-09-30 (Nitro 2.13.4, crossws 0.3.5), crossws' server-side `publish(topic)` walked the peers kept in memory, and after hibernation that set is empty until a socket sends something: a publish from the server would silently reach nobody. **Re-check this against the installed Nitro and crossws versions before building** (not rechecked on 2026-11-02: no `node_modules` in that session). The default stays one class per branch, accepting each socket with Cloudflare's **tags** (`ctx.acceptWebSocket(server, ['order:<id>'])`, or `['queue']` for the counter) and publishing with `ctx.getWebSockets(tag)`, which Cloudflare documents as working after hibernation. The class is exported from `server/cloudflare-entry.ts` next to Nitro's handler, with its binding and a `new_sqlite_classes` migration in the generated `wrangler.json` (D53), and is checked on staging before merging.
- **Per cafe (D135).** The object's name is `"<tenantId>:<branchId>"` from `idFromName`, never a branch id alone, and the publish takes the tenant from the server's actor, never from the client. A two-cafe test proves a publish for one cafe's branch reaches none of the other cafe's sockets.
- **Messages carry no data, only "changed".** The page refetches the order or the queue with its normal `apiFetch`, so authorization stays in the existing routes.
- **Subscribing is authorized on the server.** The upgrade request carries the session cookie, and the route checks it before forwarding the upgrade to the object:
  - `GET /api/c/<slug>/counter/<branchId>/live` uses `requireBranchPermission` for that branch, then tags the socket `queue`;
  - `GET /api/c/<slug>/shop/orders/<id>/live` lets only the order's own customer in, and tags the socket `order:<id>`.

  Topics are never chosen by the client. The workspace session's limits still apply (D243): when the session ends, the next refetch fails as it does today.
- **Missing events:** completed, cancelled and expired are not in `ORDER_EVENTS` yet. Add them only if something other than the live signal needs them; the live publish doesn't go through the outbox.
- **Local dev and e2e (Node):** there is no Durable Object on the `node-server` preset. `publish()` in `server/utils/live.ts` calls the branch's Durable Object on Cloudflare and an in-process list of sockets (Nitro's crossws WebSocket handler) on Node, so the e2e suite exercises the same pages.
- **Client:** the composables that own freshness today (`useCounterQueue`, `useOrderTracking` and the menu bar's query in orders) open the socket while the page is visible, refetch on "changed", reconnect with backoff, and **slow their poll to 60 s while the socket is open** (back to 10 s while it isn't). Pages don't change. Sockets close on sign-out and session changes, like the other identity-bound state.
- **CSP:** `connect-src 'self'` should already cover a same-origin `wss:` socket in current browsers; confirm in the e2e build, which runs under the CSP.

## Risks to test when it's built

| Risk | Test |
|---|---|
| Someone listens to another customer's order | server: the upgrade for another customer's order is 404, a signed-out one 401 |
| Staff of another branch listen to a branch's queue | server: 403 for a branch the person doesn't work at |
| One cafe's publish reaches another cafe | two cafes with a branch each: a publish for one reaches no socket of the other |
| A lost message leaves a page stale | e2e: drop the socket; the fallback poll and the tab-return refetch still update it |
| A publish fails and fails the order | the publish throws; the order's response is still a success and the order is committed |
| The live signal arrives later than polling would | the publish runs after the commit, not from the outbox cron: a test checks the signal is sent during the request |
| Hibernation loses subscriptions | tags live with the socket, not in memory; a test publishes after the object was evicted (Cloudflare's `vitest-pool-workers` can evict) |
| The Durable Object breaks deploys | staging deploy and smoke check before merging; the e2e build stays on Node |

## Out of scope

Push notifications to phones (Web Push), SMS, sound on the customer's page, sending order data over the socket.
