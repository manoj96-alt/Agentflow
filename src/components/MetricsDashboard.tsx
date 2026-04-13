/**
 * MetricsDashboard
 * ================
 * Shows execution metrics: timing per node, total time, token estimates.
 * Opens from a 📊 Metrics button in the topbar after execution.
 */
import React, { useMemo } from 'react'
import type { ExecutionLog, ExecutionResult } from '../types'

interface MetricsDashboardProps {
  logs: ExecutionLog[]
  result: ExecutionResult | null
  onClose: () => void
}

const ROLE_COLOR: Record<string, string> = {
  planner: '#2563eb', worker: '#059669', evaluator: '#dc2626',
  orchestrator: '#7c3aed', researcher: '#0891b2', coder: '#16a34a',
  reviewer: '#d97706', custom: '#64748b',
}

// Rough token cost estimate (per 1M tokens)
const MODEL_COST: Record<string, { input: number; output: number }> = {
  'claude-opus-4-5':   { input: 15,  output: 75  },
  'claude-sonnet-4-5': { input: 3,   output: 15  },
  'claude-haiku-4-5':  { input: 0.25,output: 1.25},
  'gpt-4o':            { input: 5,   output: 15  },
  'gpt-4o-mini':       { input: 0.15,output: 0.6 },
}

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const cost = MODEL_COST[model] ?? { input: 3, output: 15 }
  return (promptTokens * cost.input + completionTokens * cost.output) / 1_000_000
}

const Bar: React.FC<{ value: number; max: number; color: string; label: string; sub: string }> = ({ value, max, color, label, sub }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{sub}</span>
    </div>
    <div style={{ height: 6, background: '#f4f4f5', borderRadius: 3, overflow: 'hidden' }}>
      <div style={{
        height: '100%', width: `${Math.min(100, (value / max) * 100)}%`,
        background: color, borderRadius: 3, transition: 'width 0.4s ease',
      }} />
    </div>
  </div>
)

const StatCard: React.FC<{ label: string; value: string; sub?: string; color?: string }> = ({ label, value, sub, color }) => (
  <div style={{ padding: '12px', background: '#fafafa', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
    <div style={{ fontSize: 20, fontWeight: 700, color: color ?? 'var(--text)', fontFamily: 'var(--mono)' }}>{value}</div>
    <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{label}</div>
    {sub && <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 1 }}>{sub}</div>}
  </div>
)

export const MetricsDashboard: React.FC<MetricsDashboardProps> = ({ logs, result, onClose }) => {
  const successLogs = logs.filter(l => l.status === 'success')
  const maxDuration = Math.max(...successLogs.map(l => l.durationMs ?? 0), 1)

  const nodeStats = useMemo(() => {
    const byNode = new Map<string, { name: string; role: string; model: string; runs: number; totalMs: number; errors: number }>()
    for (const log of logs) {
      if (!byNode.has(log.nodeId)) {
        byNode.set(log.nodeId, { name: log.nodeName, role: log.role, model: log.model, runs: 0, totalMs: 0, errors: 0 })
      }
      const n = byNode.get(log.nodeId)!
      if (log.status === 'success') { n.runs++; n.totalMs += log.durationMs ?? 0 }
      if (log.status === 'error')   { n.errors++ }
    }
    return Array.from(byNode.values())
  }, [logs])

  const totalMs    = result?.durationMs ?? 0
  const totalRetries = (result as any)?.totalRetries ?? 0
  const healedCount  = (result as any)?.healedNodes ?? 0
  const failedCount  = ((result as any)?.failedNodes ?? []).length
  const totalCost = nodeStats.reduce((sum, n) => sum + estimateCost(n.model, 800, 400), 0)
  const errorCount = logs.filter(l => l.status === 'error').length
  const avgMs = successLogs.length > 0 ? Math.round(successLogs.reduce((s, l) => s + (l.durationMs ?? 0), 0) / successLogs.length) : 0

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)', fontFamily: 'var(--font)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>📊 Execution Metrics</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>{logs.length} log entries · {successLogs.length} successful steps</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>
          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 20 }}>
            <StatCard label="Total Time" value={totalMs > 1000 ? `${(totalMs/1000).toFixed(1)}s` : `${totalMs}ms`} color="#2563eb" />
            <StatCard label="Avg Step Time" value={`${avgMs}ms`} color="#059669" />
            <StatCard label="Steps Run" value={String(result?.totalSteps ?? 0)} sub={`${errorCount} errors`} color={errorCount > 0 ? '#dc2626' : '#16a34a'} />
            <StatCard label="Est. Cost" value={`$${totalCost.toFixed(4)}`} sub="rough estimate" color="#d97706" />
            <StatCard label="Auto-Retries" value={String(totalRetries)} sub={healedCount>0?`${healedCount} healed`:''} color={totalRetries>0?'#d97706':'#a1a1aa'} />
            <StatCard label="Failed Nodes" value={String(failedCount)} color={failedCount>0?'#dc2626':'#16a34a'} />
          </div>

          {/* Node timing bars */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Execution Time per Agent
            </div>
            {nodeStats.map(n => (
              <Bar key={n.name}
                value={n.totalMs} max={maxDuration}
                color={ROLE_COLOR[n.role] ?? '#64748b'}
                label={n.name}
                sub={`${n.totalMs}ms · ${n.runs} run${n.runs !== 1 ? 's' : ''}${n.errors > 0 ? ` · ${n.errors} error` : ''}`}
              />
            ))}
          </div>

          {/* Model breakdown */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Model Usage
            </div>
            {(() => {
              const byModel = new Map<string, number>()
              for (const n of nodeStats) byModel.set(n.model, (byModel.get(n.model) ?? 0) + 1)
              return Array.from(byModel.entries()).map(([model, count]) => (
                <div key={model} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '7px 10px', borderRadius: 7, background: '#fafafa',
                  border: '1px solid var(--border)', marginBottom: 5,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: model.startsWith('claude') ? '#d97706' : '#16a34a' }} />
                    <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text)' }}>{model}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)' }}>{count} agent{count !== 1 ? 's' : ''}</span>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                      ~${estimateCost(model, 800 * count, 400 * count).toFixed(4)}
                    </span>
                  </div>
                </div>
              ))
            })()}
          </div>

          {/* Conditional routing stats */}
          {result && result.conditionalsEvaluated > 0 && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-2)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Conditional Routing
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                <StatCard label="Conditions Evaluated" value={String(result.conditionalsEvaluated)} />
                <StatCard label="Routes Taken" value={String(result.conditionalsEvaluated - result.conditionalsSkipped)} color="#16a34a" />
                <StatCard label="Routes Skipped" value={String(result.conditionalsSkipped)} color="#dc2626" />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
