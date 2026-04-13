/**
 * workflowGenerator.ts
 * ====================
 * Converts a natural language description into a React Flow graph.
 *
 * Strategy:
 * 1. Try backend POST /api/generate-workflow (uses Claude server-side)
 * 2. Fallback to direct Anthropic API call from browser
 * 3. Parse JSON → validate → position nodes in clean layout
 *
 * Smart defaults applied after generation:
 * - Default model: claude-sonnet-4-5
 * - Orchestrators get low temperature (0.2)
 * - Reviewers get claude-opus-4-5
 * - Short, action-oriented prompts
 * - Automatic layout: tree from top-center
 */

import type { AgentRole, AgentModel } from '../types'

export interface GeneratedNode {
  id: string
  type: 'agent'
  position: { x: number; y: number }
  data: {
    agentName: string
    role: AgentRole
    model: AgentModel
    prompt: string
    temperature: number
    maxTokens: number
    status: 'idle'
    description: string
    attachedTools: string[]
  }
}

export interface GeneratedEdge {
  id: string
  source: string
  target: string
  animated: boolean
  label?: string
  style: Record<string, unknown>
  data?: Record<string, unknown>
}

export interface GeneratedWorkflow {
  name: string
  description: string
  nodes: GeneratedNode[]
  edges: GeneratedEdge[]
}

// ── Smart model selection ────────────────────────────────────────────────────

function smartModel(role: AgentRole, taskComplexity: 'simple' | 'medium' | 'complex'): AgentModel {
  if (role === 'reviewer') return 'claude-opus-4-5'   // reviewers need best model
  if (role === 'orchestrator' && taskComplexity === 'complex') return 'claude-opus-4-5'
  if (role === 'coder') return 'claude-sonnet-4-5'     // coders need good reasoning
  if (taskComplexity === 'simple') return 'claude-haiku-4-5'
  return 'claude-sonnet-4-5'                          // default
}

function smartTemperature(role: AgentRole): number {
  const temps: Record<AgentRole, number> = {
    orchestrator: 0.2,
    researcher:   0.4,
    coder:        0.1,
    reviewer:     0.3,
    custom:       0.5,
  }
  return temps[role] ?? 0.4
}

function smartTools(role: AgentRole): string[] {
  const tools: Record<AgentRole, string[]> = {
    orchestrator: [],
    researcher:   ['api_fetch', 'db_query'],
    coder:        ['api_call'],
    reviewer:     ['db_query'],
    custom:       [],
  }
  return tools[role] ?? []
}

// ── Layout engine ────────────────────────────────────────────────────────────
// Builds a clean top-down tree layout given edges

function layoutNodes(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
): Record<string, { x: number; y: number }> {
  // Build adjacency
  const children = new Map<string, string[]>()
  const parents  = new Map<string, string[]>()
  for (const n of nodes) { children.set(n.id, []); parents.set(n.id, []) }
  for (const e of edges) {
    children.get(e.source)?.push(e.target)
    parents.get(e.target)?.push(e.source)
  }

  // Find roots (no incoming edges)
  const roots = nodes.filter(n => (parents.get(n.id) ?? []).length === 0).map(n => n.id)
  if (roots.length === 0 && nodes.length > 0) roots.push(nodes[0].id)

  // BFS tier assignment
  const tier = new Map<string, number>()
  const queue = [...roots]
  roots.forEach(r => tier.set(r, 0))
  while (queue.length > 0) {
    const id = queue.shift()!
    const t = tier.get(id) ?? 0
    for (const child of children.get(id) ?? []) {
      if (!tier.has(child) || tier.get(child)! < t + 1) {
        tier.set(child, t + 1)
        queue.push(child)
      }
    }
  }

  // Group by tier
  const byTier = new Map<number, string[]>()
  for (const [id, t] of tier.entries()) {
    if (!byTier.has(t)) byTier.set(t, [])
    byTier.get(t)!.push(id)
  }

  // Position — center each tier
  const NODE_W = 240, NODE_H = 160, GAP_X = 60, GAP_Y = 80
  const positions: Record<string, { x: number; y: number }> = {}

  for (const [t, ids] of byTier.entries()) {
    const totalW = ids.length * NODE_W + (ids.length - 1) * GAP_X
    const startX = -totalW / 2
    ids.forEach((id, i) => {
      positions[id] = {
        x: startX + i * (NODE_W + GAP_X),
        y: t * (NODE_H + GAP_Y),
      }
    })
  }

  return positions
}

// ── LLM prompt ───────────────────────────────────────────────────────────────

const SYSTEM = `You are an expert multi-agent system architect.
Convert a user's workflow description into a JSON graph of agents and connections.
Respond with ONLY valid JSON — no markdown, no explanation.`

function buildPrompt(description: string): string {
  return `Design a multi-agent workflow for: "${description}"

Return this exact JSON structure:
{
  "name": "Short workflow name (max 5 words)",
  "description": "One sentence description",
  "complexity": "simple|medium|complex",
  "agents": [
    {
      "id": "1",
      "name": "Agent Name",
      "role": "orchestrator",
      "prompt": "Concise action-oriented system prompt (2-3 sentences max). State what to read from state and what to write.",
      "description": "One line role description"
    }
  ],
  "connections": [
    { "from": "1", "to": "2", "label": "" }
  ]
}

Design rules:
- 3 to 5 agents only
- First agent: role "orchestrator"
- Last agent: role "reviewer"  
- Middle agents: "researcher", "coder", or "custom"
- Available roles: orchestrator, researcher, coder, reviewer, custom
- Prompts must be SHORT and ACTION-ORIENTED (not generic)
- Prompts must mention reading from state[] and writing to state[]
- Orchestrator prompt MUST include the user's goal: "${description}"
- connections must form a connected graph
- Label connections only if they carry a condition (leave blank otherwise)
- Do NOT add loopback connections unless the workflow explicitly needs iteration`
}

// ── Parser ───────────────────────────────────────────────────────────────────

function parseAndEnrich(raw: string, description: string): GeneratedWorkflow {
  let json = raw.trim()
  const m = json.match(/\{[\s\S]*\}/)
  if (m) json = m[0]

  const parsed = JSON.parse(json)
  const complexity = parsed.complexity ?? 'medium'

  const rawNodes: { id: string; name: string; role: AgentRole; prompt: string; description: string }[] =
    parsed.agents ?? []
  const rawEdges: { from: string; to: string; label?: string }[] =
    parsed.connections ?? []

  // Layout
  const positions = layoutNodes(
    rawNodes.map(n => ({ id: n.id })),
    rawEdges.map(e => ({ source: e.from, target: e.to })),
  )

  const nodes: GeneratedNode[] = rawNodes.map(agent => ({
    id: agent.id,
    type: 'agent',
    position: positions[agent.id] ?? { x: 0, y: 0 },
    data: {
      agentName:    agent.name,
      role:         agent.role,
      model:        smartModel(agent.role, complexity),
      prompt:       agent.prompt,
      temperature:  smartTemperature(agent.role),
      maxTokens:    agent.role === 'reviewer' ? 2048 : 1024,
      status:       'idle',
      description:  agent.description,
      attachedTools: smartTools(agent.role),
    },
  }))

  const edges: GeneratedEdge[] = rawEdges.map((conn, i) => ({
    id: `e${i}`,
    source: conn.from,
    target: conn.to,
    animated: true,
    label: conn.label || undefined,
    style: { stroke: '#a1a1aa', strokeWidth: 1.5 },
  }))

  return {
    name:        parsed.name ?? description.slice(0, 40),
    description: parsed.description ?? description,
    nodes,
    edges,
  }
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function generateWorkflow(description: string): Promise<GeneratedWorkflow> {
  // 1. Try backend endpoint first
  try {
    const res = await fetch('http://localhost:8000/api/generate-workflow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description }),
    })
    if (res.ok) {
      const data = await res.json()
      return parseAndEnrich(JSON.stringify(data.raw ?? data), description)
    }
  } catch { /* fallback to direct API */ }

  // 2. Direct Anthropic API call from browser
  const apiKey = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('No API key — set VITE_ANTHROPIC_API_KEY in .env')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 2048,
      temperature: 0.2,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(description) }],
    }),
  })

  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error?.message ?? `API error ${res.status}`)
  }

  const data = await res.json()
  const content = data.content?.[0]?.text ?? ''
  return parseAndEnrich(content, description)
}
