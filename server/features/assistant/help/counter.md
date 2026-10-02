# The counter app and how orders work

Branch staff, managers and admins use the **counter app** at `/counter` (its own sign-in, `/counter/sign-in`) on the counter's tablet or computer. The admin portal doesn't take orders or payments.

## An order's journey

1. A customer orders on the cafe's website: **pickup**, or **dine-in** by scanning a table's QR code. They need an account with a verified email. Each order gets a 3-digit number for the day.
2. The order waits in **To pay**. The customer pays at the counter within **30 minutes**, or the order is cancelled automatically. A customer can have at most 2 unpaid orders at a time, and can cancel their own order while it's unpaid.
3. The cashier takes payment, and the order moves to **Preparing**.
4. When it's made, **Mark ready**: it moves to **Ready**.
5. When the customer has it, **Complete**.

## The queue

- After sign-in, choose the branch (it opens straight away when you work at only one).
- Three columns, **To pay**, **Preparing**, **Ready** (tabs with counts on a phone). Each card shows the number, pickup or table, the customer's first name, the items, the total and how long ago it was placed. "Pay by" turns amber in the last 5 minutes.
- New orders are marked **New** for a minute with a chime. Mute the chime in the user menu.
- Search by order number or name.
- Click a card to open the order and its one next action.

## Take payment

1. Open the order in **To pay** and press **Take payment**.
2. Choose the **Payment method**:
   - **Cash USD**: enter **Amount received (USD)** (or tap a quick amount, or **Exact**). The change to give back shows, or how much is short.
   - **Cash riel**: the total in riel at the rate set on Admin → Payments, rounded up to ៛100. Enter **Amount received (៛)**.
   - **KHQR**: when an admin has set it up, a QR for this order appears with the amount, "Order 042" and the minutes left; with dollars and riel both offered, choose **US dollars** or **Riel**. The customer scans it with their banking app. Once it expires, press **New QR**. Otherwise, ask the customer to scan the counter's printed KHQR and pay the total. Either way, confirm only after the payment appears in your bank app. **Transaction reference** is optional.
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

The counter's **Sold out** page (`/counter/<branch>/sold-out`) switches individual versions sold out at this branch, for example "Iced Latte · Large". Customers see "Sold out" and can't order it. It stays sold out until staff switch it back. Each row says since when and who marked it. To remove an item from the menu for good, an admin unpublishes or archives it in **Menu items** instead.

## Common problems at the counter

- **"Order 042 changed meanwhile: it's … now."**: another cashier or the customer acted first. Press **Reload**.
- **"The 30 minutes to pay are over, so this order is cancelled."**: the customer can place a new order.
- **"No riel rate is set yet."**: an admin sets it on **Payments**; take dollars or KHQR meanwhile.
- **A payment failed with "Try again"**: press **Try again**. It never charges twice; the same payment is recorded once.
