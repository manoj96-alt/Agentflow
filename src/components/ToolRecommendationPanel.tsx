/**
 * ToolRecommendationPanel
 * =======================
 * Shows per-agent tool recommendations from the backend LLM engine.
 * Can be opened from:
 *   1. The ConfigPanel "🎯 Recommend" button (single agent)
 *   2. Topbar "🎯 Tools" button (whole workflow)
 *
 * For each match shows:
 *   - Tool name + category badge + confidence bar
 *   - One-sentence LLM reasoning
 *   - Ready-to-use example args preview
 *   - "Attach" button → calls POST /api/tools/attach
 */
import React, { useState, useEffect, useCallback } from 'react'
import type { Node } from 'reactflow'
import type { AgentNodeData } from '../types'

const BASE = (import.meta as any).env?.VITE_API_BASE_URL ?? 'http://localhost:8000'

// ── Types ─────────────────────────────────────────────────────────────────────
interface ToolMatch {
  tool_name:   string
  category:    string
  description: string
  confidence:  number
  reasoning:   string
  example:     Record<string, unknown>
}

interface AgentRec {
  agent_id:   string
  agent_name: string
  role:       string
  matches:    ToolMatch[]
}

// ── Colors ────────────────────────────────────────────────────────────────────
const CAT_COLOR: Record<string, { color: string; bg: string; icon: string }> = {
  http:     { color: '#0891b2', bg: '#ecfeff', icon: '🌐' },
  database: { color: '#7c3aed', bg: '#f5f3ff', icon: '🗄️' },
  file:     { color: '#059669', bg: '#f0fdf4', icon: '📁' },
  custom:   { color: '#64748b', bg: '#f8fafc', icon: '⚡' },
}

const CONF_COLOR = (c: number) =>
  c >= 0.75 ? '#16a34a' : c >= 0.50 ? '#d97706' : '#64748b'

// ── Single tool match card ─────────────────────────────────────────────────────
const MatchCard: React.FC<{
  match:       ToolMatch
  agentId:     string
  attached:    boolean
  onAttach:    (agentId: string, toolName: string) => void
  isAttaching: boolean
}> = ({ match, agentId, attached, onAttach, isAttaching }) => {
  const cat  = CAT_COLOR[match.category] ?? CAT_COLOR.custom
  const pct  = Math.round(match.confidence * 100)

  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${attached ? '#bbf7d0' : '#e4e4e7'}`,
      background: attached ? '#f0fdf4' : '#fff',
      padding: '10px 12px', marginBottom: 8,
      transition: 'all 0.15s',
      fontFamily: 'var(--font)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 7, flexShrink: 0,
          background: cat.bg, border: `1px solid ${cat.color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
        }}>{cat.icon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#18181b', fontFamily: 'var(--mono)' }}>
              {match.tool_name}
            </span>
            <span style={{
              fontSize: 9, padding: '1px 5px', borderRadius: 3,
              background: cat.bg, color: cat.color, border: `1px solid ${cat.color}30`,
              fontWeight: 600,
            }}>{match.category}</span>
          </div>

          {/* Confidence bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
            <div style={{ flex: 1, height: 3, background: '#f4f4f5', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: CONF_COLOR(match.confidence), borderRadius: 2, transition: 'width 0.4s ease' }} />
            </div>
            <span style={{ fontSize: 9, color: CONF_COLOR(match.confidence), fontFamily: 'var(--mono)', flexShrink: 0, fontWeight: 600 }}>
              {pct}%
            </span>
          </div>
        </div>

        {/* Attach button */}
        <button
          onClick={() => !attached && onAttach(agentId, match.tool_name)}
          disabled={attached || isAttaching}
          style={{
            padding: '4px 10px', borderRadius: 6, border: 'none', flexShrink: 0,
            background: attached ? '#16a34a' : isAttaching ? '#f4f4f5' : cat.color,
            color: '#fff',
            fontSize: 10, fontWeight: 700, cursor: attached || isAttaching ? 'default' : 'pointer',
            fontFamily: 'var(--font)', transition: 'all 0.12s',
            opacity: isAttaching ? 0.6 : 1,
          }}
        >
          {attached ? '✓' : isAttaching ? '…' : 'Attach'}
        </button>
      </div>

      {/* Reasoning */}
      <div style={{ fontSize: 10, color: '#52525b', lineHeight: 1.5, marginBottom: 6 }}>
        {match.reasoning}
      </div>

      {/* Example args */}
      {Object.keys(match.example).length > 0 && (
        <div style={{
          fontSize: 9, color: '#64748b', fontFamily: 'var(--mono)',
          background: '#f8fafc', border: '1px solid #e4e4e7',
          borderRadius: 5, padding: '4px 8px',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {JSON.stringify(match.example)}
        </div>
      )}
    </div>
  )
}

// ── Main panel ────────────────────────────────────────────────────────────────
interface ToolRecommendationPanelProps {
  nodes:          Node<AgentNodeData>[]
  selectedNodeId: string | null
  onAttachTool:   (nodeId: string, toolName: string) => void
  onClose:        () => void
  mode:           'single' | 'workflow'   // single = selected node only
}

export const ToolRecommendationPanel: React.FC<ToolRecommendationPanelProps> = ({
  nodes, selectedNodeId, onAttachTool, onClose, mode,
}) => {
  const [recs,       setRecs]       = useState<AgentRec[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState('')
  const [attached,   setAttached]   = useState<Record<string, Set<string>>>({})
  const [attaching,  setAttaching]  = useState<string | null>(null)  // "nodeId:toolName"
  const [activeNode, setActiveNode] = useState<string | null>(selectedNodeId)

  const fetchRecs = useCallback(async () => {
    setLoading(true); setError('')
    try {
      if (mode === 'single' && selectedNodeId) {
        const node = nodes.find(n => n.id === selectedNodeId)
        if (!node) return
        const res = await fetch(`${BASE}/api/tools/recommend/agent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agent: { id: node.id, name: node.data.agentName, role: node.data.role, prompt: node.data.prompt ?? '' },
            top_n: 3,
          }),
        })
        const data = await res.json()
        setRecs([data])
        setActiveNode(selectedNodeId)
      } else {
        const targetNodes = mode === 'workflow' ? nodes : nodes.slice(0, 8)
        const res = await fetch(`${BASE}/api/tools/recommend/workflow`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            agents: targetNodes.map(n => ({
              id: n.id, name: n.data.agentName, role: n.data.role, prompt: n.data.prompt ?? '',
            })),
            top_n_per_agent: 3,
          }),
        })
        const data = await res.json()
        setRecs(data.recommendations ?? [])
        setActiveNode(selectedNodeId ?? (targetNodes[0]?.id ?? null))
      }
    } catch (e) {
      setError('Cannot reach backend')
    } finally {
      setLoading(false)
    }
  }, [nodes, selectedNodeId, mode])

  useEffect(() => { fetchRecs() }, [fetchRecs])

  const handleAttach = useCallback(async (agentId: string, toolName: string) => {
    const key = `${agentId}:${toolName}`
    setAttaching(key)
    try {
      await fetch(`${BASE}/api/tools/attach`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId, tool_names: [toolName] }),
      })
      setAttached(prev => {
        const next = { ...prev }
        if (!next[agentId]) next[agentId] = new Set()
        next[agentId] = new Set([...next[agentId], toolName])
        return next
      })
      onAttachTool(agentId, toolName)
    } catch {
      // silent — tool attach is best-effort
    } finally {
      setAttaching(null)
    }
  }, [onAttachTool])

  const attachAll = useCallback(async (agentId: string, matches: ToolMatch[]) => {
    for (const m of matches.filter(m => m.confidence >= 0.6)) {
      await handleAttach(agentId, m.tool_name)
    }
  }, [handleAttach])

  const activeRec = recs.find(r => r.agent_id === activeNode) ?? recs[0] ?? null
  const totalRecs = recs.reduce((s, r) => s + r.matches.length, 0)

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 660, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid #e4e4e7', borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)', fontFamily: 'var(--font)',
        overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e4e4e7', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 34, height: 34, borderRadius: 9, background: '#eff6ff', border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>🎯</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#18181b' }}>Recommended Tools</div>
            <div style={{ fontSize: 10, color: '#71717a', marginTop: 1 }}>
              {loading ? 'Analysing agents…' : `${totalRecs} tool matches across ${recs.length} agent${recs.length !== 1 ? 's' : ''}`}
            </div>
          </div>
          <button onClick={fetchRecs} disabled={loading} style={{ padding: '5px 10px', borderRadius: 6, border: '1px solid #e4e4e7', background: '#fafafa', color: '#52525b', fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)' }}>↻ Refresh</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

          {/* Left: agent list (only in workflow mode with multiple recs) */}
          {recs.length > 1 && (
            <div style={{ width: 180, flexShrink: 0, borderRight: '1px solid #e4e4e7', overflowY: 'auto', padding: '8px' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 6px 8px' }}>Agents</div>
              {recs.map(rec => {
                const isActive = rec.agent_id === activeNode
                const attCount = (attached[rec.agent_id]?.size ?? 0)
                return (
                  <div key={rec.agent_id} onClick={() => setActiveNode(rec.agent_id)} style={{
                    padding: '7px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2,
                    background: isActive ? '#eff6ff' : 'transparent',
                    border: `1px solid ${isActive ? '#bfdbfe' : 'transparent'}`,
                    transition: 'all 0.12s',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: isActive ? 700 : 500, color: isActive ? '#2563eb' : '#18181b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {rec.agent_name}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <span style={{ fontSize: 9, color: '#a1a1aa' }}>{rec.role}</span>
                      {attCount > 0 && <span style={{ fontSize: 9, color: '#16a34a', marginLeft: 'auto' }}>✓{attCount}</span>}
                      {rec.matches.length > 0 && <span style={{ fontSize: 9, color: '#2563eb', marginLeft: attCount > 0 ? 2 : 'auto' }}>{rec.matches.length} match{rec.matches.length !== 1 ? 'es' : ''}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Right: matches for active agent */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
            {loading && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#71717a' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 8 }}>
                  <svg style={{ animation: 'spin 0.8s linear infinite' }} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="32 10"/></svg>
                  <span style={{ fontSize: 12, color: '#2563eb' }}>Matching tools with Claude…</span>
                </div>
                <div style={{ fontSize: 10, color: '#a1a1aa' }}>Analysing agent roles and prompts</div>
              </div>
            )}

            {!loading && error && (
              <div style={{ textAlign: 'center', padding: '32px 0', color: '#dc2626', fontSize: 11 }}>{error}</div>
            )}

            {!loading && !error && activeRec && (
              <>
                {/* Agent header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>{activeRec.agent_name}</div>
                    <div style={{ fontSize: 10, color: '#71717a', marginTop: 1 }}>
                      Role: {activeRec.role} · {activeRec.matches.length} recommended tool{activeRec.matches.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                  {activeRec.matches.length > 1 && (
                    <button onClick={() => attachAll(activeRec.agent_id, activeRec.matches)} style={{
                      padding: '5px 12px', borderRadius: 6, border: 'none',
                      background: '#2563eb', color: '#fff',
                      fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
                    }}>
                      Attach top matches
                    </button>
                  )}
                </div>

                {/* Match cards */}
                {activeRec.matches.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '24px 0', color: '#a1a1aa', fontSize: 11 }}>
                    No tool matches above confidence threshold for this agent.
                  </div>
                ) : (
                  activeRec.matches.map(m => (
                    <MatchCard
                      key={m.tool_name}
                      match={m}
                      agentId={activeRec.agent_id}
                      attached={attached[activeRec.agent_id]?.has(m.tool_name) ?? false}
                      onAttach={handleAttach}
                      isAttaching={attaching === `${activeRec.agent_id}:${m.tool_name}`}
                    />
                  ))
                )}
              </>
            )}

            {!loading && !error && !activeRec && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#a1a1aa' }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🎯</div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#52525b', marginBottom: 4 }}>No recommendations yet</div>
                <div style={{ fontSize: 10 }}>Add agents with prompts to get tool recommendations</div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid #e4e4e7', background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, color: '#a1a1aa' }}>
            Confidence: <span style={{ color: '#16a34a' }}>■</span> High ≥75%&nbsp;&nbsp;
            <span style={{ color: '#d97706' }}>■</span> Medium ≥50%&nbsp;&nbsp;
            <span style={{ color: '#64748b' }}>■</span> Low ≥30%
          </div>
          <div style={{ fontSize: 10, color: '#a1a1aa' }}>Powered by Claude Haiku</div>
        </div>
      </div>
    </div>
  )
}
