/**
 * llm.ts — Thin LLM client for frontend direct calls
 * Supports Anthropic and OpenAI via env vars.
 */

const ANTHROPIC_KEY = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY ?? ''
const OPENAI_KEY    = (import.meta as any).env?.VITE_OPENAI_API_KEY    ?? ''

const ANTHROPIC_MODELS = ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5']

export interface LLMResponse {
  content: string
  model: string
  provider: string
  promptTokens: number
  completionTokens: number
}

async function callAnthropic(
  prompt: string, model: string, system: string,
  maxTokens: number, temperature: number,
): Promise<LLMResponse> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model, max_tokens: maxTokens, temperature, system,
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`Anthropic: ${err.error?.message ?? res.statusText}`)
  }
  const d = await res.json()
  return {
    content: d.content[0].text, model: d.model,
    provider: 'anthropic',
    promptTokens: d.usage.input_tokens,
    completionTokens: d.usage.output_tokens,
  }
}

async function callOpenAI(
  prompt: string, model: string, system: string,
  maxTokens: number, temperature: number,
): Promise<LLMResponse> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model, max_tokens: maxTokens, temperature,
      messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(`OpenAI: ${err.error?.message ?? res.statusText}`)
  }
  const d = await res.json()
  return {
    content: d.choices[0].message.content, model: d.model,
    provider: 'openai',
    promptTokens: d.usage.prompt_tokens,
    completionTokens: d.usage.completion_tokens,
  }
}

export async function generate(
  prompt: string, model: string,
  system = '', maxTokens = 1024, temperature = 0.5,
): Promise<LLMResponse> {
  if (ANTHROPIC_MODELS.includes(model)) {
    if (!ANTHROPIC_KEY) throw new Error('VITE_ANTHROPIC_API_KEY not set in .env')
    return callAnthropic(prompt, model, system, maxTokens, temperature)
  }
  if (OPENAI_KEY) return callOpenAI(prompt, model, system, maxTokens, temperature)
  throw new Error(`Unknown model "${model}" and no OpenAI key set`)
}
