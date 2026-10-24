# Availability

**Menu → Availability** holds weekly time rules that limit when menu items are sold, like "Breakfast: 7:00 AM – 11:00 AM every day" or "Happy hour: weekdays 2:00 PM – 5:00 PM". Each card shows the rule's days and times and how many items and categories use it. Tabs **All**, **Active**, **Archived**; search by name.

## How rules apply

- An item with **no rule** is sold whenever the branch is open.
- An item with **several rules** is sold when **any** of them allows the time.
- A **category's** rules apply to every item in it, on top of the item's own rules: the item is sold only when both allow it.
- Outside its times, the item is hidden from the customer menu.
- Times use the cafe's time zone. A rule never extends the branch's opening hours: the branch must also be open.

## Create a rule

1. Press **New rule** (or **N**).
2. **Rule name**, for example "Breakfast".
3. **Weekly times**: for each time, tick the days (or use **Weekdays**, **Weekend**, **Every day**, **Clear**) and set **From** and **Until**.
4. **Add another time** for a different time on other days (for example later on weekends).
5. Check the **Weekly schedule** preview, then press **Create**.
6. Use it: open a menu item (**Availability**) or a category (**Availability**) and choose the rule.

**Overnight**: if **Until** is earlier than **From** (for example 9:00 PM to 1:00 AM), the time continues into the next day; the form notes "next day".

## Edit, archive, restore, delete

- **Manage** on a card opens the rule. Change it and **Save**. Items using it follow the new times at once.
- **⋮ → Archive**: only when nothing uses it. Remove it from its items and categories first; the card lists them.
- **Restore** on an archived rule.
- **⋮ → Delete permanently** (on an archived rule): removes it and its times for good. It asks first, and it can't be restored. Only a rule that **no menu item or category uses**, archived ones too, can be deleted: an archived item keeps its rules, and would sell at any hour if it came back without them. Otherwise the action is greyed out and says what still uses it: remove the rule from those (restore, edit, archive again) or delete them first.

## Common problems

- **"This rule is used by …. Remove it from them first."**: archive is blocked while items or categories use the rule.
- **"Menu items still use this availability rule (archived ones count too)."**: delete is blocked while any item or category, archived or not, still has the rule.
- **Two times overlap on the same day**: the error shows on the row; change the times or days so they don't overlap.
- **"There is already an availability rule named …"**
- **An item disappeared at a certain time**: check its rules and its category's rules here.
