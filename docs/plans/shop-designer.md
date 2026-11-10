# Shop designer plan

Owner brief 2026-11-10; decisions in [D273](../decisions.md#d273-the-shop-designer-a-branch-layout-separate-from-its-tables-drawn-in-2d-and-3d-2026-11-10). Status: **planned, no code yet.** Next step: step 1 (prototype).

Design references:

- **Mockups (Claude Design canvas, the owner's):** <https://claude.ai/artifact/4R9sZD3iADJqFsybdhffo8>. Frames 1–8 are the screens; frame 9 (9A–9F) holds what was agreed on 2026-11-10. The canvas uses the app's current UI style (amber primary, stone neutrals, Nuxt UI).
- **3D visual target (owner, 2026-11-10):** [visual-target-3d.webp](shop-designer/visual-target-3d.webp). The built 3D view aims for this render's warmth and detail, not the flat shapes of the canvas's 3D frames. The UI chrome around it still follows the UI standard ([docs/reference/ui.md](../reference/ui.md)).

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

## Data model (migration `0058` or the next free number)

Lengths are whole centimetres; angles whole degrees (0–359, clockwise in the top-down view). Owned by the **branches** feature (it owns branches and dining tables, and the archive batch must write placements without a cross-feature write).

| Table | Columns | Integrity |
|---|---|---|
| `dining_tables` (existing) | + `seats integer not null default 2` | `CHECK seats between 1 and 20` [Choice: bounds]. + `unique (tenant_id, branch_id, id)` as the placements' FK target |
| `branch_layouts` | `tenant_id`, `branch_id` (PK with tenant), `version`, `updated_at`, `updated_by` | FK `(tenant_id, branch_id)` → `branches` restrict. The save lock (D41): every save names `version` |
| `branch_layout_floors` | `id`, `tenant_id`, `branch_id`, `position`, `name`, `height_cm`, `has_roof`, `geometry` (JSON: outline polygon, edges with kind and openings, inside walls, fixtures, decor) | FK to `branch_layouts` cascade. `unique (branch_id, position)`. `CHECK height_cm between 200 and 800` [Choice] |
| `branch_layout_placements` | `tenant_id`, `branch_id`, `table_id`, `floor_id`, `x_cm`, `y_cm`, `rotation`, `width_cm`, `depth_cm`, `look` (built-in key) or `custom_look_id` | **`unique (table_id)`**: a table appears once. FK `(tenant_id, branch_id, table_id)` → `dining_tables` cascade (same cafe and branch, enforced by the database). FK `floor_id` → floors cascade. FK `custom_look_id` → custom looks **restrict**. `CHECK` exactly one of `look` / `custom_look_id` |
| `custom_furniture_looks` | `id`, `tenant_id`, `name`, `base_shape`, `default_width_cm`, `default_depth_cm`, `height_cm`, `main_finish`, `accent_finish`, `photo_id`, `version` | Cafe-wide (every branch). `photo_id` → `media_assets` via the media attach/release statements |

- Geometry JSON is validated by one Valibot schema in `shared/contracts/` used by the editor and the server: finite numbers, bounds, at most 10 floors, 64 outline corners, 200 objects per floor, openings inside their edge and not overlapping. **To verify:** the D1 limit on a row/value size before setting the JSON size cap.
- Finishes are keys from a fixed palette (light oak, walnut, dark wood, black metal, steel, brass, green, terracotta, blue, linen, white marble, slate), not free colors.

## API contract (`shared/contracts/branches.ts`)

| Route | Permission | Notes |
|---|---|---|
| `GET /api/c/<slug>/admin/branches/{branchId}/layout` | `table: ['manage']` | Floors, placements, the branch's active tables (for Unplaced), custom looks, `version`. No layout yet: an empty layout with `version: 0` |
| `PUT /api/c/<slug>/admin/branches/{branchId}/layout` | `table: ['manage']` | Whole layout + `version`. One `db.batch`: version guard, upsert floors, delete removed floors, replace placements, audit row. 409 `STALE_VERSION` keeps nothing; 409/422 when a placed table is no longer active in this branch |
| `GET/POST/PATCH …/admin/furniture-looks[/{id}]`, `DELETE …/{id}` | new `furniture: ['manage']` (owner) | PATCH and DELETE name `version`; DELETE refused while used (409 lists the tables) |
| Table form (existing routes) | `table: ['manage']` | + `seats` |

- The routes use `table: ['manage']` so a counter surface for managers (D198) can be added later without a permission change. The admin portal is owners only (D52), so the first release is used by owners.
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

- View and edit the layout: `table: ['manage']` (owners and managers; the admin UI reaches owners only for now). Custom looks: `furniture: ['manage']` (owner). Photo upload: `media: ['upload']` (owner). Platform superadmins get no access (D135).

## Steps (one branch and PR each)

| Step | Deliverable | Review checkpoint |
|---|---|---|
| 1. Prototype | Client-only, demo data in the real shared layout schema: one drag-to-place flow (snap, rotate, undo), a three-floor shophouse, a small model set (generated tables/walls + a few glTF props), exterior orbit, cutaway, click-to-enter. Measure bundle size and frame time on a real phone and tablet | Drag a demo table upstairs, open 3D and find it on the right floor; same with touch. Compare the look with the visual target |
| 2a. Server | Migration, `seats`, repository, service, layout GET/PUT, version conflict, two-cafe isolation test, size limits | Server tests incl. guard removal; real-server check |
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
