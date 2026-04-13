import React, { useState } from 'react'
import type { AgentNodeData, AgentModel, AgentRole } from '../types'
import { ROLE_ICONS, ROLE_COLORS, CloseIcon } from './icons'

interface ConfigPanelProps {
  nodeId: string | null
  data: AgentNodeData | null
  onUpdate: (nodeId: string, data: Partial<AgentNodeData>) => void
  onClose: () => void
  onOpenTools?: () => void
  onOpenOptimizer?: () => void
  onOpenRecommend?: () => void
}

const MODELS: { value: AgentModel; label: string; provider: string; color: string }[] = [
  { value: 'claude-opus-4-5',   label: 'Claude Opus 4.5',   provider: 'Anthropic', color: '#d97706' },
  { value: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5', provider: 'Anthropic', color: '#d97706' },
  { value: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'Anthropic', color: '#d97706' },
  { value: 'gpt-4o',            label: 'GPT-4o',            provider: 'OpenAI',    color: '#16a34a' },
  { value: 'gpt-4o-mini',       label: 'GPT-4o Mini',       provider: 'OpenAI',    color: '#16a34a' },
  { value: 'gemini-1.5-pro',    label: 'Gemini 1.5 Pro',    provider: 'Google',    color: '#2563eb' },
  { value: 'gemini-1.5-flash',  label: 'Gemini 1.5 Flash',  provider: 'Google',    color: '#2563eb' },
]

const ROLES: AgentRole[] = ['orchestrator', 'researcher', 'coder', 'reviewer', 'custom']

const F: React.CSSProperties = {
  width: '100%', background: '#ffffff', border: '1px solid #1a2535',
  borderRadius: 7, padding: '8px 10px', color: '#18181b',
  fontSize: 12, fontFamily: "var(--font)", outline: 'none',
  transition: 'border-color 0.15s',
}

const Label: React.FC<{ children: React.ReactNode; hint?: string }> = ({ children, hint }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#3d5a7a' }}>
      {children}
    </span>
    {hint && <span style={{ fontSize: 9, color: '#a1a1aa' }}>{hint}</span>}
  </div>
)

export const ConfigPanel: React.FC<ConfigPanelProps> = ({ nodeId, data, onUpdate, onClose, onOpenTools, onOpenOptimizer, onOpenRecommend }) => {
  const [promptFocused, setPromptFocused] = useState(false)

  if (!nodeId || !data) {
    return (
      <aside style={{
        width: 272, flexShrink: 0, background: '#ffffff',
        borderLeft: '1px solid #10192a',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 10, padding: 28,
      }}>
        <div style={{
          width: 48, height: 48, borderRadius: 12,
          background: '#fafafa', border: '1px solid #162030',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#2d4060" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#a1a1aa', lineHeight: 1.6 }}>
            Click any agent node<br/>to configure it here
          </div>
        </div>
      </aside>
    )
  }

  const color = ROLE_COLORS[data.role] || ROLE_COLORS.custom
  const RoleIcon = ROLE_ICONS[data.role] || ROLE_ICONS.custom

  const set = (field: keyof AgentNodeData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const val = e.target.type === 'range' ? parseFloat(e.target.value) : e.target.value
      onUpdate(nodeId, { [field]: val })
    }

  const groupedModels = MODELS.reduce<Record<string, typeof MODELS>>((acc, m) => {
    acc[m.provider] = acc[m.provider] || []
    acc[m.provider].push(m)
    return acc
  }, {})

  return (
    <aside style={{
      width: 272, flexShrink: 0, background: '#ffffff',
      borderLeft: '1px solid #10192a',
      display: 'flex', flexDirection: 'column',
      fontFamily: "var(--font)",
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        padding: '13px 14px', borderBottom: '1px solid #10192a',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, flexShrink: 0,
          background: `${color}18`, border: `1px solid ${color}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <RoleIcon size={14} color={color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 9, color: `${color}99`, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 1 }}>
            {data.role}
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#18181b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {data.agentName || 'Unnamed Agent'}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {onOpenTools && (
            <button onClick={onOpenTools} style={{
              background: '#f4f4f5', border: '1px solid #1e2b3e',
              borderRadius: 6, color: '#2563eb', fontSize: 10,
              padding: '3px 8px', cursor: 'pointer',
              fontFamily: "var(--font)",
            }}>🔧 Tools</button>
          )}
          {onOpenOptimizer && (
            <button onClick={onOpenOptimizer} style={{
              background: '#f4f4f5', border: '1px solid #1e2b3e',
              borderRadius: 6, color: '#f59e0b', fontSize: 10,
              padding: '3px 8px', cursor: 'pointer',
              fontFamily: "var(--font)",
            }}>⚡ Optimize</button>
          )}
          {onOpenRecommend && (
            <button onClick={onOpenRecommend} style={{
              background: '#fafafa', border: '1px solid #e4e4e7',
              borderRadius: 6, color: '#0891b2', fontSize: 10,
              padding: '3px 8px', cursor: 'pointer',
              fontFamily: 'var(--font)',
            }}>🎯 Recommend</button>
          )}
          <button onClick={onClose} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: 4, borderRadius: 5, color: '#71717a',
            display: 'flex', alignItems: 'center', transition: 'color 0.1s',
          }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#52525b')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#71717a')}
          >
            <CloseIcon size={15} color="currentColor" />
          </button>
        </div>
      </div>

      {/* Color bar */}
      <div style={{ height: 2, background: `linear-gradient(90deg, ${color}, ${color}00)`, opacity: 0.7 }} />

      {/* Scrollable form */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Name */}
          <div>
            <Label>Agent Name</Label>
            <input style={F} value={data.agentName} onChange={set('agentName')}
              placeholder="e.g. Data Researcher"
              onFocus={e => (e.target.style.borderColor = `${color}80`)}
              onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
          </div>

          {/* Role */}
          <div>
            <Label>Role</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {ROLES.map(role => {
                const rc = ROLE_COLORS[role]
                const RI = ROLE_ICONS[role]
                const active = data.role === role
                return (
                  <button key={role} onClick={() => onUpdate(nodeId, { role })} style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 8px', borderRadius: 6, cursor: 'pointer',
                    background: active ? `${rc}18` : '#f4f4f5',
                    border: `1px solid ${active ? rc : '#e4e4e7'}`,
                    color: active ? rc : '#71717a',
                    fontSize: 11, fontFamily: "var(--font)",
                    transition: 'all 0.12s', textTransform: 'capitalize',
                  }}>
                    <RI size={11} color="currentColor" />
                    {role}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Model */}
          <div>
            <Label>Model</Label>
            <select style={{ ...F, cursor: 'pointer', appearance: 'none' as const }}
              value={data.model} onChange={set('model')}
              onFocus={e => (e.target.style.borderColor = `${color}80`)}
              onBlur={e => (e.target.style.borderColor = '#e4e4e7')}>
              {Object.entries(groupedModels).map(([provider, models]) => (
                <optgroup key={provider} label={provider}>
                  {models.map(m => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div>
            <Label hint={`${(data.temperature ?? 0.7).toFixed(1)}`}>Temperature</Label>
            <input type="range" min={0} max={1} step={0.1}
              value={data.temperature ?? 0.7} onChange={set('temperature')}
              style={{ width: '100%', accentColor: color }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#a1a1aa', marginTop: 2 }}>
              <span>Precise</span><span>Creative</span>
            </div>
          </div>

          {/* Max Tokens */}
          <div>
            <Label>Max Tokens</Label>
            <input style={F} type="number" min={1} max={128000} step={256}
              value={data.maxTokens ?? 1000} onChange={set('maxTokens')}
              onFocus={e => (e.target.style.borderColor = `${color}80`)}
              onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
          </div>

          {/* Prompt */}
          <div>
            <Label hint={`${(data.prompt || '').length} chars`}>System Prompt</Label>
            <textarea
              style={{
                ...F,
                minHeight: 120, resize: 'vertical', lineHeight: 1.65,
                borderColor: promptFocused ? `${color}80` : '#e4e4e7',
              }}
              value={data.prompt}
              onChange={set('prompt')}
              placeholder="You are a helpful agent that…"
              onFocus={() => setPromptFocused(true)}
              onBlur={() => setPromptFocused(false)}
            />
          </div>

          {/* Description */}
          <div>
            <Label hint="optional">Description</Label>
            <input style={F} value={data.description ?? ''} onChange={set('description')}
              placeholder="What does this agent do?"
              onFocus={e => (e.target.style.borderColor = `${color}80`)}
              onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
          </div>
        </div>
      </div>

      {/* Footer — auto-save indicator */}
      <div style={{
        padding: '8px 14px', borderTop: '1px solid #10192a',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#22c55e' }} />
        <span style={{ fontSize: 10, color: '#a1a1aa', fontFamily: 'var(--mono)' }}>
          Changes saved automatically
        </span>
      </div>
    </aside>
  )
}
