/**
 * FlowForge Adaptive Execution Engine v5
 * ========================================
 * Self-healing: retry with backup model → reduced tokens → simplified prompt
 * Failure isolation: one node failing never crashes the whole flow
 * Dynamic skip: conditional edges skip downstream nodes at runtime
 * Detailed telemetry: per-node retry records, healed flags, model used
 */

import type {
  FlowState, ExecutionLog, ExecutionResult, ExecutionOptions,
  NodeStatus, NodeIORecord, EdgeRoutingRecord,
  RetryRecord, NodeExecutionSummary,
} from '../types'
import type { Node, Edge } from 'reactflow'
import type { AgentNodeData, AgentModel } from '../types'
import { routeEdges } from './conditionEvaluator'
import { generate } from './llm'

// ─── Model fallback chains ─────────────────────────────────────────────────────
const FALLBACK_CHAIN: Record<string, AgentModel[]> = {
  'claude-opus-4-5':   ['claude-sonnet-4-5', 'claude-haiku-4-5'],
  'claude-sonnet-4-5': ['claude-haiku-4-5',  'gpt-4o-mini'],
  'claude-haiku-4-5':  ['gpt-4o-mini'],
  'gpt-4o':            ['gpt-4o-mini',       'claude-haiku-4-5'],
  'gpt-4o-mini':       ['claude-haiku-4-5'],
}
const getFallbacks = (m: string): AgentModel[] => FALLBACK_CHAIN[m] ?? ['claude-haiku-4-5']

// ─── Graph helpers ─────────────────────────────────────────────────────────────
interface CondEdge { id: string; target: string; expression: string; label?: string }

function buildCondAdj(edges: Edge[]): Map<string, CondEdge[]> {
  const adj = new Map<string, CondEdge[]>()
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, [])
    const c = (e.data as any)?.condition
    adj.get(e.source)!.push({ id: e.id, target: e.target, expression: c?.expression ?? '', label: c?.label ?? (e.label as string) ?? '' })
  }
  return adj
}

function buildPlainAdj(edges: Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>()
  for (const e of edges) { if (!adj.has(e.source)) adj.set(e.source, []); adj.get(e.source)!.push(e.target) }
  return adj
}

function findBackEdges(ids: string[], adj: Map<string, string[]>): Set<string> {
  const W=0,G=1,B=2; const color=new Map(ids.map(id=>[id,W])); const back=new Set<string>()
  function dfs(u:string){color.set(u,G);for(const v of adj.get(u)??[]){if(color.get(v)===G)back.add(v);else if(color.get(v)===W)dfs(v)}color.set(u,B)}
  for(const id of ids) if(color.get(id)===W) dfs(id)
  return back
}

function findRoots(ids: string[], edges: Edge[]): string[] {
  const hasIn = new Set(edges.map(e=>e.target))
  const r = ids.filter(id=>!hasIn.has(id))
  return r.length>0 ? r : ids.slice(0,1)
}

// ─── State helpers ─────────────────────────────────────────────────────────────
const SKIP = new Set(['flowStartTime','totalNodes','maxIterations','flowEndTime','totalSteps'])

function fmtState(state: FlowState): string {
  const entries = Object.entries(state).filter(([k])=>!k.startsWith('__')&&!SKIP.has(k)).slice(0,15)
  if (!entries.length) return '(empty)'
  return entries.map(([k,v])=>`  ${k}: ${String(typeof v==='object'?JSON.stringify(v):v).slice(0,250)}`).join('\n')
}

function parseUpdates(resp: string, nodeId: string): Record<string,unknown> {
  const u: Record<string,unknown> = { [`${nodeId}:output`]: resp }
  const m = resp.match(/##\s*STATE_UPDATES\s*\n([\s\S]*?)(?:\n##|\n---|\n$|$)/i)
  if (!m) return u
  for (const line of m[1].split('\n').map(l=>l.trim()).filter(Boolean)) {
    const sep=line.indexOf(':'); if(sep===-1) continue
    const key=line.slice(0,sep).trim(), raw=line.slice(sep+1).trim()
    if(!key) continue
    if(raw==='true'){u[key]=true;continue} if(raw==='false'){u[key]=false;continue}
    if(raw==='null'){u[key]=null;continue}
    const n=Number(raw); if(!isNaN(n)&&raw!==''){u[key]=n;continue}
    u[key]=raw
  }
  return u
}

// ─── Prompt builders ───────────────────────────────────────────────────────────
function fullPrompt(node: Node<AgentNodeData>, state: FlowState, iter: number, isLoop: boolean, maxIter: number): string {
  const loopNote = isLoop && iter>1 ? `\n⚠ LOOP ITERATION ${iter}/${maxIter} — improve previous output.` : ''
  return `${node.data.prompt}${loopNote}

## Shared State
${fmtState(state)}

## Your Task
You are the ${node.data.role} agent "${node.data.agentName}". Complete your role.

## STATE_UPDATES
${node.id}:status: completed
[add key:value results here]
score: [0-100 if reviewing]
approved: [true/false if reviewing]`
}

function simplePrompt(node: Node<AgentNodeData>): string {
  return `${node.data.prompt}\n\nComplete your task as the ${node.data.role} agent "${node.data.agentName}".\n\n## STATE_UPDATES\n${node.id}:status: completed`
}

// ─── Adaptive node executor ────────────────────────────────────────────────────
interface NodeResult {
  output: string; stateUpdates: Record<string,unknown>; io: NodeIORecord
  modelUsed: string; retries: RetryRecord[]; healed: boolean
  healStrategy: string; toolFallback: boolean
}

async function executeAdaptive(
  node: Node<AgentNodeData>, state: FlowState,
  iter: number, isLoop: boolean, maxIter: number,
): Promise<NodeResult> {
  const { agentName, role, model, temperature, maxTokens } = node.data
  const sys = `You are ${agentName}, a ${role} agent. Be concise and follow the output format.`
  const retries: RetryRecord[] = []
  const inputs = Object.fromEntries(Object.entries(state).filter(([k])=>!k.startsWith('__')&&!SKIP.has(k)).slice(0,10))
  const prompt = fullPrompt(node, state, iter, isLoop, maxIter)

  const finish = (output: string, usedModel: string, healed: boolean, strategy: string): NodeResult => {
    const u = parseUpdates(output, node.id)
    u[`${node.id}:model`] = usedModel; u.lastCompletedNode = node.id; u.lastCompletedRole = role
    return { output, stateUpdates: u, io: { inputs, outputs: u, llmPrompt: prompt, llmResponse: output },
      modelUsed: usedModel, retries, healed, healStrategy: strategy, toolFallback: false }
  }

  // Strategy 0: primary model, full prompt
  let t = Date.now()
  try { return finish(await generate(prompt, model, sys, maxTokens??1024, temperature??0.5).then(r=>r.content), model, false, '') }
  catch(e0) { retries.push({ attempt:1, model, error:String(e0), durationMs:Date.now()-t, strategy:'backup_model' }) }

  // Strategy 1: fallback models, full prompt
  for (const fb of getFallbacks(model)) {
    t = Date.now()
    try { return finish(await generate(prompt, fb, sys, maxTokens??1024, temperature??0.5).then(r=>r.content), fb, true, `backup_model:${fb}`) }
    catch(e1) { retries.push({ attempt:retries.length+1, model:fb, error:String(e1), durationMs:Date.now()-t, strategy:'backup_model' }) }
  }

  // Strategy 2: primary model, reduced tokens
  const half = Math.max(256, Math.floor((maxTokens??1024)/2))
  t = Date.now()
  try { return finish(await generate(prompt, model, sys, half, temperature??0.5).then(r=>r.content), model, true, `reduced_tokens:${half}`) }
  catch(e2) { retries.push({ attempt:retries.length+1, model, error:String(e2), durationMs:Date.now()-t, strategy:'reduced_tokens' }) }

  // Strategy 3: simplified prompt
  const sp = simplePrompt(node)
  t = Date.now()
  try { return finish(await generate(sp, model, sys, 512, 0.3).then(r=>r.content), model, true, 'simplified_prompt') }
  catch(e3) { retries.push({ attempt:retries.length+1, model, error:String(e3), durationMs:Date.now()-t, strategy:'simplified_prompt' }) }

  // All exhausted
  const lastErr = retries.at(-1)?.error ?? 'all strategies failed'
  const errOut = `[${agentName}] Failed after ${retries.length} attempts. Last error: ${lastErr}\n\n## STATE_UPDATES\n${node.id}:status: error\n${node.id}:error: ${lastErr}`
  const u = parseUpdates(errOut, node.id)
  return { output: errOut, stateUpdates: u, io: { inputs, outputs: u, llmPrompt: prompt, llmResponse: errOut },
    modelUsed: model, retries, healed: false, healStrategy: '', toolFallback: false }
}

// ─── Callbacks ─────────────────────────────────────────────────────────────────
export interface EngineCallbacks {
  onNodeStart:  (nodeId: string) => void
  onNodeEnd:    (nodeId: string, status: NodeStatus, output: string) => void
  onLog:        (entry: ExecutionLog) => void
  onEdgeRoute?: (edgeId: string, passed: boolean) => void
  onRetry?:     (nodeId: string, attempt: number, strategy: string, model: string) => void
  onHealed?:    (nodeId: string, strategy: string, model: string) => void
}

// ─── Main runner ────────────────────────────────────────────────────────────────
export async function runFlow(
  nodes: Node<AgentNodeData>[], edges: Edge[],
  options: ExecutionOptions = {}, callbacks: EngineCallbacks,
): Promise<ExecutionResult> {
  const t0 = Date.now()
  const MAX = options.maxIterations ?? 5

  const nodeMap  = new Map(nodes.map(n=>[n.id,n]))
  const ids      = nodes.map(n=>n.id)
  const plain    = buildPlainAdj(edges)
  const cond     = buildCondAdj(edges)
  const back     = findBackEdges(ids, plain)

  const state: FlowState = { flowStartTime:t0, totalNodes:nodes.length, maxIterations:MAX, ...(options.testInputs??{}) }
  const iterMap  = new Map(ids.map(id=>[id,0]))
  const logs: ExecutionLog[] = []

  let steps=0, retries=0, healed=0, early=false, cevals=0, cskips=0
  const failed:string[]=[], skipped:string[]=[], summaries:NodeExecutionSummary[]=[]

  const q = [...findRoots(ids,edges)]
  const inQ = new Set(q)

  const emit = (nodeId:string, iter:number, status:NodeStatus, msg:string, io:NodeIORecord, x:Partial<ExecutionLog>={}) => {
    const n = nodeMap.get(nodeId)
    logs.push({ nodeId, nodeName:n?.data.agentName??nodeId, role:n?.data.role??'custom',
      model:n?.data.model??'unknown', modelUsed:x.modelUsed??n?.data.model??'unknown',
      iteration:iter, status, message:msg, timestamp:Date.now(), io, stateSnapshot:{...state}, ...x })
    callbacks.onLog(logs.at(-1)!)
  }

  while (q.length > 0) {
    const nodeId = q.shift()!; inQ.delete(nodeId)
    const node = nodeMap.get(nodeId); if (!node) continue

    const iter = (iterMap.get(nodeId)??0)+1
    if (iter > MAX) {
      emit(nodeId, iter, 'skipped', `⚠ Max iterations (${MAX}) reached`, {inputs:{},outputs:{}}, {skippedReason:'max_iterations'})
      callbacks.onNodeEnd(nodeId,'skipped','Max iterations'); skipped.push(nodeId); early=true; continue
    }

    iterMap.set(nodeId, iter); steps++
    callbacks.onNodeStart(nodeId)
    const nodeT = Date.now()
    const isLoop = back.has(nodeId)

    emit(nodeId, iter, 'running', `${iter>1?`Loop ×${iter} — `:''}Calling ${node.data.model}…`, {inputs:{},outputs:{}})

    const result = await executeAdaptive(node, state, iter, isLoop, MAX)
    const dur = Date.now()-nodeT
    const isErr = result.output.includes(':status: error')

    result.retries.forEach(r => { callbacks.onRetry?.(nodeId, r.attempt, r.strategy, r.model); retries++ })
    if (result.healed) { callbacks.onHealed?.(nodeId, result.healStrategy, result.modelUsed); healed++ }

    Object.assign(state, result.stateUpdates)

    const status: NodeStatus = isErr ? 'error' : result.healed ? 'healed' : 'success'
    if (isErr) failed.push(nodeId)

    callbacks.onNodeEnd(nodeId, status, result.output)

    const retryNote = result.retries.length>0
      ? ` (${result.retries.length} retr${result.retries.length===1?'y':'ies'}${result.healed?', healed via '+result.healStrategy:', FAILED'})`
      : ''

    emit(nodeId, iter, status,
      result.output.slice(0,150)+(result.output.length>150?'…':'')+retryNote,
      result.io,
      { durationMs:dur, modelUsed:result.modelUsed,
        retries: result.retries.length>0 ? result.retries : undefined,
        healed: result.healed||undefined, healStrategy: result.healStrategy||undefined,
        toolFallback: result.toolFallback||undefined,
        error: isErr ? String(result.stateUpdates[`${nodeId}:error`]??'') : undefined })

    summaries.push({ nodeId, nodeName:node.data.agentName, status, totalRetries:result.retries.length,
      healed:result.healed, modelsUsed:[node.data.model,...result.retries.map(r=>r.model),result.modelUsed].filter((v,i,a)=>a.indexOf(v)===i),
      finalModel:result.modelUsed, durationMs:dur, toolFallback:result.toolFallback })

    // Route edges
    const routes = routeEdges(cond.get(nodeId)??[], state)
    const routing: EdgeRoutingRecord[] = routes.map(r=>({ edgeId:r.edgeId, source:nodeId, target:r.target, condition:r.expression, result:r.passed, error:r.error }))
    if (logs.length>0) logs.at(-1)!.routing = routing

    for (const r of routes) {
      if (r.expression) {
        cevals++
        if (!r.passed) {
          cskips++; callbacks.onEdgeRoute?.(r.edgeId, false)
          emit(r.target, 0, 'skipped', `Skipped — condition not met: ${r.expression}`, {inputs:{},outputs:{}}, {skippedReason:`condition:${r.expression}`})
          skipped.push(r.target); continue
        }
        callbacks.onEdgeRoute?.(r.edgeId, true)
      }
      const si = iterMap.get(r.target)??0
      const isB = back.has(r.target)
      if (isB) { if(si<MAX&&!inQ.has(r.target)){q.push(r.target);inQ.add(r.target)} }
      else if (!inQ.has(r.target)) { q.push(r.target); inQ.add(r.target) }
    }
  }

  state.flowEndTime = Date.now(); state.totalSteps = steps

  const base: ExecutionResult = {
    success: failed.length===0&&!early, totalSteps:steps,
    iterations: Object.fromEntries(iterMap), loopsDetected:back.size>0,
    terminatedEarly:early, conditionalsEvaluated:cevals, conditionalsSkipped:cskips,
    logs, finalState:{...state}, durationMs:Date.now()-t0,
    totalRetries:retries, healedNodes:healed,
    failedNodes:[...new Set(failed)], skippedNodes:[...new Set(skipped)], nodeSummaries:summaries,
  }

  if (options.testMode && options.expectedOutputs?.length) {
    const tr = evaluateAssertions(options.expectedOutputs, state)
    return { ...base, testMode:true as const, testResults:tr, passCount:tr.filter(r=>r.passed).length, failCount:tr.filter(r=>!r.passed).length } as any
  }
  return base
}

// ─── Test assertions ───────────────────────────────────────────────────────────
import type { TestAssertion, TestResult } from '../types'

function evaluateAssertions(assertions: TestAssertion[], state: Record<string,unknown>): TestResult[] {
  return assertions.map(a => {
    const actual = state[a.key]; let passed=false
    try {
      switch(a.operator) {
        case '==': passed=actual==a.expected; break; case '!=': passed=actual!=a.expected; break
        case '>':  passed=(actual as number)>(a.expected as number); break
        case '<':  passed=(actual as number)<(a.expected as number); break
        case '>=': passed=(actual as number)>=(a.expected as number); break
        case '<=': passed=(actual as number)<=(a.expected as number); break
        case 'contains': passed=String(actual).includes(String(a.expected)); break
        case 'exists':   passed=actual!==undefined&&actual!==null; break
      }
    } catch {}
    return { assertion:a, actual, passed,
      message: passed ? `✓ ${a.key} ${a.operator} ${JSON.stringify(a.expected)}`
                      : `✕ Expected ${a.key} ${a.operator} ${JSON.stringify(a.expected)}, got ${JSON.stringify(actual)}` }
  })
}
