import { describe, expect, it, vi } from 'vitest'
import { generateText, jsonSchema, Output, streamText, tool } from 'ai'
import type { CloudflareAiBinding } from '#server/features/assistant/assistant.model'
import { languageModel } from '#server/features/assistant/assistant.model'
import { assistantSettingsFrom } from '#server/features/assistant/assistant.settings'
import { AI_UNAVAILABLE_MESSAGE, providerFailureMessage } from '#server/features/assistant/assistant.errors'
import { expectApiError } from '#server/tests/support/failure'
import { extractMenuImage, toReviewRows } from '#server/features/assistant/assistant-extraction'

// Exercise the installed Cloudflare provider and AI SDK together, without metered inference.
const configured = () => assistantSettingsFrom({ enabled: true, provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' })!
const completion = (content: string) => Response.json({
  id: 'test', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
})

function bound(reply: (input: Record<string, unknown>, options: Record<string, unknown>) => Promise<Response> | Response) {
  const run = vi.fn(async (_model: string, input: Record<string, unknown>, options: Record<string, unknown>) => reply(input, options))
  const binding = { run } as unknown as CloudflareAiBinding
  return { run, model: languageModel(configured(), binding) }
}

describe('keyless Cloudflare settings', () => {
  it('uses safe capacity/allocation copy separate from the per-owner limit', () => {
    expect(providerFailureMessage('cloudflare', { statusCode: 429, message: 'private provider body' })).toContain('00:00 UTC')
    expect(providerFailureMessage('cloudflare', { statusCode: 429 })).not.toContain('midnight')
    expect(providerFailureMessage('cloudflare', new Error('private provider body'))).toBe(AI_UNAVAILABLE_MESSAGE)
    expect(providerFailureMessage('openai', { statusCode: 429 })).toBe(AI_UNAVAILABLE_MESSAGE)
  })
  it('requires explicit enablement, never uses a leftover external API key', () => {
    expect(assistantSettingsFrom({ provider: 'cloudflare', model: '@cf/a/b', apiKey: 'old-key' })).toBeNull()
    expect(assistantSettingsFrom({ enabled: 'false', provider: 'cloudflare' })).toBeNull()
    expect(configured()).toMatchObject({ provider: 'cloudflare', apiKey: '', dailyLimit: 100 })
    expect(assistantSettingsFrom({ enabled: 'true', provider: 'cloudflare', model: '@cf/a/b', apiKey: 'old-key' })?.apiKey).toBe('')
  })

  it('refuses an invalid switch, missing binding/model, REST endpoint or vendor model', async () => {
    for (const raw of [
      { enabled: 'yes' },
      { enabled: true, provider: 'cloudflare' },
      { enabled: true, provider: 'cloudflare', model: 'gpt-5-mini' },
      { enabled: true, provider: 'cloudflare', model: '@cf/a/b', baseUrl: 'https://example.com' },
      { enabled: true, provider: 'openai', model: 'm' },
    ]) await expectApiError(() => assistantSettingsFrom(raw), 500, 'AI_NOT_CONFIGURED')
    await expectApiError(() => languageModel(configured()), 500, 'AI_NOT_CONFIGURED')
    await expectApiError(() => languageModel(configured(), {} as CloudflareAiBinding), 500, 'AI_NOT_CONFIGURED')
  })

  it('can explicitly disable a legacy provider with a key', () => {
    expect(assistantSettingsFrom({ enabled: false, provider: 'openai', model: 'm', apiKey: 'k' })).toBeNull()
  })
})

describe('AI SDK 7 through the installed Cloudflare binding provider', () => {
  it('generates text with token accounting using only AI.run', async () => {
    const { model, run } = bound(() => completion('Hello'))
    const result = await generateText({ model, prompt: 'Hello', maxRetries: 0 })
    expect(result.text).toBe('Hello')
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 5 })
    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.calls[0]?.[0]).toBe(configured().model)
    expect(run.mock.calls[0]?.[2]).toMatchObject({ returnRawResponse: true })
  })

  it('keeps Gemma thinking from exhausting the answer token budget', async () => {
    const { model, run } = bound(input => input.chat_template_kwargs
      && (input.chat_template_kwargs as { enable_thinking?: boolean }).enable_thinking === false
      ? completion('READY.')
      : Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: 'length' }],
          usage: { prompt_tokens: 21, completion_tokens: 64, total_tokens: 85 } }))
    const result = await generateText({ model, prompt: 'Reply with exactly READY.', maxOutputTokens: 64, maxRetries: 0 })
    expect(result.text).toBe('READY.')
    expect(result.finishReason).toBe('stop')
    expect(run).toHaveBeenCalledOnce()
  })

  it('streams the chat-completions wire format into the existing AI SDK stream', async () => {
    const events = [
      { choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello ' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: { content: 'owner' }, finish_reason: null }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 } },
    ]
    const { model, run } = bound(() => new Response(`${events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
    const result = streamText({ model, prompt: 'Hello', maxRetries: 0 })
    expect(await result.text).toBe('Hello owner')
    expect(await result.usage).toMatchObject({ inputTokens: 12, outputTokens: 5 })
    expect(run.mock.calls[0]?.[1]).toMatchObject({ stream: true })
  })

  it('transcribes full names without sending the one-character constrained name pattern', async () => {
    const { model } = bound((input) => {
      const format = input.response_format as { json_schema: { schema: { properties: { items: { items: { properties: { name: { pattern?: string } } } } } } } }
      const name = format.json_schema.schema.properties.items.items.properties.name.pattern ? '%' : 'Americano'
      return completion(JSON.stringify({ items: [{ name, description: null, category: 'Coffee',
        prices: [{ label: null, amount: '2.50', currency: 'USD', evidence: '$2.50' }], flags: [] }], truncated: false }))
    })
    const result = await extractMenuImage(model, new Uint8Array([137, 80, 78, 71]), 'image/png', new AbortController().signal)
    expect(toReviewRows(result.output)[0]?.source.name).toBe('Americano')
    expect(() => toReviewRows({ ...result.output, items: [{ ...result.output.items[0]!, name: ' \t' }] })).toThrow()
  })

  it('carries the approved navigation tool and executes its validated result', async () => {
    const execute = vi.fn(async () => ({ title: 'Menu items', path: '/admin/products' }))
    const { model, run } = bound(() => Response.json({ choices: [{ message: {
      role: 'assistant', content: null,
      tool_calls: [{ id: 'link-1', type: 'function', function: { name: 'link_to_page', arguments: '{"page":"products"}' } }],
    }, finish_reason: 'tool_calls' }] }))
    const result = await generateText({ model, prompt: 'Where is the menu?', maxRetries: 0, tools: {
      link_to_page: tool({ inputSchema: jsonSchema<{ page: 'products' }>({ type: 'object', properties: { page: { type: 'string', enum: ['products'] } }, required: ['page'], additionalProperties: false }), execute }),
    } })
    expect(execute).toHaveBeenCalledOnce()
    expect(result.toolResults[0]?.output).toEqual({ title: 'Menu items', path: '/admin/products' })
    expect(run.mock.calls[0]?.[1]).toHaveProperty('tools')
  })

  it('returns schema-checked structured output and preserves inline image data', async () => {
    const schema = jsonSchema<{ name: string }>({ type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }, {
      validate: value => typeof (value as { name?: unknown })?.name === 'string'
        ? { success: true, value: value as { name: string } }
        : { success: false, error: new Error('Missing name') },
    })
    const { model, run } = bound(() => completion('{"name":"Latte"}'))
    const result = await generateText({ model, maxRetries: 0, output: Output.object({ schema }), messages: [{ role: 'user', content: [
      { type: 'text', text: 'Read the stated item name.' },
      { type: 'file', data: new Uint8Array([137, 80, 78, 71]), mediaType: 'image/png' },
    ] }] })
    expect(result.output).toEqual({ name: 'Latte' })
    expect(JSON.stringify(run.mock.calls[0]?.[1])).toContain('data:image/png;base64,iVBORw==')
    expect(run.mock.calls[0]?.[1]).toHaveProperty('response_format')
  })

  it('surfaces quota failures without retry', async () => {
    const controller = new AbortController()
    const { model, run } = bound((_input, options) => {
      expect(options.signal).toBe(controller.signal)
      return new Response('{"error":"daily allocation exhausted"}', { status: 429 })
    })
    await expect(generateText({ model, prompt: 'Hello', abortSignal: controller.signal, maxRetries: 0 })).rejects.toMatchObject({ statusCode: 429 })
    expect(run).toHaveBeenCalledOnce()
  })

  it('forwards cancellation during inference to the binding', async () => {
    const controller = new AbortController()
    let entered!: () => void
    const started = new Promise<void>((resolve) => {
      entered = resolve
    })
    const { model, run } = bound((_input, options) => new Promise<Response>((_resolve, reject) => {
      const signal = options.signal as AbortSignal
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
      entered()
    }))
    const result = generateText({ model, prompt: 'Hello', abortSignal: controller.signal, maxRetries: 0 })
    const rejected = expect(result).rejects.toThrow()
    await started
    controller.abort()
    await rejected
    expect(run).toHaveBeenCalledOnce()
    expect((run.mock.calls[0]?.[2].signal as AbortSignal).aborted).toBe(true)
  })
})
