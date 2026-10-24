# Options

**Menu → Options** is the library of **option sets**: choices that make versions of a menu item, like **Size** (Small, Medium, Large) or **Temperature** (Hot, Iced). A set holds names only; each menu item sets its own price for each version.

Each card shows the set's values and which menu items use it. Tabs **All**, **Active**, **Archived**; the search finds sets by their name or a value's name.

## Create an option set

1. Press **New option set** (or **N**).
2. **Option set name**, for example "Size".
3. **Values**: type each value (for example "Small"), add more, and order them with the up and down buttons. At most 20.
4. Press **Create**.
5. Use it on a menu item: open the item, **Options and prices → Add option set**, then set a price per version.

## Edit a set

Press **Edit** on its card. The editor saves each change at once and shows "Saving…" / "Saved".

- **Add value**: type the name, press **Add**.
- **Rename**: from a value's menu, or **Edit name** for the set itself.
- **Reorder**: move values up or down; the new order saves itself.
- **Archive** a value: menu-item versions that use it are hidden from customers until you restore it. A set needs at least one active value.
- **Delete** an archived value for good: the bin button beside its **Restore** (under **Archived values**). It asks first, and it can't be restored. Only a value **no menu-item version uses** can go, including archived items and versions an item no longer offers; otherwise the button is greyed out.

## Archive, restore or delete a set

- **Archive option set** (in the editor or the card's ⋮ menu): items that already use it keep it, but it can't be added to other items.
- **Restore option set** brings it back.
- **⋮ → Delete permanently** (on an archived set's card): removes the set and its values for good. It asks first, and it can't be restored. Only a set that **no menu item uses**, archived ones too, and none of whose values a menu-item version uses, can be deleted; otherwise the action is greyed out and says so. Remove the set from those items, or delete them, first.

## Common problems

- **"There is already an option set named …"** / **"This set already has a value named …"**: names must be unique.
- **"An option set needs at least one value. Archive the set instead."**
- **"An option set can have at most 20 active values."**
- **"Menu items still use this option set or its values (archived ones count too)."**: delete is blocked while any item, archived or not, uses the set or kept versions of its values.
- **A new value doesn't appear on the customer menu**: items that use the set don't sell a new value until you open each item, switch on the new versions (they start off) and give them a price, then save.
- **"The values of this option set changed. Reload it and try again."**: someone else edited it; press **Reload**.
