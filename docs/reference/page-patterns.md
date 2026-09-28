# Page patterns

← [API Reference](./README.md) · Visual rules: [ui.md](./ui.md) · Width classes, shell, matrix: [responsive-layout.md](./responsive-layout.md) · Review: [ui-review-checklist.md](./ui-review-checklist.md)

Blueprints for the four kinds of admin page, with expanded and compact anatomy, the editing surfaces, gestures, and the states every page must handle. Behavior plumbing (queries, mutations, unsaved-changes guards) lives in [data-fetching](./data-fetching.md), [mutations](./mutations.md) and [forms](./forms.md); list behavior requirements live in [feature-standard §4](../feature-standard.md#4-list-page-behavior).

Status labels: **owner-directed** and **proposed** (see [the rollout plan](../plans/ui-standardization.md#6-owner-decisions)). Current pages are **evidence**, not automatic rules. Where a page differs from its blueprint, the gap is listed in [the rollout plan's audit](../plans/ui-standardization.md#2-route-inventory).

---

## 1. Choose the pattern

| The user is… | Pattern | Admin routes today |
|---|---|---|
| Finding, scanning or acting on many records of one kind | [Resource index](#2-resource-index) | `/products`, `/categories`, `/options`, `/add-ons`, `/availability`, `/staff` |
| Changing configuration that isn't a list of records | [Settings](#3-settings) | none yet (branch settings in step 5.1) |
| Viewing or editing one record, possibly with sub-collections | [Detail / editor](#4-detail--editor) | `/add-ons/[id]`; overlays on the other indexes |
| Completing one focused, sequential job | [Task flow](#5-task-flow) | `/login`, `/change-password` |

`/` (Dashboard) is a placeholder. It gets a pattern (likely an overview of the resource-index family) when reports exist (step 8.1).

## 2. Resource index

**Purpose:** find records, see their state, open one, act on one or a few.

### Expanded anatomy

```
Navbar:   Title                                    [+ New <thing>]
Toolbar:  [Search…]  [filters]              [view actions: Reorder · Select · Grid/List]
Body:     Intro sentence (muted)
          All 12 · Active 10 · Archived 2
          ┌ collection ─────────────────────────────────────────────┐
          │ table rows | card grid | agenda cards | tree            │
          └─────────────────────────────────────────────────────────┘
          pagination (paginated lists)
```

**Pick the collection by the job (D37):**

| Collection | When | Example |
|---|---|---|
| `UTable` | Comparing values across columns, sorting | `/staff`, `/products` (List view) |
| Card grid (`UCard`, 2 columns from `lg`) | Pictures or a short preview per record | `/products` (Grid), `/options`, `/add-ons` |
| Full-width agenda cards | Each record has a structured summary read left to right | `/availability` |
| Tree | Parent/child data | `/categories` |

Opening a record: an explicit **Manage/Edit/View** button or the row itself. Never both a clickable row and nested buttons that compete. Other actions sit in the `⋮` menu. Archive/Restore follow [ui.md → action hierarchy](./ui.md#9-action-hierarchy-owner-directed).

### Compact anatomy

```
[≡]  Title                              [+ New]
[Search…                      ] [Filters]
Intro sentence
All 12 · Active 10 · Archived 2
┌───────────────────────────────┐
│ Name                    Badge │  ← one tap target: opens the record
│ meta line · meta line       ⋮ │
├───────────────────────────────┤
│ …                             │
└───────────────────────────────┘
[Load more / pagination]
```

- **Tables become grouped rows or cards; no sideways-scrolling table (owner-directed).** Each row keeps the one or two values that identify and distinguish it (name, status, one meta line). The rest is on the detail view.
- Rows can be grouped under headings when the data has a natural group (category, day, role).
- Selection and bulk actions are a mode ("Select") with a bottom bar, never always-on checkboxes.
- Reorder is a mode with Move up/down buttons ([Gestures](#7-gestures)).

**Examples:**
- `/staff`: the table becomes rows ("Name · role · branch" + status). This is the proposed first reference for the table→rows rule.
- `/products`: the grid stays one column; the List view becomes rows.
- `/categories`: already grouped cards per parent on compact (D72).
- `/availability`: agenda cards stack (D76).

## 3. Settings

**Purpose:** change configuration (branch hours, points rate). No instance exists yet; this blueprint is **proposed** and will be proven by the first settings page (step 5.1).

### Expanded anatomy

```
Navbar:  Settings title                                   [Save changes]
Body:    Section heading          Fields…
         Short description        Fields…
         ──────────────────────────────────
         Section heading          Fields…
```

- Sections with a heading and a one-line description, fields beside or below (max readable width, not full screen width).
- One draft per page with **Save changes** in the navbar (the page's primary action), enabled only when dirty. It's guarded by `useUnsavedChanges` ([forms](./forms.md)). Instant toggles (save at once) are allowed only where the change is harmless and reversible, and say so.

### Compact anatomy

- Short settings: one column; Save changes in a bottom bar while dirty.
- Long settings (more than ~2 screens): a **grouped list of sections**, each opening a **pushed full-screen section** with its own Save. One section is edited at a time.

## 4. Detail / editor

**Purpose:** see or change one record.

### Editing surfaces

| Surface | Use when | Examples |
|---|---|---|
| `UModal` | Short form (≤ ~6 fields), one topic, the list stays the context | Staff, Category, Availability rule, Add/Edit add-on |
| `USlideover` | A medium editor tied to its list: the user compares with the list or opens the next record | Menu item form, Option-set editor |
| Route (`/<resource>/[id]`) | A record with sections or sub-collections, a URL worth sharing, or a long form | `/add-ons/[id]` |
| Master–detail (expanded) | Working through many records in turn (queues) | none yet (future orders or feedback screens) |

**Compact:**
- Modals and slideovers are **full screen** (`fullscreen` on `UModal`; slideovers are full width below `sm`).
- **Long forms use a focused full-screen route (owner-directed):** a slideover form that is several screens long on compact moves to a route or pushed screen, one section at a time.
- **Master–detail becomes a pushed screen or a bottom sheet (owner-directed):** the list is one screen; the detail pushes over it with Back. A bottom sheet is only for a short detail (a few fields or actions).

### Route anatomy (the `/add-ons/[id]` reference, D75)

```
Expanded                                           Compact
Navbar: Add-ons / Milk choices   [Save changes]    [←] Milk choices                 [⋮]
Body:   Milk choices  Active                       Milk choices  Active
        Required · choose exactly 1                Required · choose exactly 1
        ┌ Main column ───────────┐ ┌ Settings ┐   [ Add-ons 3 | Settings ]
        │ sub-collection (table) │ │ fields   │   stacked rows · ⋮ → bottom sheet
        │ usage                  │ │ status   │   …
        └────────────────────────┘ └──────────┘   [ Save changes ]  ← bottom bar, only while dirty
```

- Heading block: record name (`h2`), status badge, one summary line.
- A main column for what the user works on most, and a narrower column for settings and status.
- On compact, the two columns become tabs, and each tab is a focused screen.

### Save models

| Model | Use when | Rules |
|---|---|---|
| **Draft + Save** | Several fields that make sense together, or one request covers them | Save enables when dirty; unsaved-changes guard; conflict → Reload keeps input |
| **Save each change** | The API has one call per action and each action stands alone (rename a value, preselect) | Each action is a confirmed step (Enter, a checkbox, a dialog's Save); a live status ("Saving… / Saved / Couldn't save") in the header; errors inside the editor |

Don't mix both for the same fields. Never send several dependent calls behind one Save without saying it isn't atomic (D75).

## 5. Task flow

**Purpose:** one focused job, often sequential: sign in, change password, and later record a payment, redeem a voucher or check out.

- **Expanded:** a centered `UCard` (max ~28rem), the step's title, fields, one primary action. Multi-step flows show the step ("Step 2 of 3") and allow Back.
- **Compact:** full screen; title at the top; the primary action at the bottom in thumb reach, above the keyboard and the safe area.
- One primary action per step; Cancel/Back is secondary. A multi-step flow keeps one unsaved-changes guard over all its steps ([forms](./forms.md)).
- Errors appear beside the field or at the top of the step, and focus moves to them.

## 6. Bottom sheets

A bottom sheet (`UDrawer`) is for **brief contextual actions or choices** on compact (owner-directed): a row's actions, a quick pick from ≤ ~7 options, or a short detail. It has a title naming the record, the actions (disabled ones with their reason), and Cancel. **Not** for forms longer than one or two fields; those go full-screen. On medium and expanded, the same actions are a dropdown or popover. The Add-on row actions are the current example (`AddOnActions.vue`).

## 7. Gestures

- **Swipe, drag and long-press only enhance an interaction; they're never the only way to do it (owner-directed).** Every drag has Move up/down buttons and keyboard moves (↑/↓ on the handle). Every swipe action is also in the `⋮` menu. A long-press menu duplicates a visible button.
- Drag handles have `touch-none` so dragging doesn't scroll the page, and they're visible only in reorder mode.
- A moved item keeps focus, and its new position is announced (`aria-live`).

## 8. States

Every page and overlay handles the states that can occur for it. This table is the canonical list; the mechanisms are linked.

| State | What the user sees | Built with |
|---|---|---|
| **Loading (first)** | Placeholder rows or cards shaped like the content; never the empty state | `ListSkeleton`, `useApiQuery().loading` ([ui-helpers](./ui-helpers.md#listskeleton)) |
| **Refreshing** | Existing content stays; a small spinner in the toolbar | `refreshing` ([data-fetching](./data-fetching.md)) |
| **Initial empty** | "No <things> yet", one sentence of why it matters, and the create action (if the user may create) | `ListEmptyState` |
| **Filtered empty** | "No <things> match your filters" + Clear filters. Say it when everything is archived ("Every add-on group is archived" + Show archived) | `ListEmptyState`, a feature-specific variant |
| **Load error** | The safe message + Retry, in place of the content | `ApiErrorAlert` ([errors](./errors.md)) |
| **Not found** | "This <thing> doesn't exist" + a way back (detail routes) | the page |
| **Unauthorized / forbidden** | Session loss redirects to login; a forbidden action is hidden or disabled with the reason; the server still refuses | [app-behavior → Session loss](./app-behavior.md#session-loss) |
| **Offline** | The offline banner; saves fail with a clear toast, input kept | [app-behavior → Offline](./app-behavior.md#offline-banner) |
| **Saving** | The triggering control shows loading; inputs lock; the user may still close (the save continues) | [feature-standard → Save lifecycle](../feature-standard.md#save-lifecycle) |
| **Validation** | Messages next to their fields, focus on the first; a group message only when it's about the group | the form schema, `UFormField` |
| **Conflict (409)** | "Someone else changed this…" with **Reload**, inside the surface; input kept where possible | the feature (D72, D73, D75) |
| **Archived / read-only** | A notice saying why and what still works; fields disabled; the restore action as the primary | the feature (D73, D75, D76) |
| **Busy record** | The row dims with a spinner; its actions are unavailable | `isBusy` ([mutations](./mutations.md)) |

**Errors inside overlays** appear in the overlay, not only as toasts: toasts behind a modal are unreachable (they're `aria-hidden`).
