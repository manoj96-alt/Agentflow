import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { ExecutionResult, ExecutionLog, FlowState, NodeIORecord } from '../types'

// ─── Design tokens ─────────────────────────────────────────────────────────────

const C = { // light theme colors
  bg:      '#ffffff',
  surface: '#0d0f1a',
  border:  '#e4e4e7',
  border2: '#252838',
  muted:   '#71717a',
  dim:     '#52525b',
  text:    '#52525b',
  bright:  '#e2e8f0',
  accent:  '#6366f1',
  success: '#34d399',
  error:   '#f87171',
  warn:    '#f59e0b',
  info:    '#38bdf8',
  running: '#818cf8',
}

const STATUS = {
  running: { color: C.running, bg: `${C.running}18`, icon: '⟳', spin: true  },
  success: { color: C.success, bg: `${C.success}18`, icon: '✓', spin: false },
  error:   { color: C.error,   bg: `${C.error}18`,   icon: '✕', spin: false },
  skipped: { color: C.warn,    bg: `${C.warn}18`,    icon: '⏭', spin: false },
  pending: { color: C.muted,   bg: 'transparent',    icon: '·', spin: false },
}

const ROLE_COLOR: Record<string, string> = {
  orchestrator: '#f59e0b',
  researcher:   '#38bdf8',
  coder:        '#a78bfa',
  reviewer:     '#34d399',
  custom:       '#f472b6',
}

// ─── Sub-components ────────────────────────────────────────────────────────────

const mono = { fontFamily: 'JetBrains Mono, monospace' }

const Badge: React.FC<{ label: string; color: string }> = ({ label, color }) => (
  <span style={{
    ...mono, fontSize: 9, fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase' as const,
    padding: '1px 5px', borderRadius: 3,
    background: `${color}18`, color, border: `1px solid ${color}30`,
  }}>
    {label}
  </span>
)

const JsonTree: React.FC<{ data: unknown; depth?: number }> = ({ data, depth = 0 }) => {
  const [collapsed, setCollapsed] = useState(depth > 1)
  if (data === null || data === undefined) return <span style={{ color: C.muted }}>null</span>
  if (typeof data === 'boolean') return <span style={{ color: '#f472b6' }}>{String(data)}</span>
  if (typeof data === 'number') return <span style={{ color: '#fb923c' }}>{data}</span>
  if (typeof data === 'string') {
    const truncated = data.length > 120 ? data.slice(0, 120) + '…' : data
    return <span style={{ color: '#86efac' }}>"{truncated}"</span>
  }
  if (Array.isArray(data)) {
    if (data.length === 0) return <span style={{ color: C.dim }}>[]</span>
    return (
      <span>
        <button onClick={() => setCollapsed(c => !c)}
          style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, ...mono, fontSize: 10 }}>
          {collapsed ? `▶ [${data.length}]` : '▼ ['}
        </button>
        {!collapsed && (
          <span>
            {data.map((v, i) => (
              <div key={i} style={{ paddingLeft: 14 }}>
                <JsonTree data={v} depth={depth + 1} />
                {i < data.length - 1 && <span style={{ color: C.dim }}>,</span>}
              </div>
            ))}
            <span style={{ color: C.dim }}>]</span>
          </span>
        )}
      </span>
    )
  }
  if (typeof data === 'object') {
    const entries = Object.entries(data as Record<string, unknown>)
    if (entries.length === 0) return <span style={{ color: C.dim }}>{'{}'}</span>
    return (
      <span>
        <button onClick={() => setCollapsed(c => !c)}
          style={{ background: 'none', border: 'none', color: C.accent, cursor: 'pointer', padding: 0, ...mono, fontSize: 10 }}>
          {collapsed ? `▶ {${entries.length}}` : '▼ {'}
        </button>
        {!collapsed && (
          <span>
            {entries.map(([k, v], i) => (
              <div key={k} style={{ paddingLeft: 14 }}>
                <span style={{ color: '#93c5fd' }}>"{k}"</span>
                <span style={{ color: C.dim }}>: </span>
                <JsonTree data={v} depth={depth + 1} />
                {i < entries.length - 1 && <span style={{ color: C.dim }}>,</span>}
              </div>
            ))}
            <span style={{ color: C.dim }}>{'}'}</span>
          </span>
        )}
      </span>
    )
  }
  return <span style={{ color: C.text }}>{String(data)}</span>
}

const IOSection: React.FC<{ title: string; color: string; data: FlowState; empty: string }> = ({ title, color, data, empty }) => {
  const entries = Object.entries(data)
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color, marginBottom: 4, ...mono }}>
        {title}
      </div>
      {entries.length === 0
        ? <div style={{ fontSize: 10, color: C.muted, fontStyle: 'italic' }}>{empty}</div>
        : entries.map(([k, v]) => (
          <div key={k} style={{
            marginBottom: 3, padding: '4px 8px',
            background: `${color}08`, borderRadius: 4,
            borderLeft: `2px solid ${color}40`,
          }}>
            <div style={{ fontSize: 9, color, marginBottom: 2, ...mono }}>{k}</div>
            <div style={{ fontSize: 10, color: C.text, ...mono, lineHeight: 1.5 }}>
              <JsonTree data={v} />
            </div>
          </div>
        ))
      }
    </div>
  )
}

const LogDetail: React.FC<{ log: ExecutionLog }> = ({ log }) => {
  const st = STATUS[log.status] ?? STATUS.pending
  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '12px 14px' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14,
        paddingBottom: 10, borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: `${ROLE_COLOR[log.role] ?? C.accent}20`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 14, color: ROLE_COLOR[log.role] ?? C.accent,
        }}>●</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: C.bright }}>{log.nodeName}</div>
          <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
            <Badge label={log.role} color={ROLE_COLOR[log.role] ?? C.accent} />
            <Badge label={log.model} color={C.dim} />
            {log.iteration > 1 && <Badge label={`×${log.iteration}`} color={C.warn} />}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 10, color: st.color, ...mono }}>{st.icon} {log.status}</div>
          {log.durationMs !== undefined && (
            <div style={{ fontSize: 9, color: C.muted, ...mono }}>{log.durationMs}ms</div>
          )}
        </div>
      </div>

      {/* Error banner */}
      {log.error && (
        <div style={{
          padding: '8px 10px', borderRadius: 6, marginBottom: 12,
          background: `${C.error}12`, border: `1px solid ${C.error}30`,
        }}>
          <div style={{ fontSize: 9, color: C.error, fontWeight: 700, marginBottom: 3, ...mono, textTransform: 'uppercase' as const }}>
            Error
          </div>
          <div style={{ fontSize: 11, color: C.error, ...mono, lineHeight: 1.5 }}>{log.error}</div>
        </div>
      )}

      {/* Self-healing detail */}
      {(log as any).retries?.length > 0 && (
        <div style={{ marginBottom: 12, padding: '10px 12px', borderRadius: 8,
          background: (log as any).healed ? '#f0fdf420' : '#fef2f220',
          border: `1px solid ${(log as any).healed ? '#bbf7d0' : '#fecaca'}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 6,
            color: (log as any).healed ? C.success : C.error }}>
            {(log as any).healed
              ? `✦ Self-healed · ${(log as any).retries.length} retr${(log as any).retries.length===1?'y':'ies'} · ${(log as any).healStrategy}`
              : `✕ All strategies failed · ${(log as any).retries.length} attempts`}
          </div>
          {(log as any).modelUsed && (log as any).modelUsed !== log.model && (
            <div style={{ fontSize: 9, color: C.warn, marginBottom: 6, ...mono }}>
              Configured: {log.model} → Final: {(log as any).modelUsed}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(log as any).retries.map((r: any, i: number) => (
              <div key={i} style={{ padding: '5px 8px', borderRadius: 5,
                background: C.bg, border: `1px solid ${C.border}`, fontSize: 10 }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 2 }}>
                  <span style={{ color: C.muted }}>#{r.attempt}</span>
                  <span style={{ color: C.accent, ...mono }}>{r.model}</span>
                  <span style={{ color: C.warn }}>{r.strategy}</span>
                  <span style={{ color: C.muted, marginLeft: 'auto', ...mono }}>{r.durationMs}ms</span>
                </div>
                <div style={{ color: C.error, ...mono, fontSize: 9,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.error?.slice(0, 140)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* LLM Prompt */}
      {log.io.llmPrompt && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.accent, marginBottom: 4, ...mono }}>
            LLM Prompt
          </div>
          <pre style={{
            margin: 0, padding: '8px 10px', borderRadius: 6,
            background: `${C.accent}08`, border: `1px solid ${C.accent}20`,
            fontSize: 10, color: C.text, ...mono,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
          }}>
            {log.io.llmPrompt}
          </pre>
        </div>
      )}

      {/* LLM Response */}
      {log.io.llmResponse && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.success, marginBottom: 4, ...mono }}>
            LLM Response
          </div>
          <pre style={{
            margin: 0, padding: '8px 10px', borderRadius: 6,
            background: `${C.success}08`, border: `1px solid ${C.success}20`,
            fontSize: 10, color: C.text, ...mono,
            whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.6,
          }}>
            {log.io.llmResponse}
          </pre>
        </div>
      )}

      {/* Edge Routing decisions */}
      {log.routing && log.routing.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.warn, marginBottom: 4, ...mono }}>
            ⇢ Edge Routing
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {log.routing.map((r, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 7,
                padding: '4px 8px', borderRadius: 5,
                background: r.result ? `${C.success}10` : `${C.error}10`,
                border: `1px solid ${r.result ? C.success : C.error}30`,
              }}>
                <span style={{ fontSize: 11, color: r.result ? C.success : C.error, flexShrink: 0 }}>
                  {r.result ? '✓' : '✕'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, color: r.result ? C.success : C.error, ...mono }}>→ {r.target}</div>
                  {r.condition && (
                    <div style={{ fontSize: 9, color: C.dim, ...mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.condition}
                    </div>
                  )}
                  {r.error && <div style={{ fontSize: 9, color: C.error }}>Error: {r.error}</div>}
                </div>
                <span style={{ fontSize: 9, color: r.result ? C.success : C.error, flexShrink: 0 }}>
                  {r.result ? 'routed' : 'skipped'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tools used */}
      {log.io.toolsUsed && log.io.toolsUsed.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: C.info, marginBottom: 4, ...mono }}>
            Tools Used
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {log.io.toolsUsed.map(t => (
              <span key={t} style={{
                fontSize: 10, padding: '2px 7px', borderRadius: 4, ...mono,
                background: `${C.info}15`, color: C.info, border: `1px solid ${C.info}30`,
              }}>{t}</span>
            ))}
          </div>
        </div>
      )}

      {/* Inputs */}
      <IOSection title="Inputs (read from state)" color={C.info}
        data={log.io.inputs} empty="No state consumed" />

      {/* Outputs */}
      <IOSection title="Outputs (written to state)" color={C.success}
        data={log.io.outputs} empty="No state produced" />
    </div>
  )
}

// ─── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = 'execution' | 'io' | 'errors' | 'state'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'execution', label: 'Execution',  icon: '▶' },
  { id: 'io',        label: 'I/O',        icon: '⇄' },
  { id: 'errors',    label: 'Errors',     icon: '⚠' },
  { id: 'state',     label: 'State',      icon: '◈' },
]

// ─── Main panel ───────────────────────────────────────────────────────────────

interface ExecutionPanelProps {
  logs: ExecutionLog[]
  result: ExecutionResult | null
  isExecuting: boolean
  maxIterations: number
  onMaxIterChange: (n: number) => void
}

export const ExecutionPanel: React.FC<ExecutionPanelProps> = ({
  logs, result, isExecuting, maxIterations, onMaxIterChange,
}) => {
  const [tab, setTab] = useState<Tab>('execution')
  const [selectedLog, setSelectedLog] = useState<ExecutionLog | null>(null)
  const [panelHeight, setPanelHeight] = useState(260)
  const [isDragging, setIsDragging] = useState(false)
  const dragStartY = useRef(0)
  const dragStartH = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  const errorLogs = logs.filter(l => l.status === 'error')
  const successLogs = logs.filter(l => l.status === 'success')

  // Auto-switch to errors tab when error occurs
  useEffect(() => {
    if (errorLogs.length > 0 && tab === 'execution') setTab('errors')
  }, [errorLogs.length])

  // Auto-scroll execution log
  useEffect(() => {
    if (tab === 'execution' && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs.length, tab])

  // Auto-select latest success log for I/O tab
  useEffect(() => {
    if (successLogs.length > 0) {
      setSelectedLog(successLogs[successLogs.length - 1])
    }
  }, [successLogs.length])

  // Drag resize
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    dragStartY.current = e.clientY
    dragStartH.current = panelHeight
  }, [panelHeight])

  useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      const delta = dragStartY.current - e.clientY
      setPanelHeight(Math.max(120, Math.min(520, dragStartH.current + delta)))
    }
    const onUp = () => setIsDragging(false)
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [isDragging])

  const renderExecution = () => (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
      {logs.length === 0 && (
        <div style={{ padding: '20px', textAlign: 'center', color: C.muted, fontSize: 11 }}>
          Press <span style={{ color: C.accent }}>Execute Flow</span> to start
        </div>
      )}
      {logs.map((log, i) => {
        const st = STATUS[log.status] ?? STATUS.pending
        const isActive = selectedLog?.timestamp === log.timestamp
        return (
          <div
            key={i}
            onClick={() => { setSelectedLog(log); setTab('io') }}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '4px 14px',
              background: isActive ? `${C.accent}10` : 'transparent',
              borderLeft: `2px solid ${isActive ? C.accent : 'transparent'}`,
              cursor: 'pointer', transition: 'all 0.1s',
            }}
            onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = `${C.surface}80` }}
            onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
          >
            <span style={{ fontSize: 9, color: C.muted, width: 70, flexShrink: 0, paddingTop: 2, ...mono }}>
              {new Date(log.timestamp).toLocaleTimeString('en', { hour12: false })}
            </span>
            <span style={{
              fontSize: 12, width: 14, textAlign: 'center', flexShrink: 0,
              color: st.color,
              display: 'inline-block',
              animation: st.spin ? 'spin 1s linear infinite' : 'none',
            }}>{st.icon}</span>
            <span style={{ fontSize: 11, color: ROLE_COLOR[log.role] ?? C.accent, width: 90, flexShrink: 0, ...mono }}>
              {log.nodeName}
              {log.iteration > 1 && <span style={{ color: C.warn }}> ×{log.iteration}</span>}
              {(log as any).retries?.length > 0 && !((log as any).healed) && <span style={{ color: C.error, fontSize: 9 }}> ✕{(log as any).retries.length}</span>}
              {(log as any).healed && <span style={{ color: C.success, fontSize: 9 }}> ✦</span>}
            </span>
            {log.durationMs !== undefined && log.status !== 'running' && (
              <span style={{ fontSize: 9, color: C.muted, width: 44, flexShrink: 0, textAlign: 'right', paddingTop: 2, ...mono }}>
                {log.durationMs}ms
              </span>
            )}
            <span style={{
              fontSize: 10, color: log.status === 'error' ? C.error : C.text,
              flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', ...mono,
            }}>
              {log.message}
            </span>
          </div>
        )
      })}
      {result && !isExecuting && (
        <div style={{
          margin: '8px 14px', padding: '8px 12px',
          background: C.surface, border: `1px solid ${C.border}`,
          borderRadius: 6, display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 11, color: result.success ? C.success : C.error, ...mono }}>
            {result.success ? '✓' : '⚠'} {result.success ? 'Completed' : 'Terminated early'}
          </span>
          <span style={{ fontSize: 10, color: C.muted, ...mono }}>{result.totalSteps} steps</span>
          <span style={{ fontSize: 10, color: C.muted, ...mono }}>{result.durationMs}ms</span>
          {result.loopsDetected && <Badge label="cycles" color={C.warn} />}
          {result.terminatedEarly && <Badge label="max iter" color={C.error} />}
          {(result as any).totalRetries > 0 && <Badge label={`${(result as any).totalRetries} retr${(result as any).totalRetries===1?'y':'ies'}`} color={C.warn} />}
          {(result as any).healedNodes > 0 && <Badge label={`${(result as any).healedNodes} healed`} color={C.success} />}
          {((result as any).failedNodes?.length ?? 0) > 0 && <Badge label={`${(result as any).failedNodes.length} failed`} color={C.error} />}
        </div>
      )}
    </div>
  )

  const renderIO = () => (
    <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Log list */}
      <div style={{
        width: 200, flexShrink: 0, borderRight: `1px solid ${C.border}`,
        overflowY: 'auto',
      }}>
        {successLogs.length === 0 && (
          <div style={{ padding: 12, fontSize: 10, color: C.muted, textAlign: 'center' }}>
            No completed nodes yet
          </div>
        )}
        {successLogs.map((log, i) => {
          const isActive = selectedLog?.timestamp === log.timestamp
          return (
            <div
              key={i}
              onClick={() => setSelectedLog(log)}
              style={{
                padding: '7px 10px', cursor: 'pointer',
                background: isActive ? `${C.accent}18` : 'transparent',
                borderLeft: `2px solid ${isActive ? C.accent : 'transparent'}`,
                borderBottom: `1px solid ${C.border}`,
                transition: 'all 0.1s',
              }}
            >
              <div style={{ fontSize: 11, color: isActive ? C.bright : C.text, fontWeight: isActive ? 600 : 400 }}>
                {log.nodeName}
                {log.iteration > 1 && <span style={{ color: C.warn, marginLeft: 4, fontSize: 9, ...mono }}>×{log.iteration}</span>}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 3 }}>
                <Badge label={log.role} color={ROLE_COLOR[log.role] ?? C.accent} />
                {log.durationMs !== undefined && (
                  <span style={{ fontSize: 9, color: C.muted, ...mono }}>{log.durationMs}ms</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* Detail pane */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selectedLog
          ? <LogDetail log={selectedLog} />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.muted, fontSize: 11 }}>
              Select a node to inspect its I/O
            </div>
        }
      </div>
    </div>
  )

  const renderErrors = () => (
    <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px' }}>
      {errorLogs.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
          <div style={{ fontSize: 24 }}>✓</div>
          <div style={{ fontSize: 11, color: C.success }}>No errors</div>
        </div>
      ) : (
        errorLogs.map((log, i) => (
          <div key={i} style={{
            marginBottom: 10, padding: '10px 12px', borderRadius: 8,
            background: `${C.error}0c`, border: `1px solid ${C.error}30`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ color: C.error, fontSize: 13 }}>✕</span>
              <span style={{ fontSize: 12, color: C.bright, fontWeight: 600 }}>{log.nodeName}</span>
              <Badge label={log.role} color={ROLE_COLOR[log.role] ?? C.accent} />
              {log.iteration > 1 && <Badge label={`iter ×${log.iteration}`} color={C.warn} />}
              <span style={{ marginLeft: 'auto', fontSize: 9, color: C.muted, ...mono }}>
                {new Date(log.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div style={{
              fontSize: 11, color: C.error, ...mono,
              padding: '6px 8px', borderRadius: 4,
              background: `${C.error}12`, lineHeight: 1.6,
            }}>
              {log.error || log.message}
            </div>
            {Object.keys(log.io.inputs).length > 0 && (
              <div style={{ marginTop: 8 }}>
                <IOSection title="Inputs at time of error" color={C.info}
                  data={log.io.inputs} empty="No inputs" />
              </div>
            )}
          </div>
        ))
      )}
    </div>
  )

  const renderState = () => {
    const state = result?.finalState ?? {}
    const entries = Object.entries(state).filter(([k]) => !['flowStartTime', 'flowEndTime', 'totalSteps', 'maxIterations', 'totalNodes'].includes(k))
    return (
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px' }}>
        {entries.length === 0 ? (
          <div style={{ color: C.muted, fontSize: 11, textAlign: 'center', paddingTop: 20 }}>
            No state yet — run the flow first
          </div>
        ) : (
          <>
            <div style={{ fontSize: 9, color: C.dim, ...mono, marginBottom: 8 }}>
              {entries.length} keys in shared state
            </div>
            {entries.map(([k, v]) => (
              <div key={k} style={{
                marginBottom: 4, padding: '5px 8px',
                background: C.surface, borderRadius: 5,
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 9, color: C.accent, marginBottom: 3, ...mono }}>{k}</div>
                <div style={{ fontSize: 10, color: C.text, ...mono }}>
                  <JsonTree data={v} />
                </div>
              </div>
            ))}
          </>
        )}
      </div>
    )
  }

  const tabContent = { execution: renderExecution, io: renderIO, errors: renderErrors, state: renderState }

  return (
    <div style={{
      height: panelHeight, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: C.bg, borderTop: `1px solid ${C.border}`,
      position: 'relative', userSelect: isDragging ? 'none' : 'auto',
    }}>
      {/* Drag handle */}
      <div
        onMouseDown={onMouseDown}
        style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 4,
          cursor: 'ns-resize',
          background: isDragging ? `${C.accent}40` : 'transparent',
          transition: 'background 0.15s',
          zIndex: 10,
        }}
        onMouseEnter={e => (e.currentTarget.style.background = `${C.accent}30`)}
        onMouseLeave={e => { if (!isDragging) e.currentTarget.style.background = 'transparent' }}
      />

      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        flexShrink: 0, paddingLeft: 8, height: 34,
      }}>
        {TABS.map(t => {
          const count = t.id === 'errors' ? errorLogs.length : t.id === 'io' ? successLogs.length : 0
          const isActive = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              background: 'none', border: 'none',
              borderBottom: `2px solid ${isActive ? C.accent : 'transparent'}`,
              color: isActive ? C.bright : C.dim,
              padding: '0 12px', height: '100%', cursor: 'pointer',
              fontSize: 11, fontWeight: isActive ? 600 : 400,
              display: 'flex', alignItems: 'center', gap: 5,
              transition: 'all 0.15s', fontFamily: "'DM Sans', sans-serif",
            }}>
              <span>{t.icon}</span>
              <span>{t.label}</span>
              {count > 0 && (
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 8,
                  background: t.id === 'errors' ? `${C.error}30` : `${C.accent}30`,
                  color: t.id === 'errors' ? C.error : C.accent,
                  ...mono,
                }}>
                  {count}
                </span>
              )}
            </button>
          )
        })}

        {/* Right controls */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, paddingRight: 12 }}>
          {isExecuting && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.running, animation: 'pulse-ring 1s ease-out infinite' }} />
              <span style={{ fontSize: 10, color: C.running, ...mono }}>running</span>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ fontSize: 10, color: C.dim }}>max iter</span>
            <input
              type="number" min={1} max={20} value={maxIterations}
              onChange={e => onMaxIterChange(Math.max(1, parseInt(e.target.value) || 1))}
              style={{
                width: 40, background: C.surface, border: `1px solid ${C.border2}`,
                borderRadius: 4, color: C.bright, fontSize: 11,
                padding: '2px 5px', outline: 'none', textAlign: 'center', ...mono,
              }}
            />
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {tabContent[tab]()}
      </div>
    </div>
  )
}
