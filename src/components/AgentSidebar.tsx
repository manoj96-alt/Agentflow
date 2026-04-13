import React, { useState } from 'react'
import type { AgentRole } from '../types'
import { ROLE_ICONS, ROLE_COLORS, ROLE_BG, ROLE_BORDER } from './icons'

interface AgentSidebarProps {
  nodeCount: number
  edgeCount: number
  onSave: () => void
  onLoad: () => void
  onClear: () => void
  onExecute: () => void
  isExecuting: boolean
  flowName: string
  onFlowNameChange: (name: string) => void
  onLoadTemplate: (key: string) => void
}

// ── Category icons ───────────────────────────────────────────────────────────
const AgentsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
  </svg>
)
const TemplatesIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="3" width="8" height="8" rx="1"/>
    <rect x="3" y="13" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>
  </svg>
)
const ToolsIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
  </svg>
)
const FlowIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="6" r="2"/><circle cx="19" cy="6" r="2"/><circle cx="12" cy="18" r="2"/>
    <path d="M5 8v2a4 4 0 004 4h6a4 4 0 004-4V8"/><line x1="12" y1="14" x2="12" y2="16"/>
  </svg>
)
const ChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
)
const ChevronDown = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"/>
  </svg>
)
const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
)

// ── Agent definitions ────────────────────────────────────────────────────────
const AGENT_ITEMS = [
  { role: 'orchestrator' as AgentRole, label: 'Orchestrator', desc: 'Coordinates agents (static graph)' },
  { role: 'planner'      as AgentRole, label: 'Planner',      desc: 'Dynamically plans execution' },
  { role: 'worker'       as AgentRole, label: 'Worker',       desc: 'Executes assigned tasks' },
  { role: 'evaluator'    as AgentRole, label: 'Evaluator',    desc: 'Validates & approves outputs' },
  { role: 'researcher'   as AgentRole, label: 'Researcher',   desc: 'Gathers & synthesises info' },
  { role: 'coder'        as AgentRole, label: 'Coder',        desc: 'Writes & reviews code' },
  { role: 'reviewer'     as AgentRole, label: 'Reviewer',     desc: 'Validates outputs' },
  { role: 'custom'       as AgentRole, label: 'Custom Agent', desc: 'Define your own role' },
]

const TEMPLATE_ITEMS = [
  { key: 'pdf_summarizer', label: 'PDF Summarizer',   desc: 'Extract & summarise documents',  icon: '📄' },
  { key: 'reasoning_loop', label: 'Reasoning Loop',   desc: 'Multi-turn debate & synthesis',  icon: '🔁' },
  { key: 'api_analysis',   label: 'API Analysis',     desc: 'Fetch data and analyse results', icon: '📊' },
]

const TOOL_ITEMS = [
  { key: 'api_fetch',      label: 'API Fetch',        desc: 'GET request → parsed JSON', icon: '🌐' },
  { key: 'db_query',       label: 'SQL Query',        desc: 'Read-only SELECT query',    icon: '🗄️' },
  { key: 'webhook',        label: 'Webhook',          desc: 'POST state to a URL',       icon: '🔗' },
]

// ── Nav icon sidebar (left strip) ────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'search',    Icon: () => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>, label: 'Search' },
  { id: 'agents',   Icon: AgentsIcon,   label: 'Agents' },
  { id: 'templates',Icon: TemplatesIcon,label: 'Templates' },
  { id: 'tools',    Icon: ToolsIcon,    label: 'Tools' },
  { id: 'flows',    Icon: FlowIcon,     label: 'Flows' },
]

// ── Expandable category row ──────────────────────────────────────────────────
const Category: React.FC<{
  label: string
  icon: React.ReactNode
  open: boolean
  onToggle: () => void
  children: React.ReactNode
}> = ({ label, icon, open, onToggle, children }) => {

  return (
    <div style={{ marginBottom: 2 }}>
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center',
          gap: 10, padding: '8px 12px',
          background: 'none', border: 'none', cursor: 'pointer',
          borderRadius: 8, transition: 'background 0.12s',
          fontFamily: 'var(--font)',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#f4f4f5')}
        onMouseLeave={e => (e.currentTarget.style.background = 'none')}
      >
        <span style={{ color: '#52525b', flexShrink: 0 }}>{icon}</span>
        <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: '#18181b', textAlign: 'left' }}>{label}</span>
        <span style={{ color: '#a1a1aa', transition: 'transform 0.15s', transform: open ? 'rotate(0deg)' : 'rotate(0deg)' }}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </span>
      </button>
      {open && (
        <div style={{ paddingLeft: 8, paddingBottom: 4, animation: 'slide-in 0.15s ease' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Draggable agent item ─────────────────────────────────────────────────────
const AgentItem: React.FC<{ role: AgentRole; label: string; desc: string; onDragStart: (e: React.DragEvent) => void }> = ({ role, label, desc, onDragStart }) => {
  const color  = ROLE_COLORS[role]
  const bg     = ROLE_BG[role]
  const border = ROLE_BORDER[role]
  const Icon   = ROLE_ICONS[role]

  return (
    <div draggable onDragStart={onDragStart}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '7px 10px', borderRadius: 8, cursor: 'grab',
        border: '1px solid transparent', transition: 'all 0.12s',
        userSelect: 'none',
      }}
      onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = bg; el.style.borderColor = border }}
      onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.background = 'transparent'; el.style.borderColor = 'transparent' }}
    >
      <div style={{
        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
        background: bg, border: `1px solid ${border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={13} color={color} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: '#18181b' }}>{label}</div>
        <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</div>
      </div>
    </div>
  )
}

// ── Template / tool item ─────────────────────────────────────────────────────
const ClickItem: React.FC<{ label: string; desc: string; icon: string; onClick: () => void }> = ({ label, desc, icon, onClick }) => (
  <button onClick={onClick} style={{
    width: '100%', display: 'flex', alignItems: 'center', gap: 10,
    padding: '7px 10px', borderRadius: 8, cursor: 'pointer',
    border: '1px solid transparent', background: 'none',
    fontFamily: 'var(--font)', transition: 'all 0.12s', textAlign: 'left',
  }}
    onMouseEnter={e => { const el = e.currentTarget; el.style.background = '#f4f4f5'; el.style.borderColor = '#e4e4e7' }}
    onMouseLeave={e => { const el = e.currentTarget; el.style.background = 'none'; el.style.borderColor = 'transparent' }}
  >
    <div style={{
      width: 28, height: 28, borderRadius: 7, flexShrink: 0,
      background: '#f4f4f5', border: '1px solid #e4e4e7',
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
    }}>{icon}</div>
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 12, fontWeight: 500, color: '#18181b' }}>{label}</div>
      <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 1 }}>{desc}</div>
    </div>
  </button>
)

// ── Main sidebar ─────────────────────────────────────────────────────────────
export const AgentSidebar: React.FC<AgentSidebarProps> = ({
  nodeCount, edgeCount, onSave, onLoad, onClear, onExecute, isExecuting,
  flowName, onFlowNameChange, onLoadTemplate,
}) => {
  const [activeNav, setActiveNav]   = useState('agents')
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    agents: true, templates: false, tools: false, flows: false,
  })

  const toggleCategory = (key: string) => {
    setOpenCategories(prev => ({ ...prev, [key]: !prev[key] }))
  }

  // When nav icon clicked → expand that category, collapse others
  const handleNavClick = (id: string) => {
    setActiveNav(id)
    if (id === 'agents' || id === 'templates' || id === 'tools' || id === 'flows') {
      setOpenCategories({
        agents: id === 'agents',
        templates: id === 'templates',
        tools: id === 'tools',
        flows: id === 'flows',
      })
    }
  }
  const [search, setSearch]         = useState('')
  const [editName, setEditName]     = useState(false)

  const onDragStart = (e: React.DragEvent, role: AgentRole) => {
    e.dataTransfer.setData('application/agent-role', role)
    e.dataTransfer.effectAllowed = 'move'
  }

  const filteredAgents    = AGENT_ITEMS.filter(i => !search || i.label.toLowerCase().includes(search.toLowerCase()) || i.desc.toLowerCase().includes(search.toLowerCase()))
  const filteredTemplates = TEMPLATE_ITEMS.filter(i => !search || i.label.toLowerCase().includes(search.toLowerCase()))
  const filteredTools     = TOOL_ITEMS.filter(i => !search || i.label.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{ display: 'flex', height: '100%', flexShrink: 0 }}>

      {/* ── Icon nav strip (leftmost) ───────────────────────────────────── */}
      <div style={{
        width: 48, height: '100%', flexShrink: 0,
        background: '#fff', borderRight: '1px solid #f4f4f5',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        paddingTop: 8,
      }}>
        {/* Logo */}
        <div style={{
          width: 28, height: 28, borderRadius: 7, background: '#2563eb',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          marginBottom: 12,
        }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5">
            <circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/>
            <path d="M12 7.5v3M12 10.5l-5 6M12 10.5l5 6"/>
          </svg>
        </div>

        {/* Nav icons */}
        {NAV_ITEMS.map(({ id, Icon, label }) => (
          <button key={id}
            onClick={() => handleNavClick(id)}
            title={label}
            style={{
              width: 36, height: 36, borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', cursor: 'pointer', marginBottom: 2,
              background: activeNav === id ? '#eff6ff' : 'transparent',
              color: activeNav === id ? '#2563eb' : '#71717a',
              transition: 'all 0.12s',
            }}
            onMouseEnter={e => { if (activeNav !== id) (e.currentTarget as HTMLButtonElement).style.background = '#f4f4f5' }}
            onMouseLeave={e => { if (activeNav !== id) (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
          >
            <Icon />
          </button>
        ))}
      </div>

      {/* ── Main panel ─────────────────────────────────────────────────── */}
      <div style={{
        width: 240, height: '100%', flexShrink: 0,
        background: '#fff', borderRight: '1px solid #e4e4e7',
        display: 'flex', flexDirection: 'column',
        fontFamily: 'var(--font)',
      }}>

        {/* Search header */}
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid #f4f4f5' }}>
          {/* Flow name */}
          {editName ? (
            <input autoFocus value={flowName}
              onChange={e => onFlowNameChange(e.target.value)}
              onBlur={() => setEditName(false)}
              onKeyDown={e => e.key === 'Enter' && setEditName(false)}
              style={{
                width: '100%', border: '1.5px solid #2563eb', borderRadius: 6,
                fontSize: 12, padding: '4px 8px', outline: 'none',
                fontFamily: 'var(--font)', background: '#fff', color: '#18181b',
                boxSizing: 'border-box', marginBottom: 8,
              }} />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, cursor: 'text' }}
              onClick={() => setEditName(true)}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#18181b', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{flowName}</span>
              <span style={{ fontSize: 9, color: '#a1a1aa' }}>✎</span>
            </div>
          )}

          {/* Search box */}
          <div style={{ position: 'relative' }}>
            <svg style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: '#a1a1aa', pointerEvents: 'none' }}
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
            </svg>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search"
              style={{
                width: '100%', paddingLeft: 28, paddingRight: 32, paddingTop: 6, paddingBottom: 6,
                border: '1px solid #e4e4e7', borderRadius: 8, fontSize: 12,
                background: '#fafafa', color: '#18181b', outline: 'none',
                fontFamily: 'var(--font)', boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = '#2563eb')}
              onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
            <kbd style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              fontSize: 9, color: '#a1a1aa', background: '#f4f4f5',
              border: '1px solid #e4e4e7', borderRadius: 3, padding: '1px 4px',
              fontFamily: 'var(--mono)',
            }}>/</kbd>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: 'flex', padding: '8px 12px', gap: 6, borderBottom: '1px solid #f4f4f5' }}>
          {[{ label: 'Agents', val: nodeCount, color: '#2563eb' }, { label: 'Links', val: edgeCount, color: '#52525b' }].map(s => (
            <div key={s.label} style={{
              flex: 1, textAlign: 'center', padding: '5px 4px',
              background: '#fafafa', borderRadius: 6, border: '1px solid #f4f4f5',
            }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: s.color, fontFamily: 'var(--mono)' }}>{s.val}</div>
              <div style={{ fontSize: 9, color: '#a1a1aa', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Section label */}
        <div style={{ padding: '10px 14px 4px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: '#18181b' }}>Components</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#a1a1aa', padding: 2 }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/>
              <circle cx="21" cy="6" r="2" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="2" fill="currentColor" stroke="none"/><circle cx="21" cy="18" r="2" fill="currentColor" stroke="none"/>
            </svg>
          </button>
        </div>

        {/* Expandable categories */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 8px' }}>

          <Category label="Agents" icon={<AgentsIcon />} open={openCategories.agents} onToggle={() => toggleCategory('agents')}>
            {filteredAgents.length === 0
              ? <div style={{ padding: '6px 10px', fontSize: 11, color: '#a1a1aa' }}>No results</div>
              : filteredAgents.map(item => (
                  <AgentItem key={item.role} role={item.role} label={item.label} desc={item.desc}
                    onDragStart={e => onDragStart(e, item.role)} />
                ))
            }
          </Category>

          <Category label="Templates" icon={<TemplatesIcon />} open={openCategories.templates} onToggle={() => toggleCategory('templates')}>
            {filteredTemplates.map(item => (
              <ClickItem key={item.key} label={item.label} desc={item.desc} icon={item.icon}
                onClick={() => onLoadTemplate(item.key)} />
            ))}
          </Category>

          <Category label="Tools" icon={<ToolsIcon />} open={openCategories.tools} onToggle={() => toggleCategory('tools')}>
            {filteredTools.map(item => (
              <ClickItem key={item.key} label={item.label} desc={item.desc} icon={item.icon}
                onClick={() => {}} />
            ))}
            <div style={{ padding: '6px 10px' }}>
              <div style={{ fontSize: 10, color: '#a1a1aa' }}>Use 🔧 Tools in the config panel to attach tools to agents</div>
            </div>
          </Category>

          <Category label="Flow Control" icon={<FlowIcon />} open={openCategories.flows} onToggle={() => toggleCategory('flows')}>
            <ClickItem label="Conditional Edge" desc="Route based on state expression" icon="⎇"
              onClick={() => {}} />
            <ClickItem label="Loop Back" desc="Repeat until condition met" icon="🔄"
              onClick={() => {}} />
            <div style={{ padding: '6px 10px' }}>
              <div style={{ fontSize: 10, color: '#a1a1aa' }}>Double-click any edge on the canvas to add a condition</div>
            </div>
          </Category>

          {/* Discover more */}
          <button style={{
            width: '100%', margin: '8px 0', padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 8,
            background: '#fafafa', border: '1px solid #e4e4e7',
            borderRadius: 8, cursor: 'pointer', fontFamily: 'var(--font)',
            transition: 'all 0.12s',
          }}
            onMouseEnter={e => { const el = e.currentTarget; el.style.background = '#f4f4f5'; el.style.borderColor = '#d4d4d8' }}
            onMouseLeave={e => { const el = e.currentTarget; el.style.background = '#fafafa'; el.style.borderColor = '#e4e4e7' }}
            onClick={onLoad}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#52525b" strokeWidth="2">
              <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
              <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
            </svg>
            <span style={{ fontSize: 12, fontWeight: 500, color: '#52525b' }}>Load saved workflows</span>
          </button>
        </div>

        {/* Bottom actions */}
        <div style={{ padding: '8px 10px', borderTop: '1px solid #f4f4f5', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <button onClick={onExecute} disabled={isExecuting} style={{
            width: '100%', padding: '8px', borderRadius: 8, border: 'none',
            background: isExecuting ? '#f4f4f5' : '#2563eb',
            color: isExecuting ? '#a1a1aa' : '#fff',
            fontSize: 12, fontWeight: 600, cursor: isExecuting ? 'not-allowed' : 'pointer',
            fontFamily: 'var(--font)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            boxShadow: isExecuting ? 'none' : '0 2px 8px rgba(37,99,235,0.25)',
            transition: 'all 0.15s',
          }}>
            {isExecuting
              ? <><svg style={{ animation: 'spin 0.8s linear infinite' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="32 10"/></svg> Running…</>
              : <><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Run Flow</>
            }
          </button>

          <div style={{ display: 'flex', gap: 4 }}>
            {[{ label: 'Save', fn: onSave }, { label: 'Clear', fn: onClear }].map(({ label, fn }) => (
              <button key={label} onClick={fn} style={{
                flex: 1, padding: '6px', borderRadius: 6, border: '1px solid #e4e4e7',
                background: '#fafafa', color: '#52525b', fontSize: 11,
                cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.12s',
              }}
                onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = '#f4f4f5' }}
                onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.background = '#fafafa' }}
              >{label}</button>
            ))}
          </div>

          {/* New custom component */}
          <button onClick={() => {}} style={{
            width: '100%', padding: '7px', borderRadius: 7, border: '1px dashed #d4d4d8',
            background: 'transparent', color: '#71717a', fontSize: 11,
            cursor: 'pointer', fontFamily: 'var(--font)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
            transition: 'all 0.12s',
          }}
            onMouseEnter={e => { const el = e.currentTarget; el.style.borderColor = '#2563eb'; el.style.color = '#2563eb' }}
            onMouseLeave={e => { const el = e.currentTarget; el.style.borderColor = '#d4d4d8'; el.style.color = '#71717a' }}
          >
            <PlusIcon /> New Custom Component
          </button>
        </div>
      </div>
    </div>
  )
}
