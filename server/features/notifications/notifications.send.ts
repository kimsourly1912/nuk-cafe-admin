import type { Api } from 'grammy'
import { InputFile } from 'grammy'
import type { StoredMessage } from './notifications.schema'

/** Sends a saved message: the text (with its link button), then its file. */
export async function sendStored(api: Api, chatId: string, message: StoredMessage): Promise<void> {
  if (message.html) {
    await api.sendMessage(chatId, message.html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: message.button ? { inline_keyboard: [[{ text: message.button.text, url: message.button.url }]] } : undefined,
    })
  }
  if (message.document) {
    await api.sendDocument(chatId, new InputFile(new TextEncoder().encode(message.document.content), message.document.filename))
  }
}
