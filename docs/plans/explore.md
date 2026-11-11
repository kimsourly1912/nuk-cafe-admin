# Explore plan: walk, ride and map your way to a café

Owner brief 2026-11-11 ([brief](explore/brief.md), mockups below); decision [D275](../decisions.md#d275-explore-a-third-person-café-world-with-a-map-built-on-the-shop-designer-2026-11-11). Builds on the [shop designer](shop-designer.md) (D273) and its [scenes](shop-designer-scenes.md) (D274). Status: **E1 (walk and map) built** (2026-11-11, [below](#step-e1-walk-and-map-built-2026-11-11)), behind `NUXT_PUBLIC_EXPLORE`, waiting for the owner's Android benchmark and feel review. The owner delegated the open choices to Claude (2026-11-11: "help me decide all the way"); they are recorded in [Decisions](#decisions-2026-11-11) with their reasons, and the owner may override any of them before its step starts.

## Mockups (owner, 2026-11-11)

[Frames 01–04: call, approach, meet the driver, confirm](explore/frames-01-04-call-and-confirm.webp) · [Frames 05–08 on the riverwalk: open the door, get in, boarding, look around inside](explore/frames-05-08-board-riverwalk.webp) · [the same frames at a storefront](explore/frames-05-08-board-storefront.webp) · [Frames 09–12: outside view through the gateway, arrive, step out, at the counter](explore/frames-09-12-ride-and-arrive.webp).

They set the visual direction and the HUD: **View Menu** top left on every frame, a round north-up-marked minimap bottom left, a thumbstick on the left, one large amber context button bottom right (Call tuk-tuk, Talk to driver, Open door, Get in, Exit, View drinks), dark secondary buttons above it (Inside/Outside view, Skip ride, Cancel ride), a status pill on top (Tuk-tuk arriving, Arrived · Old Market, Getting in…). The storefront sign shows **the cafe's own name** (no hardcoded name, AGENTS.md); the mockups' "NUK CAFE" is a placeholder.

## Purpose and scope

A customer opens **Explore** from the cafe's menu and plays a small third-person world: walk or jog through a street, call a tuk-tuk, ride to another branch, walk into the café as the owner drew it in Design shop, and open that branch's real menu at the counter. It is a way to discover the cafe's branches, not a second ordering system: ordering, the cart and checkout stay the menu's.

GTA V is the reference for **how controls and vehicles feel** (camera-relative movement, a context action, entering a vehicle, a minimap with a route, a full map with a waypoint). Nothing else is taken from it: no names, art, UI copy or missions. Code and UI say "Explore".

**In v1:** one cafe's branches; walking, jogging, sprinting, jumping, stairs, doors, sitting; the tuk-tuk as a passenger; the moto as a driver (last step); minimap, full map, waypoint and route line; the nearby list from the customer's location; districts generated per branch and joined by gateways.

**Not in v1:** discovery across cafes; traffic and pedestrians that react; a phone UI; saving the avatar's position between visits; gamepads; an in-world menu (the counter opens the real menu page, [below](#ordering-and-the-cart)); custom avatars.

## Decisions (2026-11-11)

Decided by Claude at the owner's request. Each is the simplest choice that keeps the boundaries the project already has.

| # | Question | Decision | Why | Revisit when |
|---|---|---|---|---|
| 1 | Discovery scope | **One cafe's branches**, at `/c/<slug>/explore` | Crossing cafes is a platform-level read of every tenant's branches and layouts (D135); the brief's trip is two branches of one cafe | The platform wants a cross-cafe map (its own decision and API) |
| 2 | What makes a branch's 3D visit public | An explicit **Show in Explore** switch on the branch's layout, which needs a chosen **street door** and a **pin** | A saved layout is an owner's working drawing; making it public must be a deliberate act. The door and pin are what Explore cannot guess | — |
| 3 | Physics | **Our own collision on the floor plan**, no physics engine | Rapier and other engines are WebAssembly, and the CSP refuses `'wasm-unsafe-eval'` (D273). Layouts are 2D plans on floors already: walls are segments, furniture footprints are rectangles and circles, stairs are a ramp. A capsule on that is about 200 lines, tested in Node | The moto needs real physics after the phone review (reopens the CSP decision) |
| 4 | Character | **Generated from code with procedural animation** in E1–E5, behind an `AvatarRig` interface; a CC0 rigged `.glb` with clips replaces it later without gameplay changes | No CC0 people source was reachable (step 3g); waiting for art would block feel testing, which is the brief's first priority | The owner supplies a CC0 or commissioned rigged character |
| 5 | Districts | **One district per branch, generated from its saved scene preset** (D274), joined by gateways | The surroundings generator already builds a street on the café's door edge; extending it to a walkable block with anchors reuses it, and works for any café shape. Hand-authored real neighbourhoods are a content pipeline the project doesn't have | The owner wants recognisable landmarks (hand-made districts as content) |
| 6 | Where the customer's location goes | **Nowhere: distances are computed in the browser** | Branch pins are public (they are addresses); the customer's position never needs to reach our server. More private, simpler, and the branch list stays cacheable | Cross-cafe discovery (decision 1) |
| 7 | Map rendering | **Canvas 2D from the districts' plan data**, not a second 3D camera | Crisp at any size, a fraction of a render pass, and the same data gives the route line | — |
| 8 | Opening the menu | **The counter opens the real menu page** with that branch chosen; **Back to café** returns to the counter | The menu, cart and checkout are already correct and server-rendered; a second copy inside Explore would duplicate checkout rules. AGENTS.md forbids exporting pages | The phone review finds the reload too slow (then an overlay, as its own decision) |
| 9 | Pausing | Opening the **full map, destination picker or leaving for the menu pauses the world** (a ride stops advancing); the minimap and HUD don't | One rule for every overlay; nobody misses their stop while reading the map | — |
| 10 | Timing | **E1 starts now behind `NUXT_PUBLIC_EXPLORE`** (on in dev and staging, off in production), in parallel with the pilot; it touches no production behaviour | Like step 3h, an internal scene can be measured before it ships. Shipping waits for the Riverside pilot (3c) and the phone review (E6) | — |

Still the owner's, not decided here: running the benchmarks on their Android phone and desktop (only they have the devices), the final character and tuk-tuk art, the backups (highest operational risk, [current state](../current-state.md)).

## Controls (starting bindings; the owner tunes them after E1)

Inputs map to **actions**; the runtime never reads a key or a touch directly. Held actions (move, look, sprint, throttle, brake) are values sampled each step; one-shot actions (jump, interact, map, camera) are queued once per press. Every held action clears on `blur`, `pagehide`, `pointercancel`, `visibilitychange` and whenever an overlay takes focus, so nothing keeps walking after a dialog.

### On foot

| Action | Desktop | Touch |
|---|---|---|
| Move (camera-relative) | WASD or arrows | Floating left thumbstick: appears where the thumb lands in the left half |
| Look | Mouse, with pointer lock after a click on the world (Esc releases it) | Drag anywhere in the right half |
| Sprint | Hold Shift | Push the stick to its rim and hold 0.3 s |
| Jump | Space | **Jump** button, separate from the action button |
| Interact | E (F also works, for vehicle muscle memory) | The amber context button, labelled with the action |
| Map | M | Tap the minimap |
| Camera | V: near / far follow | — |
| Back | Esc: close the overlay, else release the pointer, else leave Explore | System Back, same order (D201) |

**Movement feel** (constants in one tuning file, metres and seconds):

- Speeds: walk 1.6 (a small stick tilt), jog 3.6 (default for keys and a full tilt), sprint 6.0. **Indoors the cap is 2.4 and sprint is off**: a café is not a running track, and it keeps collisions with furniture gentle.
- Acceleration to the target speed in about 0.15 s, stopping in 0.1 s; the body turns toward the move direction at 720°/s, so the character arcs instead of snapping.
- Diagonal input is clamped to length 1 (no faster diagonals).
- Jump only when grounded: 4.5 m/s up under 20 m/s² gravity (about 0.5 m, 0.45 s in the air). **Coyote time** 0.1 s after leaving an edge and a **jump buffer** 0.12 s before landing, so a jump pressed slightly early or late still happens.
- Capsule radius 0.3, height 1.7; steps up to 0.25 m (curbs are 0.15), slopes up to 40°.

### Camera

- Third-person orbit around a pivot at 1.5 m, 3.2 m away and 0.3 m to the right (the mockups' framing), pitch −60° to +35°.
- **Auto-recentres behind the character** after 1.5 s without look input while moving, as in the reference; never while the player is looking.
- **Obstacle correction:** the camera moves in front of any wall, building or roof between it and the pivot (the same 2D shapes as collision, with heights), and eases back out. Indoors the distance shortens to 2.2 m.
- **Reduced motion** (`prefers-reduced-motion` or the Explore setting): no auto-recentre swing, cuts instead of blends, no head bob.

### Context action

One target at a time: the closest eligible object the character faces. Candidates are doors (reach 1.5 m), seats (1.2), the tuk-tuk door (1.6), the driver (2.5), the counter (2.0), the moto (1.6) and gateways (4.0), within 70° of facing and with a clear line on the plan. The current target stays until another scores 20% better or leaves reach, so the button doesn't flicker. On press, the runtime checks again (reach, availability, vehicle stopped, the player's mode); a second press while an action runs is ignored by the state machine, not by a timer.

Labels name the action and target: **Open door**, **Close door**, **Sit**, **Stand up**, **Talk to driver**, **Get in**, **Exit**, **Ride moto**, **Get off**, **View drinks**, **Enter Old Market**.

### Passenger (tuk-tuk)

Drag or mouse to look from the seat (yaw ±110°, pitch ±30°). **Outside view** / **Inside view** (V) switch cameras; both keep the ride's progress. **Skip ride** goes to the same arrival as waiting. **Exit** appears only once the vehicle has stopped.

### Moto (E5)

| Action | Desktop | Touch |
|---|---|---|
| Steer | A / D | Left thumbstick, sideways |
| Throttle / brake | W / S (S reverses slowly from a stop) | **Gas** and **Brake** buttons on the right |
| Look around | Mouse | Drag above the buttons |
| Get off | E, only below 0.5 m/s | The context button, only when stopped |
| Recover | R | **Reset moto** in the pause sheet: back to the last safe curb |

## Map

### Minimap

- A 128 px circle bottom left (the mockups), **rotating with the camera's heading** with the **N** marker on its rim, as in the reference; the player's arrow stays in the centre.
- Shows streets, building footprints, café markers (cup), gateways (arch), the tuk-tuk pickup, the waypoint pin and the **route line**. An off-map waypoint clamps to the rim, pointing the way.
- Drawn from the district's plan after the world's frames, at most 30 times a second (a few dozen polygons: cheaper than caching a layer). Tapping it opens the full map.

### Full map (M or tap the minimap)

- **North-up**, pinch and wheel zoom, drag to pan; pauses the world (decision 9).
- Two levels: the **district** (streets, cafés, gateways, the player) and, zoomed out, the **overview**: each branch's district as a tile placed by its real bearing and connected by its gateways.
- A **branch list** beside the map (a bottom sheet on phones): name, open now or opening hours, **real distance** ("1.8 km from you", only with location) and **virtual time** ("≈ 20 s ride"), with **Set waypoint**, **Ride here** (calls the tuk-tuk with this destination) and **View menu**. Real and virtual are always labelled separately.

### Waypoint and route

- One waypoint at a time, set on a café or a gateway (not an arbitrary point in v1). It **identifies the destination branch**, so it survives crossing districts.
- The route is the shortest path on the district's **walk graph** (sidewalks, crossings, the door approach) to the café's door, or to the gateway toward the destination's district. Recomputed when the player leaves the line by more than 4 m or crosses a gateway.
- In the world: a soft light column above the target door. Cleared when the player walks through that café's door, or by tapping the pin again.

## How it's built

### Runtime and Vue

```text
app/pages/c/[slug]/explore.vue        thin route, client-only, behind the flag
app/features/explore/
  runtime/                            plain TypeScript, no Vue, nothing per-frame in refs
    actions.ts        the action list and the input state (held vs one-shot, clearing rules)
    input-keyboard.ts, input-touch.ts adapters that write actions
    motor.ts          capsule on the plan: move, gravity, jump, steps, ramps, sliding
    colliders.ts      2D shapes with heights from the layout and the district
    interaction.ts    target selection with hysteresis
    avatar.ts         AvatarRig interface; the generated, procedurally animated figure
    ride.ts           the ride state machine, a pure function
    route.ts          the brief's taxi route and follower, typed
    camera.ts         follow, cabin and chase cameras, obstacle correction, blends
    map.ts            walk graph, shortest path, minimap drawing
    district.ts       builds a district from a branch's layout and preset; anchors
    world.ts          the loop, fixed step, district switching, pause, dispose
  components/         ExploreHud, ContextButton, Thumbstick, Minimap, FullMap, BranchList
  composables/        useExploreBranches (the public list), useExploreSession (Vue ↔ runtime)
```

- **Vue sends commands** (interact, set waypoint, confirm destination, pause) and **receives discrete events** (the prompt changed, the ride's state, the status pill, the current district). Positions, camera transforms and animation stay in the runtime.
- The runtime loads with a **dynamic import** on the client only; the customer menu's bundle and edge cache are untouched.
- **Shared code:** Explore is the second user of the building renderer, so `app/features/branches/index.ts` exports a narrow builder (`buildScene` and the surroundings generator, plus `cm` units), as AGENTS.md says. The editor's stage, orbit controls and studio stay in the designer. Common rendering setup is extracted only where the two callers really share it.

### The loop

- A fixed simulation step of 1/60 s with an accumulator (at most 5 steps per frame); `dt` is clamped; the accumulator resets on `visibilitychange`, so a backgrounded tab doesn't jump.
- Rendering runs every frame **only while the tab is visible and the world isn't paused**; a paused world draws once and stops.
- Quality comes from the viewer's measured levels (D273); the low level adds blob shadows for the avatar and vehicles instead of the sun's shadow.
- Only the current district is in memory. The next one loads when the player is within 30 m of its gateway or a ride's route reaches it, and the previous one is disposed after the switch.

### Collision

- From the layout: wall and railing edges are segments (doors are gaps, closed doors are segments until opened, windows are wall); inner walls are segments; furniture footprints are oriented rectangles or circles (overhead pieces, people and pets don't block); **stairs** are a ramp from their floor to the next across their depth; each floor is a height with its outline as the boundary.
- From the district: building footprints, the river railing and the water's edge are walls; curbs are 0.15 m steps; roads are walkable.
- The motor resolves the capsule against segments and shapes with sliding, in a few iterations, then applies the ground height. All of it is pure and tested in Node.

### The avatar

- `AvatarRig`: `setLocomotion(speed, grounded)`, `play(action)` for one-shot clips (`sit`, `stand`, `board`, `exit`, `jump`), a `finished` event, `update(dt)`, `dispose()`.
- The generated figure: the step 3g style with pivoted limbs; the gait phase follows **distance travelled**, so feet don't slide at any speed; one-shot actions are short pose tweens.
- **Bounded recovery:** every one-shot action has a timeout (its length + 0.5 s). If `finished` doesn't come, the runtime snaps to the action's end pose at the authored anchor and restores control. Nobody stays stuck in a seat or a door.

### The ride state machine

`idle → requested → approaching → waiting → boarding → travelling → stopped → exiting → complete`, plus `cancelled` and `held` (stopped before a gateway that failed to load).

| Event | Allowed in | Result |
|---|---|---|
| Call tuk-tuk / Ride here | `idle` | `requested` → the vehicle spawns out of view and drives to the nearest pickup (`approaching`). Repeated calls keep the same request |
| Cancel ride | `requested`, `approaching`, `waiting` | `cancelled` → walking; the vehicle drives off |
| Confirm destination | `waiting` | The destination is held; Get in is offered. An unavailable branch returns to the picker with the reason |
| Get in | `waiting` with a destination, at the door | `boarding`: the door opens on its hinge, the avatar aligns, steps in, sits; the door closes; passenger camera |
| Boarding finished | `boarding` | `travelling` |
| Skip ride / route end | `travelling` | **One arrival handler**: commit the final district, place the vehicle at the drop-off pose, speed 0 → `stopped`, highlight Exit and the café door |
| Gateway fails to load | `travelling` | `held` at the curb before the gateway: **Retry** (the same route) or **End ride** (exit here) |
| Exit | `stopped` or `held` | `exiting`: door opens, avatar steps onto the sidewalk, door closes, follow camera, walking → `complete`, waypoint to the café's door |

Any other event in any state is ignored. The vehicle never moves during `boarding` or `exiting`.

## Data and API (step E3)

- **Branch pin:** `branches.latitude`, `branches.longitude` (REAL, nullable; `CHECK` both set or both null, −90…90 and −180…180). Edited in the branch settings at the branch's version, `branch: ['update']`, as two fields that also accept a pasted "11.5564, 104.9282" (what Google Maps copies). No map tiles: they would need a third-party script and CSP changes.
- **Street door and Show in Explore:** two optional fields in the layout's scene JSON (`branch_layouts.scene`, D274), saved with the layout at its version: `entrance` (a door's opening id on the ground floor, the first floor in the list) and `explore` (boolean, default false). The shared schema checks `explore` needs `entrance`, and that the door exists and is a door. The surroundings use `entrance` as the café's front when set, in View in 3D too (today: the first door, else the longest wall). No migration: the column exists.
- **Public reads** (`/api/c/<slug>/public/…`, no session, the tenant from the slug):
  - `GET …/branches` adds `latitude`, `longitude` and `hasExplore`.
  - `GET …/explore/branches/{branchId}`: the branch's public layout projection and scene, only while it is active and `explore` is on (else 404). The projection keeps geometry, items, looks' finishes and sizes and table footprints; it drops the version, `updatedByName`, table ids and labels, and photo asset ids. Cached like the public menu.
- **Tests:** the two-cafe isolation test for the new read, archived and switched-off branches answer 404, the projection never contains the dropped fields, and the schema's `explore` and `entrance` checks.

## Ordering and the cart

- **View drinks** at the counter and **View Menu** on the HUD both go to the cafe's menu with that branch chosen, through the menu feature's public `index.ts` (it adds a `chooseBranch` export if it has none). The cart is already kept per branch (`useCart(branchId)`), so a ride to another branch never moves items.
- The HUD shows the current branch's cart when it has items ("Old Market · 2 items").
- The menu shows **Back to café** when it was opened from Explore; it returns to that café's counter (`/c/<slug>/explore?at=<branchId>&spot=counter`).
- Checkout, table and availability rules are the menu's, unchanged.

## Location and the nearby list

- **Explore nearby** asks for the position on the tap (a user gesture), with a 10 s timeout and a 5-minute cache.
- With a position: branches sorted by real distance, grouped **Within 5 km** and **Farther**. One cafe has few branches, so nothing is hidden.
- Denied or unavailable: branches by name, without distances; Explore and the menu work the same.
- The player starts at the chosen branch's district (the nearest, or the branch already chosen in the menu) at its safe spawn across the street from the café. Moving in the world never changes the customer's real location.

## Districts and gateways (step E4)

- Each Explore branch's district is its café plus its preset's surroundings, extended to a walkable block: sidewalks on both sides, one crossing, a tuk-tuk pickup and drop-off, the café's door approach, a spawn point, and the walk and lane graphs.
- Gateways join districts along a **minimum spanning tree** of the branches' real positions, at most three per district (the street's two ends and a side street). The arch shows the next district's name (its branch name; Khmer when the cafe has it) and faded storefronts through it.
- **Enter** loads the destination first, plays the crossing, places the player (or the vehicle) at the arrival anchor and keeps the activity and waypoint. If loading fails, the player stays at the gateway with **Retry** and **Go back**.
- The tuk-tuk's route is one leg per district, generated from the lane graph, split at gateways; the ride controller handles the switch.

## Steps

**Grouping (owner, 2026-11-11):** consecutive small or medium steps go in one PR, one commit each; a large step gets its own PR (AGENTS.md). E1, E2 and E4 are large (their own PRs). E3 and E5 are medium: each shares a PR with whichever small or medium step is next to it when it starts (for example, follow-up fixes from a review).

| Step | Deliverable | Review gate |
|---|---|---|
| **E1. Walk and map** | Behind the flag, on the demo layout, no server change. The runtime skeleton, keyboard and touch input, the motor and colliders, the follow camera, the generated avatar, one district from the Neighborhood lane, the café door and interior with stairs and sitting, the minimap, the full map (one district), waypoint and route line, Back and pause rules. Benchmark `?bench=walk` (a scripted walk outside and in) | The owner's Android phone: 95th-percentile frame interval ≤ 33.3 ms; desktop ≈ 16.7 ms. The owner plays it on both and approves the feel |
| **E2. Tuk-tuk** | The ride state machine, the generated tuk-tuk with a hinged door and anchors, the driver, the destination picker (demo branches), cabin and chase cameras, route and follower, skip, arrival, exit, recovery | The brief's acceptance test inside one district, including Get in twice, Exit while moving, Cancel before pickup, and Skip ending at the same curb |
| **E3. Data** | The pin, the street door and Show in Explore (Design shop and branch settings), the public reads, isolation tests | Two cafes; switching Explore off answers 404 |
| **E4. Real branches** | Districts from real branches, gateways, the overview map, the nearby list with location, the menu handoff and Back to café | The brief's first-playable items 1–5 |
| **E5. Moto** | Mount, steer, throttle, brake, slow reverse, safe dismount, Reset moto | Mount and dismount loop on the phone |
| **E6. Phone review and ship** | The full trip recorded on the owner's Android phone and desktop; fixes; the help page; the flag removed in production with the owner's approval | Shipped only after the Riverside pilot (3c) |

## Edge cases and tests

| Case | Behaviour | Test |
|---|---|---|
| A key held while the map opens | The character stays still after closing until the next press | Unit (actions) + e2e |
| `pointercancel`, blur, page hidden mid-move | All held actions clear | Unit (actions) |
| Diagonal input | Same speed as straight | Unit (motor) |
| Jump pressed 0.1 s before landing / after leaving an edge | Jumps | Unit (motor) |
| Walking into a table, a wall corner, a closed door | Slides, never passes | Unit (motor, colliders) |
| Stairs up and down | Follows the ramp, no falling through | Unit (motor) |
| Two targets at the same distance | No flicker between them | Unit (interaction) |
| Get in twice, Exit while moving, Cancel after boarding | Ignored | Unit (ride), each removed guard fails a test |
| Skip vs waiting | Same district, pose and anchors | Unit (ride + route) |
| One-shot animation never finishes | Snaps to the end pose and restores control | Unit (avatar timeout) |
| Gateway load fails | Held before the gateway, Retry keeps the route | Unit (ride) + e2e (mocked failure) |
| Tab hidden for a minute | No simulation jump on return | Unit (loop accumulator) |
| Location denied, no Explore branches, 3D unavailable | The menu stays one tap away; the list explains | e2e |
| Leaving Explore ten times | Renderer, listeners and districts disposed; resource counts return | e2e (`renderer.info`, listener count) |
| Another cafe's branch id | 404 | Server (isolation) |
| Projection fields | No version, author, table ids or photo ids | Server |

CI's software renderer proves flows and errors, never speed; the owner's devices decide the frame-time gates.

## Step E1: walk and map (built 2026-11-11)

Internal: `/c/<slug>/explore`, client-only (`ssr: false`), 404 unless `NUXT_PUBLIC_EXPLORE` (on for the dev server, staging and the e2e server). It plays Explore's own demo café (`app/features/explore/demo/demo-cafe.ts`: two floors, a front door, the counter facing it, six tables, a sofa corner, stairs), not a real branch: real branches join in E4. **View menu** and the counter's **View drinks** open the cafe's real menu.

- **Shared code (branches feature):** `index.ts` exports the pure plan helpers Explore needs (`chairPoses`, `planLane`, `ITEM_SPECS`…) and `loadSceneKit()`, a dynamic import of the three.js builders, so three.js never joins the bundles that import the index (the admin shell does). `createStage({ orbit: false })` keeps the orbit controls off the camera (their `update()` turns the camera even when disabled). A door's leaf and handle carry `userData.doorId`, so Explore hinges them. `SLAB_THICKNESS_CM` moved to the pure `geometry.ts` (re-exported where it was).
- **Runtime** (`app/features/explore/runtime/`, plain TypeScript): `actions` (held vs one-shot, cleared on blur, page hide, pointer cancel, overlays), `walk-world` and `motor` (capsule on the plan: walls, turned boxes, circles, floors, stair ramps solid underneath, ledges between a step and head height; constant acceleration, a 720°/s turn, jump with coyote time and buffer), `district` (the layout plus `planLane` → walls, seats from table chairs and seat pieces, the counter's customer spot, the spawn across the lane facing the door, map shapes), `interaction`, `player` (sit and stand with a deadline), `route` (a 0.5 m walk grid, A*, smoothing), `camera` (follow, recentre after 1.5 s, walls tested at the height the ray crosses them so the camera follows through an open doorway), `fixed-step`, `avatar` (generated, gait from distance travelled, hidden when the camera is pulled within 0.75 m of its head), `map-draw`, `desktop-input`, `bench`, `world`.
- **Screen:** `ExplorePage` (HUD: View menu, place and waypoint badges, map button, minimap, the context button with its key, Jump on touch, the keyboard hint on desktop, loading and "can't run here" states), `ExploreTouchControls`, `ExploreMinimap`, `ExploreFullMap` (`AppModal`, so Back closes it). The full map pauses the world.
- **Decided while building:**
  - A **ledge** (a floor more than a step up and below the head) blocks; the first motor ignored a higher surface over the same point and walked into it.
  - **Acceleration is constant** (jog to stop in exactly 0.1 s); an exponential ease never quite stopped.
  - The **beacon fades within 1.5–6.5 m** of the door: up close it tinted the whole view.
  - The **player's arrow is the primary color**; a black arrow read as the mouse pointer on the full map.
  - The minimap and the HUD use Nuxt UI's tokens (`soft` neutral buttons and badges, safe-area padding); no blur, no hex.
- **Not in E1:** the open door's leaf is not an obstacle; table chairs are seats but sitting at a booth is not; no railings around the stairwell; the upper floors aren't on the route grid (waypoints are on the ground floor); the moto, the tuk-tuk and gateways (E2, E4, E5).
- **Evidence:** see [progress](../progress.md#explore-e1-walk-and-map-d275-2026-11-11).
