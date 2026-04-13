import React, { useCallback, useState } from 'react'
import ReactFlow, {
  Background, Controls, MiniMap,
  BackgroundVariant, ReactFlowProvider, useReactFlow,
} from 'reactflow'
import 'reactflow/dist/style.css'
import type { EdgeProps } from 'reactflow'

import { AgentNode }           from './components/AgentNode'
import { AgentSidebar }        from './components/AgentSidebar'
import { ConfigPanel }         from './components/ConfigPanel'
import { ExecutionPanel }      from './components/ExecutionPanel'
import { GoalInput }           from './components/GoalInput'
import { QuickAddBar }         from './components/QuickAddBar'
import { LoadWorkflowModal }   from './components/LoadWorkflowModal'
import { EdgeConditionEditor } from './components/EdgeConditionEditor'
import { ToolRegistry }        from './components/ToolRegistry'
import { ReplayPlayer }        from './components/ReplayPlayer'
import { TestRunPanel }        from './components/TestRunPanel'
import { OptimizerPanel }      from './components/OptimizerPanel'
import { PlannerModePanel }    from './components/PlannerModePanel'
import { MetricsDashboard }    from './components/MetricsDashboard'
import { StateViewer }         from './components/StateViewer'
import { MarketplacePanel }    from './components/MarketplacePanel'
import { CopilotPanel, CopilotBadge, InlineTip } from './components/CopilotPanel'
import { ToolRecommendationPanel } from './components/ToolRecommendationPanel'
import { useCopilot }             from './hooks/useCopilot'
import { useAgentFlow }        from './hooks/useAgentFlow'
import { ROLE_COLORS }         from './components/icons'
import { TEMPLATES }           from './utils/templates'
import { generateWorkflow }    from './utils/workflowGenerator'
import type { AgentRole, EdgeCondition } from './types'

const nodeTypes = { agent: AgentNode }

const FlowCanvas: React.FC = () => {
  const [maxIterations]                       = useState(5)
  const [flowName, setFlowName]               = useState('New Flow')
  const [isGenerating, setIsGenerating]       = useState(false)
  const [showLoadModal, setShowLoadModal]     = useState(false)
  const [showGoalInput, setShowGoalInput]     = useState(false)
  const [showToolRegistry, setShowToolRegistry] = useState(false)
  const [showReplay, setShowReplay]           = useState(false)
  const [showTestPanel, setShowTestPanel]     = useState(false)
  const [showOptimizer, setShowOptimizer]     = useState(false)
  const [showPlannerPanel, setShowPlannerPanel]   = useState(false)
  const [showMetrics, setShowMetrics]             = useState(false)
  const [showStateViewer, setShowStateViewer]     = useState(false)
  const [showMarketplace, setShowMarketplace]     = useState(false)
  const [showCopilot, setShowCopilot]             = useState(false)
  const [showToolRec, setShowToolRec]             = useState(false)
  const [toolRecMode, setToolRecMode]             = useState<'single'|'workflow'>('workflow')
  const [inlineTipIdx, setInlineTipIdx]           = useState(0)

  const {
    nodes, edges,
    onNodesChange, onEdgesChange, onConnect,
    addAgentNode, updateNodeData, updateEdgeCondition,
    clearCanvas, executeFlow, loadGraph,
    isExecuting, executionResult, executionLogs,
    selectedNodeId, setSelectedNodeId, selectedNodeData,
    selectedEdgeId, setSelectedEdgeId, selectedEdge,
    setNodes,
    testRun, testRunResult, isTestRunning,
    plannerRun, isPlannerMode, setIsPlannerMode, currentPlan, plannerMessages,
  } = useAgentFlow(maxIterations)

  const { screenToFlowPosition, getViewport } = useReactFlow()

  // ── Co-pilot ──────────────────────────────────────────────────────────────
  const copilot = useCopilot({
    nodes, edges, selectedNodeId,
    goal: '',
    enabled: true,
    onAddNode: (role, name, prompt, model) => {
      const vp = getViewport()
      const cx = (window.innerWidth  / 2 - vp.x) / vp.zoom + (nodes.length % 3) * 60
      const cy = (window.innerHeight / 2 - vp.y) / vp.zoom + Math.floor(nodes.length / 3) * 180
      addAgentNode(role, { x: cx, y: cy }, name, prompt, model)
    },
    onAddEdge: (sourceId, targetId, condition) => {
      if (sourceId && targetId) {
        const edgeId = `e-copilot-${Date.now()}`
        if (condition) {
          updateEdgeCondition(edgeId, { expression: condition, label: condition })
        }
      }
    },
    onUpdatePrompt: (nodeId, prompt) => updateNodeData(nodeId, { prompt }),
    onUpdateModel:  (nodeId, model)  => updateNodeData(nodeId, { model }),
  })

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.dataTransfer.dropEffect = 'move'
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const role = e.dataTransfer.getData('application/agent-role') as AgentRole
    if (!role) return
    addAgentNode(role, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }, [addAgentNode, screenToFlowPosition])

  const onQuickAdd = useCallback((role: AgentRole) => {
    const vp = getViewport()
    const cx = (window.innerWidth  / 2 - vp.x) / vp.zoom
    const cy = (window.innerHeight / 2 - vp.y) / vp.zoom
    addAgentNode(role, { x: cx - 120, y: cy - 80 })
  }, [addAgentNode, getViewport])

  const onNodeClick = useCallback((_: React.MouseEvent, node: { id: string }) => {
    setSelectedNodeId(node.id); setSelectedEdgeId(null)
  }, [setSelectedNodeId, setSelectedEdgeId])

  const onEdgeDoubleClick = useCallback((_: React.MouseEvent, edge: { id: string }) => {
    setSelectedEdgeId(edge.id); setSelectedNodeId(null)
  }, [setSelectedEdgeId, setSelectedNodeId])

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null); setSelectedEdgeId(null)
  }, [setSelectedNodeId, setSelectedEdgeId])

  const loadTemplate = useCallback((key: string) => {
    const t = TEMPLATES[key]; if (!t) return
    loadGraph(t.nodes, t.edges); setFlowName(t.name)
  }, [loadGraph])

  const handleGenerate = useCallback(async (goal: string) => {
    setIsGenerating(true)
    try {
      const wf = await generateWorkflow(goal)
      loadGraph(wf.nodes, wf.edges); setFlowName(wf.name); setShowGoalInput(false)
    } catch (err) { alert('Generation failed: ' + (err instanceof Error ? err.message : err)) }
    finally { setIsGenerating(false) }
  }, [loadGraph])

  const handleSave = useCallback(async () => {
    try {
      const res = await fetch(`${(import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api/workflows/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: flowName, description: 'Saved from AgentFlow', tags: ['saved'], max_iterations: maxIterations,
          nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
          edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, animated: e.animated, label: e.label, data: e.data })),
        }),
      })
      if (res.ok) { const s = await res.json(); alert(`Saved — ID: ${s.id}`) }
      else alert('Save failed')
    } catch { alert('Could not connect to backend') }
  }, [flowName, maxIterations, nodes, edges])

  const handleLoad = useCallback(async (id: string) => {
    try {
      const res  = await fetch(`${(import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api/workflows/${id}`)
      const data = await res.json()
      loadGraph(data.nodes, data.edges); setFlowName(data.name); setShowLoadModal(false)
    } catch { alert('Could not load workflow') }
  }, [loadGraph])

  const saveExecution = useCallback(async (logs: any[], result: any) => {
    if (!logs.length) return
    try {
      await fetch(`${(import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api/execution-runs/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow_name: flowName,
          nodes: nodes.map(n => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
          edges: edges.map(e => ({ id: e.id, source: e.source, target: e.target, label: e.label, data: e.data })),
          logs, final_state: result?.finalState ?? {},
          summary: { totalSteps: result?.totalSteps, durationMs: result?.durationMs, loopsDetected: result?.loopsDetected },
          status: result?.success ? 'success' : 'error',
        }),
      })
    } catch { }
  }, [flowName, nodes, edges])

  const onReplayHighlight = useCallback((nodeId: string | null) => {
    setNodes(nds => nds.map(n => ({
      ...n,
      style: nodeId && n.id === nodeId
        ? { ...n.style, filter: 'drop-shadow(0 0 8px rgba(37,99,235,0.6))', opacity: 1 }
        : { ...n.style, filter: 'none', opacity: nodeId ? 0.35 : 1 },
    })))
  }, [setNodes])

  React.useEffect(() => {
    if (!isExecuting && executionResult && executionLogs.length > 0) {
      saveExecution(executionLogs, executionResult)
      executionLogs.filter(l => l.status === 'success' || l.status === 'error').forEach(log => {
        fetch(`${(import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api/optimizer/record`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent_id: log.nodeId, agent_name: log.nodeName, role: log.role, model: log.model,
            status: log.status, duration_ms: log.durationMs ?? 0,
            tool_called: (log.io?.toolsUsed?.length ?? 0) > 0,
            tool_succeeded: (log.io?.toolsUsed?.length ?? 0) > 0,
            log_entry: { status: log.status, message: log.message },
          }),
        }).catch(() => {})
      })
    }
  }, [isExecuting]) // eslint-disable-line

  const edgeSourceLabel = selectedEdge ? (nodes.find(n => n.id === selectedEdge.source)?.data.agentName ?? '') : ''
  const edgeTargetLabel = selectedEdge ? (nodes.find(n => n.id === selectedEdge.target)?.data.agentName ?? '') : ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100vw', height: '100vh', overflow: 'hidden', background: 'var(--bg)', fontFamily: 'var(--font)' }}>

      {/* ── Topbar ── Langflow style ──────────────────────────────────────── */}
      <header style={{
        height: 48, flexShrink: 0, background: '#fff',
        borderBottom: '1px solid #e4e4e7',
        display: 'flex', alignItems: 'center', padding: '0 16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}>
        {/* Left: breadcrumb */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, fontSize: 13, minWidth: 0 }}>
          <span style={{ color: '#a1a1aa', fontWeight: 500 }}>My Flows</span>
          <span style={{ color: '#d4d4d8' }}>/</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 20, height: 20, borderRadius: 5, background: '#2563eb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
                <circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/>
                <path d="M12 7.5v3M12 10.5l-5 6M12 10.5l5 6"/>
              </svg>
            </div>
            <span style={{ fontWeight: 600, color: '#18181b' }}>{flowName}</span>
          </div>
          {/* Status indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 4 }}>
            <div style={{
              width: 6, height: 6, borderRadius: '50%',
              background: isExecuting ? '#2563eb' : isGenerating ? '#d97706' : '#16a34a',
            }} />
            <span style={{ fontSize: 11, color: '#a1a1aa', fontFamily: 'var(--mono)' }}>
              {isGenerating ? 'generating…' : isExecuting ? 'running…' : `${nodes.length}n · ${edges.length}e`}
            </span>
          </div>
        </div>

        {/* Center: action buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap', overflow: 'hidden' }}>
          <CopilotBadge
            count={copilot.pendingSuggestions.length}
            isActive={showCopilot}
            isAnalysing={copilot.isAnalysing}
            onClick={() => setShowCopilot(v => !v)}
          />

          <button onClick={() => setShowGoalInput(v => !v)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
            borderRadius: 7, border: '1px solid #e4e4e7',
            background: showGoalInput ? '#eff6ff' : '#fafafa',
            color: showGoalInput ? '#2563eb' : '#52525b',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
            transition: 'all 0.15s',
          }}>✦ AI Generate</button>

          <button onClick={() => setShowPlannerPanel(true)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
            borderRadius: 7, border: '1px solid #bfdbfe',
            background: '#eff6ff', color: '#2563eb',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>🧭 Planner</button>

          <button onClick={() => { setToolRecMode('workflow'); setShowToolRec(true) }} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
            borderRadius: 7, border: '1px solid #e4e4e7',
            background: '#fafafa', color: '#52525b',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>🎯 Tools</button>

          <button onClick={() => setShowTestPanel(true)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
            borderRadius: 7, border: '1px solid #e4e4e7',
            background: '#fafafa', color: '#52525b',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>🧪 Test</button>

          <button onClick={() => setShowMetrics(true)}
            disabled={!executionResult}
            title={executionResult ? 'View execution metrics' : 'Run workflow first'}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
              borderRadius: 7, border: '1px solid #e4e4e7',
              background: executionResult ? '#fafafa' : '#f4f4f5',
              color: executionResult ? '#52525b' : '#a1a1aa',
              fontSize: 12, fontWeight: 500,
              cursor: executionResult ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font)',
            }}>📊 Metrics</button>

          <button onClick={() => setShowStateViewer(true)}
            disabled={executionLogs.length === 0}
            title={executionLogs.length > 0 ? 'View live state' : 'Run workflow first'}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
              borderRadius: 7, border: '1px solid #e4e4e7',
              background: executionLogs.length > 0 ? '#fafafa' : '#f4f4f5',
              color: executionLogs.length > 0 ? '#52525b' : '#a1a1aa',
              fontSize: 12, fontWeight: 500,
              cursor: executionLogs.length > 0 ? 'pointer' : 'not-allowed',
              fontFamily: 'var(--font)',
            }}>🔍 State</button>

          {executionLogs.length > 0 && (
            <button onClick={() => setShowReplay(true)} style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
              borderRadius: 7, border: '1px solid #bbf7d0',
              background: '#f0fdf4', color: '#16a34a',
              fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
            }}>▶ Replay</button>
          )}
        </div>

        {/* Right: Run + Share buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12 }}>
          <button onClick={executeFlow} disabled={isExecuting} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px',
            borderRadius: 8, border: 'none',
            background: isExecuting ? '#f4f4f5' : '#2563eb',
            color: isExecuting ? '#a1a1aa' : '#fff',
            fontSize: 12, fontWeight: 600, cursor: isExecuting ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font)', boxShadow: isExecuting ? 'none' : '0 2px 8px rgba(37,99,235,0.25)',
            transition: 'all 0.15s',
          }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            {isExecuting ? 'Running…' : 'Run'}
          </button>

          <button onClick={() => setShowMarketplace(true)} style={{
            display: 'flex', alignItems: 'center', gap: 5, padding: '6px 14px',
            borderRadius: 8, border: '1px solid var(--border)',
            background: '#fff', color: '#18181b',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>🛒 Marketplace</button>

          <button onClick={handleSave} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
            borderRadius: 8, border: '1px solid #e4e4e7',
            background: '#fff', color: '#18181b',
            fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>Share ↗</button>
        </div>
      </header>

      {/* ── Main row ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>

        <AgentSidebar
          nodeCount={nodes.length} edgeCount={edges.length}
          onSave={handleSave} onLoad={() => setShowLoadModal(true)}
          onClear={clearCanvas} onExecute={executeFlow}
          isExecuting={isExecuting} flowName={flowName}
          onFlowNameChange={setFlowName} onLoadTemplate={loadTemplate}
        />

        {/* Center: canvas + log */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden', position: 'relative' }}>

          {showGoalInput && <GoalInput onGenerate={handleGenerate} onLoadTemplate={loadTemplate} isGenerating={isGenerating} onClose={() => setShowGoalInput(false)} />}

          <div style={{ flex: 1, minHeight: 0 }}>
            <ReactFlow
              nodes={nodes} edges={edges}
              onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
              onConnect={onConnect} onDragOver={onDragOver} onDrop={onDrop}
              onNodeClick={onNodeClick} onPaneClick={onPaneClick}
              onEdgeDoubleClick={onEdgeDoubleClick}
              nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }}
              deleteKeyCode="Delete"
              defaultEdgeOptions={{ style: { stroke: '#a1a1aa', strokeWidth: 1.5 } }}
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} color="#d4d4d8" gap={24} size={1} />
              <Controls style={{ bottom: 16, left: 16, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8 }} />
              <MiniMap
                style={{ bottom: 16, right: 16, background: '#fff', border: '1px solid #e4e4e7', borderRadius: 8 }}
                nodeColor={n => ROLE_COLORS[(n.data as any)?.role] ?? '#2563eb'}
                maskColor="rgba(250,250,250,0.8)"
              />
            </ReactFlow>
          </div>

          {/* Co-pilot inline tip — highest-priority suggestion shown near canvas edge */}
          {!showCopilot && copilot.pendingSuggestions.length > 0 && (
            <InlineTip
              suggestion={copilot.pendingSuggestions[0]}
              onAccept={copilot.accept}
              onDismiss={() => copilot.reject(copilot.pendingSuggestions[0].id)}
            />
          )}

          <QuickAddBar onAdd={onQuickAdd} />

          <ExecutionPanel logs={executionLogs} result={executionResult} isExecuting={isExecuting} />
        </div>

        {/* Right: co-pilot panel */}
        {showCopilot && (
          <CopilotPanel
            suggestions={copilot.suggestions}
            workflowHealth={copilot.workflowHealth}
            healthReason={copilot.healthReason}
            isAnalysing={copilot.isAnalysing}
            lastAnalysedAt={copilot.lastAnalysedAt}
            onAccept={copilot.accept}
            onReject={copilot.reject}
            onDismissAll={copilot.dismissAll}
            onRefresh={copilot.refresh}
            onClose={() => setShowCopilot(false)}
          />
        )}

        {/* Right: config panel */}
        {selectedNodeId && (
          <ConfigPanel
            nodeId={selectedNodeId} data={selectedNodeData}
            onUpdate={updateNodeData} onClose={() => setSelectedNodeId(null)}
            onOpenTools={() => setShowToolRegistry(true)}
            onOpenOptimizer={() => setShowOptimizer(true)}
          />
        )}
      </div>

      {/* ── Modals ───────────────────────────────────────────────────────── */}
      {selectedEdgeId && selectedEdge && (
        <EdgeConditionEditor
          edgeId={selectedEdgeId}
          condition={(selectedEdge.data as any)?.condition}
          sourceLabel={edgeSourceLabel} targetLabel={edgeTargetLabel}
          onSave={(id, condition) => updateEdgeCondition(id, condition)}
          onClose={() => setSelectedEdgeId(null)}
        />
      )}

      {showToolRegistry && selectedNodeId && selectedNodeData && (
        <ToolRegistry
          nodeId={selectedNodeId} agentName={selectedNodeData.agentName}
          attachedTools={selectedNodeData.attachedTools ?? []}
          onAttach={(nodeId, tools) => {
            updateNodeData(nodeId, { attachedTools: tools })
            fetch(`${(import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'}/api/mcp/agents/${nodeId}/tools`, {
              method: 'PUT', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agent_id: nodeId, tool_names: tools }),
            }).catch(() => {})
          }}
          onClose={() => setShowToolRegistry(false)}
        />
      )}

      {showOptimizer && selectedNodeId && selectedNodeData && (
        <OptimizerPanel
          nodeId={selectedNodeId} data={selectedNodeData}
          onApplyModel={(id, model) => updateNodeData(id, { model: model as any })}
          onApplyPromptHint={(hint) => {
            if (selectedNodeId && selectedNodeData)
              updateNodeData(selectedNodeId, { prompt: (selectedNodeData.prompt || '') + '\n\n// Suggestion: ' + hint })
          }}
          onClose={() => setShowOptimizer(false)}
        />
      )}

      {showReplay && (
        <ReplayPlayer liveLogs={executionLogs} onHighlight={onReplayHighlight}
          onClose={() => { setShowReplay(false); onReplayHighlight(null) }} />
      )}

      {showMetrics && executionResult && (
          <MetricsDashboard
            logs={executionLogs}
            result={executionResult}
            onClose={() => setShowMetrics(false)}
          />
        )}

        {showStateViewer && executionLogs.length > 0 && (
          <StateViewer
            logs={executionLogs}
            onClose={() => setShowStateViewer(false)}
          />
        )}

        {showMarketplace && (
          <MarketplacePanel
            onLoad={handleLoad}
            onLoadTemplate={loadTemplate}
            onImportJSON={(json) => {
              try {
                const data = JSON.parse(json)
                if (data.nodes && data.edges) {
                  loadGraph(data.nodes, data.edges)
                  if (data.name) setFlowName(data.name)
                  setShowMarketplace(false)
                }
              } catch { alert('Invalid JSON') }
            }}
            onClose={() => setShowMarketplace(false)}
          />
        )}

        {showToolRec && (
          <ToolRecommendationPanel
            nodes={nodes}
            selectedNodeId={selectedNodeId}
            mode={toolRecMode}
            onAttachTool={(nodeId, toolName) => {
              const node = nodes.find(n => n.id === nodeId)
              const existing = node?.data.attachedTools ?? []
              if (!existing.includes(toolName)) {
                updateNodeData(nodeId, { attachedTools: [...existing, toolName] })
              }
            }}
            onClose={() => setShowToolRec(false)}
          />
        )}

        {showTestPanel && (
        <TestRunPanel
          onRun={async (inputs, assertions) => { await testRun(inputs, assertions) }}
          testResult={testRunResult} isRunning={isTestRunning}
          onClose={() => setShowTestPanel(false)}
        />
      )}

      {showLoadModal && (
        <LoadWorkflowModal onLoad={handleLoad} onClose={() => setShowLoadModal(false)} />
      )}
    </div>
  )
}

const App: React.FC = () => (
  <ReactFlowProvider>
    <FlowCanvas />
  </ReactFlowProvider>
)

export default App
