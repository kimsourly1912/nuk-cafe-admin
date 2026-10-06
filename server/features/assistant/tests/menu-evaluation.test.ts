import * as v from 'valibot'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MockLanguageModelV4 } from 'ai/test'
import type { CloudflareAiBinding } from '#server/features/assistant/assistant.model'
import { languageModel } from '#server/features/assistant/assistant.model'
import { assistantSettingsFrom } from '#server/features/assistant/assistant.settings'
import { MENU_CASES } from '#server/features/assistant/eval/menu-cases'
import { convertEvaluationPdf, extractEvaluationMenu, menuEvaluationSchema, scoreEvaluationMenu } from '#server/features/assistant/eval/menu-extraction'

const usage = { inputTokens: { total: 12, noCache: 12, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 5, text: 5, reasoning: undefined } }
const expected = MENU_CASES[0]!.expected
type Generate = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>['doGenerate']
type GenerateFunction = Extract<Generate, (...args: never[]) => unknown>
let doGenerate: ReturnType<typeof vi.fn<GenerateFunction>>
beforeEach(() => {
  doGenerate = vi.fn<GenerateFunction>(async () => ({ content: [{ type: 'text', text: JSON.stringify({ items: expected }) }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] }))
})
const model = () => new MockLanguageModelV4({ doGenerate })

describe('schema-checked menu evaluation through AI SDK 7', () => {
  it('the installed Cloudflare adapter sends the Valibot JSON schema and validates its response', async () => {
    const run = vi.fn(async () => Response.json({
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ items: expected }) }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 12, completion_tokens: 5, total_tokens: 17 },
    }))
    const settings = assistantSettingsFrom({ enabled: true, provider: 'cloudflare', model: '@cf/google/gemma-4-26b-a4b-it' })!
    const result = await extractEvaluationMenu(languageModel(settings, { run } as unknown as CloudflareAiBinding), { kind: 'text', text: 'Synthetic menu' })
    expect(scoreEvaluationMenu(expected, result.output)).toEqual([])
    expect(run).toHaveBeenCalledWith(settings.model, expect.objectContaining({ response_format: { type: 'json_schema', json_schema: expect.objectContaining({ name: 'menu_transcription', schema: expect.objectContaining({ additionalProperties: false }) }) } }), expect.anything())
  })
  it('keeps exact source amounts/currencies, missing prices and review flags', async () => {
    const result = await extractEvaluationMenu(model(), { kind: 'text', text: 'Synthetic source' })
    expect(result.output.items).toEqual(expected)
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 5 })
    expect(scoreEvaluationMenu(expected, result.output)).toEqual([])
    const request = doGenerate.mock.calls[0]![0]
    expect(request.responseFormat).toMatchObject({ type: 'json', schema: { type: 'object' } })
    expect(request.tools).toBeUndefined()
    expect(request.prompt[0]!.content).toContain('never converted or invented')
  })
  it('sends inline PNG data through the canonical file part, without a URL fetch', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71])
    doGenerate.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ items: expected, truncated: false }) }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] })
    await extractEvaluationMenu(model(), { kind: 'image', bytes })
    expect(doGenerate.mock.calls[0]![0].prompt.at(-1)!.content).toContainEqual(expect.objectContaining({ type: 'file', mediaType: 'image/png', data: { type: 'data', data: bytes } }))
  })
  it.each([
    { items: expected, truncated: true },
    { items: [{ ...expected[0]!, name: ' \t' }], truncated: false },
    { items: [{ ...expected[0]!, prices: [{ ...expected[0]!.prices[0]!, evidence: null }] }], truncated: false },
  ])('image evaluation applies production review rejection (%j)', async (invalid) => {
    doGenerate.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify(invalid) }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] })
    await expect(extractEvaluationMenu(model(), { kind: 'image', bytes: new Uint8Array([137, 80, 78, 71]) })).rejects.toThrow()
  })
  it.each([{ items: [] }, { items: [{ ...expected[0], unexpected: 'field' }] }, { items: [{ ...expected[0], prices: [{ ...expected[0]!.prices[0], amount: '-1' }] }] }])('rejects empty/invalid provider output rather than treating it as success', async ({ items }) => {
    doGenerate.mockResolvedValueOnce({ content: [{ type: 'text', text: JSON.stringify({ items }) }], finishReason: { unified: 'stop', raw: 'stop' }, usage, warnings: [] })
    await expect(extractEvaluationMenu(model(), { kind: 'text', text: 'Source' })).rejects.toThrow()
  })
  it('bounds item/price counts and refuses unknown output keys', () => {
    expect(v.safeParse(menuEvaluationSchema, { items: Array.from({ length: 51 }, () => expected[0]) }).success).toBe(false)
    expect(v.safeParse(menuEvaluationSchema, { items: [{ ...expected[0], prices: Array.from({ length: 21 }, () => expected[0]!.prices[0]) }] }).success).toBe(false)
    expect(v.safeParse(menuEvaluationSchema, { items: expected, publish: true }).success).toBe(false)
  })
  it('rejects empty/oversized inputs before metered inference', async () => {
    for (const source of [{ kind: 'text' as const, text: ' ' }, { kind: 'text' as const, text: 'x'.repeat(40_001) }, { kind: 'image' as const, bytes: new Uint8Array() }, { kind: 'image' as const, bytes: new Uint8Array(5 * 1024 * 1024 + 1) }]) {
      await expect(extractEvaluationMenu(model(), source)).rejects.toThrow()
    }
    expect(doGenerate).not.toHaveBeenCalled()
  })
  it('does not retry provider errors', async () => {
    doGenerate.mockRejectedValue(new Error('Provider refused'))
    await expect(extractEvaluationMenu(model(), { kind: 'text', text: 'Source' })).rejects.toThrow('Provider refused')
    expect(doGenerate).toHaveBeenCalledOnce()
  })
  it('propagates cancellation before inference starts', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(extractEvaluationMenu(model(), { kind: 'text', text: 'Source' }, controller.signal)).rejects.toThrow()
    expect(doGenerate).not.toHaveBeenCalled()
  })
})

describe('quality scoring, independent of schema validity', () => {
  const output = () => structuredClone({ items: expected })
  it('allows equivalent decimal spelling without floating point conversion', () => {
    const actual = output()
    actual.items[0]!.prices[0]!.amount = '02.5000'
    expect(scoreEvaluationMenu(expected, actual)).toEqual([])
  })
  it('fails a swapped price, guessed currency, invented description or item', () => {
    const actual = output()
    actual.items[0]!.prices[0]!.amount = '4.25'
    actual.items[4]!.prices[0]!.currency = 'USD'
    actual.items[1]!.description = 'Invented ingredients'
    actual.items.push({ ...actual.items[0]!, name: 'Dragon Latte' })
    const problems = scoreEvaluationMenu(expected, actual)
    expect(problems).toContain('Expected 5 items; received 6.')
    expect(problems).toContain('Incorrect price/size/currency association: Americano.')
    expect(problems).toContain('Incorrect price/size/currency association: Banana Bread.')
    expect(problems).toContain('Unstated or incorrect description: Latte.')
  })
  it('fails missing uncertainty flags, source evidence and duplicated associations', () => {
    const actual = output()
    actual.items[4]!.flags = []
    actual.items[0]!.prices[0]!.evidence = null
    actual.items[1] = { ...actual.items[0]! }
    const problems = scoreEvaluationMenu(expected, actual)
    expect(problems).toContain('Missing or duplicated item: Americano.')
    expect(problems).toContain('Missing or duplicated item: Latte.')
    expect(problems).toContain('Missing ambiguous-currency flag: Banana Bread.')
  })
  it('fails invented price evidence even when the numerical value matches', () => {
    const actual = output()
    actual.items[0]!.prices[0]!.evidence = '$99.99'
    expect(scoreEvaluationMenu(expected, actual)).toContain('Incorrect price evidence: Americano.')
  })
})

describe('text-PDF conversion uses the binding, never assumes OCR', () => {
  const bytes = new TextEncoder().encode('%PDF-1.7 synthetic')
  function converter(result: unknown) {
    const toMarkdown = vi.fn(async () => result)
    return { toMarkdown, binding: { toMarkdown } as unknown as CloudflareAiBinding }
  }
  it('disables embedded-image descriptions, validates text, keeps token estimates distinct', async () => {
    const { binding, toMarkdown } = converter({ format: 'markdown', data: 'Coffee $2.50', tokens: 5 })
    expect(await convertEvaluationPdf(binding, bytes)).toMatchObject({ text: 'Coffee $2.50', estimatedTextTokens: 5 })
    expect(toMarkdown).toHaveBeenCalledWith(expect.objectContaining({ name: 'evaluation-menu.pdf', blob: expect.any(Blob) }), { conversionOptions: { pdf: { metadata: false, images: { convert: false } } } })
  })
  it.each([{ format: 'error', error: 'private conversion body' }, { format: 'markdown', data: '' }, { format: 'markdown', data: 'x'.repeat(40_001) }])('does not send failed/empty/oversized conversion results to the model', async (converted) => {
    await expect(convertEvaluationPdf(converter(converted).binding, bytes)).rejects.toThrow()
  })
})
