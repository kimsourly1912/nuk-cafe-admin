# Payments

**Admin → Payments** sets up **KHQR at the counter** and the **riel exchange rate**, used when a customer pays cash in riel (or a KHQR in riel) at the counter. Prices are in US dollars; the counter converts the total at this rate and rounds it up to the next ៛100.

## KHQR at the counter

Once it's on, the counter shows a QR made for each order: the customer scans it with any Cambodian banking app, and the total and the order number are already in it. The money goes straight to the cafe's Bakong account.

1. Under **KHQR at the counter**, turn on **Show a KHQR for each order at the counter**.
2. Enter the **Bakong account ID** (it looks like name@bank, for example nukcafe@aclb; it's in your Bakong or banking app), the **Name customers see** (Latin letters, at most 25) and the **City**.
3. Choose the **Currencies**: US dollars, riel, or both (the cashier then picks for each order). Riel uses the rate below, rounded up to ៛100.
4. Press **Save KHQR settings**. The first time in 15 minutes, **Confirm it's you** asks for your password: it protects where the cafe's money goes. Saving, adding, replacing or removing the Bakong token asks the same way.

Turned off (or not filled in), the counter asks customers to scan its printed KHQR, as before.

### Automatic check with Bakong

Under the KHQR settings, **Automatic check with Bakong** says **On** or **Off**. On, the counter records a KHQR payment by itself as soon as Bakong confirms it was paid to the cafe's account, in the right amount: the cashier doesn't have to press Confirm. Cashiers can still confirm by hand.

- To turn it on, press **Add token** and paste the cafe's Bakong token from Bakong's developer portal (api-bakong.nbc.gov.kh). It's stored encrypted and never shown again; the page shows when it expires and who saved it. **Replace token** puts in a new one; **Remove token** turns the check off.
- "Tokens can't be saved on this server yet": the platform team sets up the server's encryption key first.
- **Test connection** asks Bakong once and says whether it answered.
- Bakong's token lasts 90 days. The page shows when it expires ("Token expires 21 Dec 2026 · 80 days left"), in amber from 14 days before and red once expired, and Telegram reminds the chats with **Server errors and reminders** on 14, 7, 3 and 1 days before and on the day. Before then, get a new token from Bakong's developer portal and press **Replace token**. Once expired, cashiers confirm by hand until a new one is set.
- **"The saved token can't be read on this server any more"**: press **Replace token** and paste the token again.
- **"Bakong refused this server"**: Bakong may answer only servers in Cambodia. Cashiers confirm by hand until that's solved.

### KHQR payments to review (owners only)

With the automatic check on, the server keeps asking Bakong about every QR for 24 hours after it expires, even when the counter's tablet was closed or the page was reloaded. If the customer paid and the order is still waiting for payment, the payment is recorded by itself (the order's history says "Paid by KHQR: found by the automatic check").

If the money arrived but the order couldn't take it, the cafe's **owners** see it under **KHQR payments to review** at the top of Payments (managers and staff don't, and nor does platform support):

- **Paid twice**: the order was already paid another way (cash, or a KHQR in the other currency).
- **Paid after the order was cancelled**: for example after its 30 minutes to pay were over.
- **Paid a different amount than the QR asked.**

Each shows the order, the branch, what arrived and when, and who found it (a counter, or the automatic check).

1. Give the money back to the customer (cash at the counter, or a KHQR transfer from your banking app). Nothing is sent from this page.
2. Press **Record return**, choose **Cash** or **KHQR**, the currency and the amount given back (it starts at what arrived), **When**, the transfer's **Reference** if there is one, and a **Note** saying why and how (who handed it back, for example).
3. Press **Record return**. It moves to **Recently returned**, with who recorded it.

"**N QRs couldn't be checked with Bakong in the last 30 days**": Bakong didn't answer for them (no token, an expired one, or refused), so a payment on them may not show here. Check your bank app for those days.

"**This payment to review was changed by someone else**": another owner recorded it first. Press **Reload**.

## Set or change the rate

1. Enter **Riel per $1**, for example 4100. It must be between 1,000 and 10,000.
2. Press **Save rate**.

The new rate applies at once to every payment taken after it. The page shows who set the current rate and when, and a **Rate history** of the latest 20 rates (the current one marked **Current**).

Example: at 4,100 riel per dollar, a $4.30 order is ៛17,630, rounded up to **៛17,700**.

## Common problems

- **"Confirm it's you"**: enter the password you sign in with, then **Confirm**: the change goes through. You aren't asked again for 15 minutes on this device. **Cancel** changes nothing. After 5 wrong passwords in a row you're signed out: sign in again.
- **"No rate yet" / "No riel rate is set yet"**: the counter can't take cash in riel until an admin sets a rate. Meanwhile it can take dollars or KHQR.
- **"The riel rate changed to … per dollar. Check the new amount and confirm again."** (at the counter): the rate changed while the cashier had the payment open. They check the new riel amount and confirm again.
- **"Someone else saved the KHQR settings meanwhile."**: another admin saved first. Press **Reload**: what you typed stays; check it and save again.
- **"A Bakong account ID looks like name@bank"** or **"Latin letters, digits and simple punctuation only"**: the QR can only carry an ID like name@bank and a name in Latin letters.
