# Payments

**Admin → Payments** sets up **KHQR at the counter** and the **riel exchange rate**, used when a customer pays cash in riel (or a KHQR in riel) at the counter. Prices are in US dollars; the counter converts the total at this rate and rounds it up to the next ៛100.

## KHQR at the counter

Once it's on, the counter shows a QR made for each order: the customer scans it with any Cambodian banking app, and the total and the order number are already in it. The money goes straight to the cafe's Bakong account.

1. Under **KHQR at the counter**, turn on **Show a KHQR for each order at the counter**.
2. Enter the **Bakong account ID** (it looks like name@bank, for example nukcafe@aclb; it's in your Bakong or banking app), the **Name customers see** (Latin letters, at most 25) and the **City**.
3. Choose the **Currencies**: US dollars, riel, or both (the cashier then picks for each order). Riel uses the rate below, rounded up to ៛100.
4. Press **Save KHQR settings**.

Turned off (or not filled in), the counter asks customers to scan its printed KHQR, as before.

### Automatic check with Bakong

Under the KHQR settings, **Automatic check with Bakong** says **On** or **Off**. On, the counter records a KHQR payment by itself as soon as Bakong confirms it was paid to the cafe's account, in the right amount: the cashier doesn't have to press Confirm. Cashiers can still confirm by hand.

- It's turned on by the owner, who sets the Bakong token (from Bakong's developer portal) as a server secret. It isn't entered on this page.
- **Test connection** asks Bakong once and says whether it answered.
- Bakong's token lasts 90 days. The page shows when it expires ("Token expires 21 Dec 2026 · 80 days left"), in amber from 14 days before and red once expired, and Telegram reminds the chats with **Server errors and reminders** on 14, 7, 3 and 1 days before and on the day. Before then, the owner gets a new token from Bakong's developer portal and replaces the secret. Once expired, cashiers confirm by hand until a new one is set.
- **"Bakong refused this server"**: Bakong may answer only servers in Cambodia. Cashiers confirm by hand until that's solved.

## Set or change the rate

1. Enter **Riel per $1**, for example 4100. It must be between 1,000 and 10,000.
2. Press **Save rate**.

The new rate applies at once to every payment taken after it. The page shows who set the current rate and when, and a **Rate history** of the latest 20 rates (the current one marked **Current**).

Example: at 4,100 riel per dollar, a $4.30 order is ៛17,630, rounded up to **៛17,700**.

## Common problems

- **"No rate yet" / "No riel rate is set yet"**: the counter can't take cash in riel until an admin sets a rate. Meanwhile it can take dollars or KHQR.
- **"The riel rate changed to … per dollar. Check the new amount and confirm again."** (at the counter): the rate changed while the cashier had the payment open. They check the new riel amount and confirm again.
- **"Someone else saved the KHQR settings meanwhile."**: another admin saved first. Press **Reload**: what you typed stays; check it and save again.
- **"A Bakong account ID looks like name@bank"** or **"Latin letters, digits and simple punctuation only"**: the QR can only carry an ID like name@bank and a name in Latin letters.
