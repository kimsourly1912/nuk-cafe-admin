import type { CreateTelegramLinkInput, NewTelegramLink, TelegramDestination, TelegramLink, TelegramOverview } from '#shared/contracts/notifications'

/** The Telegram page's data (`/api/admin/telegram`, D112): whether it's set up, and the chats. */
export function useTelegramOverview() {
  return useApiQuery('telegram:overview', () => apiFetch<TelegramOverview>('/admin/telegram'))
}

export const fetchLink = (id: string) => apiFetch<TelegramLink>(`/admin/telegram/links/${id}`)

export function useTelegramMutations() {
  const createLink = useMutation(
    (input: CreateTelegramLinkInput) => apiFetch<NewTelegramLink>('/admin/telegram/links', { method: 'POST', body: input }),
    { id: 'telegram:create-link', key: input => input.kind, successMessage: false, errorMessage: 'Could not make a Telegram link' },
  )
  const confirmLink = useMutation(
    (link: Pick<TelegramLink, 'id'>) => apiFetch<TelegramDestination>(`/admin/telegram/links/${link.id}/confirm`, { method: 'POST' }),
    {
      id: 'telegram:confirm-link',
      key: link => link.id,
      successMessage: destination => `${destination.title} is connected`,
      errorMessage: 'Could not connect the group',
      // The Send dialog lists the chats too.
      invalidate: ['telegram', 'reports'],
    },
  )
  const cancelLink = useMutation(
    (link: Pick<TelegramLink, 'id'>) => apiFetch<TelegramLink>(`/admin/telegram/links/${link.id}/cancel`, { method: 'POST' }),
    { id: 'telegram:cancel-link', key: link => link.id, successMessage: false, errorMessage: 'Could not cancel the link' },
  )
  const sendTest = useMutation(
    (destination: TelegramDestination) => apiFetch<TelegramDestination>(`/admin/telegram/destinations/${destination.id}/test`, { method: 'POST' }),
    {
      id: 'telegram:test',
      key: d => d.id,
      lock: d => `telegram-destination:${d.id}`,
      successMessage: (_, d) => `Test sent to ${d.title}`,
      errorMessage: 'Could not send the test',
      invalidate: ['telegram'],
    },
  )
  const disconnect = useMutation(
    (destination: TelegramDestination) => apiFetch<null>(`/admin/telegram/destinations/${destination.id}/disconnect`, { method: 'POST', body: { version: destination.version } }),
    {
      id: 'telegram:disconnect',
      key: d => d.id,
      lock: d => `telegram-destination:${d.id}`,
      confirm: d => ({
        title: `Stop sending to ${d.title}?`,
        description: d.kind === 'group'
          ? 'Nothing more is sent there, and the bot leaves the group. You can connect it again later.'
          : 'Nothing more is sent there. You can connect it again later.',
        confirmLabel: 'Disconnect',
        danger: true,
      }),
      successMessage: (_, d) => `${d.title} is disconnected`,
      errorMessage: 'Could not disconnect',
      removes: true,
      invalidate: ['telegram', 'reports'],
    },
  )
  const isBusy = (id: string) => sendTest.isPending(id) || disconnect.isPending(id)
  return { createLink, confirmLink, cancelLink, sendTest, disconnect, isBusy }
}
