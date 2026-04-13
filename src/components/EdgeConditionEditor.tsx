/**
 * EdgeConditionEditor
 * ===================
 * Shown as a floating panel when the user clicks a React Flow edge.
 * Lets the user attach / edit / remove an EdgeCondition expression.
 *
 * Expression receives `state` — the shared FlowState. Examples:
 *   state['score'] > 80
 *   state['reviewer:approved'] === true
 *   state['status'] === 'approved'
 *   state['retry_count'] < 3
 */

import React, { useState, useEffect } from 'react'
import type { EdgeCondition } from '../types'

const EXAMPLES = [
  { label: "score > 80",        expr: "state['score'] > 80",               desc: "route if score above threshold" },
  { label: "approved",          expr: "state['reviewer:approved'] === true", desc: "route if reviewer approved" },
  { label: "status = done",     expr: "state['status'] === 'completed'",    desc: "route when status is completed" },
  { label: "retry < 3",         expr: "state['retry_count'] < 3",           desc: "loop guard" },
  { label: "no error",          expr: "!state['error']",                    desc: "route only if no error" },
]

interface EdgeConditionEditorProps {
  edgeId: string
  condition: EdgeCondition | undefined
  sourceLabel: string
  targetLabel: string
  onSave: (edgeId: string, condition: EdgeCondition | null) => void
  onClose: () => void
}

export const EdgeConditionEditor: React.FC<EdgeConditionEditorProps> = ({
  edgeId, condition, sourceLabel, targetLabel, onSave, onClose,
}) => {
  const [expr,  setExpr]  = useState(condition?.expression ?? '')
  const [label, setLabel] = useState(condition?.label ?? '')
  const [desc,  setDesc]  = useState(condition?.description ?? '')
  const [error, setError] = useState('')

  // Validate expression syntax (won't catch runtime errors, but catches syntax)
  useEffect(() => {
    if (!expr.trim()) { setError(''); return }
    try {
      // eslint-disable-next-line no-new-func
      new Function('state', `"use strict"; return (${expr});`)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Syntax error')
    }
  }, [expr])

  const handleSave = () => {
    if (error) return
    if (!expr.trim()) {
      onSave(edgeId, null)   // remove condition
    } else {
      onSave(edgeId, { expression: expr.trim(), label: label.trim() || expr.trim(), description: desc.trim() })
    }
    onClose()
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.15)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 500, background: '#ffffff',
        border: '1px solid #1e2b3e', borderRadius: 14,
        boxShadow: '0 24px 80px rgba(0,0,0,0.25)',
        fontFamily: "var(--font)",
        overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid #1e2b3e',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#ffffff',
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>
              Edge Condition
            </div>
            <div style={{ fontSize: 10, color: '#71717a', marginTop: 2 }}>
              {sourceLabel} → {targetLabel}
            </div>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#71717a',
            cursor: 'pointer', fontSize: 18, padding: 4,
          }}>✕</button>
        </div>

        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>

          {/* Info box */}
          <div style={{
            background: '#f4f4f5', border: '1px solid #1e2b3e',
            borderRadius: 8, padding: '10px 12px', fontSize: 11, color: '#71717a', lineHeight: 1.6,
          }}>
            Write a JavaScript expression. The variable <code style={{ color: '#2563eb', background: '#f4f4f5', padding: '1px 4px', borderRadius: 3 }}>state</code> contains
            the shared FlowState dictionary. The edge is followed only if the expression is <strong style={{ color: '#18181b' }}>truthy</strong>.
            Leave blank for an unconditional edge.
          </div>

          {/* Expression input */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Condition Expression
            </div>
            <input
              autoFocus
              value={expr}
              onChange={e => setExpr(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose() }}
              placeholder="e.g. state['score'] > 80"
              style={{
                width: '100%', background: '#ffffff',
                border: `1px solid ${error ? '#f87171' : '#e4e4e7'}`,
                borderRadius: 7, color: '#18181b',
                fontSize: 12, padding: '9px 11px', outline: 'none',
                fontFamily: 'var(--mono)',
                boxSizing: 'border-box',
                transition: 'border-color 0.15s',
              }}
              onFocus={e => !error && (e.target.style.borderColor = '#2563eb')}
              onBlur={e => !error && (e.target.style.borderColor = '#e4e4e7')}
            />
            {error && (
              <div style={{ fontSize: 10, color: '#f87171', marginTop: 4, fontFamily: 'var(--mono)' }}>
                ✕ {error}
              </div>
            )}
            {!error && expr.trim() && (
              <div style={{ fontSize: 10, color: '#34d399', marginTop: 4 }}>
                ✓ Expression is valid
              </div>
            )}
          </div>

          {/* Display label */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Edge Label <span style={{ color: '#a1a1aa', fontWeight: 400 }}>(shown on canvas)</span>
            </div>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. score > 80  (defaults to expression)"
              style={{
                width: '100%', background: '#ffffff',
                border: '1px solid #1e2b3e', borderRadius: 7,
                color: '#18181b', fontSize: 12, padding: '8px 11px', outline: 'none',
                fontFamily: "var(--font)", boxSizing: 'border-box',
              }}
              onFocus={e => (e.target.style.borderColor = '#2563eb')}
              onBlur={e => (e.target.style.borderColor = '#e4e4e7')}
            />
          </div>

          {/* Quick examples */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
              Quick examples
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
              {EXAMPLES.map(ex => (
                <button key={ex.label} title={ex.desc}
                  onClick={() => { setExpr(ex.expr); setLabel(ex.label) }}
                  style={{
                    fontSize: 10, padding: '3px 9px', borderRadius: 5, cursor: 'pointer',
                    background: expr === ex.expr ? '#4f46e518' : '#f4f4f5',
                    border: `1px solid ${expr === ex.expr ? '#2563eb' : '#e4e4e7'}`,
                    color: expr === ex.expr ? '#2563eb' : '#52525b',
                    fontFamily: 'var(--mono)',
                    transition: 'all 0.12s',
                  }}
                >
                  {ex.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid #1e2b3e',
          display: 'flex', gap: 8, justifyContent: 'flex-end',
          background: '#ffffff',
        }}>
          {condition && (
            <button onClick={() => { onSave(edgeId, null); onClose() }} style={{
              padding: '7px 14px', borderRadius: 7,
              background: '#fef2f2', border: '1px solid #f8717140',
              color: '#f87171', fontSize: 11, cursor: 'pointer',
              fontFamily: "var(--font)", marginRight: 'auto',
            }}>
              Remove condition
            </button>
          )}
          <button onClick={onClose} style={{
            padding: '7px 14px', borderRadius: 7,
            background: '#f4f4f5', border: '1px solid #1e2b3e',
            color: '#52525b', fontSize: 11, cursor: 'pointer',
            fontFamily: "var(--font)",
          }}>
            Cancel
          </button>
          <button onClick={handleSave} disabled={!!error} style={{
            padding: '7px 18px', borderRadius: 7, border: 'none',
            background: error ? '#f4f4f5' : 'linear-gradient(135deg, #4f46e5, #6d28d9)',
            color: error ? '#71717a' : '#fff',
            fontSize: 11, fontWeight: 700, cursor: error ? 'not-allowed' : 'pointer',
            fontFamily: "var(--font)",
          }}>
            {expr.trim() ? 'Save condition' : 'Set unconditional'}
          </button>
        </div>
      </div>
    </div>
  )
}
