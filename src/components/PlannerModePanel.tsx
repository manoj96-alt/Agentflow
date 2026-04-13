/**
 * PlannerModePanel
 * ================
 * UI for planner-driven dynamic workflow execution.
 *
 * Shows:
 * - Goal input
 * - Live execution plan (steps with status)
 * - Agent message feed (real-time inter-agent communication)
 * - Evaluator verdict
 */
import React, { useState, useRef, useEffect } from 'react'
import type { ExecutionPlan, AgentMessage } from '../types'

interface PlannerModePanelProps {
  onRun: (goal: string) => Promise<void>
  isRunning: boolean
  plan: ExecutionPlan | null
  messages: AgentMessage[]
  onClose: () => void
}

const ROLE_COLOR: Record<string, string> = {
  planner: '#2563eb', worker: '#059669', evaluator: '#dc2626',
  orchestrator: '#7c3aed', researcher: '#0891b2', coder: '#16a34a', reviewer: '#d97706',
}

const MSG_TYPE_COLOR: Record<string, string> = {
  instruction: '#2563eb', result: '#16a34a', question: '#d97706', feedback: '#dc2626',
}

const EXAMPLES = [
  'Research the top 5 AI frameworks and recommend the best one',
  'Analyze competitor pricing and suggest our pricing strategy',
  'Review this codebase for security vulnerabilities and suggest fixes',
  'Summarize the latest news in quantum computing',
]

export const PlannerModePanel: React.FC<PlannerModePanelProps> = ({
  onRun, isRunning, plan, messages, onClose,
}) => {
  const [goal, setGoal]     = useState('')
  const [tab, setTab]       = useState<'plan' | 'messages'>('plan')
  const msgEndRef           = useRef<HTMLDivElement>(null)

  // Auto-scroll messages
  useEffect(() => {
    msgEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Switch to messages tab when they start arriving
  useEffect(() => {
    if (messages.length > 0 && tab === 'plan') setTab('messages')
  }, [messages.length])

  const handleRun = async () => {
    if (!goal.trim() || isRunning) return
    await onRun(goal.trim())
  }

  const F: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 8,
    color: 'var(--text)', fontFamily: 'var(--font)', outline: 'none',
    background: 'var(--bg)',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 680, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
        fontFamily: 'var(--font)', overflow: 'hidden',
      }}>

        {/* ── Header ────────────────────────────────────────────────────── */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 34, height: 34, borderRadius: 9, flexShrink: 0,
            background: '#eff6ff', border: '1px solid #bfdbfe',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>🧭</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Planner Mode</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>
              The Planner agent dynamically decides which workers to call and in what order
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* ── Goal input ────────────────────────────────────────────────── */}
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-2)', marginBottom: 6 }}>Goal for the Planner</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={goal} onChange={e => setGoal(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRun()}
              placeholder="e.g. Research AI frameworks and recommend the best one for our project"
              style={{ ...F, flex: 1, padding: '8px 12px', fontSize: 12 }}
              onFocus={e => (e.target.style.borderColor = '#2563eb')}
              onBlur={e => (e.target.style.borderColor = 'var(--border)')}
            />
            <button onClick={handleRun} disabled={!goal.trim() || isRunning} style={{
              padding: '8px 18px', borderRadius: 8, border: 'none',
              background: !goal.trim() || isRunning ? '#f4f4f5' : '#2563eb',
              color: !goal.trim() || isRunning ? '#a1a1aa' : '#fff',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              fontFamily: 'var(--font)', minWidth: 90,
              display: 'flex', alignItems: 'center', gap: 5,
              boxShadow: !goal.trim() || isRunning ? 'none' : '0 2px 8px rgba(37,99,235,0.25)',
            }}>
              {isRunning
                ? <><svg style={{ animation: 'spin 0.8s linear infinite' }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeDasharray="32 10"/></svg> Running</>
                : <>🧭 Plan & Run</>
              }
            </button>
          </div>

          {/* Example goals */}
          <div style={{ display: 'flex', gap: 5, marginTop: 8, flexWrap: 'wrap' }}>
            {EXAMPLES.map(ex => (
              <button key={ex} onClick={() => setGoal(ex)} style={{
                padding: '2px 8px', borderRadius: 20, border: '1px solid var(--border)',
                background: goal === ex ? '#eff6ff' : 'var(--bg)',
                color: goal === ex ? '#2563eb' : 'var(--text-3)',
                fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)', transition: 'all 0.12s',
              }}>{ex.slice(0, 40)}…</button>
            ))}
          </div>
        </div>

        {/* ── Tabs ──────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[
            { id: 'plan',     label: `📋 Execution Plan${plan ? ` (${plan.steps.length} steps)` : ''}` },
            { id: 'messages', label: `💬 Agent Messages${messages.length > 0 ? ` (${messages.length})` : ''}` },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)} style={{
              padding: '7px 16px', border: 'none', cursor: 'pointer', background: 'none',
              fontFamily: 'var(--font)', fontSize: 11,
              color: tab === t.id ? '#2563eb' : 'var(--text-3)',
              borderBottom: `2px solid ${tab === t.id ? '#2563eb' : 'transparent'}`,
              fontWeight: tab === t.id ? 600 : 400,
            }}>{t.label}</button>
          ))}
        </div>

        {/* ── Body ──────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>

          {/* Plan tab */}
          {tab === 'plan' && (
            <div>
              {!plan && !isRunning && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-3)', fontSize: 11 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>🧭</div>
                  Enter a goal and click Plan & Run — the Planner agent will design<br/>
                  and execute a custom workflow for your goal
                </div>
              )}
              {isRunning && !plan && (
                <div style={{ textAlign: 'center', padding: '24px 0', color: '#2563eb', fontSize: 11 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>⟳</div>
                  Planner agent is designing the execution plan…
                </div>
              )}
              {plan && (
                <div>
                  <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 8, background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#2563eb', marginBottom: 2 }}>
                      🧭 Plan: {plan.goal}
                    </div>
                    <div style={{ fontSize: 10, color: '#3b82f6' }}>
                      {plan.steps.length} steps generated by Planner · {new Date(plan.timestamp).toLocaleTimeString()}
                    </div>
                  </div>

                  {/* Step list */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {plan.steps.map((step, i) => {
                      const roleColor = ROLE_COLOR[step.role] ?? '#64748b'
                      return (
                        <div key={step.nodeId} style={{
                          padding: '10px 12px', borderRadius: 8,
                          border: '1px solid var(--border)', background: '#fff',
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                        }}>
                          {/* Step number */}
                          <div style={{
                            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                            background: roleColor + '18', border: `1px solid ${roleColor}30`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 10, fontWeight: 700, color: roleColor,
                          }}>{i + 1}</div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{step.agentName || step.nodeId}</span>
                              <span style={{
                                fontSize: 9, padding: '1px 5px', borderRadius: 3,
                                background: roleColor + '12', color: roleColor,
                                border: `1px solid ${roleColor}25`, fontWeight: 600,
                              }}>{step.role}</span>
                              {step.dependsOn.length > 0 && (
                                <span style={{ fontSize: 9, color: 'var(--text-3)' }}>
                                  after: {step.dependsOn.join(', ')}
                                </span>
                              )}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--text-2)', lineHeight: 1.5 }}>{step.instruction}</div>
                            {step.condition && (
                              <div style={{ fontSize: 9, color: '#d97706', marginTop: 4, fontFamily: 'var(--mono)' }}>
                                if: {step.condition}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Messages tab */}
          {tab === 'messages' && (
            <div>
              {messages.length === 0 && (
                <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-3)', fontSize: 11 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>💬</div>
                  Agent messages will appear here during execution
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {messages.map((msg, i) => {
                  const typeColor = MSG_TYPE_COLOR[msg.type] ?? '#64748b'
                  const isInstruction = msg.type === 'instruction'
                  const isFeedback = msg.type === 'feedback'
                  return (
                    <div key={i} style={{
                      padding: '8px 12px', borderRadius: 8,
                      border: `1px solid ${typeColor}25`,
                      background: isFeedback ? '#fef2f2' : isInstruction ? '#eff6ff' : '#fff',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{
                          fontSize: 9, padding: '1px 6px', borderRadius: 3,
                          background: typeColor + '18', color: typeColor,
                          border: `1px solid ${typeColor}25`, fontWeight: 700,
                          textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>{msg.type}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-3)' }}>
                          {msg.from} → {msg.to === 'broadcast' ? '🌐 all' : msg.to}
                        </span>
                        <span style={{ fontSize: 9, color: 'var(--text-3)', marginLeft: 'auto', fontFamily: 'var(--mono)' }}>
                          {new Date(msg.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text)', lineHeight: 1.55 }}>
                        {msg.content}
                      </div>
                    </div>
                  )
                })}
                <div ref={msgEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ────────────────────────────────────────────────────── */}
        <div style={{
          padding: '10px 18px', borderTop: '1px solid var(--border)',
          background: '#fafafa', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {isRunning
              ? '⟳ Planner mode executing…'
              : plan
                ? `✓ Plan executed — ${plan.steps.length} steps · ${messages.length} messages`
                : 'Planner mode: dynamic execution driven by AI planning'
            }
          </div>
          <button onClick={onClose} style={{
            padding: '6px 14px', borderRadius: 7, border: '1px solid var(--border)',
            background: '#fff', color: 'var(--text-2)', fontSize: 11, cursor: 'pointer',
            fontFamily: 'var(--font)',
          }}>Close</button>
        </div>
      </div>
    </div>
  )
}
