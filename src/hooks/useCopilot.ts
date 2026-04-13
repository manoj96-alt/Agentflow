/**
 * useCopilot
 * ==========
 * Manages co-pilot state: fetching suggestions, accepting/rejecting them,
 * and triggering quick suggestions when a node is selected.
 *
 * Design:
 * - Full analysis fires 2s after the workflow stops changing (debounced)
 * - Quick analysis fires when a node is selected (300ms debounce)
 * - Suggestions are non-blocking — they never interrupt the user's flow
 * - Accepted suggestions auto-apply to the graph via callbacks
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import type { Node, Edge } from 'reactflow'
import type { AgentNodeData, AgentRole, AgentModel } from '../types'

const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'

// ── Suggestion type ───────────────────────────────────────────────────────────

export interface CopilotAction {
  node_role?:         string
  node_name?:         string
  node_prompt?:       string
  model?:             string
  connect_from?:      string | null
  connect_to?:        string | null
  edge_condition?:    string
  tool_name?:         string
  prompt_improvement?: string
}

export interface CopilotSuggestion {
  id:       string
  type:     string
  priority: 'high' | 'medium' | 'low'
  title:    string
  reason:   string
  action:   CopilotAction
  // UI state
  status?:  'pending' | 'accepted' | 'rejected'
  source?:  'workflow' | 'node'   // where it came from
}

export interface CopilotState {
  suggestions:       CopilotSuggestion[]
  workflowHealth:    'good' | 'fair' | 'needs_work' | null
  healthReason:      string
  isAnalysing:       boolean
  lastAnalysedAt:    number | null
}

// ── Hook ──────────────────────────────────────────────────────────────────────

interface UseCopilotOptions {
  nodes:          Node<AgentNodeData>[]
  edges:          Edge[]
  selectedNodeId: string | null
  goal?:          string
  enabled:        boolean
  onAddNode:      (role: AgentRole, name: string, prompt: string, model: AgentModel) => void
  onAddEdge:      (sourceId: string, targetId: string, condition?: string) => void
  onUpdatePrompt: (nodeId: string, prompt: string) => void
  onUpdateModel:  (nodeId: string, model: AgentModel) => void
}

export function useCopilot({
  nodes, edges, selectedNodeId, goal = '', enabled,
  onAddNode, onAddEdge, onUpdatePrompt, onUpdateModel,
}: UseCopilotOptions) {

  const [state, setState] = useState<CopilotState>({
    suggestions: [], workflowHealth: null, healthReason: '', isAnalysing: false, lastAnalysedAt: null,
  })

  const workflowDebounce  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nodeDebounce      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastNodeId        = useRef<string | null>(null)
  const lastNodeCount     = useRef(0)

  // ── Full workflow analysis ─────────────────────────────────────────────────
  const analyseWorkflow = useCallback(async () => {
    if (!enabled || nodes.length === 0) return
    setState(s => ({ ...s, isAnalysing: true }))

    try {
      const body = {
        goal,
        nodes: nodes.map(n => ({
          id:             n.id,
          role:           n.data.role,
          name:           n.data.agentName,
          prompt:         n.data.prompt ?? '',
          model:          n.data.model ?? '',
          attached_tools: n.data.attachedTools ?? [],
        })),
        edges: edges.map(e => ({
          source:    e.source,
          target:    e.target,
          condition: (e.data as any)?.condition?.expression ?? '',
        })),
      }

      const res  = await fetch(`${BASE}/api/copilot/suggest`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      const newSuggestions: CopilotSuggestion[] = (data.suggestions ?? []).map((s: any) => ({
        ...s, status: 'pending', source: 'workflow',
      }))

      setState(s => {
        // Keep rejected suggestions so user doesn't see them again
        const rejected = new Set(s.suggestions.filter(x => x.status === 'rejected').map(x => x.id))
        return {
          suggestions:    [...s.suggestions.filter(x => x.status === 'rejected'), ...newSuggestions.filter(x => !rejected.has(x.id))],
          workflowHealth: data.workflow_health ?? null,
          healthReason:   data.health_reason ?? '',
          isAnalysing:    false,
          lastAnalysedAt: Date.now(),
        }
      })
    } catch {
      setState(s => ({ ...s, isAnalysing: false }))
    }
  }, [enabled, nodes, edges, goal])

  // ── Quick node analysis ────────────────────────────────────────────────────
  const analyseNode = useCallback(async (nodeId: string) => {
    if (!enabled) return
    const node = nodes.find(n => n.id === nodeId)
    if (!node) return

    try {
      const body = {
        node_id:        nodeId,
        node_role:      node.data.role,
        node_name:      node.data.agentName,
        node_prompt:    node.data.prompt ?? '',
        workflow_roles: nodes.map(n => n.data.role),
      }
      const res  = await fetch(`${BASE}/api/copilot/quick`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      const newSugs: CopilotSuggestion[] = (data.suggestions ?? []).map((s: any) => ({
        ...s, status: 'pending', source: 'node',
      }))

      setState(s => {
        const rejected = new Set(s.suggestions.filter(x => x.status === 'rejected').map(x => x.id))
        // Remove previous node suggestions, add new ones
        const kept = s.suggestions.filter(x => x.source !== 'node' || x.status !== 'pending')
        return { ...s, suggestions: [...kept, ...newSugs.filter(x => !rejected.has(x.id))] }
      })
    } catch { /* silent */ }
  }, [enabled, nodes])

  // ── Debounced triggers ─────────────────────────────────────────────────────

  // Re-analyse when nodes/edges change (2s debounce)
  useEffect(() => {
    if (!enabled) return
    if (workflowDebounce.current) clearTimeout(workflowDebounce.current)
    // Only fire if node count changed (not on position moves)
    if (nodes.length !== lastNodeCount.current) {
      lastNodeCount.current = nodes.length
      workflowDebounce.current = setTimeout(analyseWorkflow, 2000)
    }
    return () => { if (workflowDebounce.current) clearTimeout(workflowDebounce.current) }
  }, [nodes.length, edges.length, enabled, analyseWorkflow])

  // Quick analysis when selected node changes (500ms debounce)
  useEffect(() => {
    if (!enabled || !selectedNodeId) return
    if (selectedNodeId === lastNodeId.current) return
    lastNodeId.current = selectedNodeId
    if (nodeDebounce.current) clearTimeout(nodeDebounce.current)
    nodeDebounce.current = setTimeout(() => analyseNode(selectedNodeId), 500)
    return () => { if (nodeDebounce.current) clearTimeout(nodeDebounce.current) }
  }, [selectedNodeId, enabled, analyseNode])

  // ── Accept / reject ────────────────────────────────────────────────────────

  const accept = useCallback((suggestion: CopilotSuggestion) => {
    const { type, action } = suggestion

    try {
      if (type === 'add_node' && action.node_role) {
        onAddNode(
          action.node_role as AgentRole,
          action.node_name  ?? action.node_role,
          action.node_prompt ?? '',
          (action.model ?? 'claude-sonnet-4-5') as AgentModel,
        )
        // If connect_from is specified, add edge after a tick (node needs to exist)
        if (action.connect_from) {
          setTimeout(() => {
            // The new node won't have an ID yet — we find it by name after add
          }, 100)
        }
      }

      if (type === 'add_edge' && action.connect_from && action.connect_to) {
        onAddEdge(action.connect_from, action.connect_to, action.edge_condition ?? '')
      }

      if (type === 'improve_prompt' && action.prompt_improvement) {
        const targetNode = nodes.find(n =>
          n.id === selectedNodeId || n.data.role === suggestion.action.node_role
        )
        if (targetNode) onUpdatePrompt(targetNode.id, action.prompt_improvement)
      }

      if (type === 'change_model' && action.model) {
        const targetNode = nodes.find(n => n.id === selectedNodeId)
        if (targetNode) onUpdateModel(targetNode.id, action.model as AgentModel)
      }

      if (type === 'add_loop' && action.connect_from && action.connect_to) {
        onAddEdge(action.connect_from, action.connect_to, action.edge_condition ?? "state['score'] < 75")
      }
    } catch (e) {
      console.warn('Co-pilot accept error:', e)
    }

    // Mark as accepted
    setState(s => ({
      ...s,
      suggestions: s.suggestions.map(sg =>
        sg.id === suggestion.id ? { ...sg, status: 'accepted' } : sg
      ),
    }))

    // Dismiss after 2s
    setTimeout(() => {
      setState(s => ({ ...s, suggestions: s.suggestions.filter(sg => sg.id !== suggestion.id) }))
    }, 2000)
  }, [nodes, selectedNodeId, onAddNode, onAddEdge, onUpdatePrompt, onUpdateModel])

  const reject = useCallback((id: string) => {
    setState(s => ({
      ...s,
      suggestions: s.suggestions.map(sg => sg.id === id ? { ...sg, status: 'rejected' } : sg),
    }))
    // Remove rejected after 800ms
    setTimeout(() => {
      setState(s => ({ ...s, suggestions: s.suggestions.filter(sg => sg.id !== id) }))
    }, 800)
  }, [])

  const dismissAll = useCallback(() => {
    setState(s => ({ ...s, suggestions: [] }))
  }, [])

  const pendingSuggestions = state.suggestions.filter(s => s.status === 'pending')

  return {
    ...state,
    pendingSuggestions,
    accept,
    reject,
    dismissAll,
    refresh: analyseWorkflow,
  }
}
