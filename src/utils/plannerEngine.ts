/**
 * plannerEngine.ts
 * ================
 * Dynamic workflow execution driven by a Planner agent.
 *
 * In "planner mode":
 * 1. The Planner node runs first and produces an ExecutionPlan JSON.
 * 2. The engine follows the plan — not the static edge graph.
 * 3. Each step is executed in dependency order (parallel where deps allow).
 * 4. After all workers complete, the Evaluator validates and may trigger retry.
 * 5. Agents communicate via typed messages stored in shared state.
 *
 * Message protocol:
 *   state["messages"]     = AgentMessage[]  (append-only log)
 *   state["msg:{nodeId}"] = latest message TO that node
 *
 * State write protocol (same as executionEngine):
 *   Agent ends response with:
 *   ## STATE_UPDATES
 *   key: value
 */

import type {
  FlowState, ExecutionLog, ExecutionResult,
  NodeStatus, NodeIORecord, EdgeRoutingRecord,
  AgentMessage, ExecutionPlan, PlanStep,
} from '../types'
import type { Node } from 'reactflow'
import type { AgentNodeData } from '../types'
import { generate } from './llm'

// ─── Message helpers ──────────────────────────────────────────────────────────

export function sendMessage(
  state: FlowState,
  from: string,
  to: string,
  content: string,
  type: AgentMessage['type'],
  iteration: number,
): FlowState {
  const msg: AgentMessage = { from, to, content, type, timestamp: Date.now(), iteration }
  const messages = [...((state['messages'] as AgentMessage[]) ?? []), msg]
  return {
    ...state,
    messages,
    [`msg:${to}`]: msg,   // latest message for quick lookup
  }
}

export function getMessagesFor(state: FlowState, nodeId: string): AgentMessage[] {
  const all = (state['messages'] as AgentMessage[]) ?? []
  return all.filter(m => m.to === nodeId || m.to === 'broadcast')
}

// ─── State parser (same as executionEngine) ───────────────────────────────────

function parseStateUpdates(response: string, nodeId: string): Record<string, unknown> {
  const updates: Record<string, unknown> = { [`${nodeId}:output`]: response }
  const match = response.match(/##\s*STATE_UPDATES\s*\n([\s\S]*?)(?:\n##|\n---|\n$|$)/i)
  if (!match) return updates
  for (const line of match[1].split('\n').map(l => l.trim()).filter(Boolean)) {
    const sep = line.indexOf(':')
    if (sep === -1) continue
    const key = line.slice(0, sep).trim()
    const raw = line.slice(sep + 1).trim()
    if (!key) continue
    if (raw === 'true')  { updates[key] = true;  continue }
    if (raw === 'false') { updates[key] = false; continue }
    if (raw === 'null')  { updates[key] = null;  continue }
    const num = Number(raw)
    if (!isNaN(num) && raw !== '') { updates[key] = num; continue }
    updates[key] = raw
  }
  return updates
}

function formatState(state: FlowState): string {
  const SKIP = new Set(['flowStartTime', 'totalNodes', 'maxIterations', 'messages'])
  return Object.entries(state)
    .filter(([k]) => !k.startsWith('__') && !SKIP.has(k))
    .slice(0, 12)
    .map(([k, v]) => `  ${k}: ${String(typeof v === 'object' ? JSON.stringify(v) : v).slice(0, 250)}`)
    .join('\n') || '  (empty)'
}

// ─── Planner prompt ───────────────────────────────────────────────────────────

function buildPlannerPrompt(
  plannerNode: Node<AgentNodeData>,
  workers: Node<AgentNodeData>[],
  goal: string,
  state: FlowState,
): string {
  const workerList = workers.map(w =>
    `  - id="${w.id}" name="${w.data.agentName}" role="${w.data.role}" prompt="${w.data.prompt.slice(0, 100)}"`
  ).join('\n')

  return `${plannerNode.data.prompt}

## Goal
${goal}

## Available Worker Agents
${workerList}

## Current Shared State
${formatState(state)}

## Your Task
Create a step-by-step execution plan for the workers to achieve the goal.

Respond with your reasoning, then output an execution plan as JSON:

## EXECUTION_PLAN
{
  "goal": "${goal}",
  "steps": [
    {
      "nodeId": "<worker agent id from the list above>",
      "instruction": "<specific task for this agent — be precise>",
      "dependsOn": [],
      "condition": ""
    }
  ]
}

## STATE_UPDATES
planner:plan_ready: true
planner:goal: ${goal}

Rules:
- Only reference nodeIds from the Available Worker Agents list
- dependsOn must be an array of nodeIds that must complete before this step
- Empty dependsOn = can run immediately (or in parallel with other step-0 nodes)
- condition = JS expression using state[] to skip this step (empty = always run)
- The last step should always be the evaluator agent (if one exists)`
}

// ─── Worker prompt ────────────────────────────────────────────────────────────

function buildWorkerPrompt(
  workerNode: Node<AgentNodeData>,
  step: PlanStep,
  state: FlowState,
  inboundMessages: AgentMessage[],
): string {
  const msgBlock = inboundMessages.length > 0
    ? `\n## Messages from Other Agents\n${inboundMessages.map(m =>
        `  [${m.type}] from ${m.from}: ${m.content.slice(0, 200)}`
      ).join('\n')}`
    : ''

  return `${workerNode.data.prompt}

## Your Assigned Task (from Planner)
${step.instruction}
${msgBlock}

## Shared State
${formatState(state)}

Complete your task. Share results with other agents using STATE_UPDATES.

## STATE_UPDATES
${workerNode.id}:status: completed
[add your key results here — other agents and the evaluator will read them]`
}

// ─── Evaluator prompt ─────────────────────────────────────────────────────────

function buildEvaluatorPrompt(
  evalNode: Node<AgentNodeData>,
  plan: ExecutionPlan,
  state: FlowState,
  iteration: number,
  maxIterations: number,
): string {
  return `${evalNode.data.prompt}

## Evaluation Task
Review all worker outputs and decide if the goal has been achieved.

## Original Goal
${plan.goal}

## Worker Outputs
${formatState(state)}

## Iteration ${iteration}/${maxIterations}

Evaluate quality 0-100. Be strict — only approve if the goal is truly met.

## STATE_UPDATES
score: <0-100>
evaluator:approved: <true if score >= 75, else false>
evaluator:feedback: <specific improvements needed if not approved>
evaluator:verdict: <approved|needs_revision|failed>
${evalNode.id}:status: completed`
}

// ─── Plan parser ──────────────────────────────────────────────────────────────

function parsePlan(response: string, plannerNodeId: string): ExecutionPlan | null {
  const match = response.match(/##\s*EXECUTION_PLAN\s*\n([\s\S]*?)(?:\n##|\n---|\n$|$)/i)
  if (!match) return null
  try {
    const raw = match[1].trim()
    const parsed = JSON.parse(raw)
    return {
      planId:      `plan_${Date.now()}`,
      goal:        parsed.goal ?? '',
      steps:       (parsed.steps ?? []).map((s: any) => ({
        nodeId:      s.nodeId,
        agentName:   s.agentName ?? s.nodeId,
        role:        s.role ?? 'worker',
        instruction: s.instruction ?? '',
        dependsOn:   s.dependsOn ?? [],
        condition:   s.condition ?? '',
      })),
      generatedBy:  plannerNodeId,
      timestamp:    Date.now(),
    }
  } catch {
    return null
  }
}

// ─── Condition evaluator ──────────────────────────────────────────────────────

function evalCondition(expression: string, state: FlowState): boolean {
  if (!expression?.trim()) return true
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function('state', `"use strict"; return (${expression})`)(state))
  } catch { return true }
}

// ─── Callbacks ────────────────────────────────────────────────────────────────

export interface PlannerCallbacks {
  onNodeStart:     (nodeId: string, role: string) => void
  onNodeEnd:       (nodeId: string, status: NodeStatus, output: string) => void
  onLog:           (entry: ExecutionLog) => void
  onPlanReady?:    (plan: ExecutionPlan) => void
  onMessage?:      (msg: AgentMessage) => void
}

// ─── Main planner runner ──────────────────────────────────────────────────────

export async function runPlannerFlow(
  nodes: Node<AgentNodeData>[],
  goal: string,
  maxIterations: number,
  callbacks: PlannerCallbacks,
): Promise<ExecutionResult> {
  const startTime = Date.now()
  const logs: ExecutionLog[] = []
  let totalSteps = 0

  const nodeMap = new Map(nodes.map(n => [n.id, n]))

  // Find planner, workers, evaluator
  const plannerNode   = nodes.find(n => n.data.role === 'planner' || n.data.role === 'orchestrator')
  const evaluatorNode = nodes.find(n => n.data.role === 'evaluator' || n.data.role === 'reviewer')
  const workerNodes   = nodes.filter(n => n.id !== plannerNode?.id && n.id !== evaluatorNode?.id)

  if (!plannerNode) {
    return {
      success: false, totalSteps: 0, iterations: {}, loopsDetected: false,
      terminatedEarly: true, conditionalsEvaluated: 0, conditionalsSkipped: 0,
      logs: [], finalState: {}, durationMs: 0,
    }
  }

  const sharedState: FlowState = {
    flowStartTime: startTime, totalNodes: nodes.length,
    maxIterations, plannerMode: true, goal,
    messages: [] as AgentMessage[],
  }

  function emitLog(
    nodeId: string, iteration: number, status: NodeStatus,
    message: string, io: NodeIORecord, durationMs?: number, error?: string,
  ) {
    const node = nodeMap.get(nodeId)
    const entry: ExecutionLog = {
      nodeId,
      nodeName:  node?.data.agentName ?? nodeId,
      role:      node?.data.role ?? 'worker',
      model:     node?.data.model ?? 'unknown',
      iteration, status, message,
      timestamp: Date.now(), durationMs, io, error,
      stateSnapshot: { ...sharedState },
    }
    logs.push(entry)
    callbacks.onLog(entry)
  }

  async function runNode(
    node: Node<AgentNodeData>,
    prompt: string,
    iteration: number,
  ): Promise<string> {
    const system = `You are ${node.data.agentName}, a ${node.data.role} agent. Be concise and follow the output format exactly.`
    try {
      const resp = await generate(prompt, node.data.model, system, node.data.maxTokens ?? 1024, node.data.temperature ?? 0.4)
      return resp.content
    } catch (err) {
      return `[${node.data.agentName}] Error: ${err instanceof Error ? err.message : err}

## STATE_UPDATES
${node.id}:status: error
${node.id}:error: ${err}`
    }
  }

  let globalIteration = 0
  let plan: ExecutionPlan | null = null

  // ── Phase 1: Planner generates the execution plan ────────────────────────
  globalIteration++
  totalSteps++
  callbacks.onNodeStart(plannerNode.id, plannerNode.data.role)
  const t0 = Date.now()
  emitLog(plannerNode.id, 1, 'running',
    `Planner generating execution plan for: "${goal.slice(0, 60)}"…`,
    { inputs: {}, outputs: {} })

  const plannerPrompt = buildPlannerPrompt(plannerNode, workerNodes, goal, sharedState)
  const plannerResponse = await runNode(plannerNode, plannerPrompt, 1)

  const plannerUpdates = parseStateUpdates(plannerResponse, plannerNode.id)
  Object.assign(sharedState, plannerUpdates)

  plan = parsePlan(plannerResponse, plannerNode.id)

  if (plan) {
    sharedState['__plan__'] = plan
    callbacks.onPlanReady?.(plan)

    // Send plan instructions as messages to each worker
    for (const step of plan.steps) {
      const targetNode = nodeMap.get(step.nodeId)
      if (targetNode) {
        const updated = sendMessage(sharedState, plannerNode.id, step.nodeId,
          step.instruction, 'instruction', 1)
        Object.assign(sharedState, updated)
        callbacks.onMessage?.(updated[`msg:${step.nodeId}`] as AgentMessage)
      }
    }
  }

  callbacks.onNodeEnd(plannerNode.id, 'success', plannerResponse)
  emitLog(plannerNode.id, 1, 'success',
    plan ? `Plan ready — ${plan.steps.length} steps` : 'Plan generated (fallback mode)',
    { inputs: {}, outputs: plannerUpdates }, Date.now() - t0)

  // ── Phase 2: Execute plan steps in dependency order ──────────────────────
  const stepsToRun: PlanStep[] = plan?.steps.filter(s => {
    const node = nodeMap.get(s.nodeId)
    return node && node.id !== evaluatorNode?.id
  }) ?? workerNodes.map(w => ({
    nodeId: w.id, agentName: w.data.agentName, role: w.data.role,
    instruction: `Complete your role: ${w.data.prompt.slice(0, 100)}`,
    dependsOn: [], condition: '',
  }))

  const completed = new Set<string>()

  // Topological execution
  let safetyCounter = 0
  while (completed.size < stepsToRun.length && safetyCounter < 50) {
    safetyCounter++
    // Find runnable steps (deps met, not yet completed)
    const runnable = stepsToRun.filter(step => {
      if (completed.has(step.nodeId)) return false
      if (!evalCondition(step.condition ?? '', sharedState)) {
        completed.add(step.nodeId)
        return false
      }
      return step.dependsOn.every(dep => completed.has(dep))
    })

    if (runnable.length === 0) break  // no progress — break

    // Run all runnable steps in parallel
    await Promise.all(runnable.map(async (step) => {
      const workerNode = nodeMap.get(step.nodeId)
      if (!workerNode) { completed.add(step.nodeId); return }

      globalIteration++
      totalSteps++
      callbacks.onNodeStart(step.nodeId, workerNode.data.role)
      const tw = Date.now()
      const inbound = getMessagesFor(sharedState, step.nodeId)
      const workerPrompt = buildWorkerPrompt(workerNode, step, sharedState, inbound)

      emitLog(step.nodeId, 1, 'running',
        `Worker executing: ${step.instruction.slice(0, 60)}…`,
        { inputs: {}, outputs: {} })

      const workerResponse = await runNode(workerNode, workerPrompt, 1)
      const workerUpdates = parseStateUpdates(workerResponse, step.nodeId)
      Object.assign(sharedState, workerUpdates)

      // Broadcast result to all other workers and evaluator
      const resultMsg = sendMessage(
        sharedState, step.nodeId, 'broadcast',
        workerResponse.slice(0, 300), 'result', 1,
      )
      Object.assign(sharedState, resultMsg)
      callbacks.onMessage?.(resultMsg['messages'] as any)

      completed.add(step.nodeId)
      callbacks.onNodeEnd(step.nodeId, 'success', workerResponse)
      emitLog(step.nodeId, 1, 'success',
        workerResponse.slice(0, 120) + (workerResponse.length > 120 ? '…' : ''),
        { inputs: {}, outputs: workerUpdates }, Date.now() - tw)
    }))
  }

  // ── Phase 3: Evaluator validates and may trigger retry ───────────────────
  let evalIteration = 0
  const MAX_EVAL = Math.min(maxIterations, 3)

  while (evaluatorNode && evalIteration < MAX_EVAL) {
    evalIteration++
    totalSteps++
    callbacks.onNodeStart(evaluatorNode.id, evaluatorNode.data.role)
    const te = Date.now()

    emitLog(evaluatorNode.id, evalIteration, 'running',
      `Evaluator validating outputs (attempt ${evalIteration}/${MAX_EVAL})…`,
      { inputs: {}, outputs: {} })

    const evalPrompt = buildEvaluatorPrompt(
      evaluatorNode, plan ?? { planId: '', goal, steps: [], generatedBy: plannerNode.id, timestamp: Date.now() },
      sharedState, evalIteration, MAX_EVAL,
    )
    const evalResponse = await runNode(evaluatorNode, evalPrompt, evalIteration)
    const evalUpdates = parseStateUpdates(evalResponse, evaluatorNode.id)
    Object.assign(sharedState, evalUpdates)

    const approved = sharedState['evaluator:approved'] === true || sharedState['approved'] === true
    const score    = Number(sharedState['score'] ?? 0)

    callbacks.onNodeEnd(evaluatorNode.id, 'success', evalResponse)
    emitLog(evaluatorNode.id, evalIteration, 'success',
      `Score: ${score} — ${approved ? '✓ Approved' : '✕ Needs revision'}`,
      { inputs: {}, outputs: evalUpdates }, Date.now() - te)

    if (approved || evalIteration >= MAX_EVAL) break

    // Not approved — planner re-plans with feedback
    if (evalIteration < MAX_EVAL) {
      const feedback = String(sharedState['evaluator:feedback'] ?? 'Improve quality')
      const rePlanMsg = sendMessage(sharedState, evaluatorNode.id, plannerNode.id,
        `Revision needed: ${feedback}`, 'feedback', evalIteration)
      Object.assign(sharedState, rePlanMsg)
      callbacks.onMessage?.(rePlanMsg[`msg:${plannerNode.id}`] as AgentMessage)

      // Quick re-execution of workers with evaluator feedback in state
      sharedState['evaluator:revision_request'] = feedback
      for (const step of stepsToRun.slice(0, 2)) {   // re-run first 2 workers
        const wNode = nodeMap.get(step.nodeId)
        if (!wNode) continue
        totalSteps++
        callbacks.onNodeStart(step.nodeId, wNode.data.role)
        const tr = Date.now()
        const rMsg = getMessagesFor(sharedState, step.nodeId)
        const rPrompt = buildWorkerPrompt(wNode, { ...step, instruction: `REVISION: ${feedback}\n\n${step.instruction}` }, sharedState, rMsg)
        const rResponse = await runNode(wNode, rPrompt, evalIteration + 1)
        const rUpdates = parseStateUpdates(rResponse, step.nodeId)
        Object.assign(sharedState, rUpdates)
        callbacks.onNodeEnd(step.nodeId, 'success', rResponse)
        emitLog(step.nodeId, evalIteration + 1, 'success',
          `Revised: ${rResponse.slice(0, 80)}…`, { inputs: {}, outputs: rUpdates }, Date.now() - tr)
      }
    }
  }

  sharedState.flowEndTime = Date.now()
  sharedState.totalSteps  = totalSteps

  return {
    success:               !logs.some(l => l.status === 'error'),
    totalSteps,
    iterations:            Object.fromEntries(nodes.map(n => [n.id, 1])),
    loopsDetected:         evalIteration > 1,
    terminatedEarly:       false,
    conditionalsEvaluated: stepsToRun.filter(s => s.condition).length,
    conditionalsSkipped:   0,
    logs,
    finalState:            { ...sharedState },
    durationMs:            Date.now() - startTime,
  }
}
