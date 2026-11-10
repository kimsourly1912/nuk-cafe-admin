# Shop designer plan

Owner brief 2026-11-10; decisions in [D273](../decisions.md#d273-the-shop-designer-a-branch-layout-separate-from-its-tables-drawn-in-2d-and-3d-2026-11-10). Status: **step 1 (prototype) reviewed by the owner on staging** (2026-11-10: "everything is so perfect"; their Android phone draws the 3D view in 23–30 ms a frame). **Step 2a (server) built, in review** (2026-11-10, [below](#step-2a-the-server-built-2026-11-10)). Next: step 2b (the editor on saved layouts).

Design references:

- **Mockups (Claude Design canvas, the owner's):** <https://claude.ai/artifact/4R9sZD3iADJqFsybdhffo8>. Frames 1–8 are the screens; frame 9 (9A–9F) holds what was agreed on 2026-11-10. The canvas uses the app's current UI style (amber primary, stone neutrals, Nuxt UI).
- **3D visual target (owner, 2026-11-10):** [visual-target-3d.webp](shop-designer/visual-target-3d.webp). The built 3D view aims for this render's warmth and detail, not the flat shapes of the canvas's 3D frames. The UI chrome around it still follows the UI standard ([docs/reference/ui.md](../reference/ui.md)).
- **Furniture studio references (owner, 2026-11-10):** [chair](shop-designer/studio-chair.webp), [table](shop-designer/studio-table.webp), [counter](shop-designer/studio-counter.webp): start from a preset (Tables, Chairs, Fixtures), a turntable preview with 3D and Top view, and Customize with dimensions, base style and finishes per part (frame and upholstery, tabletop and base, cabinet and countertop). They replace frame 8's dialog as the place where custom looks are made (step 3a).

## Purpose and scope

- **Purpose:** an owner draws their café as floors, walls and furniture, places the branch's real dining tables in it, and explores the result as a small 3D building. Setting up should feel like build mode in a game. The table list stays the quick route to QR codes.
- **Where:** a branch's **Dining tables** tab gets three views: **Table list** (today's), **Design shop** (2D editor) and **View in 3D**. Design shop and View in 3D use the full page width.
- **Acceptance criteria, first release:**
  1. An owner starts from Blank or a starter (narrow shophouse, wide café, rooftop café); a starter draws outlines, doors and windows, never tables.
  2. Floors can be added, renamed, given a height and a roof (on/off), and removed; removing one names the tables that become unplaced before it is saved.
  3. Each floor's outline is a polygon (an L-shape works); each edge is Wall, Railing or Open; doors and windows sit on edges (a door on a railing is a gate; windows need a wall). Inside walls are drawn with Draw wall.
  4. Real tables are placed from Unplaced tables (drag, or Place on map and the move pad); a table look can be dropped and asks which table it is. Snap to a 25 cm grid (5 cm with Shift), rotate (15° steps, 90° buttons), resize, undo/redo.
  5. A table's chairs come from its **seats**; moving the table moves its chairs.
  6. Save stores the whole layout as one versioned change; reopening shows it as saved. A stale save keeps the draft and offers Load latest or Overwrite with mine (after a confirmation).
  7. View in 3D shows the same saved layout: exterior orbit, cutaway (roof and camera-facing walls hidden, floors pulled apart), and inside a floor from preset viewpoints. Selecting a table shows its label, seats, floor, View QR and Show on plan.
  8. Moving, restyling or unplacing a table never changes its QR; a printed QR keeps working.
  9. Custom looks (cafe-wide) with a main and an accent finish and an optional photo shown in the picker and the table details.
  10. The 3D view works on tablet and phone (view only on phone); the lists work when 3D is unavailable.
- **Out of scope (follow-ups):** tracing an imported floor sketch, importing 3D model files, free walking, a live counter map, a public tour, editing the layout from the counter app.

## Agreed rules (D273)

- **The layout is separate from the dining table record.** A placement references a table id; it never copies or changes the table's label, QR or status.
- **Seats belong to the table** (new `dining_tables.seats`, edited in the table form). A table look places that many chairs (round: evenly around; rectangle: along the long sides; booth: none). The catalog's **Extra chair** is for stools and extras only.
- **A look is shared.** Shape, finishes and photo come from the look; editing a look changes every table that uses it. Width, depth and rotation belong to each placement (the look gives defaults). To change one table only, save a new look. A look in use can't be deleted (the dialog lists its tables).
- **Archiving a table removes its placement** in the same batch; restoring it brings it back to Unplaced tables. Deleting a table for good (D200) removes its placement by cascade.
- **Removing a floor removes its placements** (cascade): those tables become unplaced.
- **Items outside the outline** are flagged in the editor and saved anyway: a reminder, not an integrity rule.

## Data model (migration `0058_shop_layout`)

Lengths are whole centimetres; angles whole degrees (0–359, clockwise in the top-down view). Owned by the **branches** feature (it owns branches and dining tables, and the archive batch must write placements without a cross-feature write).

| Table | Columns | Integrity |
|---|---|---|
| `dining_tables` (existing) | + `seats integer not null default 2` | `CHECK seats between 1 and 20` (owner, 2026-11-10). + unique index `(tenant_id, branch_id, id)` as the placements' FK target |
| `branch_layouts` | `tenant_id`, `branch_id` (PK), `version`, `updated_at`, `updated_by` (→ user, set null) | FK `(tenant_id, branch_id)` → `branches` restrict. The save lock (D41): every save names `version`. No row: version 0 |
| `branch_layout_floors` | `tenant_id`, `branch_id`, `id` (PK: the editor's id, unique in its layout), `position`, `name`, `height_cm`, `has_roof`, `geometry` (JSON: outline polygon, edges with kind and openings, inside walls, furniture) | FK `(tenant_id, branch_id)` → `branch_layouts` cascade. `unique (tenant_id, branch_id, position)`. `CHECK position between 0 and 9`, `height_cm between 200 and 800` (owner, 2026-11-10) |
| `branch_layout_placements` | `table_id` (PK), `tenant_id`, `branch_id`, `floor_id`, `x_cm`, `y_cm`, `rotation`, `width_cm`, `depth_cm`, `look` (built-in key) | **PK `table_id`**: a table appears once. FK `(tenant_id, branch_id, table_id)` → `dining_tables` cascade (same cafe and branch, enforced by the database). FK `(tenant_id, branch_id, floor_id)` → floors cascade. `CHECK rotation 0–359, width and depth 40–600`. Step 3a adds `custom_look_id` → custom looks **restrict** and `CHECK` exactly one of `look` / `custom_look_id` (a rebuild: nothing references this table) |
| `custom_furniture_looks` | `id`, `tenant_id`, `name`, `base_shape`, `default_width_cm`, `default_depth_cm`, `height_cm`, `main_finish`, `accent_finish`, `photo_id`, `version` | Cafe-wide (every branch). `photo_id` → `media_assets` via the media attach/release statements |

- Geometry JSON is validated by one Valibot schema in `shared/contracts/shop-layout.ts` used by the editor and the server: whole numbers in bounds, at most 10 floors, 64 outline corners, 200 objects and 100 inside walls per floor, openings inside their edge and not overlapping, and **at most 64 KB of JSON per floor** (`LAYOUT_MAX_FLOOR_BYTES`). Each floor is written by its own statement as one bound value, so no statement carries more than one floor. The save route takes up to 768 KB (`LAYOUT_MAX_BODY_BYTES`: ten full floors and 200 placements); other routes keep 64 KB.
- **D1 limits (2026-11-10):** Cloudflare's limits page couldn't be read from the build session. Measured on local D1 (workerd, wrangler's platform proxy): SQL text over 100,000 bytes is refused (`SQLITE_TOOBIG`); bound values aren't counted (2.1 MB passed). The largest layout saves on local D1 (`server/tests/d1-search.test.ts`). **To verify on staging:** the first real save (a few KB) and, once, a large one.
- Finishes are keys from a fixed palette (light oak, walnut, dark wood, black metal, steel, brass, green, terracotta, blue, linen, white marble, slate), not free colors.

## API contract (`shared/contracts/branches.ts`)

| Route | Permission | Notes |
|---|---|---|
| `GET /api/c/<slug>/admin/branches/{branchId}/layout` | `branch: ['update']` | `BranchLayout`: `version`, `updatedAt`, floors bottom first, placements, the branch's active tables (`id`, `label`, `seats`). No layout yet: empty at `version: 0`. Archived branches read |
| `PUT /api/c/<slug>/admin/branches/{branchId}/layout` | `branch: ['update']` | `{ version, layout: { floors, placements } }` (`saveLayoutSchema`). One `db.batch`: the version (first save inserts the layout's row; later ones update at the version read + `requireOneChange`), placements and floors deleted and inserted again, a guard that every placed table is an active table of the branch, an audit row (`branch.layout.update`). 409 `VERSION_CONFLICT` saves nothing; 409 `LAYOUT_TABLE_UNAVAILABLE` on `layout.placements.<i>.tableId` when a placed table is archived, deleted or another branch's (by position, so nothing about other branches leaks); 409 `INVALID_STATE` for an archived branch. Answers the layout as saved |
| `GET/POST/PATCH …/admin/furniture-looks[/{id}]`, `DELETE …/{id}` | new `furniture: ['manage']` (owner) | PATCH and DELETE name `version`; DELETE refused while used (409 lists the tables) |
| Table form (existing routes) | `branch: ['update']` (admin), `table: ['manage']` (counter, D198) | + `seats` (1–20; 2 when a new table names none) |

- The admin routes check `branch: ['update']`, like the admin's dining-table routes: a cafe permission only owners hold (the admin portal is owners only, D52). Managers manage tables on the counter, where routes check the branch permission `table: ['manage']` for the path's branch (D198); a counter surface for the layout would follow that pattern without a new permission. (Corrected 2026-11-10: the first draft named `table: ['manage']` for the admin routes, but that is a branch-role permission owners don't hold as a cafe permission.)
- `furniture: ['manage']` is owner-only like menu write and media upload: looks are cafe-wide.

## Editor (Design shop)

- **Rendering:** SVG with Pointer Events. Pointer capture plus a movement threshold separates tap/click from drag; pinch zooms; Space-drag or empty-space drag pans. Hit testing and accessibility come from the DOM.
- **No-drag path:** Place on map, the move pad and keyboard (arrows, Shift for 5 cm, R rotate, Enter done, Esc cancel). The e2e tests drive the editor this way.
- **State:** the draft layout lives in a managed composable, cleared on session transitions; undo/redo is a capped list of document snapshots. Leaving with unsaved changes asks first (the app's existing guard).
- **Upper floors** show the floor below as a faint outline (toggle), so stairs and walls line up.
- **Table form reuse:** New table and Edit table open the branches feature's own form, which is why the editor lives in `app/features/branches/designer/` (forms are never exported, AGENTS.md).

## 3D viewer (View in 3D)

- **three.js**, client-only, loaded with a dynamic import when the view opens. Version pinned at step 1; APIs checked against that installed version's docs.
- `buildScene(layout)` is a pure function of the saved layout. Coordinates: layout `x` → world `x`, layout `y` → world `z`, centimetres → metres; rotation `y = −degrees`.
- **Models, aiming for the visual target:**
  - **Generated from code** for anything that resizes: floor slabs (extruded outline), walls split around openings (no hole cutting), railings, stairs, counters, table tops and legs (legs keep their thickness at every size), booths. Bevelled edges and PBR materials with tiling textures (wood floor, tiles, plaster) per finish.
  - **glTF models (`.glb`)** for fixed-size props: chairs and stools, plants, lamps and sconces, the counter's till. Low-poly with WebP textures, **no Draco, KTX2 or meshopt** (their WASM decoders would need a CSP change). Served from this origin. Sources: made for us or CC0 with the license recorded.
  - **Lighting:** image-based light from three.js's built-in room environment, one shadow-casting sun, warm emissive lamps, filmic tone mapping. Shadows are drawn once and redrawn only when the scene changes; the scene renders on demand.
  - **Quality levels:** high (desktop: soft shadows, ambient occlusion), medium (tablet), low (phone: no AO, smaller shadow map, lower pixel ratio). Chosen from a measured frame time, not the user agent.
- **Labels** (floor names with leader lines, the selected table's chip) are HTML overlays, so they are readable and accessible. The scene's background follows light/dark mode.
- **Cutaway:** hide the roof and walls whose outward normal faces the camera; floors pulled apart. **Inside a floor:** viewpoints worked out from the layout (front door, top of stairs, the longest window, a bar ledge); a floor without a front door has no Entrance.
- **WebGL unavailable or context lost:** the calm message of frame 6D; the floor and table lists always work.

## Mutations and freshness

- `saveLayout` (PUT), `createLook` / `updateLook` / `deleteLook`, plus the existing table mutations. A table created from the editor saves at once (its own mutation); placing it saves with the layout.
- Invalidate: the branch's layout and tables queries after a layout save; layouts after a look change; layouts after a table archive/restore/delete.
- No polling: another device's save shows on return or as a 409 on save (D22).

## Permissions

- View and edit the layout: owners in the admin (`branch: ['update']`); managers later on the counter (`table: ['manage']` for their branch, D198). Custom looks: `furniture: ['manage']` (owner). Photo upload: `media: ['upload']` (owner). Platform superadmins get no access (D135).

## Steps (one branch and PR each)

| Step | Deliverable | Review checkpoint |
|---|---|---|
| 1. Prototype | Client-only, demo data in the real shared layout schema: one drag-to-place flow (snap, rotate, undo), a three-floor shophouse, a small model set (generated tables/walls + a few glTF props), exterior orbit, cutaway, click-to-enter. Measure bundle size and frame time on a real phone and tablet | Drag a demo table upstairs, open 3D and find it on the right floor; same with touch. Compare the look with the visual target |
| 2a. Server (**built**) | Migration, `seats`, repository, service, layout GET/PUT, version conflict, two-cafe isolation test, size limits | Server tests incl. guard removal; real-server check |
| 2b. Editor | Floors, outline, edges and openings, Draw wall, placing real tables, save and reopen, the 409 flow, floor menu, outside-outline flags | Recreate an L-shaped café with a patio and a three-floor shophouse; move a staging table and scan its original QR |
| 2c. Viewer | Saved layouts in 3D, table card with View QR and Show on plan, quality levels | Find each table from the lists and in 3D on phone, tablet, desktop |
| 3a. Looks | Starter catalog and custom looks | Edit a look used by three tables; delete refused while used |
| 3b. Photos | Look photos via `media_assets` attach/release | Photo shows in the picker and table details |
| 3c. Pilot | Pilot with a real café; prioritize more furniture from what the owner reaches for | The owner recreates part of their café and explores it without help |

## Edge cases and verification

| Risk | Test |
|---|---|
| Another cafe's or branch's table placed | Server: two-cafe and two-branch placement refused (FK and service), isolation test |
| A table placed twice | Server: unique `table_id`; the save that places it twice fails as a whole |
| Stale save | Server: wrong `version` → 409, nothing written; e2e: draft kept, Load latest / Overwrite |
| Table archived elsewhere during editing | Server: save with an archived table refused; archive removes its placement in the same batch |
| Floor removed | Server: cascade unplaces its tables; e2e: dialog names them |
| Look in use deleted | Server: restrict → 409 with the tables |
| 2D and 3D disagree | Unit: each builder's bounding box equals its footprint (size and rotation); a placed table's world position matches the layout |
| Bad geometry | Unit: shared schema rejects open polygons, overlapping openings, out-of-range numbers |
| 3D unavailable | e2e: WebGL disabled shows the message; the lists work |
| QR unchanged | Server: moving, restyling, unplacing a table leaves `qr_version` and the token hash unchanged |

## Step 1: the prototype (built 2026-11-10)

Client-only on demo data in the real layout schema; nothing is saved. On the dev server and staging only (`runtimeConfig.public.shopDesignerPrototype`, `NUXT_PUBLIC_SHOP_DESIGNER_PROTOTYPE`; off in production): `/c/<slug>/admin/prototypes/shop-designer`, owners (`branch: ['update']`), linked from a branch's Dining tables tab. Step 2 replaces it with the real tables in that tab and removes the flag.

- **Where:** `shared/contracts/shop-layout.ts` (the layout schema the save route will use); `app/features/branches/designer/` (catalog, geometry, demo, and `scene/`: materials, furniture, building, scene, stage, building and studio viewers); `app/features/branches/components/` (`ShopDesignerPrototypePage`, `DesignShopEditor`, `FloorPlanCanvas`, `BuildingView3D`, `BuildingNavigator`, `FurnitureStudio`); `composables/useLayoutDraft.ts`.
- **Design shop:** library (Unplaced tables with drag or Place on map, furniture by category), the SVG plan (snap 25/5 cm, turn handle in 15° steps, pan, wheel and pinch zoom, keyboard), the move pad, undo/redo (one step per gesture), floor tabs with the floor below shown faintly, the outside-outline warning, the inspector (floor, size, rotation, look with "Also used by", Remove from map; furniture finishes).
- **View in 3D:** three.js 0.187.0 (pinned), loaded on demand; exterior, cutaway (roof and camera-facing walls hidden, floors pulled apart, leader labels), inside a floor at worked-out viewpoints, tap-to-select with the table card (Show on plan returns to the editor), floor and table lists (a drawer on phones), loading and unavailable states, light and dark.
- **Furniture studio:** the owner's references as a preview: presets, turntable with 3D and Top view, dimensions, base style, chairs, finishes per part. Save to library and the photo are shown disabled (steps 3a, 3b).
- **Models:** generated from code, with the owner's visual target as the aim: bevelled parts, canvas-drawn grain, weave, speckle, planks and tiles; image-based light, one soft sun (`PCFShadowMap` with a radius: 0.187 removed `PCFSoftShadowMap`), warm lamps, ACES tone mapping. No glTF props yet: chairs, plants and lamps are generated too. glTF for fixed-size props stays the plan for step 3.
- **Quality:** measured, not guessed: up to 30 frames, or about a second on a slow device (4+ frames), then high, medium or low (pixel ratio, shadow size and softness, lamps). The prototype shows the result ("Quality low · 854 ms a frame" in the e2e browser's software renderer, which first spent 23 s measuring 45 frames: the cap came from that).
- **Size (production build, gzip -9):** three.js in two lazy chunks of 92 and 66 kB, loaded only by View in 3D and the studio; the prototype page's own chunk 21 kB. No other page imports three.js.
- **Not in step 1:** saving (2a), drawing outlines, Draw wall, openings and floors in the editor (2b; the demo's shapes come from data), table looks from the catalog onto a table (the inspector's Look does it), custom looks (3a), photos (3b), glTF props (3), real-device measurements (a phone and a tablet the owner uses).
- **Tests:** `app/features/branches/tests/designer-geometry.test.ts` (contract rules, chairs from seats, wall pieces, normals, snapping, outside-outline, viewpoints), `designer-scene.test.ts` (each model fills its plan footprint; a resized table keeps its leg thickness; one chair per seat; tables on their floors at the plan's positions; rotation agrees between 2D and 3D; walls per edge), `test/e2e/shop-designer.test.ts` (Place on map + pad + undo, drag from the library snapped, T03 moved upstairs and found on the First floor in 3D, cutaway, inside with no Entrance upstairs, Show on plan, the studio, a 390 px phone, dark mode; `SHOP_DESIGNER_SCREENSHOTS=1` keeps screenshots).
- **Review on staging:** open a branch → Dining tables → Open prototype. Move a table upstairs (inspector → Floor), open View in 3D, find it on its floor; try the same with touch on a tablet, and note the quality line on a real phone and tablet.

## Step 2a: the server (built 2026-11-10)

The layout is saved and read on the server; no screen uses it yet (step 2b). The prototype stays as it was until 2b replaces it. One visible change: dining tables have **Seats** (the table form on the admin and the counter, and each table card: "Main floor · 4 seats").

- **Where:** migration `server/db/migrations/sqlite/0058_shop_layout.sql`; `server/features/branches/branches.schema.ts` (three tables, `seats`), `branches.layout.repository.ts`, `branches.layout.service.ts` (`getLayout`, `saveLayout`, exported by `index.ts`), `branches.errors.ts` (`layoutChanged`, `layoutTablesUnavailable`); routes `server/api/c/[slug]/admin/branches/[branchId]/layout.get.ts` and `layout.put.ts`; `shared/contracts/shop-layout.ts` (`saveLayoutSchema`, `BranchLayout`, `BUILT_IN_LOOK_IDS`, the byte limits) and `shared/contracts/branches.ts` (`seats`); `readValidBody`'s `maxBytes` and `workerBodyLimit` (the route's 768 KB). Archiving a table deletes its placement in the archive's batch (`branches.service.ts`).
- **The migration is hand-edited.** drizzle-kit rebuilt `dining_tables` to add a table-level `CHECK` (copy, drop, rename with `PRAGMA foreign_keys=OFF`, which D1 ignores), and its copy selected `seats` from the old table, which has none. It is `ALTER TABLE … ADD seats … CHECK (seats between 1 and 20)` instead: the same rule as a column constraint. drizzle-kit then reports no schema changes.
- **Choices made while building:**
  - A floor's key is `(tenant_id, branch_id, id)`. The id is the editor's own, unique in its layout only, so two branches can both have a floor called `ground`, and one branch can never write another's floor.
  - Floors and placements are replaced whole on every save, rather than upserted. It's simpler, and an upsert keyed by a client id could reach another branch's rows.
  - Archiving a table doesn't change the layout's version. An open editor that still shows the table is refused on save with `LAYOUT_TABLE_UNAVAILABLE` naming it, instead of the whole draft being lost to a version conflict.
  - Looks are stored as a built-in key now (`look`). Custom looks add their column in step 3a.
- **Tests:**
  - `server/features/branches/tests/branches.layout.service.test.ts` (23 tests):
    - empty layout at version 0, with active tables by label;
    - save, read back and audit; a whole replace, where a removed floor takes its tables with it;
    - the tables' rows unchanged (version, QR version and hash);
    - stale version, plus two races: a first save landing meanwhile (the layout's key) and a save landing meanwhile (the version guard);
    - archived, another branch's or an unknown table, by position;
    - a table archived meanwhile (the guard) and deleted meanwhile (the foreign key);
    - the database refusing a placement in another branch;
    - archive takes the table off the plan, restore doesn't put it back;
    - permanent delete cascades;
    - seats are the table's own, and the database's seats `CHECK`;
    - an archived branch reads but can't save;
    - two cafes, through the service and in the repository itself;
    - a malformed floor is a 400, never a thrown error;
    - the largest floor fits 64 KB, and one more item is refused;
    - the largest save fits 768 KB.
  - `server/tests/d1-limits.test.ts`: every floor full and 200 tables placed, under D1's 100 parameters.
  - `server/tests/d1-search.test.ts`: the same on real D1, plus a stale save and an archived table refused by D1's batch.
  - `server/tests/worker-body.test.ts`: the route's limit.
  - `test/e2e/shop-layout-api.test.ts`, on the built server:
    - an owner reads, places a table, and a stale save is 409, bad geometry 400;
    - a 600 KB save is accepted and one over the limit is 413;
    - a branch manager gets 403;
    - another cafe's owner gets 403 on our cafe, and 404 with our branch's id at their own address.
  - `test/e2e/branches.test.ts`: Seats in the add-table form.
  - `test/e2e/manager-tools.test.ts`: the counter's new table shows "2 seats" from the real server.
- **Found by the real-server test:** a floor with fewer corners than edges answered 500. Valibot runs every check of a pipe even after one failed, and the door-and-window check read a corner that wasn't there. The step 1 prototype's data was always well formed, so it never hit this. The check now runs only when the lists match: a 400 with the issue. The contract test fails without the fix (a `TypeError`).
- **Guards checked by removing them:** each of these, removed, makes its test fail:
  - the version guard;
  - the active-tables guard;
  - the repository's tenant filter;
  - the guard's tenant filter;
  - the archive's placement delete.

  `interleaved` gained a `skip` count, because the save's own checks read with a batch: without it, the "meanwhile" write landed before the checks and never reached the guards.
- **Review:** server-only. The owner can see **Seats** on staging: a branch → Dining tables → New table or Edit, and on the counter's Manage → Dining tables.

