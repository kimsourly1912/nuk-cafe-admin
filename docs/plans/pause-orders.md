# Pause orders plan (D199)

_2026-10-23. Owner decisions (this session, the recommendations accepted, no mockup round): managers and owners pause a branch's **online** orders from the counter for **15 minutes, 30 minutes, an hour or until closing** (never past closing, no "until I resume"); orders already placed carry on; a Telegram alert to owners is a later step._

## Why

Online orders follow the weekly hours (D45). A broken machine, a rush or a short-staffed shift needs ordering to stop now and start again by itself, without an owner editing the hours (a permanent change, owners only).

```text
Counter (manager or owner) → Manage → Pause orders… (15m · 30m · 1h · until closing, reason?)
  POST /api/c/<slug>/counter/<branchId>/pause   requireBranchPermission({ branch: ['pause'] })
  one batch: branches.paused_until / paused_by / pause_reason + audit branch.pause
        ↓
toPublicBranch → pausedUntil (only while ahead and the branch is open)
        ↓
orderProblems → ORDERING_PAUSED "Riverside isn't taking online orders right now. Back at 3:30 PM."
  checkout's quote not orderable · placing an order 409 ORDERING_CLOSED
```

## Steps (one PR each)

1. **Server (built).** Migration `0046_branch_pause`: `branches.paused_until`, `paused_by` (→ user, set null), `pause_reason`. `branch: ['pause']` for managers (owners hold it). `GET …/pause` (`order: ['read']`: anyone at the counter sees who paused and why), `POST …/pause` `{ for, reason? }`, `POST …/resume` → `BranchPause`. `PublicBranch.pausedUntil`; `QuoteProblemCode` `ORDERING_PAUSED`.
2. **Counter (built).** Manage → **Pause online orders…** (`CounterPauseModal`: four card radios, an optional reason, the refusal shown in the dialog), or **Resume online orders** while paused; the header's badge **Paused**; on the queue a banner (`role="status"`, announced politely) "Online orders paused until 3:30 PM · By Rina Sok · Machine broken" with **Resume now** for managers and owners (staff see it without the button). `useBranchPause` reads `GET …/pause` and is refreshed with each refresh of the board, so another tablet's pause shows within 10 seconds. Tested at **Zulu Pop-up**, a seeded branch open around the clock where no other file orders (pausing Riverside would stop other files' orders).
3. **Customers and admin.** The menu and checkout say it with the time; the Branch page's status card shows it with Resume; help pages.

## Rules and edge cases

- **Not versioned.** A pause is a state the counter sets, like sold out (D105): the branch's `version` (its settings and hours) doesn't move, so an owner's save never conflicts with it. The last pause wins; pausing again replaces the end time.
- **The server computes the end:** the choice from now, capped at today's closing (`minutesUntilClosed`). A closed branch is refused (409 `BRANCH_CLOSED`). No job: an end in the past means not paused.
- **Public vs staff:** customers see only `pausedUntil`; who paused and the reason are in `BranchPause` (staff routes).
- **Orders already placed** carry on. A pause landing between an order's check and its save lets that one order through, as closing time does.
- Resume when not paused changes nothing and audits nothing. An archived branch is refused. Another cafe's branch is 404.
- The menu page's 60-second cache (D122) can show a pause up to a minute late; checkout and placing an order read it fresh.
