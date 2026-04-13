import React, { useState, useRef, useCallback } from 'react'
import { Handle, Position, useReactFlow } from 'reactflow'
import type { NodeProps } from 'reactflow'
import type { AgentNodeData, AgentRole, AgentModel } from '../types'
import { ROLE_ICONS, ROLE_COLORS, ROLE_BG, ROLE_BORDER, StatusDot, SpinnerIcon } from './icons'

const MODEL_SHORT: Record<string, string> = {
  'claude-opus-4-5':   'Claude Opus',
  'claude-sonnet-4-5': 'Claude Sonnet',
  'claude-haiku-4-5':  'Claude Haiku',
  'gpt-4o':            'GPT-4o',
  'gpt-4o-mini':       'GPT-4o Mini',
}

const MODELS: AgentModel[] = ['claude-sonnet-4-5','claude-haiku-4-5','claude-opus-4-5','gpt-4o','gpt-4o-mini']
const ROLES: AgentRole[]   = ['orchestrator','planner','worker','evaluator','researcher','coder','reviewer','custom']

// Inline text edit
const Editable: React.FC<{
  value: string; onChange: (v:string)=>void; placeholder?:string
  style?: React.CSSProperties; multiline?:boolean; rows?:number
}> = ({ value, onChange, placeholder, style, multiline, rows=3 }) => {
  const [editing, setEditing] = useState(false)
  const [draft,   setDraft]   = useState(value)
  const ref = useRef<any>(null)

  const commit = () => { onChange(draft); setEditing(false) }
  const start  = () => { setDraft(value); setEditing(true); setTimeout(() => ref.current?.focus(), 0) }

  const base: React.CSSProperties = {
    background: '#fff', border: '1.5px solid #2563eb', borderRadius: 6,
    color: 'var(--text)', fontSize: 'inherit', fontFamily: 'var(--font)',
    padding: '4px 7px', width: '100%', boxSizing: 'border-box',
    outline: 'none', resize: 'vertical', ...style,
  }

  if (editing) {
    if (multiline) return (
      <textarea ref={ref} value={draft} rows={rows}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Escape' && commit()}
        style={base} onClick={e => e.stopPropagation()} />
    )
    return (
      <input ref={ref} value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if(e.key==='Enter') commit(); if(e.key==='Escape') commit() }}
        style={base} onClick={e => e.stopPropagation()} />
    )
  }
  return (
    <div onClick={e => { e.stopPropagation(); start() }}
      title="Click to edit"
      style={{ cursor: 'text', borderRadius: 4, padding: '2px 0', border: '1px solid transparent',
        transition: 'border-color 0.12s', ...style }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = '#e4e4e7')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
    >
      {value || <span style={{ color: 'var(--text-3)', fontStyle: 'italic' }}>{placeholder}</span>}
    </div>
  )
}

export const AgentNode: React.FC<NodeProps<AgentNodeData>> = ({ data, selected, id }) => {
  const { setNodes } = useReactFlow()
  const [expanded, setExpanded] = useState(false)

  const color  = ROLE_COLORS[data.role] ?? ROLE_COLORS.custom
  const bg     = ROLE_BG[data.role]     ?? ROLE_BG.custom
  const border = ROLE_BORDER[data.role] ?? ROLE_BORDER.custom
  const Icon   = ROLE_ICONS[data.role]  ?? ROLE_ICONS.custom
  const isRunning   = data.status === 'running'
  const isRetrying  = data.status === 'retrying'
  const isHealed    = data.status === 'healed'
  const isError   = data.status === 'error'
  const isSuccess = data.status === 'success'

  const update = useCallback((patch: Partial<AgentNodeData>) => {
    setNodes(nds => nds.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n))
  }, [id, setNodes])

  const ringColor = isError ? '#dc2626' : isSuccess ? '#16a34a' : selected ? '#2563eb' : 'transparent'

  return (
    <div style={{
      background: '#fff',
      border: `1px solid ${selected ? '#2563eb' : isError ? '#fca5a5' : isSuccess ? '#86efac' : isHealed ? '#5eead4' : isRetrying ? '#fde68a' : '#e4e4e7'}`,
      borderRadius: 10,
      width: expanded ? 280 : 240,
      boxShadow: selected
        ? '0 0 0 3px rgba(37,99,235,0.15), 0 4px 16px rgba(0,0,0,0.1)'
        : '0 2px 8px rgba(0,0,0,0.07)',
      transition: 'all 0.18s ease',
      fontFamily: 'var(--font)',
      position: 'relative',
      animation: isRunning ? 'pulse-ring 1.5s ease-out infinite' : isRetrying ? 'pulse-ring 0.8s ease-out infinite' : 'none',
    }}>

      {/* Top color strip */}
      <div style={{
        height: 3, background: color, borderRadius: '9px 9px 0 0',
        opacity: isRunning ? 1 : 0.7,
      }} />

      {/* Header */}
      <div style={{ padding: '10px 12px 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
        {/* Role icon badge */}
        <div
          onClick={e => { e.stopPropagation(); const i = ROLES.indexOf(data.role); update({ role: ROLES[(i+1) % ROLES.length] }) }}
          title="Click to change role"
          style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: bg, border: `1px solid ${border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', transition: 'transform 0.12s',
          }}
          onMouseEnter={e => (e.currentTarget.style.transform = 'scale(1.1)')}
          onMouseLeave={e => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {(isRunning || isRetrying) ? <SpinnerIcon size={14} color={isRetrying ? '#d97706' : color} /> : isHealed ? <span style={{fontSize:11,color:'#0d9488'}}>✦</span> : <Icon size={14} color={color} />}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 600, color, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 1 }}>
            {data.role}
          </div>
          <Editable value={data.agentName || ''} onChange={v => update({ agentName: v })}
            placeholder="Agent name"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
          <StatusDot status={data.status || 'idle'} />
          <button
            onClick={e => { e.stopPropagation(); setExpanded(x => !x) }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: 9, padding: 0, lineHeight: 1 }}
          >
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'var(--bg-hover)', margin: '0 12px' }} />

      {/* Collapsed body */}
      {!expanded && (
        <div style={{ padding: '8px 12px 10px' }}>
          {/* Model selector */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <div style={{ width: 4, height: 4, borderRadius: '50%', background: color, flexShrink: 0 }} />
            <select value={data.model}
              onChange={e => { e.stopPropagation(); update({ model: e.target.value as AgentModel }) }}
              onClick={e => e.stopPropagation()}
              style={{
                background: 'transparent', border: 'none', color: 'var(--text-2)',
                fontSize: 10, fontFamily: 'var(--mono)', cursor: 'pointer', outline: 'none', flex: 1,
              }}>
              {MODELS.map(m => <option key={m} value={m}>{MODEL_SHORT[m] ?? m}</option>)}
            </select>
            {(data.iterationCount ?? 0) > 1 && (
              <span style={{
                fontSize: 9, padding: '1px 5px', borderRadius: 4,
                background: '#fef3c7', color: '#d97706', border: '1px solid #fde68a',
                fontFamily: 'var(--mono)',
              }}>×{data.iterationCount}</span>
            )}
          </div>

          {/* Prompt preview */}
          <div style={{
            fontSize: 10, color: 'var(--text-3)', lineHeight: 1.55,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical' as const, overflow: 'hidden', minHeight: 28,
          }}>
            {data.prompt || <span style={{ color: '#d4d4d8', fontStyle: 'italic' }}>Click ▼ to add prompt</span>}
          </div>

          {/* Attached tools */}
          {(data.attachedTools ?? []).length > 0 && (
            <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 5 }}>
              {(data.attachedTools ?? []).map(t => (
                <span key={t} style={{
                  fontSize: 8, padding: '1px 5px', borderRadius: 3,
                  background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
                  fontFamily: 'var(--mono)',
                }}>{t}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '10px 12px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Role pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {ROLES.map(role => {
              const rc = ROLE_COLORS[role]
              const rb = ROLE_BG[role]
              const RI = ROLE_ICONS[role]
              const active = data.role === role
              return (
                <button key={role}
                  onClick={e => { e.stopPropagation(); update({ role }) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    padding: '3px 8px', borderRadius: 5, cursor: 'pointer', border: 'none',
                    background: active ? rb : '#f4f4f5',
                    outline: active ? `1.5px solid ${rc}` : '1.5px solid transparent',
                    color: active ? rc : '#71717a', fontSize: 10, textTransform: 'capitalize',
                    fontFamily: 'var(--font)',
                  }}
                >
                  <RI size={9} color="currentColor" />{role}
                </button>
              )
            })}
          </div>

          {/* Model */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, letterSpacing: '0.04em' }}>Model</div>
            <select value={data.model}
              onChange={e => { e.stopPropagation(); update({ model: e.target.value as AgentModel }) }}
              onClick={e => e.stopPropagation()}
              style={{
                width: '100%', background: 'var(--bg)', border: '1px solid #e4e4e7',
                borderRadius: 6, color: 'var(--text)', fontSize: 11, padding: '5px 8px',
                outline: 'none', cursor: 'pointer', fontFamily: 'var(--mono)',
              }}>
              {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>

          {/* Temperature */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', letterSpacing: '0.04em' }}>Temperature</div>
              <div style={{ fontSize: 10, color: color, fontFamily: 'var(--mono)' }}>{(data.temperature ?? 0.7).toFixed(1)}</div>
            </div>
            <input type="range" min={0} max={1} step={0.1} value={data.temperature ?? 0.7}
              onClick={e => e.stopPropagation()}
              onChange={e => { e.stopPropagation(); update({ temperature: parseFloat(e.target.value) }) }}
              style={{ width: '100%', accentColor: color }} />
          </div>

          {/* Prompt */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', marginBottom: 4, letterSpacing: '0.04em' }}>System Prompt</div>
            <Editable value={data.prompt || ''} onChange={v => update({ prompt: v })}
              placeholder="You are a helpful agent that…"
              multiline rows={4}
              style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.65 }} />
          </div>
        </div>
      )}

      {/* Handles */}
      <Handle type="target" position={Position.Top}
        style={{ top: -5, background: '#fff', border: `2px solid ${color}` }} />
      <Handle type="source" position={Position.Bottom}
        style={{ bottom: -5, background: '#fff', border: `2px solid ${color}` }} />
    </div>
  )
}
