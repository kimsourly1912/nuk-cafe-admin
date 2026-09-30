import { useChat } from '@ai-sdk/vue'
import { DefaultChatTransport } from 'ai'
import type { FetchContext, FetchOptions } from 'ofetch'
import type { ApiFetchOptions } from '~/utils/api-fetch'
import type { AssistantMessage } from '../utils/chat'
import { latestMessages } from '../utils/chat'

/** A little longer than the server's own limit for one answer (60 s). */
const ANSWER_TIMEOUT_MS = 75_000

/** An error answer isn't a stream: read its JSON, so `ApiError` shows the server's message. */
async function readErrorBody(context: FetchContext) {
  const response = context.response
  if (!response) return
  const text = await new Response(response._data as ReadableStream | null).text().catch(() => '')
  try {
    response._data = JSON.parse(text)
  }
  catch {
    response._data = text
  }
}

/**
 * Posts the conversation through `apiFetch` (so a lost session, a required password change and an
 * old identity's answer are handled like any request) and hands the AI SDK the streamed answer.
 */
async function postChat(_input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const options: FetchOptions<'stream'> = {
    method: 'POST',
    body: init?.body as string,
    headers: { 'content-type': 'application/json' },
    signal: init?.signal ?? undefined,
    timeout: ANSWER_TIMEOUT_MS,
    responseType: 'stream',
    onResponseError: readErrorBody,
  }
  // apiFetch's options are typed for JSON answers; this one is read as the stream it is.
  const stream = await apiFetch<ReadableStream<Uint8Array>>('/admin/assistant/chat', options as unknown as ApiFetchOptions)
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } })
}

/**
 * The help chat (step 9.1, D109): the conversation lives in this browser tab only and is sent
 * whole (its latest messages) with the page the admin is on. `onFinish` runs after each answer.
 */
export function useAssistantChat(options: { page: () => string, onFinish: () => void }) {
  const { page, onFinish } = options
  return useChat<AssistantMessage>({
    transport: new DefaultChatTransport({
      api: '/api/admin/assistant/chat',
      fetch: postChat,
      prepareSendMessagesRequest: ({ messages }) => ({ body: { messages: latestMessages(messages), page: page() } }),
    }),
    onFinish,
  })
}
