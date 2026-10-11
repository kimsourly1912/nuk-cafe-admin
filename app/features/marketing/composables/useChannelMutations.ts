import type { ChannelLink, MarketingChannel, NewChannelLink } from '#shared/contracts/marketing'

const BASE = '/admin/marketing/channels'

export const fetchChannelLink = (id: string) => apiFetch<ChannelLink>(`${BASE}/links/${id}`)

/** Connecting and disconnecting channels; promotions' dialogs list them, so they refresh too. */
export function useChannelMutations() {
  const createLink = useMutation(
    () => apiFetch<NewChannelLink>(`${BASE}/links`, { method: 'POST' }),
    { id: 'marketing:create-link', successMessage: false, errorMessage: 'Could not make a connect code' },
  )
  const confirmLink = useMutation(
    (link: Pick<ChannelLink, 'id'>) => apiFetch<MarketingChannel>(`${BASE}/links/${link.id}/confirm`, { method: 'POST' }),
    {
      id: 'marketing:confirm-link',
      key: link => link.id,
      successMessage: channel => `${channel.title} is connected`,
      errorMessage: 'Could not connect the channel',
      invalidate: ['marketing', 'promotions'],
    },
  )
  const cancelLink = useMutation(
    (link: Pick<ChannelLink, 'id'>) => apiFetch<ChannelLink>(`${BASE}/links/${link.id}/cancel`, { method: 'POST' }),
    { id: 'marketing:cancel-link', key: link => link.id, successMessage: false, errorMessage: 'Could not cancel the code' },
  )
  const disconnect = useMutation(
    (channel: MarketingChannel) => apiFetch<null>(`${BASE}/${channel.id}/disconnect`, { method: 'POST', body: { version: channel.version } }),
    {
      id: 'marketing:disconnect',
      key: c => c.id,
      lock: c => `marketing-channel:${c.id}`,
      confirm: c => ({
        title: `Disconnect ${c.title}?`,
        description: 'Nothing more is posted there, and scheduled posts to it won\'t go out. Posts already in the channel stay. You can connect it again later.',
        confirmLabel: 'Disconnect',
        danger: true,
      }),
      successMessage: (_, c) => `${c.title} is disconnected`,
      errorMessage: c => `Could not disconnect ${c.title}`,
      removes: true,
      invalidate: ['marketing', 'promotions'],
    },
  )
  return { createLink, confirmLink, cancelLink, disconnect }
}
