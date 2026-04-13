import React from 'react'
import type { AgentRole } from '../types'

// ── Role colors (light theme) ─────────────────────────────────────────────────
export const ROLE_COLORS: Record<AgentRole, string> = {
  orchestrator: '#7c3aed',
  planner:      '#2563eb',
  worker:       '#059669',
  evaluator:    '#dc2626',
  researcher:   '#0891b2',
  coder:        '#16a34a',
  reviewer:     '#d97706',
  custom:       '#64748b',
}

export const ROLE_BG: Record<AgentRole, string> = {
  orchestrator: '#f5f3ff',
  planner:      '#eff6ff',
  worker:       '#f0fdf4',
  evaluator:    '#fef2f2',
  researcher:   '#ecfeff',
  coder:        '#f0fdf4',
  reviewer:     '#fffbeb',
  custom:       '#f8fafc',
}

export const ROLE_BORDER: Record<AgentRole, string> = {
  orchestrator: '#ddd6fe',
  planner:      '#bfdbfe',
  worker:       '#bbf7d0',
  evaluator:    '#fecaca',
  researcher:   '#a5f3fc',
  coder:        '#bbf7d0',
  reviewer:     '#fde68a',
  custom:       '#e2e8f0',
}

// ── Status dot ───────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  idle:    { color: '#d4d4d8', label: '' },
  running: { color: '#2563eb', label: '●' },
  success: { color: '#16a34a', label: '✓' },
  error:   { color: '#dc2626', label: '✕' },
  skipped: { color: '#d97706', label: '⚠' },
  pending: { color: '#d4d4d8', label: '' },
}
export const StatusDot: React.FC<{ status: string }> = ({ status }) => {
  const cfg = STATUS_CONFIG[status as keyof typeof STATUS_CONFIG] ?? STATUS_CONFIG.idle
  return (
    <div style={{
      width: 8, height: 8, borderRadius: '50%',
      background: cfg.color, flexShrink: 0,
      animation: status === 'running' ? 'pulse-ring 1.5s ease-out infinite' : 'none',
    }} title={status} />
  )
}

export const SpinnerIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = '#2563eb' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'spin 0.8s linear infinite' }}>
    <circle cx="12" cy="12" r="10" stroke={color} strokeWidth="2.5" strokeDasharray="32 10" />
  </svg>
)

// ── Role icons (clean outline style) ─────────────────────────────────────────
const iconProps = (color: string, size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: color, strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
})

export const OrchestratorIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#7c3aed' }) => (
  <svg {...iconProps(color, size)}>
    <circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/>
    <path d="M12 7.5v3M12 10.5l-5 6M12 10.5l5 6"/>
  </svg>
)

export const ResearcherIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#0891b2' }) => (
  <svg {...iconProps(color, size)}>
    <circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>
  </svg>
)

export const CoderIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#059669' }) => (
  <svg {...iconProps(color, size)}>
    <polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>
  </svg>
)

export const ReviewerIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#d97706' }) => (
  <svg {...iconProps(color, size)}>
    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
  </svg>
)

export const CustomIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#64748b' }) => (
  <svg {...iconProps(color, size)}>
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
  </svg>
)

export const PlannerIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#2563eb' }) => (
  <svg {...iconProps(color, size)}>
    <rect x="3" y="3" width="18" height="4" rx="1"/><rect x="3" y="10" width="12" height="3" rx="1"/>
    <rect x="3" y="16" width="8" height="3" rx="1"/>
    <path d="M16 14l4 4-4 4"/>
  </svg>
)

export const WorkerIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#059669' }) => (
  <svg {...iconProps(color, size)}>
    <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
  </svg>
)

export const EvaluatorIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#dc2626' }) => (
  <svg {...iconProps(color, size)}>
    <path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
    <circle cx="18" cy="18" r="4" fill={color} stroke="none" opacity="0.3"/>
    <path d="M16 18l1.5 1.5L20 16"/>
  </svg>
)

export const ROLE_ICONS: Record<AgentRole, React.FC<{ size?: number; color?: string }>> = {
  orchestrator: OrchestratorIcon,
  planner:      PlannerIcon,
  worker:       WorkerIcon,
  evaluator:    EvaluatorIcon,
  researcher:   ResearcherIcon,
  coder:        CoderIcon,
  reviewer:     ReviewerIcon,
  custom:       CustomIcon,
}

// ── UI icons ─────────────────────────────────────────────────────────────────
export const PlayIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><polygon points="5 3 19 12 5 21 5 3"/></svg>
)

export const SaveIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
    <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>
  </svg>
)

export const TrashIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
  </svg>
)

export const CloseIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)

export const ChevronIcon: React.FC<{ size?: number; color?: string; dir?: 'down'|'up'|'right' }> = ({ size = 12, color = 'currentColor', dir = 'down' }) => {
  const rotate = dir === 'up' ? 180 : dir === 'right' ? -90 : 0
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" style={{ transform: `rotate(${rotate}deg)` }}>
      <polyline points="6 9 12 15 18 9"/>
    </svg>
  )
}
