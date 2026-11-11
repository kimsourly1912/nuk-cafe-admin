# Shop designer scenes plan: surroundings, people and pets

Owner brief and answers 2026-11-11; decision [D274](../decisions.md#d274-shop-designer-scenes-generated-surroundings-cc0-models-and-a-saved-preset-per-branch-2026-11-11). Extends the [shop designer plan](shop-designer.md) (D273). Status: **planned**. Steps 3e and 3f of the shop designer plan come first, unchanged.

## Visual references (owner, 2026-11-11)

- [City street](shop-designer/scene-city-street.webp) and [Seaside](shop-designer/scene-seaside.webp): the View in 3D page with a **Scene** sidebar (surroundings presets, Show surroundings, Show demo characters, Animate scene, the character list).
- [Neighborhood lane, 360° orbit](shop-designer/scene-lane-orbit.webp): front, right, rear and left of the same diorama.
- The café itself keeps following the [3D visual target](shop-designer/visual-target-3d.webp).

**How to read them:**
- They set the art direction: a warm evening light, plaster, oak, olive seating, terracotta pots, a red-check krama and a Khmer sign.
- They show a fixed rectangular café. Our cafés are drawn by their owners (L-shapes, wide cafés, rooftops), so the surroundings must fit any outline (see [Fitting the surroundings](#fitting-the-surroundings)).
- The orbit sheet shows cutaway walls in some panels and changes details between angles. The build uses one model through the whole orbit: Exterior shows intact walls, and Cutaway uses the viewer's existing rule.
- The sign reads "NUK CAFE" in the mockups. The app never hardcodes a cafe name (AGENTS.md): the sign shows the cafe's own name.

## Purpose and scope

- **Purpose:** the 3D view shows the café inside a small living street, with people and pets, so it feels like the owner's own place rather than a building floating in space.
- **In scope:**
  - people and pets placed in Design shop (step 3g);
  - surroundings presets: **Neighborhood lane** first, then **Riverside**, **Seaside** and **City street**;
  - a saved preset per branch, playback controls per viewer, and a storefront sign with the cafe's name.
- **Out of scope (later steps):**
  - editable Khmer and English sign text, awning color, day and evening light;
  - two-point measuring;
  - alternate layout drafts;
  - choosing a different entrance as the street side;
  - free walking;
  - a public tour.

## Owner decisions (2026-11-11)

1. **Models:** start with verified **CC0** assets for the moto, tuk-tuk, figures and boats, where they fit the Cambodian art direction. Record the source URL, creator and license of every asset we ship. If a prominent model still feels generic once tested in the scene, it comes back to the owner for a commission decision. The tuk-tuk is the likely candidate.
2. **Scene setting:** the surroundings preset is **saved per branch**. Authorized branch editors change it; everyone who opens that branch's 3D view sees the same saved scene. Camera position and playback controls stay local to each viewer.
3. **Timing:**
   - The Riverside pilot (step 3c, at the Riverside branch) validates the core workflow first: owners place real tables, save and reopen the layout, and inspect it in 3D.
   - Before the pilot, **Neighborhood lane is built as an internal test scene** and benchmarked on Android and desktop.
   - After the pilot it **ships** once it passes those checks.
   - Then the Riverside, Seaside and City street presets follow.

## Who owns what

```text
Café layout          server, saved with the layout's version (D273)
  floors, tables, furniture, placed people and pets (3g)
        │
Branch scene         server, saved with the layout's version (step 4a)
  surroundings preset; later the sign text and awning
        │
Viewer playback      this browser tab only, never saved
  camera, Show surroundings, Show people and pets, Animate
```

- **Placed figures** (a customer at T06, a cat by the door) are layout items: the owner places them, so they belong to the floor like a plant. They have no table id, QR code, seats or ordering state.
- **Ambient figures** (the pedestrian walking the lane, the cat at its bowl) belong to the surroundings preset. Nobody places them. They reuse the same figure models.
- **Show people and pets** hides both kinds, because the toggle exists to clear the view while finding tables.

## Scene structure in three.js

```text
stage.scene
  ├─ building root    buildScene(layout)                 picking, Fit building, shadows
  ├─ surroundings     buildSurroundings(preset, building) never picked
  │    ├─ base, street, pavement, neighbours, props
  │    └─ ambient figures (animated)
  └─ ground disc      only when the surroundings are off
```

- **Picking:** the raycaster already tests only the building's root (`building-viewer.ts`), so a tap on a neighbour's roof can't steal a table tap. The surroundings stay a separate group to keep it that way.
- **Fit:** **Fit** frames the building and, when they are shown, the surroundings, with a margin on every side. Table focus, cutaway reveal and the indoor viewpoints keep using the building's bounds. The exterior zoom limit grows to fit the surroundings.
- **Shadows:** the sun's shadow stays fitted to the building plus about 2 m. Fitting it to the whole diorama would spread the same 512–2048 px shadow map over three or four times the area and blur the café's shadows.
  - Neighbours don't cast dynamic shadows. They are shaded by vertex colors (darker at the foot and under eaves).
  - Small props and figures outside the shadow area get a soft blob shadow: one shared texture on a flat quad.
- **Cutaway and occlusion:** in Cutaway, neighbour blocks on the camera's side are hidden, by the same outward-normal rule as the café's walls. **Focus on table** also hides any neighbour between the camera and the table. Exterior shows everything.
- **Determinism:** the same layout and preset always give the same scene, because everyone who opens the branch sees the same saved scene. Variation (neighbour heights, colors, plants) comes from a small seeded random generator keyed by the branch id, never `Math.random`.
- **Loading order:** the café is generated and drawn first, as today. The surroundings' models load afterwards. If they fail, the café still works and the Scene panel says "Surroundings couldn't load" with **Try again**. Table finding never waits for decoration.

## Fitting the surroundings

`buildSurroundings` is a pure function, like `buildScene`. A plain-geometry part (`slots`) works out where everything goes, and a three.js part builds it.

1. **The front:** the edge of the ground floor (position 0) that holds its first door. The Entrance viewpoint already finds that door (`floorViewpoints`). With no door, the front is the longest wall edge. The edge may be at any angle: the whole surroundings turn to it. The approved follow-up "choose the street-facing entrance" later stores an override in the branch scene.
2. **The café's box:** every floor's outline, turned into the front edge's frame. Upper floors can overhang, so the box covers them all.
3. **Slots around the box:**
   - the street or lane across the front, its width set by the preset (lane about 4 m, city street about 10 m);
   - a pavement with a crisp curb;
   - neighbours touching each side, at most two per side;
   - a rear yard or service lane.

   The base (plinth) is the outer rectangle plus a margin, with a crisp edge and visible sides.
4. **Concave outlines:** the empty corner of an L-shaped café's box becomes yard or planters, never a neighbour.
5. **Very large or very small cafés:** neighbour widths come from a range (3.5–6 m, like real shophouses), and their count is capped. A café wider than the street preset's length gets a longer street, not a squeezed café.

**Rules the tests hold:**
- no neighbour or prop overlaps any café floor's outline or the café's box;
- the street is on the front edge's outward side;
- the same input gives the same scene;
- the bounds contain everything.

## Models and assets

| What | How it is made | Why |
|---|---|---|
| Base, street, pavement, curbs, drains, steps | Generated from code | Sized by the slots |
| Neighbour shophouses | Generated from code: `building.ts` floors plus façade modules (shutters, balcony grilles, folding gates, corrugated awnings, signboards, wall lamps, AC units, roof tiles) | Fits any width and height, matches the café's style, needs no license |
| Pots, plants, bougainvillea, street lamps, poles and wires | Generated, reusing `furniture.ts` builders where they exist | Repeated many times: instanced or merged |
| Moto, tuk-tuk, boats, people, pets, trees and palms | **CC0 glTF (`.glb`)**, chosen per the owner's decision 1 | Organic shapes that code draws poorly |

- **Materials:** reuse `materials.ts`, the canvas-drawn plaster, wood and tiles. Add roof tile, corrugated metal, pavers, asphalt, the red-and-white curb and the krama check. A material is shared by every mesh that uses it. Repeated identical pieces use `InstancedMesh`, and static pieces merge per material (`BufferGeometryUtils.mergeGeometries`).
- **Lights:** street and shop lamps are emissive, not point lights. Only the café's own lamps are lights, as today, and none on the low quality level. The evening mood comes from the environment light, the sun's color and emissive windows.
- **Asset folder:** `public/shop-designer/models/`. Each model is listed in a typed manifest (`app/features/branches/designer/assets.ts`) with:
  - id, file, source URL, creator and license (`CC0-1.0`);
  - date, what we changed, triangles and bytes.

  A unit test fails when a file has no entry, an entry has no file, the license isn't CC0 or a model is over its budget (the precedent is step 3d's built-in pictures test).
- **Preparing a model:** a script (like `scripts/render-look-photos.mjs`) shrinks textures to at most 1024 px, makes them WebP, removes unused data and writes the `.glb`. No Draco, KTX2 or meshopt, as D273 decided: their WASM decoders would need `'wasm-unsafe-eval'` in the CSP. The tool is chosen and checked against its current docs in step 3g.
- **Cambodian look:** CC0 models are usually generic, so we recolor and retexture them: a krama, sampot colors, a Cambodian number plate, the tuk-tuk's red canopy. CC0 allows this, and the manifest records each change. A model that still looks generic in the scene goes to the owner for a commission decision.
- **Candidate sources** (each asset is checked for CC0 on its own page when downloaded, since some sites mix licenses): Quaternius, Kenney, Poly Haven, and Poly Pizza filtered to CC0.

### Textured GLB files and the CSP (QS4)

**Checked 2026-11-11** in the installed three.js 0.187.0, `examples/jsm/loaders/GLTFLoader.js`:
- A `.glb` carries its textures inside the file. `GLTFLoader` turns each one into a `blob:` URL (`URL.createObjectURL`).
- In Chrome (and Safari 17+, Firefox 98+) it reads that URL with `ImageBitmapLoader`, which calls `fetch()`. `fetch()` is governed by `connect-src`.
- Production's CSP (`nuxt.config.ts`, `securityHeaders`) has `connect-src 'self'`, and `'self'` does not match `blob:`. So **textured GLB models would fail to load in production Chrome** while working in development, which sends no CSP.

| Option | Cost |
|---|---|
| **A (recommended): add `blob:` to `connect-src`** | One CSP word. A `blob:` URL can only point at data the page itself created, so it opens no new origin. Keeps one `.glb` per asset in the manifest |
| B: ship `.gltf` with separate `.bin` and `.webp` files | No CSP change, but several files per model, a larger manifest, and the tool must keep paths right |
| C: `GLTFLoader` with a plain `TextureLoader` | Not a supported option of the loader; patching it is fragile |

The first commit of step 3g loads one textured model **on the built server**, where the CSP applies. It shows the failure, then the fix, in `test/e2e/shop-designer.test.ts`.

## Animation and rendering on demand

- Today the stage draws only when something changes (`invalidate`). Animation adds a stage task (the loop's existing `tasks`) that asks for the next frame **only while all of these hold**:
  - **Animate** is on;
  - the tab is visible (`visibilitychange`);
  - the canvas is on screen (an `IntersectionObserver`);
  - the viewer doesn't prefer reduced motion.

  When any of them stops holding, the task ends and the stage is back on demand.
- **Animate** starts **off on the low quality level** (phones that measured slow) and on otherwise. A viewer can change it, for this tab only.
- **Ambient motion:** short loops. The pedestrian walks a path along the lane and turns at its end, the cat idles at its bowl, a dog sleeps. Placed figures play a small idle loop (breathing, a tail) only while Animate is on; otherwise they hold one pose.
- **Rigged models:** each placed copy is cloned with `SkeletonUtils.clone`, with one `AnimationMixer` per animated figure, updated by the stage task. Present in the installed three.js; their use is checked against the 0.187 docs when built.
- **Cleanup:** removing the surroundings, switching preset and closing the viewer dispose every geometry, material and texture they made. The test is `renderer.info.memory` returning to its count before, after ten switches.

## Data model and API (step 4a)

- **Migration:** `branch_layouts.scene`, a nullable JSON text column. A null scene means `{ preset: 'none' }`.
- **Contract:** `layoutSceneSchema` in `shared/contracts/shop-layout.ts`, `{ preset }`, where `preset` is one of `SCENE_PRESETS` (`'none'`, `'neighborhood-lane'`, later the others). The object is strict and its JSON is at most 2 KB. Later fields (sign text, awning, entrance override) join this object.
  - The preset is checked by the contract, not a `CHECK`, for the same reason as item kinds in step 3d: SQLite can only change a `CHECK` by rebuilding the table, and every new preset would need one.
- **GET `…/layout`** adds `scene`.
- **PUT `…/layout`** takes an optional `layout.scene` and saves it in the layout's existing batch, at the version read. It brings no new route, permission or lock.
  - A save without `scene` keeps the saved one, so an app tab from before the deploy can't clear it.
  - An unknown preset is a 400.
  - The audit row (`branch.layout.update`) notes a changed preset.
- **Who:** changing it needs `branch: ['update']`, like the layout (owners in the admin; counter managers later with `table: ['manage']`, D198). Everyone who can open the branch's 3D view sees the saved scene. A support visit reads it and can't change it, like the layout. An archived branch reads it.
- **The owner's own 3D view** shows the draft scene with the draft layout, as step 2c decided, under "Unsaved changes shown". Choosing a preset is part of the draft: one **Save layout** saves the layout and the scene together.
- **Tenant isolation:** the scene lives on the branch's own layout row, which every query already reaches by `(tenant_id, branch_id)`. The two-cafe layout tests cover it.

## Steps (one branch and PR each)

| Step | When | Deliverable | Review |
|---|---|---|---|
| 3g. People and pets | Before the pilot, after 3e and 3f | The first CC0 models and the model pipeline: manifest, preparing script, CSP fix (QS4). Figures in a **People and pets** library section (the owner's list: a person, a girl, a boy, an old man, someone lazing, a cat, a dog; plus a seated customer, a barista and a mini dragon if a CC0 model fits). Placed, turned and saved like furniture, fixed size, no look, no warnings for overlapping a chair. Shown in 3D with an idle loop; **Show people and pets** and **Animate** in View in 3D | Place a cat and a seated customer, save, reopen, see them in 3D on a phone and a desktop |
| 3h. Neighborhood lane test scene | Before the pilot | Internal only (`NUXT_PUBLIC_SHOP_DESIGNER_SCENES`, on in dev and staging, off in production): `buildSurroundings` with the lane (neighbours, lane, drain, rear yard, parked moto, pedestrian, cat at its bowl), Fit, cutaway hiding, shadows kept on the café, animation rules, a **Scene** select in View in 3D, and the benchmark mode (below) | The benchmark on the owner's Android phone and a desktop, recorded in progress; full orbit behind the café on both |
| 3c. Pilot (Riverside branch) | — | As planned in D273: the core workflow, with no scenes | As planned |
| 4a. Ship Neighborhood lane | After the pilot, once 3h passes the targets | The saved scene (migration, contract, GET and PUT); the **Scene** panel (right sidebar on desktop, a slide-over on phones) with scene cards (pictures rendered from our own scenes by the pictures script), Show surroundings, Show people and pets, Animate; the storefront sign with the cafe's name; the flag removed | Choose Neighborhood lane on one device, save; another device opening the branch sees it. Playback changes on one don't reach the other |
| 4b. Riverside | After 4a | Shophouses, a stone riverwalk and landing, a covered wooden passenger boat; water as its own performance case (simple water, a slow wake) | Benchmark rerun on the same devices |
| 4c. Seaside | After 4b | Coastal road, sand, palms, a seafood stall, a fishing boat | Benchmark rerun |
| 4d. City street | After 4c | Street corner, zebra crossing, motos, the tuk-tuk (commission decision if the CC0 one feels generic) | Benchmark rerun |

The order of 4b–4d is the owner's. City street reuses most of the lane's parts, so it is the cheapest of the three if the order ever needs to change.

**If the pilot runs on staging (QS5):** the 3h flag is turned off on staging for the pilot's duration, so the pilot café doesn't see an internal scene.

## Performance check (step 3h, repeated for 4b–4d)

**Benchmark mode** (`?bench=orbit` in View in 3D, only while the scenes flag is on) runs a repeatable test and shows the results with **Copy**:
1. warm up for 5 s;
2. a 20 s scripted orbit around the café, three times;
3. report:
   - median and 95th-percentile frame interval;
   - `renderer.info` render calls, triangles, geometries and textures;
   - time to the first café frame and to the complete scene;
   - quality level, effective pixel ratio and canvas size.

The person running it records the device, OS, browser and network.

| Run | What it isolates |
|---|---|
| Café only, then café + static lane, both at a fixed quality | The cost of the surroundings |
| Lane with figures paused, then animated | The cost of figures and their motion |
| Full scene at the automatically chosen quality | What a user gets, including the phone's low level |
| Idle and paused; then hide and show the tab, and leave and reopen the view, ten times | Rendering on demand stops, and resource counts come back to their first values |

- **Targets (starting, owner may adjust):**
  - **Android phone:** 95th-percentile frame interval ≤ 33.3 ms at the chosen quality during the full-scene orbit.
  - **Desktop:** median ≈ 16.7 ms on a 60 Hz screen.
  - **Budgets:** the lane's models and textures together ≤ 1.5 MB transferred (gzip). Textures ≤ 1024 px. Triangle and draw-call budgets are set from the café-only run in 3h.
- **If the phone misses:**
  1. lower the pixel ratio and shadows;
  2. then use fewer and lighter plants, textures and figures, as the browser trace shows;
  3. recheck Fit and table labels after each change.
- **The quality level** is chosen today from the first frames, which are the café's alone. Step 3h measures it again once the surroundings are drawn, so a phone isn't left at a level the full scene can't hold.
- **Real hardware decides.** CI's software renderer proves the flows and the error states, never the speed.

## Edge cases and tests

| Risk | Test |
|---|---|
| A neighbour inside an L-shaped or overhanging café | Unit: slots for narrow, wide, L-shaped, three-floor-overhang and turned-30° layouts never overlap a floor's outline |
| No ground-floor door; several doors | Unit: the longest wall edge is the front; the first door wins (later: the owner's choice) |
| Different scene for different viewers | Unit: same layout, preset and branch id give the same objects and positions |
| Surroundings steal a table tap | Unit: the pick list holds only the building; e2e: a table picked through the lane opens its card |
| Café shadows blur | Unit: the shadow area is the same with and without surroundings |
| A neighbour hides the selected table | e2e: Focus on table with the lane shown opens the table's card; unit: the blocking neighbour is hidden |
| Textured models blocked by the CSP | e2e on the built server: a textured figure loads, no CSP violation in the console |
| An asset without a license record, or over budget | Unit: the manifest test |
| Animation keeps the phone busy | Unit: the stage task ends when the tab is hidden, Animate is off or motion is reduced; benchmark: the idle run draws no frames |
| Memory grows with preset switches | Benchmark and unit: `renderer.info.memory` back to its first counts after ten switches |
| Surroundings fail to load | e2e: a failed model request leaves the café, the lists and the table card working, with Try again |
| A figure saved with a look or another size | Contract: refused (400) |
| Figures counted as overlaps | Unit: placement warnings ignore figures |
| An old app tab saves without a scene | Server: the saved preset stays |
| A stale scene save | Server: the layout's version conflict (409), nothing written |
| Another cafe's scene | Server: the two-cafe layout tests read and write the scene |
| WebGL unavailable | e2e: the existing message and lists, with the Scene panel hidden |

## Open questions

- **QS4:** allow `blob:` in `connect-src` so textured `.glb` models load in production (option A above), or ship split `.gltf` files (option B)? Suggested: A. Blocks step 3g's models.
- **QS5:** does the Riverside pilot run on staging or production? If staging, the 3h flag is switched off there during the pilot. Blocks nothing until 3c.
