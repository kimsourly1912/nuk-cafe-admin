# The counter app and how orders work

Branch staff, managers and admins use the **counter app** at `/counter` (its own sign-in, `/counter/sign-in`) on the counter's tablet or computer. The admin portal doesn't take orders or payments.

## An order's journey

1. A customer orders on the cafe's website: **pickup**, or **dine-in** by scanning a table's QR code. No account is needed: a customer without one gives a first name, shown on the order (an account shows its own name). Each order gets a 3-digit number for the day.
2. The order waits in **To pay**. The customer pays at the counter within **30 minutes**, or the order is cancelled automatically. A customer can have at most 2 unpaid orders at a time, and can cancel their own order while it's unpaid.
3. The cashier takes payment, and the order moves to **Preparing**.
4. When it's made, **Mark ready**: it moves to **Ready**. A customer who asked for it on their order page gets a Telegram message saying it's ready.
5. When the customer has it, **Complete**.

## The queue

- After sign-in, choose the branch (it opens straight away when you work at only one).
- Three columns, **To pay**, **Preparing**, **Ready** (tabs with counts on a phone). Each card shows the number, pickup or table, the customer's first name, the items, the total and how long ago it was placed. "Pay by" turns amber in the last 5 minutes.
- New orders are marked **New** for a minute with a chime. Mute the chime in the user menu.
- Someone who works at more than one cafe finds **Another cafe** in the user menu: it opens **Your cafes**, where each cafe's counter (and admin, for an owner) opens fresh.
- Search by order number or name.
- Click a card to open the order and its one next action.
- The browser tab shows how many orders wait for payment, for example **(2) Queue**, so you see them while another tab is open.
- The screen stays on while the counter is open, so the tablet doesn't go dark between customers. (A tablet in battery saver may still turn it off.)
- If the connection drops, the cards stay and a notice says **The queue may be out of date** with the time it last loaded. New orders appear again once the connection is back; it keeps trying every 10 seconds. After 2 minutes the notice turns red (**The queue isn't updating: check the connection**), the tab shows ⚠ and a warning sound plays once.
- After the page loads, the browser keeps sound off until someone taps the screen. The counter says **Sound is off until you tap the screen**: press **Turn on sound** (or tap anywhere) so the new-order chime plays.
- Swiping down or sideways doesn't reload or leave the counter.
- After the app is updated, a notice says **A new version of the app is ready**. Press **Reload** when you have a moment, or **Later**: it updates by itself the next time you open another page.

## Take payment

1. Open the order in **To pay** and press **Take payment**.
2. Choose the **Payment method**:
   - **Cash USD**: enter **Amount received (USD)** (or tap a quick amount, or **Exact**). The change to give back shows, or how much is short.
   - **Cash riel**: the total in riel at the rate set on Admin → Payments, rounded up to ៛100. Enter **Amount received (៛)**.
   - **KHQR**: when an admin has set it up, a QR for this order appears with the amount, "Order 042" and the minutes left; with dollars and riel both offered, choose **US dollars** or **Riel**. The customer scans it with their banking app. Once it expires, press **New QR**. Otherwise, ask the customer to scan the counter's printed KHQR and pay the total. Either way, confirm only after the payment appears in your bank app. **Transaction reference** is optional. When the automatic check with Bakong is on, the panel says **Waiting for the payment** under the QR: once the customer pays, the payment is recorded by itself and the panel closes ("Order 042 paid"). You can still confirm by hand.
3. Press **Confirm payment**. The order moves to Preparing.

If another cashier pays or moves the order while you have it open, the panel says so (for example "Paid meanwhile by Sophea") and shows the next step only after you press **OK**.

## Cancel an order

1. Open it and press **Cancel order**.
2. Choose the reason: **The customer changed their mind**, **An item isn't available**, or **Other** (then say what happened).
3. If it was already paid: give the full payment back, and choose how the money went back (**Cash** or **KHQR**).
4. Press the red cancel button. **Keep order** closes without cancelling.

A ready or completed order can't be cancelled.

## Finished today

Switch from **Queue** to **Finished today (24)** at the top to see today's orders that are already completed or cancelled, newest first. Today means the cafe's business day, which starts at 4:00 AM.

- Search by order number or name, and use **All**, **Completed** or **Cancelled**.
- Each row shows when it finished, pickup or table, the customer's first name, the items, the total and how it was paid ("Cash USD · Returned" when the money went back, "Unpaid" when it was never paid).
- Click the order number (tap the row on a phone) to see its items, why it was cancelled (with the staff's note and who returned the money), and a timeline of every step with who did it.
- It's read only: nothing here changes an order. Older days are in the admin's **Reports → Order history**.
- Telegram's **Open order** on an order that has already finished opens it here.

## Sold out

The counter's **Sold out** page (`/counter/<branch>/sold-out`) switches individual versions sold out at this branch, for example "Iced Latte · Large". Customers see "Sold out" and can't order it. It stays sold out until staff switch it back. Each row says since when and who marked it. The switch moves as soon as you tap it; if the change can't be saved (the connection dropped), it moves back and a message says why. To remove an item from the menu for good, an admin unpublishes or archives it in **Menu items** instead.

## Manage (managers and admins)

Managers (and admins) have a **Manage** button in the counter's header, for the branch the counter is open at. Staff don't see it.

- **Dining tables**: the branch's tables and their QR codes, as on Admin → Branch → Dining tables: **New table**, edit a table's name or area, **View QR** to print or download it, **New QR** (the printed one stops working), archive and restore.
- **Reports**: the branch's **Summary**, **Sales by item** and **Order history**, with **Print**. Choose the period at the top. Download CSV and Send to Telegram are on the admin's Reports only.

- **Pause online orders…**: stops customers ordering online for **15 minutes**, **30 minutes**, **1 hour** or **until closing**, with an optional reason (only staff see it). Orders already placed carry on, and ordering starts again by itself at the end. While paused the header says **Paused** and the queue shows **Online orders paused until …** with who paused it and why; **Resume now** (or **Manage → Resume online orders**) ends it at once. A closed branch can't be paused.

A manager at two branches sees each branch's tools when the counter is open at that branch. Opening hours are changed by an admin, on Admin → Branch.

## Install the counter as an app

The counter can be installed on the tablet like an app: it opens from its own icon, full screen, without the browser's address bar or tabs, so it can't be closed by accident. Open the counter in the browser and choose **Install app** in the user menu (your initials, top right): it shows the steps for your device, or installs at once where the browser allows it. The steps are:

- **Android tablet or phone (Chrome):** the browser menu (⋮) → **Install app** (or **Add to Home screen**).
- **iPad or iPhone (Safari):** the Share button → **Add to Home Screen**.
- **Computer (Chrome or Edge):** the install icon at the end of the address bar, or the menu → **Install**.

The app is named after the cafe ("<cafe> Counter") with a coffee cup icon, and opens at the counter. Everything works as in the browser: sign-in, the chime (tap the screen once after it opens), keeping the screen on. It still needs the internet: without a connection nothing can be saved. The admin installs the same way from any admin page ("<cafe> Admin"): the counter and the admin are separate apps, and so is each cafe's, so one phone or tablet can have several. Your cafes and the account pages open inside the app with a thin address bar; ✕ goes back. After the cafe's web address changes, install it again.

## Common problems at the counter

- **"Order 042 changed meanwhile: it's … now."**: another cashier or the customer acted first. Press **Reload**.
- **"The 30 minutes to pay are over, so this order is cancelled."**: the customer can place a new order.
- **"No riel rate is set yet."**: an admin sets it on **Payments**; take dollars or KHQR meanwhile.
- **A payment failed with "Try again"**: press **Try again**. It never charges twice; the same payment is recorded once.
- **"A payment arrived on this QR that doesn't match it"**: Bakong says money arrived on this order's QR, but not the amount (or currency, or account) the QR asked for. Nothing was recorded: check your bank app, and settle it with the customer before confirming.
- **"A KHQR payment arrived after it was paid / cancelled"**: the customer paid the QR, but the order had already been paid another way or was cancelled. Give the money back to the customer.
- **"Automatic check unavailable"**: Bakong didn't answer, or didn't accept the cafe's token. Confirm after the payment appears in your bank app, and tell an admin if it keeps happening.
