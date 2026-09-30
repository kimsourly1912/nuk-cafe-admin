# Categories

**Menu → Categories** holds the menu's sections as a tree with two levels: **main categories** (like "Coffee") and their **subcategories** (like "Hot coffee", "Iced coffee"). The customer menu shows a section per main category and a sub-section per subcategory, in this order.

**The one rule:** menu items go in a category that has **no subcategories**. A main category holds either menu items or subcategories, never both.

Tabs **All**, **Active**, **Archived** filter the tree; the search finds categories by name or description. Each row says what it holds (subcategories or items).

## Create a category

1. Press **New category** (or **N**).
2. **Name** (required; unique at its level).
3. **Parent category**: leave **None (main category)** for a main category, or choose a main category to make a subcategory.
4. **Description** (optional).
5. **Availability** (optional): rules that apply to every item in it. Items can add their own rules too.
6. Press **Create**.

Shortcut: **Add subcategory** on a main category's row opens the form with that parent chosen. It isn't offered on a main category that already holds menu items.

## Turn a category with items into one with subcategories

A category with menu items can't get subcategories, so its items move out first. For example, to split "Coffee" into "Hot coffee" and "Iced coffee":

1. Create a temporary main category, for example "Coffee (moving)".
2. In **Menu items**, filter by Coffee, open each item and change its **Category** to "Coffee (moving)".
3. When Coffee holds no items, use **Add subcategory** on it to create "Hot coffee" and "Iced coffee".
4. Move each item into its new subcategory the same way.
5. Archive "Coffee (moving)".

Published items stay on the customer menu the whole time, under the temporary category while they're there.

## Change the order

1. Press **Reorder** (or **R**).
2. Drag rows by the handle, or use **Move up** / **Move down**. Subcategories move within their main category.
3. Press **Save order**, or **Discard** to cancel.

## Archive and restore

- **⋮ → Archive**: customers stop seeing it and its items. The items stay and come back with it. Archiving a main category also archives its active subcategories.
- **Restore**: brings it back at the end of its level. Restoring a main category asks whether to restore its subcategories too.
- A subcategory can't be restored while its main category is archived: restore the main category first.
- Several at once: **Select** (or **S**), tick rows, then **Archive selected** or **Restore selected**.

## Common problems

- **"That category has menu items. Move them to a sub-category first, or pick another parent."**: see "Turn a category with items into one with subcategories" above.
- **"There is already a category named … here."**: names are unique among categories with the same parent.
- **"Its parent category is archived. Restore the parent first."**
- **"These categories were changed by someone else."** (when saving the order): press **Reload**. Your order stays on screen; check it and save again.
