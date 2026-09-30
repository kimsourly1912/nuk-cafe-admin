# How the menu fits together

The menu is built from five pages under **Menu** in the sidebar:

| Page | What it holds |
|---|---|
| **Menu items** | What customers order: name, photo, category, prices, add-ons, availability. |
| **Categories** | The menu's sections: main categories and their subcategories (two levels). |
| **Options** | Shared choices that make versions of an item, like Size (Small, Large) or Temperature (Hot, Iced). Names only; each item sets its own prices. |
| **Add-ons** | Shared extras a customer can add, like milk or syrups, in groups with rules (for example "choose up to 2") and default prices. |
| **Availability** | Weekly time rules, like "Breakfast: 7:00–11:00 every day", to limit when items or categories are sold. |

Set up the libraries first (Categories, then Options, Add-ons and Availability as needed), then create menu items that use them.

## When does a customer see an item?

An item is on the customer menu when all of these are true:

1. The item is **Published** (not Draft or Archived).
2. Its category is **Active**, not archived (archiving a main category archives its subcategories too).
3. At least one of its versions is switched on and has a price, and doesn't use an archived option value.
4. Its availability rules allow the current time, and so do its category's and main category's rules. No rule means "whenever the branch is open". Outside its times the item is hidden.

If a customer can't see an item, check these in order.

Two more things affect ordering, not whether the item is listed:

- **Sold out**: staff mark versions sold out in the counter app's **Sold out** page. Customers see "Sold out" and can't add it. It stays until staff switch it back.
- **Branch closed**: outside the branch's weekly hours (Branch → Settings) the menu shows a closed notice with the next opening time, and nobody can place an order.

## Words used on these pages

- **Version**: one combination of an item's options, like "Iced / Large". Each version has its own price and on/off switch.
- **Draft**: saved but not on the customer menu. New items start as drafts.
- **Archived**: hidden from customers and read-only until restored. Past orders keep it.
- **Used by N items**: library pages show which menu items use a set, group or rule. You change those links from the menu item, not from the library.
