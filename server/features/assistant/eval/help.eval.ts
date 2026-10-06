import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Actor } from '#server/features/identity'
import { chatWithAssistant, chatWithCloudflareAssistant } from '#server/features/assistant/assistant.service'
import { HELP_CASES } from './help-cases'
import { evaluationSettings, openEvaluationModel } from './binding'
import type { EvaluationModel } from './binding'
import { createTestDb, createUser, ensureTenant } from '#server/tests/support/db'

/**
 * The help assistant's quality check (step 9.1, D107, D109): real questions against the configured
 * provider and model, each with the facts a good answer contains. **Spends a little** (about 25
 * requests), so it never runs in CI: run it before a step ships and whenever the model or provider
 * changes, and put the result in the pull request.
 *
 *   ASSISTANT_EVAL=1 NUXT_AI_PROVIDER=openai NUXT_AI_MODEL=… NUXT_AI_API_KEY=… pnpm vitest run --project eval
 *
 * (PowerShell: set each with `$env:NAME = '…'` first.) A case passes when the answer contains one
 * of each group of expected words (case-insensitive), links to the expected page if one is named,
 * and replies in Khmer to a Khmer question.
 */

const settings = evaluationSettings(process.env)

describe('help quality check (metered)', () => {
  const totals = { input: 0, output: 0, cached: 0, passed: 0 }
  let evaluation: EvaluationModel
  beforeAll(async () => {
    evaluation = await openEvaluationModel(settings, process.env)
  }, 60_000)
  afterAll(async () => {
    await evaluation?.dispose()
  })

  it.each(HELP_CASES)('$question', { timeout: 90_000 }, async (c) => {
    const db = await createTestDb()
    await ensureTenant(db, 'eval-tenant')
    const actor: Actor = { userId: (await createUser(db)).id, tenantId: 'eval-tenant', role: 'owner' }
    const pending: Promise<unknown>[] = []
    const errors: unknown[] = []
    const started = performance.now()
    const chat = settings.provider === 'cloudflare' ? chatWithCloudflareAssistant : chatWithAssistant
    const result = await chat(db, actor, settings, evaluation.model, {
      messages: [{ id: 'q', role: 'user', parts: [{ type: 'text', text: c.question }] }],
      page: c.page ?? '/admin',
    }, { sampleData: false, waitUntil: p => void pending.push(p), onProviderError: error => void errors.push(error) })
    const completed = 'answer' in result ? await result.answer : { text: await result.text, usage: await result.usage, links: (await result.steps).flatMap(step => step.toolResults).map(r => r.output as { path: string }) }
    const { text, usage } = completed
    await Promise.all(pending)
    expect(errors).toEqual([])
    const links = completed.links.map(link => link.path)
    totals.input += usage.inputTokens ?? 0
    totals.output += usage.outputTokens ?? 0
    totals.cached += usage.inputTokenDetails?.cacheReadTokens ?? 0

    // Models write curly apostrophes (don’t); the expected words use straight ones.
    const lower = text.toLowerCase().replace(/[‘’]/g, '\'')
    const problems = [
      ...c.expect.filter(group => !group.some(word => lower.includes(word.toLowerCase()))).map(group => `missing one of: ${group.join(' | ')}`),
      ...(c.never ?? []).filter(word => lower.includes(word.toLowerCase()) || links.includes(word)).map(word => `contains: ${word}`),
      ...(c.link && !links.includes(c.link) ? [`no link to ${c.link} (links: ${links.join(', ') || 'none'})`] : []),
      ...(c.khmer && !/[ក-៿]/.test(text) ? ['not in Khmer'] : []),
    ]
    console.log(`\n### ${c.question}\n${text}\nLinks: ${links.join(', ') || 'none'}\nLatency: ${Math.round(performance.now() - started)}ms${problems.length ? `\nPROBLEMS: ${problems.join('; ')}` : ''}`)
    if (!problems.length) totals.passed++
    expect(problems).toEqual([])
  })

  it('totals', () => {
    console.log(`\nPassed ${totals.passed}/${HELP_CASES.length}. Tokens: ${totals.input} in (${totals.cached} cached), ${totals.output} out.`)
  })
})
