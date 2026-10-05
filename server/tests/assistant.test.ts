import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { createEvent } from 'h3'
import { generateText } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudflareAiBinding } from '#server/features/assistant'
import { requireAssistant } from '#server/utils/assistant'

describe('assistant request bindings (Nitro 2)', () => {
  const actor = { userId: 'owner', tenantId: 'cafe' }
  const permission = vi.fn(async () => actor)
  const config = { ai: { enabled: true, provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' } }

  function request() {
    const req = new IncomingMessage(new Socket())
    return createEvent(req, new ServerResponse(req))
  }

  beforeEach(() => {
    permission.mockReset().mockResolvedValue(actor)
    vi.stubGlobal('useRuntimeConfig', () => config)
    vi.stubGlobal('requirePermission', permission)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('uses this request\'s AI binding after checking the cafe owner permission', async () => {
    const event = request()
    const run = vi.fn(async () => Response.json({
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello' }, finish_reason: 'stop' }],
    }))
    event.context.cloudflare = { env: { AI: { run } as unknown as CloudflareAiBinding } }
    const resolved = await requireAssistant(event)
    expect(permission).toHaveBeenCalledWith(event, { assistant: ['use'] })
    expect(resolved.actor).toBe(actor)
    expect(run).not.toHaveBeenCalled()
    expect((await generateText({ model: resolved.model, prompt: 'Hi', maxRetries: 0 })).text).toBe('Hello')
    expect(run).toHaveBeenCalledOnce()
  })

  it('reports missing bindings on a Node request or an unconfigured Worker', async () => {
    for (const cloudflare of [undefined, { env: {} }]) {
      const event = request()
      event.context.cloudflare = cloudflare
      await expect(requireAssistant(event)).rejects.toMatchObject({ statusCode: 500, data: { code: 'AI_NOT_CONFIGURED' } })
    }
  })

  it('checks permission before disclosing an enabled Worker\'s missing binding', async () => {
    permission.mockRejectedValueOnce(new Error('Permission refused'))
    await expect(requireAssistant(request())).rejects.toThrow('Permission refused')
  })

  it('legacy providers work without a Cloudflare environment', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ ai: { provider: 'openai', model: 'gpt-5.4-mini', apiKey: 'test' } }))
    expect((await requireAssistant(request())).settings.provider).toBe('openai')
  })
})
