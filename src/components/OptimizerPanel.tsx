/**
 * OptimizerPanel
 * ==============
 * Shows per-agent performance metrics and LLM-powered optimization
 * suggestions. Opens from a "⚡ Optimize" button in the ConfigPanel.
 *
 * Features:
 * - Success rate, error rate, avg latency, token usage per agent
 * - "Analyse" button triggers backend LLM analysis
 * - Shows: prompt suggestions, model recommendation, priority badge
 * - Apply button applies the suggested model to the node directly
 */
import React, { useState, useEffect, useCallback } from 'react'
import type { AgentNodeData } from '../types'

interface Metrics {
  total_runs: number
  success_count: number
  error_count: number
  success_rate: number
  error_rate: number
  avg_duration_ms: number
  avg_tokens: number
  tool_hit_rate: number
}

interface Suggestion {
  model_suggestion: string | null
  model_reasoning: string
  prompt_suggestions: string[]
  overall_assessment: string
  priority: 'high' | 'medium' | 'low'
  metrics_snapshot: Metrics
  generated_at: string
}

interface OptimizerPanelProps {
  nodeId: string
  data: AgentNodeData
  onApplyModel: (nodeId: string, model: string) => void
  onApplyPromptHint: (hint: string) => void
  onClose: () => void
}

const PRIORITY_COLOR = { high: '#f87171', medium: '#f59e0b', low: '#34d399' }
const PRIORITY_BG    = { high: '#f8717115', medium: '#f59e0b15', low: '#34d39915' }

const mono: React.CSSProperties = { fontFamily: 'var(--mono)' }

const Stat: React.FC<{ label: string; value: string | number; color?: string; sub?: string }> = ({ label, value, color, sub }) => (
  <div style={{ textAlign: 'center', padding: '10px 6px', background: '#f4f4f5', borderRadius: 8, border: '1px solid #1e2b3e' }}>
    <div style={{ fontSize: 18, fontWeight: 700, color: color ?? '#18181b', ...mono }}>{value}</div>
    <div style={{ fontSize: 9, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>{label}</div>
    {sub && <div style={{ fontSize: 9, color: '#a1a1aa', marginTop: 1 }}>{sub}</div>}
  </div>
)

export const OptimizerPanel: React.FC<OptimizerPanelProps> = ({
  nodeId, data, onApplyModel, onApplyPromptHint, onClose,
}) => {
  const [metrics, setMetrics]       = useState<Metrics | null>(null)
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null)
  const [analysing, setAnalysing]   = useState(false)
  const [loading, setLoading]       = useState(true)
  const [copied, setCopied]         = useState<number | null>(null)

  useEffect(() => {
    fetch(`http://localhost:8000/api/optimizer/metrics/${nodeId}`)
      .then(r => r.json())
      .then(d => { setMetrics(d.metrics); setLoading(false) })
      .catch(() => setLoading(false))
  }, [nodeId])

  const analyse = useCallback(async () => {
    setAnalysing(true)
    try {
      const res = await fetch(`http://localhost:8000/api/optimizer/analyse/${nodeId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_name:     data.agentName,
          role:           data.role,
          current_model:  data.model,
          current_prompt: data.prompt,
        }),
      })
      const d = await res.json()
      setSuggestion(d)
    } catch { setSuggestion(null) }
    finally { setAnalysing(false) }
  }, [nodeId, data])

  const copyHint = (hint: string, i: number) => {
    onApplyPromptHint(hint)
    setCopied(i)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: '#ffffff', border: '1px solid #1e2b3e', borderRadius: 14,
        boxShadow: '0 24px 80px rgba(0,0,0,0.15)',
        fontFamily: "var(--font)", overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '13px 18px', borderBottom: '1px solid #1e2b3e',
          background: '#ffffff', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>Agent Optimizer</div>
            <div style={{ fontSize: 10, color: '#71717a', marginTop: 1 }}>
              <span style={{ color: '#2563eb' }}>{data.agentName}</span> · {data.role} · {data.model}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {/* Performance metrics */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
              Performance Metrics
            </div>
            {loading ? (
              <div style={{ fontSize: 10, color: '#71717a', textAlign: 'center', padding: 16 }}>Loading…</div>
            ) : !metrics || metrics.total_runs === 0 ? (
              <div style={{
                padding: '12px 14px', borderRadius: 8, fontSize: 11, color: '#71717a',
                background: '#f4f4f5', border: '1px solid #1e2b3e', textAlign: 'center',
              }}>
                No executions recorded yet. Run the workflow to start tracking performance.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6 }}>
                <Stat label="Total Runs"   value={metrics.total_runs} />
                <Stat label="Success Rate" value={`${(metrics.success_rate * 100).toFixed(0)}%`}
                  color={metrics.success_rate >= 0.8 ? '#34d399' : metrics.success_rate >= 0.5 ? '#f59e0b' : '#f87171'} />
                <Stat label="Avg Latency"  value={`${metrics.avg_duration_ms.toFixed(0)}ms`} color="#818cf8" />
                <Stat label="Avg Tokens"   value={metrics.avg_tokens.toFixed(0)} color="#38bdf8" />
                <Stat label="Errors"       value={metrics.error_count}
                  color={metrics.error_count > 0 ? '#f87171' : '#34d399'} />
                <Stat label="Error Rate"   value={`${(metrics.error_rate * 100).toFixed(0)}%`}
                  color={metrics.error_rate > 0.2 ? '#f87171' : '#34d399'} />
                <Stat label="Tool Hit Rate" value={`${(metrics.tool_hit_rate * 100).toFixed(0)}%`} color="#f59e0b" />
                <Stat label="Successes"    value={metrics.success_count} color="#34d399" />
              </div>
            )}
          </div>

          {/* Analyse button */}
          {!suggestion && (
            <button onClick={analyse} disabled={analysing} style={{
              width: '100%', padding: '10px', borderRadius: 8, border: 'none',
              background: analysing ? '#f4f4f5' : 'linear-gradient(135deg, #4f46e5, #6d28d9)',
              color: analysing ? '#71717a' : '#fff',
              fontSize: 12, fontWeight: 700, cursor: analysing ? 'not-allowed' : 'pointer',
              fontFamily: "var(--font)", marginBottom: 16,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            }}>
              {analysing ? '⟳ Analysing with Claude…' : '⚡ Analyse & Get Suggestions'}
            </button>
          )}

          {/* Suggestions */}
          {suggestion && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

              {/* Priority + assessment */}
              <div style={{
                padding: '12px 14px', borderRadius: 8,
                background: PRIORITY_BG[suggestion.priority],
                border: `1px solid ${PRIORITY_COLOR[suggestion.priority]}30`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: PRIORITY_COLOR[suggestion.priority] + '30',
                    color: PRIORITY_COLOR[suggestion.priority],
                    textTransform: 'uppercase', letterSpacing: '0.1em',
                  }}>{suggestion.priority} priority</span>
                  <span style={{ fontSize: 9, color: '#71717a', ...mono }}>
                    {new Date(suggestion.generated_at).toLocaleTimeString()}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#52525b', lineHeight: 1.6 }}>
                  {suggestion.overall_assessment}
                </div>
              </div>

              {/* Model suggestion */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                  Model Recommendation
                </div>
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: suggestion.model_suggestion ? '#4f46e518' : '#f4f4f5',
                  border: `1px solid ${suggestion.model_suggestion ? '#4f46e540' : '#e4e4e7'}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                }}>
                  <div>
                    <div style={{ fontSize: 11, color: suggestion.model_suggestion ? '#2563eb' : '#71717a', fontWeight: 600, ...mono }}>
                      {suggestion.model_suggestion ?? `Keep current: ${data.model}`}
                    </div>
                    <div style={{ fontSize: 10, color: '#71717a', marginTop: 3 }}>
                      {suggestion.model_reasoning}
                    </div>
                  </div>
                  {suggestion.model_suggestion && suggestion.model_suggestion !== data.model && (
                    <button onClick={() => { onApplyModel(nodeId, suggestion.model_suggestion!); setSuggestion({ ...suggestion, model_suggestion: null }) }}
                      style={{
                        padding: '5px 12px', borderRadius: 6, border: 'none',
                        background: '#2563eb', color: '#fff', fontSize: 10,
                        fontWeight: 700, cursor: 'pointer', flexShrink: 0,
                        fontFamily: "var(--font)",
                      }}>Apply</button>
                  )}
                </div>
              </div>

              {/* Prompt suggestions */}
              {suggestion.prompt_suggestions.length > 0 && (
                <div>
                  <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    Prompt Improvements
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {suggestion.prompt_suggestions.map((hint, i) => (
                      <div key={i} style={{
                        padding: '8px 10px', borderRadius: 7,
                        background: '#f4f4f5', border: '1px solid #1e2b3e',
                        display: 'flex', alignItems: 'flex-start', gap: 8,
                      }}>
                        <span style={{ fontSize: 12, color: '#2563eb', flexShrink: 0, marginTop: 1 }}>→</span>
                        <div style={{ flex: 1, fontSize: 11, color: '#52525b', lineHeight: 1.55 }}>{hint}</div>
                        <button onClick={() => copyHint(hint, i)} style={{
                          padding: '3px 8px', borderRadius: 5, border: '1px solid #1e2b3e',
                          background: copied === i ? '#34d39920' : '#ffffff',
                          color: copied === i ? '#34d399' : '#52525b',
                          fontSize: 9, cursor: 'pointer', flexShrink: 0,
                          fontFamily: "var(--font)",
                        }}>
                          {copied === i ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <button onClick={() => setSuggestion(null)} style={{
                padding: '6px', borderRadius: 6, border: '1px solid #1e2b3e',
                background: 'transparent', color: '#71717a', fontSize: 10,
                cursor: 'pointer', fontFamily: "var(--font)",
              }}>Re-analyse</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
