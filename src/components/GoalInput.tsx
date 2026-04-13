/**
 * WorkflowBuilder / GoalInput
 * ============================
 * Full AI workflow builder with Describe tab + Templates tab.
 */
import React, { useState, useRef } from 'react'
import { TEMPLATES } from '../utils/templates'

interface GoalInputProps {
  onGenerate: (goal: string) => Promise<void>
  onLoadTemplate?: (key: string) => void
  isGenerating: boolean
  onClose?: () => void
}

const SUGGESTIONS = [
  { label: 'Analyze supplier risk',           icon: '⚠️', desc: 'Research, score and recommend action' },
  { label: 'Summarize PDF document',          icon: '📄', desc: 'Extract, chunk and summarise' },
  { label: 'Fetch API and generate report',   icon: '📊', desc: 'Pull live data and analyse' },
  { label: 'Review code for security issues', icon: '🔍', desc: 'Security, style and test coverage' },
  { label: 'Research topic and write report', icon: '📝', desc: 'Deep research with parallel agents' },
  { label: 'Multi-agent debate and reasoning',icon: '🧠', desc: 'Argue, challenge and synthesise' },
]

const CATEGORY_COLORS: Record<string, string> = {
  Documents:'#7c3aed', Reasoning:'#0891b2', Data:'#059669',
  Business:'#d97706', Engineering:'#2563eb', Research:'#dc2626',
}

export const GoalInput: React.FC<GoalInputProps> = ({ onGenerate, onLoadTemplate, isGenerating, onClose }) => {
  const [tab, setTab]     = useState<'build'|'templates'>('build')
  const [goal, setGoal]   = useState('')
  const [hoveredTmpl, setHoveredTmpl] = useState<string|null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = async () => {
    if (!goal.trim() || isGenerating) return
    await onGenerate(goal.trim())
    onClose?.()
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit() }
    if (e.key === 'Escape') onClose?.()
  }

  const templateList = Object.entries(TEMPLATES)

  return (
    <div style={{
      position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
      zIndex: 200, width: 620,
      background: '#fff', border: '1px solid #e4e4e7',
      borderRadius: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.12)',
      fontFamily: 'var(--font)', overflow: 'hidden',
      animation: 'fade-in 0.15s ease',
    }}>

      {/* Header */}
      <div style={{ padding: '14px 18px 0', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 32, height: 32, borderRadius: 8, background: '#eff6ff',
          border: '1px solid #bfdbfe',
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#18181b' }}>AI Workflow Builder</div>
          <div style={{ fontSize: 11, color: '#71717a', marginTop: 1 }}>
            Describe your goal or pick a template — Claude designs the agents
          </div>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: 18, padding: 4, borderRadius: 6 }}>✕</button>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '10px 18px 0', gap: 2 }}>
        {[
          { id: 'build',     label: '✦ Describe & Generate' },
          { id: 'templates', label: `⊞ Templates (${templateList.length})` },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} style={{
            padding: '6px 14px', border: 'none', cursor: 'pointer',
            background: 'transparent',
            borderBottom: `2px solid ${tab === t.id ? '#2563eb' : 'transparent'}`,
            color: tab === t.id ? '#2563eb' : '#71717a',
            fontSize: 12, fontWeight: tab === t.id ? 600 : 400,
            fontFamily: 'var(--font)', borderRadius: '4px 4px 0 0',
          }}>{t.label}</button>
        ))}
      </div>
      <div style={{ height: 1, background: '#f4f4f5' }} />

      {/* Build tab */}
      {tab === 'build' && (
        <div style={{ padding: '14px 18px 16px' }}>
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <textarea
              ref={textareaRef}
              autoFocus
              value={goal}
              onChange={e => setGoal(e.target.value)}
              onKeyDown={handleKey}
              placeholder="e.g. Analyze supplier risk for our top 10 vendors and flag high-risk ones"
              rows={3}
              style={{
                width: '100%', background: '#fafafa', border: '1px solid #e4e4e7',
                borderRadius: 10, color: '#18181b', fontSize: 13, padding: '12px 14px',
                outline: 'none', resize: 'none', lineHeight: 1.65,
                fontFamily: 'var(--font)', boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = '#2563eb')}
              onBlur={e => (e.target.style.borderColor = '#e4e4e7')}
            />
            {goal.length > 0 && (
              <div style={{ position: 'absolute', bottom: 10, right: 10, fontSize: 10, color: '#a1a1aa' }}>{goal.length}</div>
            )}
          </div>

          <button onClick={handleSubmit} disabled={!goal.trim() || isGenerating} style={{
            width: '100%', padding: '10px', borderRadius: 8, border: 'none',
            background: !goal.trim() || isGenerating ? '#f4f4f5' : '#2563eb',
            color: !goal.trim() || isGenerating ? '#a1a1aa' : '#fff',
            fontSize: 13, fontWeight: 600,
            cursor: !goal.trim() || isGenerating ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font)', marginBottom: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            boxShadow: !goal.trim() || isGenerating ? 'none' : '0 2px 10px rgba(37,99,235,0.3)',
          }}>
            {isGenerating
              ? <><svg style={{ animation: 'spin 0.8s linear infinite' }} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="32 10"/></svg> Designing your workflow…</>
              : <>⚡ Generate Workflow</>
            }
          </button>

          <div style={{ fontSize: 10, fontWeight: 600, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            Try these examples
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }}>
            {SUGGESTIONS.map(s => (
              <button key={s.label} onClick={() => { setGoal(s.label); setTimeout(() => textareaRef.current?.focus(), 0) }} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 10px', borderRadius: 8, cursor: 'pointer',
                border: `1px solid ${goal === s.label ? '#bfdbfe' : '#f4f4f5'}`,
                background: goal === s.label ? '#eff6ff' : '#fafafa',
                textAlign: 'left', fontFamily: 'var(--font)', transition: 'all 0.12s',
              }}
                onMouseEnter={e => { if (goal !== s.label) { const el = e.currentTarget; el.style.borderColor = '#e4e4e7'; el.style.background = '#f4f4f5' } }}
                onMouseLeave={e => { if (goal !== s.label) { const el = e.currentTarget; el.style.borderColor = '#f4f4f5'; el.style.background = '#fafafa' } }}
              >
                <span style={{ fontSize: 15, flexShrink: 0 }}>{s.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: goal === s.label ? '#2563eb' : '#18181b' }}>{s.label}</div>
                  <div style={{ fontSize: 9, color: '#a1a1aa', marginTop: 1 }}>{s.desc}</div>
                </div>
              </button>
            ))}
          </div>

          <div style={{ padding: '8px 10px', borderRadius: 7, background: '#f0fdf4', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 12 }}>✓</span>
            <span style={{ fontSize: 10, color: '#166534' }}>
              Claude auto-selects models (Opus for reviewers, Sonnet for coders), temperatures, and writes action-oriented prompts
            </span>
          </div>
        </div>
      )}

      {/* Templates tab */}
      {tab === 'templates' && (
        <div style={{ padding: '12px 18px 16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {templateList.map(([key, tmpl]) => {
              const catColor = CATEGORY_COLORS[tmpl.category] ?? '#2563eb'
              const isHov = hoveredTmpl === key
              return (
                <div key={key}
                  onClick={() => { onLoadTemplate?.(key); onClose?.() }}
                  onMouseEnter={() => setHoveredTmpl(key)}
                  onMouseLeave={() => setHoveredTmpl(null)}
                  style={{
                    padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                    border: `1px solid ${isHov ? catColor + '40' : '#e4e4e7'}`,
                    background: isHov ? catColor + '06' : '#fff',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{
                      width: 30, height: 30, borderRadius: 7, flexShrink: 0,
                      background: catColor + '12', border: `1px solid ${catColor}25`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 15,
                    }}>{tmpl.icon}</div>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: '#18181b' }}>{tmpl.name}</div>
                      <span style={{
                        fontSize: 9, padding: '1px 5px', borderRadius: 3,
                        background: catColor + '15', color: catColor,
                        border: `1px solid ${catColor}25`, fontWeight: 600,
                      }}>{tmpl.category}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 10, color: '#71717a', lineHeight: 1.5, marginBottom: 7 }}>{tmpl.description}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {tmpl.nodes.slice(0,5).map(node => {
                        const rc: Record<string,string> = { orchestrator:'#7c3aed', researcher:'#0891b2', coder:'#059669', reviewer:'#d97706', custom:'#64748b' }
                        return <div key={node.id} style={{ width: 7, height: 7, borderRadius: '50%', background: rc[node.data.role] ?? '#64748b' }} />
                      })}
                    </div>
                    <span style={{ fontSize: 9, color: '#a1a1aa' }}>{tmpl.nodes.length} agents</span>
                  </div>
                  {isHov && (
                    <div style={{ marginTop: 7, padding: '5px', background: catColor, borderRadius: 6, textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#fff' }}>
                      Load template →
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ marginTop: 8, fontSize: 10, color: '#a1a1aa', textAlign: 'center' }}>
            All nodes are fully editable after loading
          </div>
        </div>
      )}
    </div>
  )
}
