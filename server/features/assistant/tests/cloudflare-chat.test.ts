import { beforeEach, expect, it, vi } from 'vitest'
import { readUIMessageStream } from 'ai'
import type { Actor } from '#server/features/identity'
import type { Db } from '#server/utils/batch'
import { createAdmin, createTestDb, TEST_TENANT } from '#server/tests/support/db'
import { assistantUsage } from '#server/features/assistant/assistant.schema'
import { chatWithCloudflareAssistant, languageModel } from '#server/features/assistant'
import type { CloudflareAiBinding } from '#server/features/assistant'

const settings = { provider: 'cloudflare' as const, model: '@cf/google/gemma-4-26b-a4b-it', apiKey: '', baseUrl: null, dailyLimit: 10 }
let db: Db
let actor: Actor
beforeEach(async () => {
  db = await createTestDb()
  actor = { ...(await createAdmin(db)), tenantId: TEST_TENANT, role: 'owner' }
})
async function ask(output: unknown, reason = 'stop', signal?: AbortSignal) {
  const pending: Promise<unknown>[] = []
  const errors: unknown[] = []
  const run = vi.fn(async () => Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: reason }], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } }))
  const model = languageModel(settings, { run } as unknown as CloudflareAiBinding)
  const result = await chatWithCloudflareAssistant(db, actor, settings, model, { messages: [{ id: 'q', role: 'user', parts: [{ type: 'text', text: 'Where do I add staff?' }] }], page: '/admin' }, { sampleData: false, abortSignal: signal, waitUntil: promise => void pending.push(promise), onProviderError: error => void errors.push(error) })
  return { ...result, run, pending, errors }
}

it('uses one binding call and emits existing UI text/buttons with fixed server paths and usage', async () => {
  const result = await ask({ answer: 'Open **Staff**, then **Add staff member**.', pages: ['staff', 'staff'] })
  const messages = []
  for await (const message of readUIMessageStream({ stream: result.stream })) messages.push(message)
  expect(messages.at(-1)?.parts).toMatchObject([{ type: 'step-start' }, { type: 'text', text: 'Open **Staff**, then **Add staff member**.' }, { type: 'tool-link_to_page', state: 'output-available', input: { page: 'staff' }, output: { path: '/admin/staff' } }])
  const answer = await result.answer
  expect(answer.pages).toEqual(['staff'])
  expect(result.run).toHaveBeenCalledOnce()
  const input = (result.run.mock.calls as unknown as [string, Record<string, unknown>][])[0]![1]
  expect(input).not.toHaveProperty('tools')
  expect(input).toMatchObject({ chat_template_kwargs: { enable_thinking: false } })
  await Promise.all(result.pending)
  expect(result.errors).toEqual([])
  expect(await db.select().from(assistantUsage)).toMatchObject([{ outcome: 'ok', inputTokens: 12, outputTokens: 5 }])
})

it.each([
  { answer: 'Hidden page', pages: ['sample-data'] },
  { answer: 'Foreign path', pages: ['/c/another/admin/staff'] },
  { answer: '   ', pages: [] },
  { answer: 'Allowed answer', pages: [], url: 'https://example.test' },
])('refuses invalid structured output before showing any text or button: %j', async (output) => {
  const result = await ask(output)
  await expect(result.answer).rejects.toBeDefined()
  const chunks = []
  for await (const chunk of result.stream) chunks.push(chunk)
  expect(chunks).toEqual([{ type: 'error', errorText: expect.any(String) }])
  expect(JSON.stringify(chunks)).not.toContain('Foreign path')
  await Promise.all(result.pending)
  expect(result.run).toHaveBeenCalledOnce()
  expect(await db.select().from(assistantUsage)).toMatchObject([{ outcome: 'error', inputTokens: 12, outputTokens: 5 }])
})

it('rejects a truncated answer and accounts for the attempt once', async () => {
  const result = await ask({ answer: 'Incomplete', pages: ['staff'] }, 'length')
  await expect(result.answer).rejects.toThrow('Incomplete help answer')
  await Promise.all(result.pending)
  expect(await db.select().from(assistantUsage)).toMatchObject([{ outcome: 'error', inputTokens: 12 }])
})

it('preserves cancellation and records one failed reservation without calling the binding', async () => {
  const result = await ask({ answer: 'Never show', pages: [] }, 'stop', AbortSignal.abort())
  await expect(result.answer).rejects.toBeDefined()
  await Promise.all(result.pending)
  expect(result.run).not.toHaveBeenCalled()
  expect(await db.select().from(assistantUsage)).toMatchObject([{ outcome: 'error' }])
})
