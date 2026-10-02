# Telegram

**Admin → Telegram** connects Telegram chats the cafe's messages go to: your **private chat** (for reports you send, and the closing summary) and a **staff group** (for new orders). Every admin sees every connected chat.

## Connect your private chat

1. Press **Connect Telegram**. A dialog opens with **Open in Telegram**.
2. Press **Open in Telegram**, then **Start** in the chat with the cafe's bot.
3. Come back to the portal: it says the chat is connected by itself.

The link works once, for 10 minutes. If it expired, press **New link**.

## Connect a staff group

1. Press **Connect a group**, then **Open in Telegram**, and choose your staff group.
2. Telegram asks to add the bot to the group: accept. Only an **admin of that group** can do this; anyone else gets "Only an admin of this group can connect it".
3. Back in the portal, check the group's name and member count, then press **Connect**. **Cancel** doesn't connect it, and the bot leaves the group.

Everyone in the group sees what's sent there.

## Connected chats

Each chat shows **Connected** or **Blocked**, and when something was last sent.

- **Send test** sends a short message, to check the chat works.
- **Disconnect** (in **⋯**) stops sending there; the bot leaves a group. It asks first. You can connect the chat again later.
- **Blocked** means the bot was removed from the group, or blocked in the private chat. Nothing is delivered there until you press **Reconnect** and connect it again.

## Notifications

Under **Notifications**, choose which chats get each message; a switch saves at once.

- **New orders**: when a customer places an order, before it's paid: the items with their options, notes and the total, with an **Open order** button that opens it in the counter app.
- **Payment confirmed**: when the counter takes the payment.
- **Closing summary**: the day's figures (paid sales, orders, average, refunds, payments, top items), **30 minutes after closing time**, for that business day. Nothing is sent on a day the branch is closed. **Attach CSV** adds the day's file as a second message. Sent to a group, everyone there sees the sales.

### Server errors and reminders

**Server errors and reminders** sends a short alert when the app fails unexpectedly (a customer or staff member sees "Something went wrong on our side"). It says which page failed and a request id: give that id to whoever maintains the app, who finds the details in the server logs. The same page failing again within 15 minutes isn't sent again. Turn it on for your private chat rather than the staff group. The same switch sends reminders before the Bakong token expires (14, 7, 3 and 1 days before, and on the day), with an **Open Payments** button.

## Delivery history

The latest 50 messages sent to Telegram, with the time, what, to which chat and how it went:

- **Sent**.
- **Retrying at 9:05**: Telegram didn't take it; it's tried again automatically (for a few hours). There's no Retry button then, so it can't be sent twice.
- **Failed**: it stopped trying (after 8 tries, or the chat is blocked), with the reason. Press **Retry** to send the same message again (reconnect a blocked chat first).
- **View** shows the message as it was saved. A closing summary keeps the figures of the moment it was made.

## Common problems

- **"Telegram isn't set up for this app yet."**: the bot's token and settings aren't on the server yet. Whoever runs the server adds them (see the Telegram setup guide); until then the buttons are off.
- **"This link doesn't work anymore."** (in Telegram or the portal): the link expired after 10 minutes, was used already, or was cancelled. Make a new one.
- **"Telegram asks to wait … seconds."**: Telegram limits how fast a bot sends. Try again after that time.
- **No closing summary arrived**: check the chat has **Closing summary** on, the branch had opening hours that day (Branch → hours), and the delivery history.
- **A message arrived twice**: rare; if Telegram's answer is lost after it accepted a message, the retry can repeat it.
