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

## Common problems

- **"Telegram isn't set up for this app yet."**: the bot's token and settings aren't on the server yet. Whoever runs the server adds them (see the Telegram setup guide); until then the buttons are off.
- **"This link doesn't work anymore."** (in Telegram or the portal): the link expired after 10 minutes, was used already, or was cancelled. Make a new one.
- **"Telegram asks to wait … seconds."**: Telegram limits how fast a bot sends. Try again after that time.
