import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { evaluationSettings, openEvaluationModel } from './binding'
import type { EvaluationModel } from './binding'
import { MENU_CASES } from './menu-cases'
import { convertEvaluationPdf, extractEvaluationMenu, scoreEvaluationMenu } from './menu-extraction'
import { renderEvaluationPdf } from './pdf-render'

const settings = evaluationSettings(process.env)
const fixture = async (name: string) => new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)))

describe('menu quality check through Workers AI (metered)', () => {
  let evaluation: EvaluationModel
  beforeAll(async () => {
    if (settings.provider !== 'cloudflare') throw new Error('Menu/document evaluation requires the Cloudflare AI binding.')
    evaluation = await openEvaluationModel(settings, process.env)
  }, 60_000)
  afterAll(async () => {
    await evaluation?.dispose()
  })

  for (const c of MENU_CASES) {
    it(`${c.id}: image transcription`, { timeout: 90_000 }, async () => {
      const result = await extractEvaluationMenu(evaluation.model, { kind: 'image', bytes: await fixture(`${c.id}.png`) })
      const problems = scoreEvaluationMenu(c.expected, result.output)
      console.log(JSON.stringify({ fixture: c.id, path: 'image', model: settings.model, latencyMs: result.latencyMs, usage: result.usage, problems }))
      expect(problems).toEqual([])
    })
    it(`${c.id}: text PDF conversion and extraction`, { timeout: 120_000 }, async () => {
      const conversion = await convertEvaluationPdf(evaluation.binding!, await fixture(`${c.id}-text.pdf`))
      const result = await extractEvaluationMenu(evaluation.model, { kind: 'text', text: conversion.text })
      const problems = scoreEvaluationMenu(c.expected, result.output)
      console.log(JSON.stringify({ fixture: c.id, path: 'text-pdf', model: settings.model, conversionMs: conversion.latencyMs, estimatedTextTokens: conversion.estimatedTextTokens, latencyMs: result.latencyMs, usage: result.usage, problems }))
      expect(problems).toEqual([])
    })
    it(`${c.id}: text PDF page rendering and production vision extraction`, { timeout: 120_000 }, async () => {
      const rendered = await renderEvaluationPdf(await fixture(`${c.id}-text.pdf`), { executablePath: process.env.ASSISTANT_EVAL_CHROMIUM })
      expect(rendered.pages).toHaveLength(1)
      const result = await extractEvaluationMenu(evaluation.model, { kind: 'image', bytes: rendered.pages[0]!.bytes })
      const problems = scoreEvaluationMenu(c.expected, result.output)
      console.log(JSON.stringify({ fixture: c.id, path: 'text-pdf-rendered', model: settings.model, renderMs: rendered.latencyMs, latencyMs: result.latencyMs, usage: result.usage, problems }))
      expect(problems).toEqual([])
    })
    it(`${c.id}: scanned PDF page rendering and vision extraction`, { timeout: 120_000 }, async () => {
      const rendered = await renderEvaluationPdf(await fixture(`${c.id}-scan.pdf`), { executablePath: process.env.ASSISTANT_EVAL_CHROMIUM })
      expect(rendered.pages).toHaveLength(1)
      expect(rendered.pages[0]!.textCharacters).toBe(0)
      const result = await extractEvaluationMenu(evaluation.model, { kind: 'image', bytes: rendered.pages[0]!.bytes })
      const problems = scoreEvaluationMenu(c.expected, result.output)
      console.log(JSON.stringify({ fixture: c.id, path: 'scan-pdf', model: settings.model, renderMs: rendered.latencyMs, latencyMs: result.latencyMs, usage: result.usage, problems }))
      expect(problems).toEqual([])
    })
  }
  it('mixed PDF: selected rendered pages keep their own menu associations', { timeout: 180_000 }, async () => {
    const rendered = await renderEvaluationPdf(await fixture('mixed.pdf'), { executablePath: process.env.ASSISTANT_EVAL_CHROMIUM })
    expect(rendered.pages).toHaveLength(2)
    for (const page of rendered.pages) {
      const result = await extractEvaluationMenu(evaluation.model, { kind: 'image', bytes: page.bytes })
      const problems = scoreEvaluationMenu(MENU_CASES[page.page - 1]!.expected, result.output)
      console.log(JSON.stringify({ fixture: 'mixed', path: 'rendered-page', page: page.page, model: settings.model, latencyMs: result.latencyMs, usage: result.usage, problems }))
      expect(problems).toEqual([])
    }
  })
})
