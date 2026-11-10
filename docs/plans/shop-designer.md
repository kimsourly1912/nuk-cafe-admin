# Shop designer plan

Owner brief 2026-11-10; decisions in [D273](../decisions.md#d273-the-shop-designer-a-branch-layout-separate-from-its-tables-drawn-in-2d-and-3d-2026-11-10). Status: **step 1 (prototype) reviewed by the owner on staging** (2026-11-10: "everything is so perfect"; their Android phone draws the 3D view in 23–30 ms a frame). **Step 2a (server) merged** (2026-11-10, [below](#step-2a-the-server-built-2026-11-10)). **Step 2b (the editor on saved layouts) merged** (2026-11-10, [below](#step-2b-the-editor-built-2026-11-10)). **Step 2c (the viewer) built, in review** (2026-11-10, [below](#step-2c-the-viewer-built-2026-11-10)). **Step 3a (looks) built, in review** (2026-11-10, [below](#step-3a-custom-looks-built-2026-11-10)). Next: step 3b (photos).

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
| `custom_furniture_looks` (migration `0059_custom_looks`) | `id`, `tenant_id`, `name`, `shape`, `base`, `chair`, `finishes` (JSON by part), `default_width_cm`, `default_depth_cm`, `version` | Cafe-wide (every branch). Unique name per cafe; unique `(tenant_id, id)` as the placements' FK target. As built in step 3a ([why it differs from the first draft](#step-3a-custom-looks-built-2026-11-10)). Step 3b adds `photo_id` → `media_assets` |

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
  - **Quality levels:** high (desktop: soft shadows), medium (tablet), low (phone: smaller shadow map, lower pixel ratio, no lamps). Chosen from a measured frame time, not the user agent. Ambient occlusion was planned for high and left out in step 2c ([why](#step-2c-the-viewer-built-2026-11-10)).
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
| 2b. Editor (**built**) | Floors, outline, edges and openings, Draw wall, placing real tables, save and reopen, the 409 flow, floor menu, outside-outline flags | Recreate an L-shaped café with a patio and a three-floor shophouse; move a staging table and scan its original QR |
| 2c. Viewer (**built**) | Saved layouts in 3D, table card with View QR and Show on plan, quality levels | Find each table from the lists and in 3D on phone, tablet, desktop |
| 3a. Looks (**built**) | Starter catalog and custom looks | Edit a look used by three tables; delete refused while used |
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

Client-only on demo data in the real layout schema; nothing is saved. On the dev server and staging only (`runtimeConfig.public.shopDesignerPrototype`, `NUXT_PUBLIC_SHOP_DESIGNER_PROTOTYPE`; off in production): `/c/<slug>/admin/prototypes/shop-designer`, owners (`branch: ['update']`), linked from a branch's Dining tables tab. Step 2 replaces it with the real tables in that tab and removes the flag. (**Removed in step 2b**: the page, its flag and its link. The demo layout is now a test fixture, `app/features/branches/tests/demo-layout.ts`.)

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

## Step 2b: the editor (built 2026-11-10)

A branch's **Dining tables** tab has three views: **Table list**, **Design shop** and **View in 3D** (`?tab=tables&view=design|3d`). The designer views use the page's full width. The editor works on the branch's saved layout and its real tables, and **Save layout** (the navbar) saves the whole layout at the version it started from. The step 1 prototype page and its flag are gone.

- **Where:**
  - `app/features/branches/composables/useLayoutEditor.ts`: the saved layout, the draft on top of it, the version, the conflict, and the tables no longer active;
  - `useBranches.ts`: `useBranchLayout`, `fetchBranchLayout`, `useLayoutMutations` (`branches:layout-save`);
  - `designer/outline.ts`: corners, edges, doors and windows, as pure functions;
  - `designer/starters.ts`: the four starters, and new floors;
  - `designer/plan.ts`: the plan's selection, tools and ghost types;
  - components: `DesignShopEditor`, `FloorPlanCanvas` (its `select`, `outline` and `wall` tools), `EdgePanel`, `LayoutStarterPicker`, `PickTableModal`, `BranchPage` (the views, Save layout).
- **What the owner can do:**
  - start from **Blank**, **Narrow shophouse**, **Wide café** or **Rooftop café** (6C), shown while the branch has no layout;
  - add floors (on top, with the top floor's outline), and from each floor's **⋯** menu (9B): rename, height, roof, **Remove floor…** (6B, the dialog names the tables that become unplaced);
  - **Draw outline** (3A): click corners on a Blank floor; on an existing one drag corners (right angles kept unless Alt), add one at an edge's handle, remove one with Delete, move one with the arrow keys; edge lengths are shown, and **Cancel** puts the shape back;
  - click an edge (3B): **Wall**, **Railing** or **Open**, its length, **Door** (a **Gate** on a railing) and **Window** (walls only), each with width and position; doors and windows stay inside their edge when corners move (moved along, or dropped when there's no room);
  - **Draw wall** (9A): click start and end; walls chain until Escape; a wall is selected and deleted from the plan;
  - place real tables: Unplaced tables (drag, or **Place on map**), **New table** (the branch's own form, saved at once), and a **table look** from the library, which asks **Which table is this?** (2A: an unplaced table or New table); **Edit table** and **View QR** in the table's panel;
  - see what's outside the outline (9C), and placed tables archived or deleted elsewhere (**Remove from map**);
  - save: **Unsaved changes** beside **Save layout**; a floor without an outline is named before anything is sent; leaving the page asks first (the app's guard).
- **A stale save (6A):** the draft stays, under "This layout was changed somewhere else" (with when it was saved). **Load latest** puts the latest layout in place as one undo step, so Undo brings the draft back on top of it, at the latest version. **Overwrite with mine** asks first ("QR codes are not affected"), then saves the draft at the latest version.
- **Choices made while building:**
  - **View in 3D shows the editor's layout, unsaved changes included**, not only what's saved (the plan's acceptance criterion 7 says "the saved layout"). While designing, the owner checks what they just drew; saving first would be a chore. Step 2c decides what a view from elsewhere (the table card, the counter later) shows.
  - **The layout loads the first time Design shop or View in 3D opens**: the table list doesn't need it.
  - **With nothing unsaved, the draft follows the server** (a refetch after a table change, a save seen on return), and its undo history starts over. With unsaved changes, the draft is kept and the save names its version.
  - **A table archived elsewhere** shows as "… is no longer an active table here" with **Remove from map**; the server's 409 `LAYOUT_TABLE_UNAVAILABLE` refetches the tables so the editor names it.
  - **Lengths and openings are typed in the edge's panel** (length, a door's width and position), rather than on the plan's labels (3A) or by dragging an opening along its edge. Inside walls are drawn and deleted, not dragged.
  - **Below `lg` the library, and below `md` the selection's panel, open in a slide-over** (the Library button on the floor bar, Details on the move pad), so a tablet in portrait can place tables.
  - **"Saved by Dara" (6A) is not shown**: the layout's GET names when it was saved, not by whom. Adding the name is a server change for a later step if the owner wants it.
  - **The furniture studio is no longer reachable**: it was the prototype's preview of step 3a. Its code (`FurnitureStudio.vue`, `designer/scene/studio-viewer.ts`) stays for 3a.
- **Not in 2b:**
  - the quick actions beside a selected table (2B: Rotate 90°, Duplicate look), and corner handles to resize on the plan (the panel's width and depth do it);
  - typing a length on the plan's label;
  - the 3D items of step 2c: the table card's View QR, quality on real devices, the saved-or-draft question above.
- **Tests:**
  - `app/features/branches/tests/designer-outline.test.ts` (18): drawing and closing a shape; moving a corner with and without right angles; openings moved or dropped on a shorter edge; splitting and merging edges with their openings (corner 0 included); edge kinds and what each takes; a free spot for a new door; a widened opening pushing another; edge names either way round; every starter valid and table-free; Blank's message; new floors up to the limit. Every edited shape passes the shared contract.
  - `test/e2e/shop-designer.test.ts` (7, the built server, no mocks; Layout Lab, a cafe seeded for this file only):
    - a starter, a placed table saved and shown again, with its QR and version unchanged;
    - a floor added, renamed and unroofed, an edge made a railing with a gate (a window refused), a wall drawn, all saved, then the floor removed with its table named, and that table placed again from a table look (Which table is this?);
    - a stale save: Load latest, Undo, save; then Overwrite with mine after its confirmation;
    - a table archived elsewhere named and removed before the save;
    - Blank: an outline clicked corner by corner, then a corner moved with the arrow key (its neighbour follows);
    - a placed table found on its floor in 3D, and Show on plan;
    - a 390 px phone: the library in a slide-over, no sideways scrolling.
  - `test/e2e/support/mock-api.ts` answers the layout route with an empty layout by default.
- **Review on staging:** recreate an L-shaped café with a patio (Wide café, then Draw outline, then an edge made Open or Railing) and a three-floor shophouse (Narrow shophouse, Add floor twice, one roof off). Move a staging table and scan its original QR: it still opens that table.

## Step 2c: the viewer (built 2026-11-10)

**View in 3D** now works as part of the branch's real tables: the table card opens the table's own QR code, a table picked in one view is picked in the other, and the view says when it shows changes that aren't saved.

- **Where:** `app/features/branches/components/BuildingView3D.vue` (the table card, `reveal`, `start` and Try again, the unsaved label) and `BranchPage.vue` (one selected table for both views, the 3D view's loading and error states).
- **What changed:**
  - **The table card** (a table picked in 3D or from the lists): its name, area, seats and floor, **View QR** (the table's own code, the same dialog as the Table list: link, SVG and PNG downloads) and **Show on plan** (opens Design shop on that table's floor with it selected).
  - **One selected table for Design shop and View in 3D.** It is the editor's selection, so a table selected on the plan is selected and brought into view in 3D, and back.
  - **Picking a table brings it into view.** In the exterior, a table under a roof or another floor showed only its label through the building; picking it from the lists (or arriving with it selected) now opens the cutaway first. A table on an open top floor stays in the exterior. Inside a floor, a table of another floor enters that floor (as before).
  - **"Unsaved changes shown"** in the 3D view while the layout has unsaved changes (the navbar's "Unsaved changes" is hidden on a phone).
  - **3D unavailable** (no WebGL, or the graphics context lost, which a phone does to a tab left in the background): the message has **Try again**, which starts the view on a fresh canvas. The floor and table lists and the table card (View QR, Show on plan) work without 3D.
  - **Loading and error states:** opening View in 3D directly showed "No shop layout yet" until the layout arrived; it now shows the loading state, and the load error with Retry.
- **Decided:**
  - **View in 3D keeps showing the editor's layout, unsaved changes included**, and names it (the label above). Only owners open it today, from the same page as the editor; a second, saved-only copy of the layout would be one more state to keep in step for no reader. A view opened from elsewhere later (the counter, for staff) has no draft, so it shows the saved layout.
  - **No ambient occlusion.** The plan listed it for the high level. It needs a post-processing pipeline (a composer with a depth pass, and its own anti-aliasing because the canvas's is lost), which costs bundle size and frame time on every frame, for a look the owner already approved without it. The quality levels stay: pixel ratio, shadow size and softness, lamps.
  - **The quality line stays visible** ("Quality high · 12 ms a frame") through the pilot: it is how the owner reports what a real phone or tablet does. Remove or hide it after step 3c.
  - **No "Show on plan" from the Table list's cards.** The list doesn't load the layout (2b), and it would need it to know which tables are placed. The floor and table lists in View in 3D and Unplaced tables in Design shop are the ways to find a table.
- **Tests** (`test/e2e/shop-designer.test.ts`, 9 in the file, the built server):
  - L1 picked from the lists opens the cutaway and its card; **View QR** shows the same link as the tables API; **Show on plan** selects it on the plan; after a move, View in 3D shows "Unsaved changes shown" with L1 still picked;
  - WebGL switched off: the message, the lists, the table card and its QR code still work; **Try again** keeps the message while WebGL is off and draws the building once it is back;
  - a 390 px phone: the lists in a drawer, the table card inside the screen, Show on plan, no sideways scrolling.
- **Not verified:** real devices. The e2e browser draws with a software renderer (about 1 s a frame, quality low), so it proves the flow, not the speed or the look on a GPU. A lost graphics context is exercised only through Try again after a failed start, not by a real phone dropping it.
- **Review on staging:** on a phone, a tablet and a desktop, open a branch → Dining tables → View in 3D. Find each table from **Floors and tables** and by tapping it; open its QR code and scan it; press Show on plan. Note the quality line on each device. On the phone, leave the tab in the background for a few minutes and come back: the building is still there, or the message offers Try again.

## Step 3a: custom looks (built 2026-11-10)

A cafe can save its own table looks and use them in every branch. A look is shared: editing it changes every table placed with it; a look in use can't be deleted.

- **Where:**
  - server: migration `0059_custom_looks`; `branches.schema.ts` (`customFurnitureLooks`, the placements' `customLookId`); `branches.looks.repository.ts`, `branches.looks.service.ts` (`listLooks`, `createLook`, `updateLook`, `deleteLook`); the layout save in `branches.layout.service.ts`; routes `server/api/c/[slug]/admin/furniture-looks/`; the tenant permission `furniture: ['manage']` (owners);
  - contract: `shared/contracts/shop-layout.ts` (`createLookSchema`, `updateLookSchema`, `CustomLook`, `isBuiltInLook`, `MAX_CUSTOM_LOOKS`; a placement's `lookId` is a built-in key or a custom look's id);
  - app: `LookFormModal.vue` (the prototype's furniture studio as a form), `useLooks` and `useLookMutations` (`useBranches.ts`), `useLayoutEditor` (looks, `unknownLooks`), `DesignShopEditor` (New look, the pencil, Edit look, Save as new look).
- **API** (`furniture: ['manage']`, owners):

  | Route | Notes |
  |---|---|
  | `GET …/admin/furniture-looks` | The cafe's looks by name, each with `tables`: how many placed tables use it, in every branch |
  | `POST …/admin/furniture-looks` | `createLookSchema`. 409 `LOOK_NAME_TAKEN` (on `name`), 409 `LOOK_LIMIT` past 50 |
  | `PATCH …/admin/furniture-looks/{id}` | The whole look again with `version`. 409 `VERSION_CONFLICT`, `LOOK_NAME_TAKEN` |
  | `DELETE …/admin/furniture-looks/{id}?version=` | 409 `LOOK_IN_USE` while a saved layout uses it; the message names up to 5 tables with their branch |
  | `PUT …/layout` | + 409 `LAYOUT_LOOK_UNAVAILABLE` on `layout.placements.<i>.lookId` for a look that is neither built in nor this cafe's |
- **What the owner can do:** **New look** under Table looks (name, Round / Rectangle / Booth, size, Pedestal / Four legs, chairs, a finish per part, a live 3D or top-view preview); the pencil on a custom look or **Edit look** in a table's panel; **Save as new look** in a table's panel (starts from that table's look and gives the new one to that table); **Delete** in the form, enabled only when no saved layout uses the look.
- **Decided while building:**
  - **A look stores what the builders draw**: `shape`, `base`, `chair` and finishes by part (`top`, `base`, `frame`, `seat`). The first draft of the data model listed `base_shape`, a main and an accent finish and a height. Step 1 built looks by part, the owner approved that studio, and tables have one height, so the table matches the code instead.
  - **A placement has `look` or `custom_look_id`, exactly one** (a `CHECK`), with a composite foreign key `(tenant_id, custom_look_id)` → the look, **restrict**. The database itself refuses another cafe's look and the delete of a look in use. `branch_layout_placements` was rebuilt for it (copy, drop, rename): SQLite can't add a composite foreign key in place, and nothing references the table. The old Worker still works on the new table during a deploy (it writes `look` only).
  - **Custom looks are their own list** (`branches:looks`), not part of the layout's answer: they are cafe-wide and change on their own. The editor loads both before it draws.
  - **A look deleted while an unsaved draft uses it** is refused on save, the looks are read again, and the editor names the tables ("The look of L1 was deleted") with **Use Round café table**.
  - **A refetch that brings the same drawing keeps the selection and the undo history.** Before, any refetch with nothing unsaved started the draft over; editing a look refetches the layout, which dropped the selected table.
  - **Editing a look keeps each table's size.** The look's size is what a newly placed table starts with.
  - **`furniture: ['manage']`** as the plan named it, although only owners hold it today like `branch: ['update']`: looks are cafe-wide, so a later counter role for layouts would not get it by accident.
- **Not in 3a:** the look's photo (3b); custom chairs or fixtures (the prototype's studio previewed them; nothing saves them); a looks page outside the editor; more starter looks (3c, from what the owner reaches for).
- **Tests:**
  - `server/features/branches/tests/branches.looks.service.test.ts` (19): create, list with use counts, audit; the name in any capitals; the limit and its race; the size `CHECK`; edit at a version and its race; delete unused, in use (named with branches), in use meanwhile (the foreign key), stale; a look free again after its tables leave; custom and built-in looks on a save; an unknown look by position; a look deleted meanwhile; the exactly-one `CHECK`; two cafes through the service, the database and the repository.
  - `server/tests/migrations.test.ts` (`0059_custom_looks`): placed tables survive the rebuild with their look; the new and the kept rules hold.
  - `server/tests/d1-search.test.ts`: on real local D1, a name clash, a look deleted under a save and a look placed under a delete are refused by D1's batch.
  - `test/e2e/shop-layout-api.test.ts`: the routes over HTTP, a manager and another cafe's owner refused.
  - `test/e2e/shop-designer.test.ts` (11 in the file): a new look from the library, the name clash on its field, on a table and saved, edited (used by 1 table, Delete disabled), deleted after its table left; a look deleted elsewhere under a draft.
- **Guards checked by removing them:** the create's limit guard, the edit's and the delete's version guards, the delete's foreign-key answer, the repository's tenant filters (read, list, update), and the save's answer for a look deleted meanwhile: each removed makes a test fail. The save's own check for unknown looks can be removed with no test failing, because the foreign key refuses the same save; it stays for the plain case (no failed batch).
- **Review on staging:** Design shop → New look; give it to three tables in two branches and save. Edit the look: all three change in the plan and in 3D. Try to delete it: refused, with the tables named. Give them another look, save, delete it.

