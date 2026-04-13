import { useState, useCallback, useRef } from 'react'
import { useNodesState, useEdgesState, addEdge } from 'reactflow'
import type { Connection, Edge, Node } from 'reactflow'
import type { AgentNodeData, AgentRole, AgentModel, ExecutionResult, ExecutionLog, EdgeCondition } from '../types'
import { runFlow } from '../utils/executionEngine'
import { runPlannerFlow } from '../utils/plannerEngine'
import type { ExecutionPlan, AgentMessage } from '../types'

const DEFAULT_MODEL: AgentModel = 'claude-sonnet-4-5'

const roleDefaults: Record<AgentRole, Partial<AgentNodeData>> = {
  orchestrator: { agentName: 'Orchestrator', prompt: 'You coordinate tasks across agents. Break down the goal and delegate.', model: DEFAULT_MODEL, temperature: 0.3 },
  researcher:   { agentName: 'Researcher',   prompt: 'You gather and synthesize information. Return structured findings.', model: DEFAULT_MODEL, temperature: 0.5 },
  coder:        { agentName: 'Coder',        prompt: 'You write clean, well-documented code. Follow best practices.', model: DEFAULT_MODEL, temperature: 0.2 },
  reviewer:     { agentName: 'Reviewer',     prompt: 'You review outputs for quality. Write state["score"] (0-100) and state["reviewer:approved"] (true/false).', model: DEFAULT_MODEL, temperature: 0.4 },
  custom:       { agentName: 'Custom Agent', prompt: '', model: DEFAULT_MODEL, temperature: 0.7 },
}

const initialNodes: Node<AgentNodeData>[] = [
  { id: '1', type: 'agent', position: { x: 200, y: 60 },  data: { ...roleDefaults.orchestrator, role: 'orchestrator', maxTokens: 2000, status: 'idle' } as AgentNodeData },
  { id: '2', type: 'agent', position: { x: 60, y: 260 },  data: { ...roleDefaults.researcher,   role: 'researcher',   maxTokens: 2000, status: 'idle' } as AgentNodeData },
  { id: '3', type: 'agent', position: { x: 340, y: 260 }, data: { ...roleDefaults.coder,        role: 'coder',        maxTokens: 4000, status: 'idle' } as AgentNodeData },
  { id: '4', type: 'agent', position: { x: 200, y: 460 }, data: { ...roleDefaults.reviewer,     role: 'reviewer',     maxTokens: 2000, status: 'idle' } as AgentNodeData },
]

// Demo: reviewer→orchestrator loopback has a condition: only loop if score < 75
const initialEdges: Edge[] = [
  { id: 'e1-2', source: '1', target: '2', animated: true, style: { stroke: '#6366f1', strokeWidth: 2 } },
  { id: 'e1-3', source: '1', target: '3', animated: true, style: { stroke: '#6366f1', strokeWidth: 2 } },
  { id: 'e2-4', source: '2', target: '4', style: { stroke: '#6366f155', strokeWidth: 1.5 } },
  { id: 'e3-4', source: '3', target: '4', style: { stroke: '#6366f155', strokeWidth: 1.5 } },
  {
    id: 'e4-1', source: '4', target: '1', animated: true,
    label: 'score < 75',
    labelStyle: { fill: '#f59e0b', fontSize: 10 },
    labelBgStyle: { fill: '#0d0f1a' },
    style: { stroke: '#f59e0b', strokeWidth: 1.5, strokeDasharray: '6 3' },
    data: { condition: { expression: "state['score'] < 75", label: 'score < 75', description: 'Loop back if quality score is below threshold' } },
  },
]

export const useAgentFlow = (maxIterations = 5) => {
  const [nodes, setNodes, onNodesChange] = useNodesState<AgentNodeData>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)
  const [selectedNodeId, setSelectedNodeId]     = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId]     = useState<string | null>(null)
  const [isExecuting, setIsExecuting]           = useState(false)
  const [executionResult, setExecutionResult]   = useState<ExecutionResult | null>(null)
  const [executionLogs, setExecutionLogs]       = useState<ExecutionLog[]>([])
  const logsRef = useRef<ExecutionLog[]>([])

  const onConnect = useCallback(
    (params: Connection) => setEdges(eds => addEdge({
      ...params, animated: true,
      style: { stroke: '#6366f1', strokeWidth: 2 },
    }, eds)),
    [setEdges]
  )

  const addAgentNode = useCallback((
    role: AgentRole,
    position: { x: number; y: number },
    nameOverride?: string,
    promptOverride?: string,
    modelOverride?: AgentModel,
  ) => {
    const id = `agent_${Date.now()}`
    const defaults = roleDefaults[role]
    setNodes(nds => [...nds, {
      id, type: 'agent', position,
      data: {
        ...defaults,
        role,
        maxTokens: 2000,
        status: 'idle',
        ...(nameOverride  ? { agentName:   nameOverride  } : {}),
        ...(promptOverride? { prompt:       promptOverride} : {}),
        ...(modelOverride ? { model:        modelOverride } : {}),
      } as AgentNodeData,
    }])
  }, [setNodes])

  const updateNodeData = useCallback((nodeId: string, patch: Partial<AgentNodeData>) => {
    setNodes(nds => nds.map(n => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n))
  }, [setNodes])

  const updateEdgeCondition = useCallback((edgeId: string, condition: EdgeCondition | null) => {
    setEdges(eds => {
      // Detect loopback edges using simple cycle check
      const sources = new Set(eds.map(e => e.source))
      const targets = new Set(eds.map(e => e.target))
      const isLoopback = (e: typeof eds[0]) => {
        // An edge is a loopback if its target has a path back to its source
        // Simple heuristic: if target appears as source of an edge pointing toward the source
        const target = e.target
        const source = e.source
        return eds.some(other => other.source === target && eds.some(back => back.source === back.target || (back.source === target && back.target === source)))
      }

      return eds.map(e => {
        if (e.id !== edgeId) return e
        if (!condition) {
          const { data, label, labelStyle, labelBgStyle, ...rest } = e
          return { ...rest, style: { stroke: '#a1a1aa', strokeWidth: 1.5 }, animated: true }
        }
        const loopback = (e.data as any)?.isLoopback ?? false
        return {
          ...e,
          label: (condition.label || condition.expression) + (loopback ? ' ↺' : ''),
          labelStyle: { fill: '#d97706', fontSize: 10, fontFamily: 'var(--mono)' },
          labelBgStyle: { fill: '#fffbeb', padding: 3 },
          style: { stroke: '#d97706', strokeWidth: 2, strokeDasharray: '5 3' },
          animated: true,
          data: { ...((e.data as any) || {}), condition },
        }
      })
    })
    setSelectedEdgeId(null)
  }, [setEdges])

  const clearCanvas = useCallback(() => {
    setNodes([]); setEdges([]); setSelectedNodeId(null); setSelectedEdgeId(null)
    setExecutionResult(null); setExecutionLogs([])
  }, [setNodes, setEdges])

  const resetStatuses = useCallback(() => {
    setNodes(nds => nds.map(n => ({ ...n, data: { ...n.data, status: 'idle', iterationCount: 0, lastOutput: undefined } })))
    // Reset edge styles
    setEdges(eds => eds.map(e => {
      const hasCondition = !!(e.data as any)?.condition
      return {
        ...e,
        style: hasCondition
          ? { stroke: '#f59e0b', strokeWidth: 2, strokeDasharray: '5 3' }
          : { stroke: '#6366f1', strokeWidth: 1.5 },
      }
    }))
  }, [setNodes, setEdges])

  const executeFlow = useCallback(async () => {
    if (isExecuting) return
    setIsExecuting(true)
    setExecutionResult(null)
    logsRef.current = []
    setExecutionLogs([])
    resetStatuses()

    const snapNodes = [...nodes]
    const snapEdges = [...edges]

    const result = await runFlow(snapNodes, snapEdges, { maxIterations }, {
      onNodeStart: (nodeId) => {
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: 'running', iterationCount: (n.data.iterationCount ?? 0) + 1 } }
          : n))
      },
      onNodeEnd: (nodeId, status, output) => {
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: status as AgentNodeData['status'], lastOutput: output } }
          : n))
      },
      onLog: (entry) => {
        logsRef.current = [...logsRef.current, entry]
        setExecutionLogs([...logsRef.current])
      },
      onRetry: (nodeId, attempt, strategy, model) => {
        // Flash the node amber to signal retry in progress
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: 'retrying' as AgentNodeData['status'] } }
          : n))
        console.info(`[Adaptive] Retry ${attempt} on ${nodeId}: ${strategy} → ${model}`)
      },
      onHealed: (nodeId, strategy, model) => {
        console.info(`[Adaptive] Healed ${nodeId} via ${strategy} using ${model}`)
      },
      onEdgeRoute: (edgeId, passed) => {
        // Flash edge green (taken) or red (skipped)
        setEdges(eds => eds.map(e => {
          if (e.id !== edgeId) return e
          return {
            ...e,
            style: {
              ...(e.style || {}),
              stroke: passed ? '#34d399' : '#f87171',
              strokeWidth: passed ? 2.5 : 1,
              opacity: passed ? 1 : 0.4,
            },
          }
        }))
      },
    })

    setExecutionResult(result)
    setIsExecuting(false)
    setTimeout(resetStatuses, 4000)
  }, [isExecuting, nodes, edges, maxIterations, resetStatuses])

  const [testRunResult, setTestRunResult]   = useState<any>(null)
  const [isTestRunning, setIsTestRunning]   = useState(false)
  const [isPlannerMode, setIsPlannerMode]   = useState(false)
  const [currentPlan, setCurrentPlan]       = useState<ExecutionPlan | null>(null)
  const [plannerMessages, setPlannerMessages] = useState<AgentMessage[]>([])

  const testRun = useCallback(async (
    testInputs: Record<string, unknown>,
    expectedOutputs: import('../types').TestAssertion[],
  ) => {
    if (isTestRunning || isExecuting) return
    setIsTestRunning(true)
    setTestRunResult(null)
    resetStatuses()

    const snapNodes = [...nodes]
    const snapEdges = [...edges]

    const result = await runFlow(snapNodes, snapEdges, {
      maxIterations,
      testMode: true,
      testInputs,
      expectedOutputs,
    }, {
      onNodeStart: (nodeId) => {
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: 'running', iterationCount: (n.data.iterationCount ?? 0) + 1 } }
          : n))
      },
      onNodeEnd: (nodeId, status, output) => {
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: status as AgentNodeData['status'], lastOutput: output } }
          : n))
      },
      onLog: () => {},  // test runs don't need live log streaming
    })

    setTestRunResult(result)
    setIsTestRunning(false)
    setTimeout(resetStatuses, 3000)
  }, [isTestRunning, isExecuting, nodes, edges, maxIterations, resetStatuses])

  const plannerRun = useCallback(async (goal: string) => {
    if (isExecuting) return
    setIsExecuting(true)
    setExecutionResult(null)
    logsRef.current = []
    setExecutionLogs([])
    setCurrentPlan(null)
    setPlannerMessages([])
    resetStatuses()

    const snapNodes = [...nodes]

    const result = await runPlannerFlow(snapNodes, goal, maxIterations, {
      onNodeStart: (nodeId) => {
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: 'running', iterationCount: (n.data.iterationCount ?? 0) + 1 } }
          : n))
      },
      onNodeEnd: (nodeId, status, output) => {
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: status as AgentNodeData['status'], lastOutput: output } }
          : n))
      },
      onLog: (entry) => {
        logsRef.current = [...logsRef.current, entry]
        setExecutionLogs([...logsRef.current])
      },
      onRetry: (nodeId, attempt, strategy, model) => {
        // Flash the node amber to signal retry in progress
        setNodes(nds => nds.map(n => n.id === nodeId
          ? { ...n, data: { ...n.data, status: 'retrying' as AgentNodeData['status'] } }
          : n))
        console.info(`[Adaptive] Retry ${attempt} on ${nodeId}: ${strategy} → ${model}`)
      },
      onHealed: (nodeId, strategy, model) => {
        console.info(`[Adaptive] Healed ${nodeId} via ${strategy} using ${model}`)
      },
      onPlanReady: (plan) => setCurrentPlan(plan),
      onMessage: (msg) => setPlannerMessages(prev => [...prev, msg as AgentMessage]),
    })

    setExecutionResult(result)
    setIsExecuting(false)
    setTimeout(resetStatuses, 4000)
  }, [isExecuting, nodes, maxIterations, resetStatuses])

  const loadGraph = useCallback((templateNodes: any[], templateEdges: any[]) => {
    setNodes(templateNodes); setEdges(templateEdges)
    setSelectedNodeId(null); setSelectedEdgeId(null)
    setExecutionResult(null); setExecutionLogs([])
  }, [setNodes, setEdges])

  const selectedNode = nodes.find(n => n.id === selectedNodeId) ?? null
  const selectedEdge = edges.find(e => e.id === selectedEdgeId) ?? null

  return {
    nodes, edges, onNodesChange, onEdgesChange, onConnect,
    addAgentNode, updateNodeData, updateEdgeCondition,
    clearCanvas, executeFlow, loadGraph,
    isExecuting, executionResult, executionLogs,
    selectedNodeId, setSelectedNodeId,
    selectedEdgeId, setSelectedEdgeId,
    selectedNodeData:      selectedNode?.data ?? null,
    selectedEdge,
    setNodes,
    testRun, testRunResult, isTestRunning,
    plannerRun, isPlannerMode, setIsPlannerMode, currentPlan, plannerMessages,
  }
}
