# Branch

**Cafe → Branches** opens the branch (with more than one branch, choose it from the list). It has two tabs: **Settings** and **Dining tables**.

Branches are your cafe's locations. They share one menu, one staff list and the same customers; each branch has its own opening hours, dining tables, counter and orders. A different business (another owner, brand or menu) is a separate cafe, set up by the platform team, not a branch.

## Add a branch

1. Press **Add branch**: on the branch's page when the cafe has one branch, or on the **Branches** list when it has more.
2. Enter its **Name** (unique among your branches) and choose its **Time zone** (it starts on your branch's).
3. Press **Add branch**. Its page opens: set its **Weekly hours** (it takes no orders until then) and add its **Dining tables**.
4. Under **Staff**, give managers and staff the new branch. Admins already work at every branch.

A cafe can have up to 10 branches.

## Settings

At the top: whether the branch is open now, its time zone and today's hours. When a manager has paused online orders from the counter, it says **Paused until** a time, with who paused and why; **Resume** takes online orders again at once. Pausing is done at the counter (**Manage → Pause online orders**).

**Branch information:** **Branch name**, **Address**, **Phone**, **Time zone**.

**Phone:** choose the country by its flag (Cambodia, Hong Kong or Argentina), then type the number as you would locally (`012 345 678` is fine). Pasting a full number such as `+852 9123 4567` picks the country for you. A number that isn't valid for the chosen country can't be saved; the message under the field says which country it checked.

**Weekly hours:** customers can place orders only while the branch is open.

1. For each day, switch **Open** on or off.
2. Set when it opens and closes. **Add window** adds another opening on the same day (for example a lunch break: 7:00–11:30 and 13:00–21:00). Up to three per day.
3. A closing time earlier than the opening time runs past midnight; the form notes "Closes the next day".
4. **Copy Monday to weekdays** and **Copy Saturday to weekend** fill the other days.
5. Press **Save changes**. All settings on this tab save together.

If the browser closes or you are signed out before saving, the page offers your changes back next time (**Unsaved changes from** a time): **Restore** puts them back, unsaved; **Discard** throws them away.

Orders close 15 minutes before closing time ("last orders"). The business day runs from 4:00 AM to 4:00 AM, so a night past midnight counts as the day before.

When Explore is enabled, use **Explore map pin** to save the branch latitude and longitude. You can paste a coordinate pair from Google Maps into either field. These coordinates are public. Clearing both fields and saving hides the layout from Explore.

## Dining tables

Each table has a QR code. A customer who scans it orders for that table (dine-in); without it, orders are for pickup.

- **New table**: a **Name** (for example "T1", unique in the branch), an optional **Area** (for example "Terrace") and its **Seats** (how many people sit there, 1 to 20; 2 unless you change it), then **Add table**. Its QR code is ready at once. Changing a table's name, area or seats keeps its QR code.
- **View QR**: shows the code and its link. **Download SVG** (best for printing at any size) or **Download PNG**, print it and put it on the table.
- **Edit**: change the name or area; the QR code stays the same.
- **New QR**: makes a new code and **stops the old one at once**. Use it if a code was copied or misused, then print the new one and replace it on the table.
- **Archive**: the table's QR code stops working until you **Restore** it.
- **⋮ → Delete permanently** (on an archived table, owners only): removes it for good; its QR code never works again. It asks first, and it can't be restored. Only a table **no order was ever placed at** can be deleted; otherwise the action is greyed out ("it has orders") and it stays archived for your order history. Managers archive and restore from the counter, but can't delete.
- Up to 200 tables per branch, archived ones included.

## Studio (the shop layout)

Open **Cafe → Studio** and choose a branch if the cafe has several. **Open Studio** on the branch's **Dining tables** tab opens the same workspace. **2D** and **3D** share the layout and selection. Moving a table on the plan keeps its printed QR code working.

The sidebar on the left has **Back**, the cafe's Studio and the branch, the light/dark switch and **Hide sidebar** (**Show sidebar** at the top left of the plan brings it back, and the plan keeps its zoom and selection). Drag the sidebar's edge to make it wider or narrower (or focus the edge and use the arrow keys); 3D uses the same width. Its panels: **Floors** lists the floors and their objects; **Tables** shows unplaced and placed dining tables; **Assets** has the furniture, table looks, people and pets, with **+** (**New look**) beside its search to create a look; **Manage looks** lists every look. Select a piece or edge to edit it in **Properties** on the right. With nothing selected, Properties shows the floor's settings and **Explore settings**. The toolbar at the bottom has **Select** (V), **Hand** (H), **Draw outline** (P) and **Draw wall** (W), **2D** and **3D**, zoom (click the percentage for **Zoom to selection**, 50 %, 100 % and 200 %) and **Fit to screen**, **Undo** and **Redo**. It works like Figma: scroll or two-finger swipe to move around (Shift+scroll sideways), Ctrl or ⌘ with scroll, or a pinch, to zoom; hold Space and drag, or drag with the middle button, to move around from any tool. **Shift+1** fits the floor, **Shift+2** zooms to the selection, **Shift+0** shows 100 %. Pointing at a piece outlines what a click would pick. Right-click a piece, a wall or an edge for its actions. Press **?** for every shortcut. Keys work without clicking the plan first, but not while you type in a field. On a phone or tablet, the button at the top left opens the sidebar and **Properties** (top right) opens the panel for what's selected.

**Start:** a branch without a layout offers a starting shape: **Blank** (draw your own outline), **Narrow shophouse**, **Wide café** or **Rooftop café** (two floors, an open patio on top). A starter draws only walls, doors and windows; your tables wait in **Unplaced tables**.

**Tables:**

- **Unplaced tables** lists the branch's tables that aren't on the plan. Drag one onto the plan, or press **Place on map** and tap where it goes. **Place at center** is also available. Move it by dragging (hold Shift to keep it in a straight line, Ctrl or ⌘ for 5 cm steps, Alt to leave a copy behind), with the arrow keys (5 cm; Shift+arrow 25 cm), or by typing **X** and **Y** in Properties.
- A **table look** (Round café table, Oak rectangle, booth…) dropped on the plan asks **Which table is this?**: pick an unplaced table, or **New table** to add one.
- Click a table to select it: drag it, turn it with the round handle (15° steps) or **Shift+R** (90°), resize it with a square corner handle (5 cm steps; the opposite corner stays put), and set its position, rotation, size, floor and look in the panel on the right. A typed value applies with **Enter** or when you leave the field; **Escape** leaves it unchanged. Rotation is kept between 0° and 359° (typing 450 gives 90). **Edit table** opens the table's own form (name, area, seats: it saves at once). The icons at the top of the table's panel are **View QR** (its code) and **Remove from map** (back to Unplaced tables).
- Right-click a table for **Rotate 90°**, **Duplicate look** (Ctrl or ⌘+D), **Edit table**, **View QR**, **Zoom to selection** and **Remove from map** (Delete). On a touch screen and on a phone, a small bar under the selected table has the same main actions (icons only on a phone). **Duplicate look** asks **Which table is this?** and puts that table beside this one with the same look, size and turn; it never copies this table or its QR code. For furniture the menu and the bar have **Rotate 90°**, **Duplicate** (a copy beside it, Ctrl or ⌘+D) and **Delete**.
- A table's chairs come from its **Seats**.

**Your own table looks:** **+** beside the Assets search, then **New table look**, opens a form with a live preview: a name, the shape (**Round**, **Rectangle** or **Booth**), the size new tables start with, the base (**Pedestal** or **Four legs**), the chairs, and a finish for each part (tabletop, base, seating). **Save look** adds it to Table looks for every branch of the cafe (up to 50).

- Give a table a look in its panel (**Look**), or drop the look on the plan. **Save as new look** in a table's panel starts a new look from that table's look and gives it to that table.
- The pencil on a look (or **Edit look** in a table's panel) changes it. A look is shared: **every table that uses it changes**, in every branch. Each table keeps its own size and turn. The form says how many tables use it.
- **Delete** (in the look's form) works only when no saved layout uses the look. Give its tables another look and save the layout first.
- The built-in looks (Round café table, Square bistro table, Oak rectangle, Communal table, Green velvet booth) can't be changed or deleted; use **Save as new look** to start from one.
- **Photo** (optional, in the look's form): **Upload photo** of the real piece, framed 4:3. It shows on the look under Table looks, next to **Look** in a table's panel, and on the table's card in 3D. The plan and the 3D building keep the simple shape. **Remove** takes it off. A new look (also **Save as new look**) starts without a photo: each look has its own.
- The built-in looks and pieces show a picture of their 3D model; your own looks show their photo, or a shape icon without one.

**Your own chair and fixture looks:** the same **+** menu has **New chair look**, **New fixture look** and one for each other kind. Each opens a form with a live preview: a name, the **Kind** (Café chair, Bar stool, Service counter, Plant…), the size and **Height** new pieces start with, a finish for each part, and an optional **Photo**. Your looks appear after the built-in pieces, for every branch (up to 50). Stairs have no look of their own.

- Click a placed chair or fixture: its panel has its **Height (cm)** (each kind has its own range, shown under the field: a bar stool from a 45 cm low stool to 90 cm bar height; a plant or planter is measured to the top of its leaves). Its **Look** gives it one of your looks of its kind (it takes the look's finishes, size and height), or **Own finishes** to set its finishes yourself (it keeps the look's finishes as a start). **Save as new look** starts a new look from that piece and gives it to it; **Edit look** changes the look.
- A look is shared like a table look: editing it changes **every piece that uses it**, in every branch; each piece keeps its own size, height and turn. A look's kind can't change: for another kind, make a new look.
- **Delete** works only when no saved layout uses the look. The message names the floors that use it.

**More furniture:** the library also has **Lounge seating** (Armchair, Sofa, Coffee table), **Bar and service** (Coffee station, Pastry case, Menu board), **Decor and lighting** (Pendant lamp, Floor lamp, Water jar) and **Outdoor** (Parasol, Bicycle). Each takes your own looks (**New lounge look**, **New bar look**, **New decor look**, **New outdoor look** in the **+** menu) and a height. A **Pendant lamp**'s height is how low its shade hangs (its cord goes up to the ceiling), and a **Coffee station**'s is its counter's. A pendant lamp and a parasol are drawn as a dashed circle on the plan and never show the overlap warning: put them over a table or the bar.

**People and pets:** the **People and pets** section of the library has a Person, Girl, Boy, Old man, Barista, Seated customer, Someone lazing (in a hammock on its stand), Cat and Dog. Place one like a plant: drag it onto the plan or click it, then move and turn it. They are decoration: no table, QR code or seats, a fixed size, no finishes or looks, and they never show the overlap warning. Put a **Seated customer** on a chair: it sits at chair height. Each figure's clothes and colors come with it and stay the same for everyone.

**Furniture looks page:** the **Looks** button on **Dining tables** (or **Manage looks** in Studio's sidebar, which keeps your unsaved layout) lists every look: table looks, chairs and fixtures, each with **Your looks** and **Built in**. **New look** adds one; click your look's name to edit it; its **⋮** menu has **Edit**, **New look from this** and **Delete** (off while the look is in use). A built-in one's **⋮** has **New look from this**.

**Floors:** the **Floors** panel and the floor picker at the top left of the plan. **+** (**Add floor**) puts a floor on top with the same outline, with its name ready to type: **Enter** keeps your name, **Escape** keeps the suggested one. The search icon (**Find**) finds floors and the named pieces on the floor shown. With nothing selected, **Properties** shows the floor's **name**, **height** (200–800 cm, the wall height in 3D), **roof** (off: an open patio) and **Remove floor…** (it names the tables that go back to Unplaced tables). Up to 10 floors. On an upper floor, **Show floor below** shows the floor underneath faintly, so stairs and walls line up.

**Walls, doors and windows:**

- **Draw outline:** with no outline yet, click on the grid to add corners; click the first corner, double-click or press Enter to close the shape. With an outline, drag a corner (it keeps right angles unless you hold Alt), click a round handle on an edge to add a corner, or click a corner and press Delete to remove it. Click an edge's length to type a new one: **Enter** sets it (the end corner moves, right angles kept), **Escape** leaves it. **Cancel** puts the shape back as it was; **Done** finishes.
- Click an **edge** of the outline to choose what it is: **Wall**, **Railing** or **Open**, and to set its length. **Door** and **Window** add one on that edge; set its width and how far it is from the corner. On a railing a door is a **gate**, and windows need a wall. Right-click an edge (or use the bar under it on a touch screen) for the same: **Wall**, **Railing**, **Open**, **Add a door** (or gate), **Add a window** and **Remove wall** (or railing). **Delete** on a selected edge removes its wall or railing too: the edge becomes **Open** and the floor keeps its shape; **Undo** or **Wall** puts it back.
- **Draw wall** adds walls inside the floor (a stair kiosk, a kitchen): click where it starts and where it ends; walls carry on from the last end until Escape. Click a wall, then press **Delete** (or right-click it for **Delete wall**).

**3D:** the same layout as a small building. Drag to turn it, scroll or pinch to zoom, or use the toolbar's zoom buttons. **Fit building** in the toolbar frames the whole building. **Exterior** shows it from outside; **Cutaway** takes the roof and the near walls away and pulls the floors apart. Pick a floor in **Floors**, then **Enter floor** to stand inside it. To find a table, pick it in **Tables** (on a phone: **Floors and tables**) or tap it in the building: its card shows its area, seats and floor, **View QR** (its code, to scan or download) and **Edit in 2D** (opens the plan with that table selected). Tap a chair, a fixture, the stairs or a person or pet to select it: its card shows what it is, its size and height and its floor, and **Edit in 2D** opens the plan with it selected. A piece selected in 2D is selected in 3D too. A table that is not on the plan is not in 3D. **Unsaved changes shown** means the building includes changes you haven't saved yet. When the layout has people or pets, **People and pets** (top right) has **Show people and pets** and **Animate** (small movements: breathing, a tail, a swaying hammock). These are only for your own screen and are not saved; Animate starts off on a device that draws 3D slowly, and pauses while the tab is hidden.

**Save:** **Save layout** and its recovery actions are available in both 2D and 3D. Every change can be undone (**Undo**, Ctrl/⌘ Z) until you press **Save layout** (top right of the plan or the building; **Unsaved changes** shows next to it). The whole layout saves at once. Leaving the page with unsaved changes asks first.

### Publish the layout in Explore

In **2D**, with nothing selected, open **Explore settings** in **Properties**, choose a ground-floor **Street door**, and turn on **Show in Explore**. Use **Save layout** to publish. The branch needs a saved map pin. Turn the switch off and save the layout to withdraw it.

## Common problems

- **"This layout was changed somewhere else"**: someone saved the layout on another device after you opened it; the message says who and when. Your plan is kept. **Load latest** shows theirs instead (Undo brings yours back on top of it, then save); **Overwrite with mine** saves yours over theirs after asking. QR codes are not affected either way.
- **"… is no longer an active table here"**: a table on your plan was archived or deleted since you opened it. Press **Remove from map**, then save.
- **"3D view is not available here"**: this browser or device can't draw 3D right now. Press **Try again**. On a phone, press **Floors and tables** to choose a table and open **View QR**. You can also return to **Design shop**.
- **"The look of … was deleted"**: a look this plan used was deleted on another device before you saved. Press **Use Round café table**, save, then choose another look.
- **"This look is used by …"**: a look can't be deleted while tables use it. The message names them; give them another look, save the layout, then delete.
- **"The look of a piece (…) was deleted"**: a chair or fixture look this plan used was deleted on another device before you saved. Press **Use own finishes**, save, then choose another look.
- **"This look is used by 3 pieces: …"**: a chair or fixture look can't be deleted while pieces use it. The message names the floors; give those pieces **Own finishes** or another look, save the layout, then delete.
- **"There is already a look named …"** or **"… chair or fixture look named …"**: another look of that type has that name (in any capitals). Choose another name.
- **"Upload the image again"** under a look's photo: the photo can't be used (it was given to another look meanwhile, or uploaded more than a day ago and never saved). Press **Replace photo** and choose it again.
- **"Check placement on …"**: highlighted tables, their chairs, or other pieces overlap or extend outside the floor. You can still save. **Show** selects a piece so you can adjust it.
- **"Draw the … floor's outline first"**: a floor has no outline yet (Blank). Use **Draw outline**, then save.
- **"Closed every day"**: no day is switched on, so nobody can order. Switch on the days it opens.
- **Two times on one day overlap**: the error shows on that time; fix it and save again.
- **"Someone else changed these settings"**: press **Reload**; your input stays. Check it and save again.
- **A customer says the table QR doesn't work**: the table may be archived, or someone pressed **New QR**. Check the table and print its current code.
- **"There is already a table named … in this branch."**
- **"There is already a branch named …"**: another branch uses that name (in any capitals). Choose another name.
- **"A cafe can have at most 10 branches."**: **Add branch** is off at 10 branches.
