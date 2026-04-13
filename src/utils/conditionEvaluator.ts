/**
 * conditionEvaluator.ts
 * =====================
 * Safely evaluates edge condition expressions against the shared FlowState.
 *
 * Expression syntax
 * -----------------
 * The expression receives a single variable called `state` which is the
 * current FlowState dictionary. Examples:
 *
 *   state['score'] > 80
 *   state['reviewer:approved'] === true
 *   state['status'] === 'completed'
 *   state['retry_count'] < 3
 *   (state['score'] ?? 0) >= 70 && state['status'] !== 'failed'
 *   !state['error']
 *
 * An empty string / undefined is treated as unconditional (always true).
 *
 * Safety
 * ------
 * The evaluator uses the Function constructor with a restricted scope.
 * It does NOT have access to window, document, fetch, or any global.
 * Any exception during evaluation is caught and treated as false.
 */

export interface EvalResult {
  passed: boolean       // true  → route to target node
  error?: string        // set if expression threw
  expression: string    // original expression (for logging)
  value: unknown        // raw return value of the expression
}

// Characters/patterns that are always blocked regardless of content
const BLOCKED_PATTERNS = [
  /\beval\b/,
  /\bFunction\b/,
  /\bimport\b/,
  /\brequire\b/,
  /\bwindow\b/,
  /\bdocument\b/,
  /\bfetch\b/,
  /\bXMLHttpRequest\b/,
  /\bprocess\b/,
  /\b__proto__\b/,
  /\bconstructor\b/,
  /\bprototype\b/,
]

function isSafe(expression: string): boolean {
  return !BLOCKED_PATTERNS.some(p => p.test(expression))
}

/**
 * Evaluate `expression` with `state` in scope.
 * Returns EvalResult — never throws.
 */
export function evaluateCondition(
  expression: string,
  state: Record<string, unknown>,
): EvalResult {
  const expr = expression.trim()

  // Empty expression = unconditional
  if (!expr) {
    return { passed: true, expression: expr, value: true }
  }

  if (!isSafe(expr)) {
    return {
      passed: false,
      expression: expr,
      value: false,
      error: 'Expression blocked: contains disallowed identifier',
    }
  }

  try {
    // Build a sandboxed function: only `state` is in scope
    // eslint-disable-next-line no-new-func
    const fn = new Function('state', `"use strict"; return (${expr});`)
    const value = fn(state)
    return { passed: Boolean(value), expression: expr, value }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { passed: false, expression: expr, value: undefined, error: message }
  }
}

/**
 * Convenience: evaluate multiple edges from one source node and return
 * which targets should be enqueued.
 */
export interface ConditionalEdge {
  id: string
  target: string
  expression: string   // empty = unconditional
  label?: string
}

export interface RouteResult {
  edgeId: string
  target: string
  passed: boolean
  expression: string
  label?: string
  error?: string
}

export function routeEdges(
  edges: ConditionalEdge[],
  state: Record<string, unknown>,
): RouteResult[] {
  return edges.map(edge => {
    const result = evaluateCondition(edge.expression, state)
    return {
      edgeId:     edge.id,
      target:     edge.target,
      passed:     result.passed,
      expression: result.expression,
      label:      edge.label,
      error:      result.error,
    }
  })
}
