# NUK Cafe Explore

Product direction and gameplay plan  
November 11, 2026

## Product direction

Build a GTA-style café discovery experience in the browser. The customer controls a character, explores a Cambodian neighborhood on foot or by moto, or asks a virtual tuk-tuk driver to take them to a real café. Each café entrance opens that branch’s published Shop Designer layout. At the counter, the customer can open the branch’s real menu and order through the existing checkout.

Explore is optional. Keep View Menu and a route back to the regular ordering experience available throughout.

## Decisions from our discussion

| Area | Direction |
| --- | --- |
| Nearby discovery | Request location permission when the customer chooses Explore Nearby. Use their real position to find branches within 5 km by default. Allow explicit expansion when there are no results or when the use case calls for a wider search. Keep the regular menu available when location is denied or unavailable. |
| Real map and game world | Branch latitude and longitude determine real-world location, distance and neighborhood assignment. The playable streets can compress distances. Show real distance and estimated virtual travel time as separate values. Moving the avatar or entering a portal does not update the customer’s physical location. |
| Owner publishing | Owners supply a branch pin and published Shop Designer layout, then mark the street-facing door. Proposed owner preview shows the pin and lets them test the route from curb to counter. A branch with a public menu can appear in discovery while its 3D visit is unavailable. |
| Districts | Load a compact neighborhood at a time. At the edge, preview the next district with faded storefront silhouettes, a readable district name and a clear Enter action. The gateway leads to a safe arrival point and supports travel back. |
| Ordering | The barista opens the real branch menu. A change of destination never silently moves items to another branch. Keep the active cart’s branch visible and follow the existing checkout, table and availability rules. Sitting in the scene is a character interaction. |

## GTA-style flows to design

| Flow | Proposed behavior |
| --- | --- |
| Start a session | Request location, show nearby branches, then spawn at a recognizable safe spot such as the Riverside riverwalk. Give a short movement hint and a visible map button. |
| Move on foot | Third-person follow camera. Walk, jog, turn, jump, climb stairs, and sit or stand at marked spots. Walls and furniture block movement. A contextual prompt appears at doors, seats, vehicles and NPCs. Start with keyboard controls on desktop and a thumb joystick and action button on mobile. |
| Open the map | Show the avatar, nearby streets, café markers and district gateways on a minimap. A full map and list let the customer pick a branch, set a waypoint and see its hours and featured drink. Label real distances separately from virtual routes. |
| Ride a moto | Approach a parked demo moto and choose Ride. Switch the camera and controls to steering, acceleration and braking. Show Dismount at a safe curb and return the customer to walking controls. Offer a recovery action if the moto gets stuck. |
| Take a tuk-tuk | Approach a pickup point. The driver asks where to go and opens the destination picker. Suggest a closest open café or a branch with a featured iced drink. Confirm the destination, board, watch or skip the ride, and arrive at the correct curb. |
| Cross a district | Approach the gateway, see a preview, then choose to enter. Preserve the selected waypoint. A tuk-tuk ride can cross as part of its route. If loading fails, keep the customer at the gateway with Retry and Go back. |
| Visit a café | Approach its front door, enter the published layout, explore floors, sit, or walk to the barista. Open the real menu at the counter or use the persistent View Menu action. Exiting puts the character back outside that branch. |
| Recover or resume | Pause movement while a menu or map is open. Provide Back to entrance or Return to street from a stuck position. Keep the normal menu available if 3D fails to load. |

## Interaction quality and controls

Prioritize the feel and completeness of the interactions. Prototype with simple models and representative animation clips. Evaluate each action from the player’s input through the visible result and the moment control returns. Use the existing mockups for visual direction.

| State | Player controls and feedback |
| --- | --- |
| On foot | Move, look, sprint, jump, interact and open the map. On touch, use a left thumbstick, drag on the right to look, and keep Jump and the contextual action separate. On desktop, use WASD, mouse look, Shift, Space and E as starting bindings. Let the follow camera move closer near walls and through doors. |
| Near an object | Show one context action for the closest eligible object the avatar is facing. The label names the action and target, such as Open door, Ride moto or Talk to driver. Block movement through closed doors and through furniture. Interacting twice quickly triggers the action once. |
| During an animation | Temporarily hold locomotion during boarding, exiting, sitting and standing. Make the transition clear through the avatar’s movement. Restore controls when the animation completes. If a transition fails, restore the last safe position and controls. |
| Menus and overlays | Pause movement while the map, destination picker or café menu has focus. Clear held movement on opening and closing so the avatar stays still until the next input. Back closes the current overlay before leaving Explore. |

## Virtual tuk-tuk and taxi interaction

Prototype one virtual vehicle with an opening passenger door. An open-sided tuk-tuk can share the same ride flow with a step-up animation. The player rides as a passenger. Driving a moto is a separate control mode.

| Step | Player action | What happens in the world |
| --- | --- | --- |
| 1. Call a ride | Open the phone or map action and choose Call tuk-tuk. An existing curbside driver can also be approached directly. | Show a nearby pickup point, a short ETA or approaching status, and Cancel. The same request stays active on repeated taps. The player can continue walking toward pickup. |
| 2. Meet the driver | Reach the pickup and choose Talk to driver. | The vehicle drives up and stops beside the curb. The driver asks where to go. The player can open nearby café suggestions, see real distance and virtual travel time, and select a branch. |
| 3. Confirm a destination | Choose a café and confirm the virtual ride. | Close the picker and highlight the safe passenger side of the stopped vehicle. Allow cancellation before boarding. If the destination becomes unavailable, return to the picker with an explanation. |
| 4. Open the door and board | Approach the passenger side, select Open door, then Get in. | The door visibly opens on its hinge. Align the character at the door, play a step-in and sit animation, and move them into the seat. Close the door after boarding. Switch to passenger controls when seated. The vehicle remains stopped throughout boarding. |
| 5. Ride and look around | Look through the windows or switch between Inside and Outside cameras. | The interior view starts from the passenger seat, with the driver, window frame and street visible. Drag or use the mouse to look left and right. The exterior camera follows the same moving vehicle. Camera changes preserve ride progress and destination. Show the route and allow Skip ride. |
| 6. Arrive | Wait for the driver to stop, or use Skip ride. | Both paths end at the same branch’s safe drop-off. The vehicle is stopped before Exit becomes available. Show the café name and highlight the curbside door. |
| 7. Get out | Select Exit once stopped. | The door opens, the character stands and steps onto a clear sidewalk, and the door closes. Blend back to the third-person camera, restore walking controls and show the waypoint to the café entrance. |

For the first ride, use a fixed authored route with one portal crossing. If loading the next district fails, stop before the gateway and show Retry or End ride at a safe curb. If a drop-off point is blocked, use its designated fallback. On resume after a browser interruption, recover to a safe curb if the ride cannot resume. Never leave the player stuck in a seat or a door animation.

## Moto, portals and café doors

- **Moto.** Approach a parked moto, mount it, then switch to steering, acceleration and braking. Keep the camera behind the vehicle, allow a look-around gesture, and offer Dismount once stopped. Step down on the safe side and return to walking controls.
- **District gateway.** Show the next area through the arch. When the player confirms, pre-load the destination, play the crossing effect and preserve their waypoint. A moto or tuk-tuk keeps its travel mode across the gateway. Restore the current district and controls if loading fails.
- **Café door.** Approach from the sidewalk and press Open door. Open the actual 3D door and let the player walk through the threshold. Close it only after the doorway is clear. Inside, allow stairs, sitting and standing. Near the counter, View drinks opens that branch’s existing menu. Exiting returns the character to the same storefront.
- **Asset requirements.** Use one rigged avatar with walking, jogging, jumping, sitting, standing, boarding and exiting clips. The vehicle needs a moving door, a passenger seat position, an interior camera position and safe entry and exit positions. A shop entrance needs a door hinge, a clear threshold and spawn points on both sides. These can all be validated with placeholder assets.

### First behavior acceptance test

On a phone, call the ride, walk to the curb, select Old Market, open the passenger door and get in. Look through both sides of the cabin, switch to the outside camera, cross the gateway, get out and walk to the café. Repeat with Skip ride and verify the same drop-off. Try getting out while moving and tapping Get in twice. Confirm that the controls return correctly and that the customer can open the right branch menu.

## Features to consider after the first playable trip

- Use pedestrians, passing motos, ambient sound and small café interactions to make streets feel alive. Try one memorable interaction per branch, such as a shop cat that leads to a balcony.
- Try a simple day and evening change or one optional discovery activity after movement and navigation feel good. Decide later whether a session should remember the avatar’s district or last safe position.
- Define any additional GTA-inspired systems individually. This note uses GTA as the reference for third-person movement, vehicle interaction, city navigation and the way those controls connect across a trip.

## First playable milestone

Use two connected blocks with one café in each, one playable character, one moto and one virtual tuk-tuk. Start with a hand-authored route and simple storefronts. Demo the full trip on a representative Android phone.

1. Grant location access and see the two test cafés in the nearby list.
2. Set a waypoint, walk through one storefront and open the correct menu.
3. Travel by tuk-tuk through the district gateway and arrive at the other branch’s curb. Test the moto mounting and dismounting loop on the same streets.
4. Enter the second shop, open its menu, and verify that an existing cart is still associated with its original branch.
5. Test permission denial, an empty nearby list and a failed district load. Verify that the regular menu is still accessible.

[Shop Designer 3D handoff](https://chatgpt.com/library?file_id=libfile_d6ce590f3cf081918d219681fbad82f8&account_id=personal)

## Claude Code implementation handoff

### GTA V reference and NUK decisions

This is a desk review of GTA V Story Mode documentation and secondary reporting. The first build covers the movement, navigation, passenger, driving, and café loops relevant to Explore.

| Reference behavior | NUK Explore implementation |
| --- | --- |
| Move and look independently, jog or sprint, jump, use phone, interact, enter or exit vehicle | Start with those separate actions on desktop and touch. Camera-relative movement, grounded jump, and reliable interaction prompts take priority. Stairs are part of the café walk. Vaulting is a later decision. |
| Minimap, heading, prompts, pause, camera cycling | Show a district minimap and full waypoint map. Change prompts and camera options with the current activity. Hide controls that cannot act. |
| Call a cab or hail it in the street, wait for arrival, enter as passenger, pick a destination, ride or skip | Keep both call and curbside approaches. The agreed NUK flow confirms the café before boarding. Use a dedicated passenger door and show ride status from request to drop-off. |
| Interior and exterior camera modes | Show a seated eye-level passenger camera with bounded look and an outside chase camera. Switching views preserves ride progress. |
| Driving, steering, accelerating, braking, reversing from a stop and getting out | Give the moto its own driving controls. Start with steering, throttle and brake and a stopped dismount. Decide whether slow reverse helps maneuvering after phone testing. |

References: [GTA V game help](https://dlassets-ssl.xboxlive.com/public/content/4f0a3089-ba2c-4f3d-9e38-102a41cbd885/GameManual/9dfeb637-1cb0-46c8-b7d7-0c58cf990494/en-GB/index.html), [Rockstar camera support](https://support.rockstargames.com/en-US/articles/4SLMPiZCrVUVcuL71dBD29/changing-camera-perspective-to-1st-person-in-gtav), [Story Mode taxi details](https://thegta.wiki/wiki/taxi-rides/).

### What to reuse in NUK Cafe

GitHub default-branch source was inspected for these files. Check the latest main and Claude’s current branch before changing shared code. Three.js was pinned to 0.187.0 at review time.

| Repository location | Reuse and boundary |
| --- | --- |
| `app/features/branches/designer/scene/scene.ts` | `buildScene` turns layout, tables and looks into floor and furniture geometry. Keep one building renderer for the editor and Explore. Derive an Explore collision representation and explicit interactive anchors from the layout. |
| `app/features/branches/designer/scene/units.ts` and `app/features/branches/designer/surroundings.ts` | Reuse centimetre-to-metre and heading conversions. The existing front frame is useful for aligning a storefront. Its longest-wall fallback is fine for an editor preview. Use a validated walkable entrance for public Explore. |
| `app/features/branches/designer/scene/models.ts` | Reuse model template loading, skeleton cloning, normalizing the rig and ownership of shared model resources. The current figure interface starts an idle clip. The player needs an explicit clip list and one mixer per active rig. |
| `app/features/branches/designer/scene/stage.ts` | Reuse renderer settings, quality limits, measurements and cleanup where practical. The current stage owns OrbitControls and editor animations. Give Explore its own input, follow camera and simulation lifecycle. Extract common rendering code after there are two actual callers. |
| `app/features/branches/designer/scene/building-viewer.ts` and `scene/surroundings.ts` | Keep the orbit and cutaway viewer as an editor. Current surroundings use CatmullRomCurve3 to draw decorative wires. Use a new driving route with road-aware control points. |

Place the client gameplay code under the Explore feature. Keep the Vue overlay concerned with prompts and controls. Keep per-frame positions, camera transforms and animation mixers in the Three.js runtime. Publish discrete changes such as ride state, selected destination and current prompt to Vue. Instantiate the runtime on the client only. Follow AGENTS.md before sharing code across features. Use existing tenant routes for public menu and checkout links. Confirm the public published-layout contract before exposing owner data or adding a cross-café API.

### Implementation contracts

| Reusable part | Responsibility and acceptance criteria |
| --- | --- |
| Input adapter | Map touch and keyboard inputs to the same actions. Keep held inputs such as movement distinct from one-shot actions such as jump and interact. Clear inputs on pointer cancel, blur, page hide and when an overlay takes focus. Clamp diagonal movement to normal speed. |
| Interaction selection | Choose one eligible target by distance, facing and visibility. Support doors, seats, vehicles, driver, counter and gateway. Keep a small selection margin to avoid flicker. Validate reach, target availability, vehicle speed and the current player mode again on activation. |
| Character motor | Capsule against simple wall, floor and furniture shapes. Resolve move, gravity, grounded jump, slopes and collision sliding. Rapier's JavaScript character controller is a candidate if the collision spike needs it. Test stair ascent and descent with a simple ramp collider before choosing how to represent individual steps. |
| Animation transitions | Map semantic actions to named clips in the rig. Crossfade idle, walk and run. Play board, exit, sit and stand once. Advance gameplay on the expected animation's completion event, with bounded recovery if an asset or callback fails. Track and remove stale listeners. The motor owns locomotion, and authored anchors align boarding and seating. |
| Player and ride state | Keep player mode, active ride, overlay and camera state explicit. Ride progression is requested → approaching → waiting → boarding → travelling → stopped → exiting → complete. Cancel before boarding returns to walking. Retry at a failed gateway preserves the route. Reject duplicate call, boarding or exit actions in invalid states. |
| Door and seat anchors | Give the taxi a door pivot, boarding point, seat pose, passenger eye point and curbside exit point. Give the café door a hinge, threshold and approach point on both sides. Synchronize door movement, avatar animation and collision clearance. Avoid moving the vehicle while boarding or exiting. |
| Camera controller | Third-person follow with obstacle correction, cabin camera attached to the passenger eye pose, and chase view behind the vehicle. Blend on boarding and exiting. Use cabin look limits, preserve progress across switches, and offer reduced camera motion. |
| Route, waypoint and gateway | Keep branch GPS separate from district-local metres. The waypoint identifies the destination across districts. Segment the route at authored portal gates. Load the destination before switching worlds, restore the player or vehicle to the arrival anchor, and resume the same activity. |
| Recovery and lifecycle | Keep a last safe anchor in the active district. If a seat animation fails or the curb is obstructed, recover to a valid sidewalk and restore walking. Dispose scene resources and input listeners on exit. If backgrounded, reset the time accumulator on resume to avoid a simulation jump. |

### Route curve and validation

A district owns its lane points in metres, its allowed road area, its pickup and drop-off anchors, and portal connections. A route to another district is a sequence of local route legs. Build one curve per leg and keep portal transitions in the ride controller.

- Start with a centripetal Catmull–Rom spline along an authored lane centreline. A smooth curve can still swing outside the road. In a debug view, sample the path and validate the vehicle footprint around each corner and at the curb. Tight turns may need extra control points or separate straight and explicitly rounded segments.
- Advance in metres and sample the arc-length position and tangent with `getPointAt` and `getTangentAt`. Use a fixed or bounded simulation step. Convert the tangent to yaw for the vehicle root and normalize the model's forward axis at import. On sharp curves, set a lower authored speed before entry. The reference helper below supplies cruise acceleration and final braking for one short leg.
- A curve endpoint is a tested stopped vehicle pose with a nearby safe exit, and its final tangent should align with the curb. Normal completion and Skip ride must go through one arrival handler. That handler commits the final district, stops the vehicle, and enables Exit after the destination is ready. Skipping should still allow the player to open the door and get out.
- Animate the NPC driver and the wheels off the actual vehicle pose and speed. Add traffic and obstruction handling after the authored route passes. The player-controlled moto uses steering and collision logic, while the taxi follows the route.

Verified with five Node tests against the Three.js r187 CatmullRomCurve3, Curve and Vector3 source modules. They cover endpoint and heading, approximate even spacing, acceleration and braking at 30 and 60 updates per second, shared skip endpoint and malformed inputs. Browser controls, scene alignment, door animation and real-device performance still need implementation and testing.

[Three.js Curve](https://threejs.org/docs/pages/Curve.html) · [CatmullRomCurve3](https://threejs.org/docs/pages/CatmullRomCurve3.html) · [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html) · [Object3D](https://threejs.org/docs/pages/Object3D.html) · [Rapier character controller](https://rapier.rs/docs/user_guides/javascript/character_controller/)

### Build order and review gates

1. **Street test scene.** Start with placeholders, one short street, one working door and a rigged avatar. Verify third-person movement, camera obstruction, focus and touch cancellation. Test one doorway and one flight of stairs.
2. **Vehicle on the same block.** Build call, pickup, destination, board, cabin and chase cameras, drive, skip, stop and exit. Test holding input across overlays, double-tapping actions, cancelling before pickup, trying to exit while moving and arriving at the same curb via both paths.
3. **District and branch integration.** Add one portal and two branches. Validate ride continuity, failed portal recovery, the correct arrival door and menu, and the existing cross-branch cart behavior. Demo the moto and safe dismount separately.
4. **Phone review.** Record the full trip on a representative Android phone, including switching views and trying a failed load. Also test desktop keyboard and mouse. Watch for input lag, animation snaps, visible clipping, lost control, slow scene transitions and checkout routing errors. Keep the regular menu accessible throughout.

### Route helper to copy into the prototype

Use the repo's Three.js dependency. This JavaScript reference can be copied as `taxi-route.mjs` for the spike, then typed and moved to the Explore feature when its caller is ready. Supply caller-owned Vector3 instances for the position and direction outputs.

```js
import { CatmullRomCurve3, Vector3 } from 'three'

export function createTaxiRoute(coordinates) {
  if (coordinates.length < 2) throw new RangeError('A route needs at least two points')

  const points = coordinates.map((point) => {
    if (point.length !== 3 || !point.every(Number.isFinite)) {
      throw new TypeError('Expected finite [x, y, z] coordinates in metres')
    }
    return new Vector3(...point)
  })

  for (let index = 1; index < points.length; index += 1) {
    if (points[index - 1].distanceToSquared(points[index]) < 0.000001) {
      throw new RangeError('Consecutive route points are too close')
    }
  }

  const curve = new CatmullRomCurve3(points, false, 'centripetal')
  curve.arcLengthDivisions = Math.max(200, 32 * (points.length - 1))
  curve.updateArcLengths()
  const length = curve.getLength()

  return {
    length,
    sample(distance, position, forward) {
      if (!Number.isFinite(distance)) throw new TypeError('Distance must be finite')
      const fraction = Math.min(1, Math.max(0, distance / length))
      curve.getPointAt(fraction, position)
      curve.getTangentAt(fraction, forward)
    },
  }
}

export function createTaxiFollower(route, { cruiseSpeed, acceleration, braking }) {
  for (const value of [cruiseSpeed, acceleration, braking]) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new RangeError('Speed, acceleration and braking must be positive')
    }
  }

  let distance = 0
  let speed = 0

  function finish() {
    distance = route.length
    speed = 0
  }

  return {
    get distance() { return distance },
    get speed() { return speed },
    get arrived() { return distance === route.length },
    finish,
    sample(position, forward) {
      route.sample(distance, position, forward)
    },
    step(dt) {
      if (!Number.isFinite(dt) || dt < 0 || dt > 0.1) {
        throw new RangeError('Expected a bounded simulation step in seconds')
      }
      if (dt === 0 || distance === route.length) return

      const remaining = route.length - distance
      const stoppingSpeed = Math.sqrt(2 * braking * remaining)
      const targetSpeed = Math.min(cruiseSpeed, stoppingSpeed)
      const nextSpeed = targetSpeed >= speed
        ? Math.min(targetSpeed, speed + acceleration * dt)
        : Math.max(targetSpeed, speed - braking * dt)
      const travel = (speed + nextSpeed) * dt / 2

      if (travel >= remaining || remaining - travel < 0.0001) {
        finish()
        return
      }
      distance += travel
      speed = nextSpeed
    },
  }
}
```

For local verification, save the following as `taxi-route.test.mjs` next to the helper and run `pnpm exec node --test taxi-route.test.mjs` from the directory with the installed Three.js dependency.

```js
import assert from 'node:assert/strict'
import test from 'node:test'
import { Vector3 } from 'three'
import { createTaxiRoute, createTaxiFollower } from './taxi-route.mjs'

const route = createTaxiRoute([[0, 0, 0], [0, 0, 12], [0, 0, 24], [6, 0, 31], [20, 0, 31], [32, 0, 31]])
const tuning = { cruiseSpeed: 7, acceleration: 2.5, braking: 3.5 }
const position = new Vector3()
const forward = new Vector3()

test('clamps samples and returns a unit tangent on a curved route', () => {
  route.sample(-1, position, forward)
  assert.ok(position.distanceTo(new Vector3(0, 0, 0)) < 1e-8)
  route.sample(route.length + 1, position, forward)
  assert.ok(position.distanceTo(new Vector3(32, 0, 31)) < 1e-8)
  assert.ok(forward.distanceTo(new Vector3(1, 0, 0)) < 1e-3)
  route.sample(route.length / 2, position, forward)
  assert.ok(Math.abs(forward.length() - 1) < 1e-8)
})

test('uses approximately equal distances on successive curve samples', () => {
  let previous = new Vector3()
  const stride = route.length / 100
  route.sample(0, previous, forward)
  for (let index = 1; index <= 100; index += 1) {
    route.sample(index * stride, position, forward)
    assert.ok(Math.abs(position.distanceTo(previous) - stride) < 0.04)
    previous.copy(position)
  }
})

test('advances monotonically, accelerates, brakes and stops at both step sizes', () => {
  for (const dt of [1 / 30, 1 / 60]) {
    const follower = createTaxiFollower(route, tuning)
    let decelerated = false
    for (let frame = 0; frame < 1800 && !follower.arrived; frame += 1) {
      const priorDistance = follower.distance
      const priorSpeed = follower.speed
      follower.step(dt)
      assert.ok(follower.distance >= priorDistance && follower.distance <= route.length)
      assert.ok(follower.speed >= 0 && follower.speed <= tuning.cruiseSpeed)
      if (!follower.arrived && follower.speed < priorSpeed) decelerated = true
    }
    assert.ok(decelerated)
    assert.equal(follower.arrived, true)
    assert.equal(follower.speed, 0)
    assert.equal(follower.distance, route.length)
  }
})

test('skip shares the endpoint and repeated completion is harmless', () => {
  const follower = createTaxiFollower(route, tuning)
  follower.step(1 / 60)
  follower.finish()
  follower.finish()
  follower.step(1 / 60)
  follower.sample(position, forward)
  assert.equal(follower.speed, 0)
  assert.equal(follower.arrived, true)
  assert.ok(position.distanceTo(new Vector3(32, 0, 31)) < 1e-8)
})

test('rejects malformed points, tuning and time steps', () => {
  assert.throws(() => createTaxiRoute([[0, 0, 0]]), RangeError)
  assert.throws(() => createTaxiRoute([[0, 0, 0], [0, 0, 0]]), RangeError)
  assert.throws(() => createTaxiRoute([[0, 0, 0], [NaN, 0, 0]]), TypeError)
  assert.throws(() => createTaxiFollower(route, { ...tuning, braking: 0 }), RangeError)
  assert.throws(() => createTaxiFollower(route, tuning).step(1), RangeError)
})
```
