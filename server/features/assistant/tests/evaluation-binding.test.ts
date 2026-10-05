import { beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluationSettings, openEvaluationModel, requireEvaluationAccess } from '#server/features/assistant/eval/binding'

const { getPlatformProxy, dispose, run } = vi.hoisted(() => ({ getPlatformProxy: vi.fn(), dispose: vi.fn(), run: vi.fn() }))
vi.mock('wrangler', () => ({ getPlatformProxy }))
const env = { ASSISTANT_EVAL: '1', NUXT_AI_ENABLED: 'true', NUXT_AI_PROVIDER: 'cloudflare', NUXT_AI_MODEL: '@cf/google/gemma-4-26b-a4b-it' }

beforeEach(() => {
  vi.resetAllMocks()
  dispose.mockResolvedValue(undefined)
  getPlatformProxy.mockResolvedValue({ env: { AI: { run } }, dispose })
})

describe('metered evaluation access', () => {
  it.each([undefined, '', 'true', '0'])('requires the exact explicit opt-in (%s)', async (ASSISTANT_EVAL) => {
    await expect(openEvaluationModel(evaluationSettings(env), { ...env, ASSISTANT_EVAL })).rejects.toThrow('ASSISTANT_EVAL=1')
    expect(getPlatformProxy).not.toHaveBeenCalled()
  })
  it('refuses CI before creating any remote binding', async () => {
    await expect(openEvaluationModel(evaluationSettings(env), { ...env, CI: 'true' })).rejects.toThrow('outside CI')
    expect(getPlatformProxy).not.toHaveBeenCalled()
  })
  it('disabled/missing configuration fails visibly instead of silently skipping every quality case', () => {
    expect(() => evaluationSettings({ ASSISTANT_EVAL: '1' })).toThrow('Configure an enabled evaluation provider/model')
    expect(() => evaluationSettings({ ...env, NUXT_AI_ENABLED: 'false' })).toThrow('Configure an enabled evaluation provider/model')
    expect(() => requireEvaluationAccess(env)).not.toThrow()
  })
})

describe('Wrangler binding lifecycle', () => {
  it('uses an isolated AI config, typed platform proxy, no persisted state or env files', async () => {
    const evaluation = await openEvaluationModel(evaluationSettings(env), env)
    expect(getPlatformProxy).toHaveBeenCalledWith({ configPath: expect.stringContaining('/assistant/eval/wrangler.json'), envFiles: [], persist: false, remoteBindings: true })
    expect(evaluation.binding).toEqual({ run })
    expect(run).not.toHaveBeenCalled()
    await evaluation.dispose()
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('cleans up the proxy when model configuration fails after startup', async () => {
    getPlatformProxy.mockResolvedValueOnce({ env: {}, dispose })
    await expect(openEvaluationModel(evaluationSettings(env), env)).rejects.toMatchObject({ data: { code: 'AI_NOT_CONFIGURED' } })
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('supports a caller-selected evaluation-only config', async () => {
    const evaluation = await openEvaluationModel(evaluationSettings(env), { ...env, ASSISTANT_EVAL_WRANGLER_CONFIG: '/tmp/eval.json' })
    expect(getPlatformProxy).toHaveBeenCalledWith(expect.objectContaining({ configPath: '/tmp/eval.json' }))
    await evaluation.dispose()
  })
  it('legacy help evaluation never starts a Cloudflare proxy', async () => {
    const legacy = { ASSISTANT_EVAL: '1', NUXT_AI_PROVIDER: 'openai', NUXT_AI_MODEL: 'gpt-5.4-mini', NUXT_AI_API_KEY: 'test' }
    const evaluation = await openEvaluationModel(evaluationSettings(legacy), legacy)
    expect(evaluation.binding).toBeUndefined()
    expect(getPlatformProxy).not.toHaveBeenCalled()
    await evaluation.dispose()
  })
})
