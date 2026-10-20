// Public API of the notifications feature (Telegram, step 8.1c, D112).
export { cancelLink, confirmLink, createLink, disconnectDestination, getLink, handleUpdate, listDestinations, sendReport, sendTestMessage, telegramOverview } from './notifications.service'
export type { OutgoingMessage } from './notifications.service'
export { escapeHtml, secretMatches } from './notifications.rules'
export { telegramOff } from './notifications.errors'
export { telegramSettingsFrom } from './notifications.settings'
export type { TelegramSettings } from './notifications.settings'
export { deliverDue, deliverySnapshot, listDeliveries, oldestDueNotification, purgeDeliveries, queueClosingSummaries, queueBakongTokenReminder, queueJobFailureAlert, queueOrderAlert, queueServerErrorAlert, queueSupportOpenedAlert, retryDelivery, setNotificationRule, telegramDeliveryHealth } from './notifications.delivery'
export { createOrderReadyLink, deliverOrderReadyDue, orderReadyAlert, purgeOrderReadyAlerts, sendOrderReadyAlert } from './notifications.customers'
