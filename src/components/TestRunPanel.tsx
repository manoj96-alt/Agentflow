/**
 * TestRunPanel
 * ============
 * Lets the user:
 * 1. Define test input (seed values injected into shared state)
 * 2. Define expected outputs (assertions on the final state)
 * 3. Run the workflow in test mode (no logs saved)
 * 4. See a pass/fail report: expected vs actual per assertion
 *
 * Test inputs are injected as initial FlowState keys before execution.
 * Assertions are evaluated against the final state after all nodes complete.
 */

import React, { useState, useCallback } from 'react'
import type { TestAssertion, TestRunResult } from '../types'

interface KVPair {
  id: string
  key: string
  value: string
}

interface AssertionRow {
  id: string
  key: string
  operator: TestAssertion['operator']
  expected: string
  description: string
}

interface TestRunPanelProps {
  onRun: (inputs: Record<string, unknown>, assertions: TestAssertion[]) => Promise<void>
  testResult: TestRunResult | null
  isRunning: boolean
  onClose: () => void
}

const OPERATORS: TestAssertion['operator'][] = ['==', '!=', '>', '<', '>=', '<=', 'contains', 'exists']

const uid = () => Math.random().toString(36).slice(2, 8)

const mono: React.CSSProperties = { fontFamily: 'var(--mono)' }
const F: React.CSSProperties = {
  background: '#ffffff', border: '1px solid #1a2535',
  borderRadius: 6, color: '#18181b', fontSize: 11,
  padding: '5px 8px', outline: 'none',
  fontFamily: "var(--font)",
}

const EXAMPLE_INPUTS = [
  { key: 'input:topic',    value: 'Latest AI research papers 2025' },
  { key: 'input:format',  value: 'bullet points' },
  { key: 'input:max_items', value: '5' },
]

const EXAMPLE_ASSERTIONS: AssertionRow[] = [
  { id: uid(), key: 'reviewer:approved', operator: '==',       expected: 'true',  description: 'Reviewer approves output' },
  { id: uid(), key: 'score',             operator: '>=',       expected: '70',    description: 'Quality score ≥ 70' },
  { id: uid(), key: 'status',            operator: '==',       expected: 'approved', description: 'Status is approved' },
]

function parseValue(raw: string): unknown {
  if (raw === 'true')  return true
  if (raw === 'false') return false
  if (raw === 'null')  return null
  const n = Number(raw)
  if (!isNaN(n) && raw.trim() !== '') return n
  return raw
}

export const TestRunPanel: React.FC<TestRunPanelProps> = ({ onRun, testResult, isRunning, onClose }) => {
  const [inputs, setInputs]           = useState<KVPair[]>([{ id: uid(), key: '', value: '' }])
  const [assertions, setAssertions]   = useState<AssertionRow[]>([
    { id: uid(), key: '', operator: '==', expected: '', description: '' },
  ])
  const [activeTab, setActiveTab]     = useState<'inputs' | 'assertions' | 'results'>('inputs')
  const [jsonMode, setJsonMode]       = useState(false)
  const [jsonInput, setJsonInput]     = useState('{\n  \n}')
  const [jsonError, setJsonError]     = useState('')

  // ── Input helpers ──────────────────────────────────────────────────────────
  const addInput    = () => setInputs(p => [...p, { id: uid(), key: '', value: '' }])
  const removeInput = (id: string) => setInputs(p => p.filter(r => r.id !== id))
  const updateInput = (id: string, field: 'key' | 'value', val: string) =>
    setInputs(p => p.map(r => r.id === id ? { ...r, [field]: val } : r))

  const loadExamples = () => {
    setInputs(EXAMPLE_INPUTS.map(e => ({ id: uid(), key: e.key, value: e.value })))
    setAssertions(EXAMPLE_ASSERTIONS.map(a => ({ ...a, id: uid() })))
  }

  // ── Assertion helpers ──────────────────────────────────────────────────────
  const addAssertion    = () => setAssertions(p => [...p, { id: uid(), key: '', operator: '==', expected: '', description: '' }])
  const removeAssertion = (id: string) => setAssertions(p => p.filter(r => r.id !== id))
  const updateAssertion = (id: string, field: keyof AssertionRow, val: string) =>
    setAssertions(p => p.map(r => r.id === id ? { ...r, [field]: val } : r))

  // ── Run ───────────────────────────────────────────────────────────────────
  const handleRun = useCallback(async () => {
    let parsedInputs: Record<string, unknown> = {}
    if (jsonMode) {
      try { parsedInputs = JSON.parse(jsonInput); setJsonError('') }
      catch (e) { setJsonError(`Invalid JSON: ${e}`); return }
    } else {
      for (const row of inputs) {
        if (row.key.trim()) parsedInputs[row.key.trim()] = parseValue(row.value)
      }
    }
    const parsedAssertions: TestAssertion[] = assertions
      .filter(a => a.key.trim())
      .map(a => ({
        key: a.key.trim(),
        operator: a.operator,
        expected: parseValue(a.expected),
        description: a.description,
      }))
    await onRun(parsedInputs, parsedAssertions)
    setActiveTab('results')
  }, [jsonMode, jsonInput, inputs, assertions, onRun])

  // ── Results summary ────────────────────────────────────────────────────────
  const hasResults = testResult !== null && testResult.testMode

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 680, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: '#ffffff', border: '1px solid #1e2b3e', borderRadius: 14,
        boxShadow: '0 24px 80px rgba(0,0,0,0.15)',
        fontFamily: "var(--font)", overflow: 'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding: '13px 18px', borderBottom: '1px solid #1e2b3e',
          background: '#ffffff', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 16 }}>🧪</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>Test Run</div>
            <div style={{ fontSize: 10, color: '#71717a', marginTop: 1 }}>
              Inject test data → run workflow → compare expected vs actual outputs
            </div>
          </div>
          <button onClick={loadExamples} style={{
            padding: '4px 10px', borderRadius: 6, border: '1px solid #1e2b3e',
            background: '#f4f4f5', color: '#52525b', fontSize: 10, cursor: 'pointer',
            fontFamily: "var(--font)",
          }}>Load examples</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #1e2b3e', background: '#ffffff' }}>
          {[
            { id: 'inputs',     label: '① Test Inputs' },
            { id: 'assertions', label: '② Assertions' },
            { id: 'results',    label: `③ Results${hasResults ? ` (${(testResult as TestRunResult).passCount}✓ ${(testResult as TestRunResult).failCount}✕)` : ''}` },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} style={{
              padding: '8px 16px', border: 'none', cursor: 'pointer', background: 'none',
              fontFamily: "var(--font)", fontSize: 11,
              color: activeTab === tab.id ? '#2563eb' : '#71717a',
              borderBottom: `2px solid ${activeTab === tab.id ? '#2563eb' : 'transparent'}`,
              fontWeight: activeTab === tab.id ? 700 : 400,
            }}>{tab.label}</button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 18px' }}>

          {/* ── Inputs tab ────────────────────────────────────────────────── */}
          {activeTab === 'inputs' && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, color: '#71717a', lineHeight: 1.6 }}>
                  These key-value pairs are injected into the shared state before execution starts.<br/>
                  Agents read them via <code style={{ ...mono, color: '#2563eb', background: '#f4f4f5', padding: '1px 4px', borderRadius: 3 }}>state['your-key']</code>
                </div>
                <button onClick={() => setJsonMode(v => !v)} style={{
                  padding: '3px 10px', borderRadius: 5, border: '1px solid #1e2b3e',
                  background: jsonMode ? '#4f46e518' : '#f4f4f5',
                  color: jsonMode ? '#2563eb' : '#52525b',
                  fontSize: 10, cursor: 'pointer', ...mono, flexShrink: 0, marginLeft: 12,
                }}>
                  {jsonMode ? 'Form' : 'JSON'}
                </button>
              </div>

              {jsonMode ? (
                <div>
                  <textarea
                    value={jsonInput}
                    onChange={e => { setJsonInput(e.target.value); setJsonError('') }}
                    rows={10}
                    style={{ ...F, width: '100%', resize: 'vertical', lineHeight: 1.7, ...mono, boxSizing: 'border-box' }}
                    placeholder={'{\n  "input:topic": "AI trends",\n  "input:format": "bullet points"\n}'}
                  />
                  {jsonError && <div style={{ fontSize: 10, color: '#f87171', marginTop: 4, ...mono }}>{jsonError}</div>}
                </div>
              ) : (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, marginBottom: 6, padding: '0 2px' }}>
                    <span style={{ fontSize: 9, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Key</span>
                    <span style={{ fontSize: 9, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Value</span>
                    <span />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {inputs.map(row => (
                      <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6 }}>
                        <input value={row.key} onChange={e => updateInput(row.id, 'key', e.target.value)}
                          placeholder="e.g. input:topic" style={{ ...F, ...mono }}
                          onFocus={e => (e.target.style.borderColor = '#2563eb')}
                          onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
                        <input value={row.value} onChange={e => updateInput(row.id, 'value', e.target.value)}
                          placeholder="string / number / true / false" style={F}
                          onFocus={e => (e.target.style.borderColor = '#2563eb')}
                          onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
                        <button onClick={() => removeInput(row.id)} style={{
                          width: 28, height: 28, borderRadius: 6, border: '1px solid #1e2b3e',
                          background: '#f4f4f5', color: '#f87171', cursor: 'pointer', fontSize: 14,
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={addInput} style={{
                    marginTop: 8, padding: '5px 12px', borderRadius: 6,
                    border: '1px dashed #1e2b3e', background: 'transparent',
                    color: '#71717a', fontSize: 11, cursor: 'pointer',
                    fontFamily: "var(--font)",
                  }}>+ Add input</button>
                </div>
              )}
            </div>
          )}

          {/* ── Assertions tab ────────────────────────────────────────────── */}
          {activeTab === 'assertions' && (
            <div>
              <div style={{ fontSize: 11, color: '#71717a', lineHeight: 1.6, marginBottom: 12 }}>
                Define what the final state should contain after execution.
                Each assertion checks a specific state key against an expected value.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 1fr auto', gap: 5, marginBottom: 6, padding: '0 2px' }}>
                {['State Key', 'Op', 'Expected', 'Description', ''].map(h => (
                  <span key={h} style={{ fontSize: 9, color: '#71717a', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
                ))}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {assertions.map(row => (
                  <div key={row.id} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr 1fr auto', gap: 5 }}>
                    <input value={row.key} onChange={e => updateAssertion(row.id, 'key', e.target.value)}
                      placeholder="e.g. score" style={{ ...F, ...mono }}
                      onFocus={e => (e.target.style.borderColor = '#2563eb')}
                      onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
                    <select value={row.operator} onChange={e => updateAssertion(row.id, 'operator', e.target.value)}
                      style={{ ...F, cursor: 'pointer', ...mono }}>
                      {OPERATORS.map(op => <option key={op} value={op}>{op}</option>)}
                    </select>
                    <input value={row.expected} onChange={e => updateAssertion(row.id, 'expected', e.target.value)}
                      placeholder="value" style={F}
                      onFocus={e => (e.target.style.borderColor = '#2563eb')}
                      onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
                    <input value={row.description} onChange={e => updateAssertion(row.id, 'description', e.target.value)}
                      placeholder="optional label" style={F}
                      onFocus={e => (e.target.style.borderColor = '#2563eb')}
                      onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
                    <button onClick={() => removeAssertion(row.id)} style={{
                      width: 28, height: 28, borderRadius: 6, border: '1px solid #1e2b3e',
                      background: '#f4f4f5', color: '#f87171', cursor: 'pointer', fontSize: 14,
                    }}>✕</button>
                  </div>
                ))}
              </div>
              <button onClick={addAssertion} style={{
                marginTop: 8, padding: '5px 12px', borderRadius: 6,
                border: '1px dashed #1e2b3e', background: 'transparent',
                color: '#71717a', fontSize: 11, cursor: 'pointer',
                fontFamily: "var(--font)",
              }}>+ Add assertion</button>
            </div>
          )}

          {/* ── Results tab ───────────────────────────────────────────────── */}
          {activeTab === 'results' && (
            <div>
              {!hasResults ? (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#71717a', fontSize: 11 }}>
                  Run the test to see results here
                </div>
              ) : (
                <>
                  {/* Summary bar */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
                    borderRadius: 8, marginBottom: 16,
                    background: (testResult as TestRunResult).failCount === 0 ? '#34d39910' : '#f8717110',
                    border: `1px solid ${(testResult as TestRunResult).failCount === 0 ? '#34d39940' : '#f8717140'}`,
                  }}>
                    <span style={{ fontSize: 20 }}>
                      {(testResult as TestRunResult).failCount === 0 ? '✅' : '❌'}
                    </span>
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#18181b' }}>
                        {(testResult as TestRunResult).failCount === 0 ? 'All assertions passed' : `${(testResult as TestRunResult).failCount} assertion(s) failed`}
                      </div>
                      <div style={{ fontSize: 10, color: '#71717a', marginTop: 2 }}>
                        {(testResult as TestRunResult).passCount} passed · {(testResult as TestRunResult).failCount} failed · {testResult.totalSteps} steps · {testResult.durationMs}ms
                      </div>
                    </div>
                  </div>

                  {/* Assertion results */}
                  {(testResult as TestRunResult).testResults.length > 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                        Assertion Results
                      </div>
                      {(testResult as TestRunResult).testResults.map((tr, i) => (
                        <div key={i} style={{
                          padding: '10px 12px', borderRadius: 8,
                          background: tr.passed ? '#34d39908' : '#f8717108',
                          border: `1px solid ${tr.passed ? '#34d39930' : '#f8717130'}`,
                        }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 14, flexShrink: 0 }}>{tr.passed ? '✓' : '✕'}</span>
                            <div style={{ flex: 1 }}>
                              <div style={{ fontSize: 11, color: tr.passed ? '#34d399' : '#f87171', fontWeight: 600 }}>
                                {tr.assertion.description || `${tr.assertion.key} ${tr.assertion.operator} ${JSON.stringify(tr.assertion.expected)}`}
                              </div>
                              <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                                <span style={{ fontSize: 10, color: '#71717a' }}>
                                  Expected: <code style={{ ...mono, color: '#2563eb' }}>{JSON.stringify(tr.assertion.expected)}</code>
                                </span>
                                <span style={{ fontSize: 10, color: '#71717a' }}>
                                  Actual: <code style={{ ...mono, color: tr.passed ? '#34d399' : '#f87171' }}>{JSON.stringify(tr.actual)}</code>
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Final state */}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#3d5a7a', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                      Final State
                    </div>
                    <pre style={{
                      background: '#ffffff', border: '1px solid #1a2535', borderRadius: 7,
                      padding: '10px 12px', fontSize: 9, color: '#71717a', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 200, overflowY: 'auto', margin: 0, ...mono,
                    }}>
                      {JSON.stringify(
                        Object.fromEntries(
                          Object.entries(testResult.finalState)
                            .filter(([k]) => !k.startsWith('__') && !['flowStartTime','totalNodes','maxIterations','flowEndTime','totalSteps'].includes(k))
                        ), null, 2
                      )}
                    </pre>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid #1e2b3e',
          background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ fontSize: 10, color: '#71717a' }}>
            Test runs are not saved to the database
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '7px 14px', borderRadius: 7, border: '1px solid #1e2b3e',
              background: '#f4f4f5', color: '#52525b', fontSize: 11,
              cursor: 'pointer', fontFamily: "var(--font)",
            }}>Close</button>
            <button onClick={handleRun} disabled={isRunning} style={{
              padding: '7px 20px', borderRadius: 7, border: 'none',
              background: isRunning ? '#f4f4f5' : 'linear-gradient(135deg, #059669, #047857)',
              color: isRunning ? '#71717a' : '#fff',
              fontSize: 11, fontWeight: 700, cursor: isRunning ? 'not-allowed' : 'pointer',
              fontFamily: "var(--font)",
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              {isRunning ? '⟳ Running…' : '🧪 Run Test'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
