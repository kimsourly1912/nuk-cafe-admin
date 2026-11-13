/**
 * A number typed in a Studio field (ISS-020, like Figma): plain or with simple math, `900+25`,
 * `120*2`, `(600-40)/2`, `-15`. Numbers, + − × ÷ (also * and /) and brackets only; never `eval`.
 * Null for anything else, or a division by zero, so the field keeps its value.
 */
export function evaluateNumber(text: string): number | null {
  // One sign each for times and divide: × and ÷.
  const source = text.replace(/[*x]/g, '×').replace(/\//g, '÷').replace(/,/g, '.').replace(/\s+/g, '')
  if (!source || !/^[\d.+\-×÷()]+$/.test(source)) return null
  let at = 0
  const peek = () => source[at]
  function primary(): number | null {
    if (peek() === '(') {
      at += 1
      const inner = sum()
      if (inner === null || peek() !== ')') return null
      at += 1
      return inner
    }
    if (peek() === '-' || peek() === '+') {
      const sign = peek() === '-' ? -1 : 1
      at += 1
      const value = primary()
      return value === null ? null : sign * value
    }
    const match = /^\d*\.?\d+|^\d+\./.exec(source.slice(at))
    if (!match) return null
    at += match[0].length
    return Number(match[0])
  }
  function product(): number | null {
    let value = primary()
    while (value !== null && (peek() === '×' || peek() === '÷')) {
      const operator = peek()
      at += 1
      const right = primary()
      if (right === null || (operator === '÷' && right === 0)) return null
      value = operator === '×' ? value * right : value / right
    }
    return value
  }
  function sum(): number | null {
    let value = product()
    while (value !== null && (peek() === '+' || peek() === '-')) {
      const operator = peek()
      at += 1
      const right = product()
      if (right === null) return null
      value = operator === '+' ? value + right : value - right
    }
    return value
  }
  const result = sum()
  return result !== null && at === source.length && Number.isFinite(result) ? result : null
}
