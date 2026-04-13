/**
 * StateViewer
 * ===========
 * Live panel showing the shared FlowState after the last completed node.
 * Diffs previous state vs current to highlight changes.
 * Groups keys by agent prefix for readability.
 */
import React, { useState, useMemo } from 'react'
import type { ExecutionLog } from '../types'

interface StateViewerProps {
  logs: ExecutionLog[]
  onClose: () => void
}

const SKIP_KEYS = new Set(['flowStartTime', 'totalNodes', 'maxIterations', 'flowEndTime', 'totalSteps', 'plannerMode'])

function groupState(state: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const groups: Record<string, Record<string, unknown>> = { '⚙ System': {}, '📦 Global': {} }
  for (const [k, v] of Object.entries(state)) {
    if (SKIP_KEYS.has(k) || k.startsWith('__')) {
      groups['⚙ System'][k] = v
      continue
    }
    const colon = k.indexOf(':')
    if (colon > 0) {
      const prefix = k.slice(0, colon)
      if (!groups[prefix]) groups[prefix] = {}
      groups[prefix][k.slice(colon + 1)] = v
    } else {
      groups['📦 Global'][k] = v
    }
  }
  return Object.fromEntries(Object.entries(groups).filter(([, v]) => Object.keys(v).length > 0))
}

function formatValue(v: unknown): { text: string; type: string } {
  if (v === null || v === undefined) return { text: 'null', type: 'null' }
  if (typeof v === 'boolean') return { text: String(v), type: 'boolean' }
  if (typeof v === 'number')  return { text: String(v), type: 'number' }
  if (typeof v === 'string') {
    if (v.length > 200) return { text: v.slice(0, 200) + '…', type: 'string-long' }
    return { text: v, type: 'string' }
  }
  return { text: JSON.stringify(v, null, 2), type: 'object' }
}

const VALUE_COLORS: Record<string, string> = {
  null: '#a1a1aa', boolean: '#2563eb', number: '#16a34a',
  string: '#7c3aed', 'string-long': '#7c3aed', object: '#52525b',
}

export const StateViewer: React.FC<StateViewerProps> = ({ logs, onClose }) => {
  const [selectedStep, setSelectedStep] = useState<number>(Math.max(0, logs.length - 1))
  const [search, setSearch] = useState('')
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['📦 Global']))

  const currentLog = logs[selectedStep]
  const prevLog    = selectedStep > 0 ? logs[selectedStep - 1] : null

  const state  = currentLog?.stateSnapshot ?? {}
  const prev   = prevLog?.stateSnapshot   ?? {}
  const groups = useMemo(() => groupState(state), [state])

  const changedKeys = useMemo(() => {
    const changed = new Set<string>()
    for (const k of Object.keys(state)) {
      if (JSON.stringify(state[k]) !== JSON.stringify(prev[k])) changed.add(k)
    }
    return changed
  }, [state, prev])

  const toggleGroup = (g: string) => setExpandedGroups(prev => {
    const next = new Set(prev)
    next.has(g) ? next.delete(g) : next.add(g)
    return next
  })

  const successLogs = logs.filter(l => l.status === 'success' || l.status === 'error')

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)', fontFamily: 'var(--font)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '13px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>🔍 Live State Viewer</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
              Shared FlowState after step {selectedStep + 1} · {Object.keys(state).filter(k => !SKIP_KEYS.has(k) && !k.startsWith('__')).length} keys · {changedKeys.size} changed
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left: step list */}
          <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '6px' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.08em', padding: '4px 6px 6px' }}>Steps</div>
            {successLogs.map((log, i) => {
              const logIdx = logs.indexOf(log)
              const isActive = logIdx === selectedStep
              const statusColor = log.status === 'success' ? '#16a34a' : '#dc2626'
              return (
                <div key={i} onClick={() => setSelectedStep(logIdx)} style={{
                  padding: '5px 8px', borderRadius: 6, cursor: 'pointer', marginBottom: 2,
                  background: isActive ? '#eff6ff' : 'transparent',
                  border: `1px solid ${isActive ? '#bfdbfe' : 'transparent'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: isActive ? 600 : 400, color: isActive ? '#2563eb' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.nodeName}</span>
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 1, marginLeft: 11 }}>{log.durationMs}ms</div>
                </div>
              )
            })}
          </div>

          {/* Right: state tree */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
            {/* Search */}
            <div style={{ marginBottom: 10 }}>
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter keys…"
                style={{
                  width: '100%', border: '1px solid var(--border)', borderRadius: 7,
                  padding: '6px 10px', fontSize: 11, fontFamily: 'var(--mono)',
                  outline: 'none', background: '#fafafa', color: 'var(--text)',
                  boxSizing: 'border-box',
                }}
                onFocus={e => (e.target.style.borderColor = '#2563eb')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
            </div>

            {Object.entries(groups).map(([group, keys]) => {
              const filteredKeys = Object.entries(keys).filter(([k]) =>
                !search || k.toLowerCase().includes(search.toLowerCase()) ||
                String(keys[k]).toLowerCase().includes(search.toLowerCase())
              )
              if (filteredKeys.length === 0) return null
              const isOpen = expandedGroups.has(group)
              return (
                <div key={group} style={{ marginBottom: 8 }}>
                  <button onClick={() => toggleGroup(group)} style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 8px', borderRadius: 6, background: '#fafafa',
                    border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'var(--font)',
                    marginBottom: isOpen ? 5 : 0,
                  }}>
                    <span style={{ fontSize: 10, color: 'var(--text-3)', transition: 'transform 0.12s', transform: isOpen ? 'rotate(90deg)' : 'none' }}>▶</span>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text)', flex: 1, textAlign: 'left' }}>{group}</span>
                    <span style={{ fontSize: 9, color: 'var(--text-3)' }}>{filteredKeys.length} key{filteredKeys.length !== 1 ? 's' : ''}</span>
                  </button>

                  {isOpen && filteredKeys.map(([key, val]) => {
                    const fullKey = group.startsWith('⚙') || group.startsWith('📦') ? key : `${group}:${key}`
                    const isChanged = changedKeys.has(fullKey) || changedKeys.has(key)
                    const { text, type } = formatValue(val)
                    return (
                      <div key={key} style={{
                        display: 'flex', gap: 8, padding: '4px 8px', borderRadius: 5,
                        background: isChanged ? '#fffbeb' : 'transparent',
                        border: isChanged ? '1px solid #fde68a' : '1px solid transparent',
                        marginBottom: 2, alignItems: 'flex-start',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, minWidth: 160 }}>
                          {isChanged && <span style={{ fontSize: 8, color: '#d97706', fontWeight: 700 }}>NEW</span>}
                          <span style={{ fontSize: 10, color: 'var(--text-2)', fontFamily: 'var(--mono)' }}>{key}</span>
                        </div>
                        <span style={{
                          fontSize: 10, fontFamily: 'var(--mono)', color: VALUE_COLORS[type] ?? 'var(--text)',
                          whiteSpace: type === 'object' ? 'pre-wrap' : 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          flex: 1, wordBreak: 'break-word',
                        }}>{text}</span>
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
