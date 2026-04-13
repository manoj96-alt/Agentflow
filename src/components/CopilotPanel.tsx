/**
 * CopilotPanel
 * ============
 * Non-intrusive AI co-pilot panel that slides in from the right side
 * of the canvas. Shows suggestions with Accept / Dismiss actions.
 *
 * Also exports:
 *   CopilotBadge — floating badge showing pending suggestion count
 *   InlineTip    — small inline tip that appears near the canvas edge
 */
import React, { useState } from 'react'
import type { CopilotSuggestion } from '../hooks/useCopilot'

// ── Type icons + colors ───────────────────────────────────────────────────────
const TYPE_META: Record<string, { icon: string; color: string; bg: string }> = {
  add_node:       { icon: '＋', color: '#2563eb', bg: '#eff6ff' },
  add_edge:       { icon: '→', color: '#0891b2', bg: '#ecfeff' },
  improve_prompt: { icon: '✎', color: '#7c3aed', bg: '#f5f3ff' },
  change_model:   { icon: '⚡', color: '#d97706', bg: '#fffbeb' },
  add_condition:  { icon: '⎇', color: '#d97706', bg: '#fffbeb' },
  add_tool:       { icon: '🔧', color: '#059669', bg: '#f0fdf4' },
  restructure:    { icon: '↺', color: '#dc2626', bg: '#fef2f2' },
  add_loop:       { icon: '↻', color: '#d97706', bg: '#fffbeb' },
}

const PRIORITY_COLOR = { high: '#dc2626', medium: '#d97706', low: '#16a34a' }
const HEALTH_CONFIG = {
  good:       { icon: '✓', color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0' },
  fair:       { icon: '~', color: '#d97706', bg: '#fffbeb', border: '#fde68a' },
  needs_work: { icon: '!', color: '#dc2626', bg: '#fef2f2', border: '#fecaca' },
}

// ── Suggestion Card ───────────────────────────────────────────────────────────
const SuggestionCard: React.FC<{
  suggestion: CopilotSuggestion
  onAccept:   (s: CopilotSuggestion) => void
  onReject:   (id: string) => void
}> = ({ suggestion, onAccept, onReject }) => {
  const meta     = TYPE_META[suggestion.type] ?? TYPE_META.add_node
  const isAccepted = suggestion.status === 'accepted'
  const isRejected = suggestion.status === 'rejected'

  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${isAccepted ? '#bbf7d0' : '#e4e4e7'}`,
      background: isAccepted ? '#f0fdf4' : '#fff',
      padding: '10px 12px', marginBottom: 8,
      transition: 'all 0.2s ease',
      opacity: isRejected ? 0 : 1,
      transform: isRejected ? 'translateX(20px)' : 'none',
      fontFamily: 'var(--font)',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
        {/* Icon */}
        <div style={{
          width: 28, height: 28, borderRadius: 7, flexShrink: 0,
          background: meta.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, color: meta.color, fontWeight: 700,
          border: `1px solid ${meta.color}25`,
        }}>{meta.icon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: '#18181b', flex: 1 }}>{suggestion.title}</span>
            <div style={{
              width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
              background: PRIORITY_COLOR[suggestion.priority],
            }} title={`${suggestion.priority} priority`} />
          </div>
          <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.5 }}>{suggestion.reason}</div>
        </div>
      </div>

      {/* Preview of what will be applied */}
      {suggestion.action.node_name && (
        <div style={{
          fontSize: 10, color: '#52525b', fontFamily: 'var(--mono, monospace)',
          background: '#f8fafc', border: '1px solid #e4e4e7',
          borderRadius: 5, padding: '4px 8px', marginBottom: 8,
        }}>
          {suggestion.action.node_role} · {suggestion.action.node_name}
          {suggestion.action.model ? ` · ${suggestion.action.model.split('-').slice(-2).join('-')}` : ''}
        </div>
      )}
      {suggestion.action.prompt_improvement && (
        <div style={{
          fontSize: 9, color: '#52525b', fontFamily: 'var(--mono, monospace)',
          background: '#f8fafc', border: '1px solid #e4e4e7',
          borderRadius: 5, padding: '4px 8px', marginBottom: 8,
          maxHeight: 40, overflow: 'hidden', textOverflow: 'ellipsis',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const,
        }}>
          {suggestion.action.prompt_improvement}
        </div>
      )}
      {suggestion.action.edge_condition && (
        <div style={{
          fontSize: 10, color: '#d97706', fontFamily: 'var(--mono, monospace)',
          background: '#fffbeb', border: '1px solid #fde68a',
          borderRadius: 5, padding: '3px 7px', marginBottom: 8,
        }}>
          if: {suggestion.action.edge_condition}
        </div>
      )}

      {/* Actions */}
      {isAccepted ? (
        <div style={{ fontSize: 10, color: '#16a34a', fontWeight: 600 }}>✓ Applied</div>
      ) : (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={() => onAccept(suggestion)} style={{
            flex: 1, padding: '5px', borderRadius: 6, border: 'none',
            background: meta.color, color: '#fff',
            fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)',
            transition: 'opacity 0.12s',
          }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >Apply</button>
          <button onClick={() => onReject(suggestion.id)} style={{
            padding: '5px 10px', borderRadius: 6, border: '1px solid #e4e4e7',
            background: '#fff', color: '#a1a1aa',
            fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>✕</button>
        </div>
      )}
    </div>
  )
}

// ── Main Panel ────────────────────────────────────────────────────────────────
interface CopilotPanelProps {
  suggestions:    CopilotSuggestion[]
  workflowHealth: 'good' | 'fair' | 'needs_work' | null
  healthReason:   string
  isAnalysing:    boolean
  lastAnalysedAt: number | null
  onAccept:       (s: CopilotSuggestion) => void
  onReject:       (id: string) => void
  onDismissAll:   () => void
  onRefresh:      () => void
  onClose:        () => void
}

export const CopilotPanel: React.FC<CopilotPanelProps> = ({
  suggestions, workflowHealth, healthReason, isAnalysing, lastAnalysedAt,
  onAccept, onReject, onDismissAll, onRefresh, onClose,
}) => {
  const pending  = suggestions.filter(s => s.status === 'pending')
  const workflow = pending.filter(s => s.source === 'workflow')
  const node     = pending.filter(s => s.source === 'node')
  const health   = workflowHealth ? HEALTH_CONFIG[workflowHealth] : null

  return (
    <div style={{
      width: 280, height: '100%', flexShrink: 0,
      background: '#fff', borderLeft: '1px solid #e4e4e7',
      display: 'flex', flexDirection: 'column',
      fontFamily: 'var(--font)', animation: 'slide-in 0.18s ease',
    }}>

      {/* Header */}
      <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid #f4f4f5' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{
            width: 22, height: 22, borderRadius: 6,
            background: '#eff6ff', border: '1px solid #bfdbfe',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12,
          }}>✦</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#18181b' }}>AI Co-pilot</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: 15, padding: 2 }}>✕</button>
        </div>

        {/* Health badge */}
        {health && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 5, marginTop: 4,
            padding: '4px 8px', borderRadius: 6,
            background: health.bg, border: `1px solid ${health.border}`,
          }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: health.color }}>{health.icon}</span>
            <span style={{ fontSize: 10, color: '#52525b', flex: 1 }}>{healthReason}</span>
          </div>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '10px 12px' }}>

        {/* Analysing spinner */}
        {isAnalysing && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '8px 10px', marginBottom: 10, borderRadius: 8,
            background: '#eff6ff', border: '1px solid #bfdbfe',
          }}>
            <svg style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="32 10"/></svg>
            <span style={{ fontSize: 10, color: '#2563eb' }}>Analysing workflow…</span>
          </div>
        )}

        {/* Node-specific suggestions */}
        {node.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Selected agent
            </div>
            {node.map(s => (
              <SuggestionCard key={s.id} suggestion={s} onAccept={onAccept} onReject={onReject} />
            ))}
          </div>
        )}

        {/* Workflow suggestions */}
        {workflow.length > 0 && (
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
              Workflow improvements
            </div>
            {workflow.map(s => (
              <SuggestionCard key={s.id} suggestion={s} onAccept={onAccept} onReject={onReject} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isAnalysing && pending.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px 12px', color: '#a1a1aa' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>✦</div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#52525b', marginBottom: 4 }}>
              {workflowHealth === 'good' ? 'Workflow looks great!' : 'No suggestions yet'}
            </div>
            <div style={{ fontSize: 10, lineHeight: 1.6 }}>
              {workflowHealth === 'good'
                ? 'Add more agents or run the workflow to get targeted suggestions.'
                : 'Add agents to the canvas — the co-pilot will analyse your workflow and suggest improvements.'
              }
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #f4f4f5', display: 'flex', alignItems: 'center', gap: 6 }}>
        <button onClick={onRefresh} disabled={isAnalysing} style={{
          flex: 1, padding: '5px', borderRadius: 6, border: '1px solid #e4e4e7',
          background: '#fafafa', color: isAnalysing ? '#a1a1aa' : '#52525b',
          fontSize: 10, cursor: isAnalysing ? 'not-allowed' : 'pointer', fontFamily: 'var(--font)',
        }}>↻ Refresh</button>
        {pending.length > 0 && (
          <button onClick={onDismissAll} style={{
            padding: '5px 8px', borderRadius: 6, border: '1px solid #e4e4e7',
            background: '#fafafa', color: '#a1a1aa',
            fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>Clear all</button>
        )}
        {lastAnalysedAt && (
          <span style={{ fontSize: 9, color: '#d4d4d8', fontFamily: 'var(--mono)' }}>
            {new Date(lastAnalysedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>
    </div>
  )
}

// ── Floating badge (shown in topbar) ──────────────────────────────────────────
export const CopilotBadge: React.FC<{
  count:      number
  isActive:   boolean
  isAnalysing:boolean
  onClick:    () => void
}> = ({ count, isActive, isAnalysing, onClick }) => (
  <button onClick={onClick} style={{
    display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px',
    borderRadius: 7,
    border: `1px solid ${isActive ? '#bfdbfe' : '#e4e4e7'}`,
    background: isActive ? '#eff6ff' : '#fafafa',
    color: isActive ? '#2563eb' : '#52525b',
    fontSize: 12, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
    transition: 'all 0.15s', position: 'relative',
  }}>
    {isAnalysing
      ? <svg style={{ animation: 'spin 0.8s linear infinite' }} width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="32 10"/></svg>
      : <span style={{ fontSize: 13 }}>✦</span>
    }
    Co-pilot
    {count > 0 && (
      <span style={{
        minWidth: 16, height: 16, borderRadius: 8,
        background: '#dc2626', color: '#fff',
        fontSize: 9, fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 4px',
      }}>{count}</span>
    )}
  </button>
)

// ── Inline tip (floats near bottom-left of canvas) ────────────────────────────
export const InlineTip: React.FC<{
  suggestion: CopilotSuggestion
  onAccept:   (s: CopilotSuggestion) => void
  onDismiss:  () => void
}> = ({ suggestion, onAccept, onDismiss }) => {
  const meta = TYPE_META[suggestion.type] ?? TYPE_META.add_node

  return (
    <div style={{
      position: 'absolute', bottom: 80, left: 16, zIndex: 200,
      width: 280, padding: '10px 12px',
      background: '#fff', border: `1px solid ${meta.color}30`,
      borderLeft: `3px solid ${meta.color}`,
      borderRadius: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
      fontFamily: 'var(--font)', animation: 'fade-in 0.2s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 14, color: meta.color, flexShrink: 0, marginTop: 1 }}>{meta.icon}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#18181b', marginBottom: 2 }}>{suggestion.title}</div>
          <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.5 }}>{suggestion.reason}</div>
        </div>
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#d4d4d8', cursor: 'pointer', fontSize: 14, padding: 0, flexShrink: 0 }}>✕</button>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onAccept(suggestion)} style={{
          flex: 1, padding: '5px', borderRadius: 6, border: 'none',
          background: meta.color, color: '#fff',
          fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)',
        }}>Apply</button>
        <button onClick={onDismiss} style={{
          padding: '5px 10px', borderRadius: 6, border: '1px solid #e4e4e7',
          background: '#fafafa', color: '#a1a1aa',
          fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
        }}>Skip</button>
      </div>
    </div>
  )
}
