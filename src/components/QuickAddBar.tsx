import React, { useState } from 'react'
import type { AgentRole } from '../types'
import { ROLE_ICONS, ROLE_COLORS, ROLE_BG, ROLE_BORDER } from './icons'

const ROLES: { role: AgentRole; label: string }[] = [
  { role: 'orchestrator', label: 'Orchestrator' },
  { role: 'researcher',   label: 'Researcher' },
  { role: 'coder',        label: 'Coder' },
  { role: 'reviewer',     label: 'Reviewer' },
  { role: 'custom',       label: 'Custom' },
]

interface QuickAddBarProps { onAdd: (role: AgentRole) => void }

export const QuickAddBar: React.FC<QuickAddBarProps> = ({ onAdd }) => {
  const [open, setOpen] = useState(false)

  return (
    <div style={{
      position: 'absolute', bottom: 72, left: '50%',
      transform: 'translateX(-50%)', zIndex: 100,
      display: 'flex', alignItems: 'center', gap: 0,
      fontFamily: 'var(--font)',
    }}>
      {open && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: '#fff', border: '1px solid #e4e4e7',
          borderRadius: 10, padding: '5px 8px',
          marginRight: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.1)',
          animation: 'fade-in 0.15s ease',
        }}>
          {ROLES.map(({ role, label }) => {
            const color  = ROLE_COLORS[role]
            const bg     = ROLE_BG[role]
            const border = ROLE_BORDER[role]
            const Icon   = ROLE_ICONS[role]
            return (
              <button key={role}
                onClick={() => { onAdd(role); setOpen(false) }}
                title={label}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5,
                  padding: '5px 10px', borderRadius: 7, border: `1px solid ${border}`,
                  background: bg, color, cursor: 'pointer',
                  fontSize: 11, fontWeight: 500, fontFamily: 'var(--font)',
                  transition: 'all 0.12s', whiteSpace: 'nowrap',
                }}
                onMouseEnter={e => (e.currentTarget.style.transform = 'translateY(-1px)')}
                onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
              >
                <Icon size={12} color={color} />{label}
              </button>
            )
          })}
        </div>
      )}
      <button onClick={() => setOpen(o => !o)} style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '7px 16px', borderRadius: 8,
        border: open ? '1px solid #e4e4e7' : '1px solid #2563eb',
        background: open ? '#fafafa' : '#2563eb',
        color: open ? '#52525b' : '#fff',
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        fontFamily: 'var(--font)',
        boxShadow: open ? 'none' : '0 2px 12px rgba(37,99,235,0.3)',
        transition: 'all 0.2s',
      }}>
        <span style={{ fontSize: 15, lineHeight: 1 }}>{open ? '✕' : '+'}</span>
        {open ? 'Cancel' : 'Add Agent'}
      </button>
    </div>
  )
}
