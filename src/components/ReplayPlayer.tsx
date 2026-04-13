/**
 * ReplayPlayer
 * ============
 * Replays a saved execution step-by-step on the canvas.
 *
 * Features:
 * - Step through each log entry with prev/next/play controls
 * - Speed control: 0.5×, 1×, 2×, 4×
 * - Highlights the current node on the canvas (via onHighlight callback)
 * - Shows current step's log detail (prompt, response, routing)
 * - Progress bar
 * - Load past executions from the backend
 */
import React, { useState, useEffect, useRef, useCallback } from 'react'
import type { ExecutionLog } from '../types'

interface SavedRun {
  id: string
  flow_name: string
  status: string
  step_count: number
  duration_ms: number | null
  created_at: string
}

interface ReplayPlayerProps {
  /** Live logs from the current execution (for immediate replay) */
  liveLogs: ExecutionLog[]
  /** Called with nodeId to highlight on the canvas, or null to clear */
  onHighlight: (nodeId: string | null) => void
  onClose: () => void
}

const STATUS_COLOR: Record<string, string> = {
  running: '#2563eb', success: '#34d399', error: '#f87171',
  skipped: '#f59e0b', pending: '#52525b',
}

const SPEEDS = [0.5, 1, 2, 4]

const mono: React.CSSProperties = { fontFamily: 'var(--mono)' }

export const ReplayPlayer: React.FC<ReplayPlayerProps> = ({ liveLogs, onHighlight, onClose }) => {
  const [mode, setMode]               = useState<'live' | 'saved'>('live')
  const [savedRuns, setSavedRuns]     = useState<SavedRun[]>([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [replayLogs, setReplayLogs]   = useState<ExecutionLog[]>(liveLogs)
  const [currentStep, setCurrentStep] = useState(0)
  const [playing, setPlaying]         = useState(false)
  const [speed, setSpeed]             = useState(1)
  const [selectedRun, setSelectedRun] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const logs = replayLogs
  const total = logs.length
  const current = logs[currentStep] ?? null

  // ── Highlight current node whenever step changes ──────────────────────────
  useEffect(() => {
    onHighlight(current?.nodeId ?? null)
  }, [current, onHighlight])

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    onHighlight(null)
  }, [onHighlight])

  // ── Auto-play ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current)
    if (!playing) return
    intervalRef.current = setInterval(() => {
      setCurrentStep(prev => {
        if (prev >= total - 1) { setPlaying(false); return prev }
        return prev + 1
      })
    }, 1000 / speed)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [playing, speed, total])

  // ── Load saved runs ───────────────────────────────────────────────────────
  const loadSavedRuns = useCallback(async () => {
    setLoadingRuns(true)
    try {
      const res = await fetch('http://localhost:8000/api/execution-runs/')
      const data = await res.json()
      setSavedRuns(data.items || [])
    } catch { setSavedRuns([]) }
    finally { setLoadingRuns(false) }
  }, [])

  useEffect(() => {
    if (mode === 'saved') loadSavedRuns()
  }, [mode, loadSavedRuns])

  const loadRun = useCallback(async (runId: string) => {
    try {
      const res  = await fetch(`http://localhost:8000/api/execution-runs/${runId}`)
      const data = await res.json()
      setReplayLogs(data.logs || [])
      setCurrentStep(0)
      setPlaying(false)
      setSelectedRun(runId)
    } catch { alert('Could not load run') }
  }, [])

  const prev = () => { setPlaying(false); setCurrentStep(s => Math.max(0, s - 1)) }
  const next = () => { setPlaying(false); setCurrentStep(s => Math.min(total - 1, s + 1)) }
  const jumpTo = (i: number) => { setPlaying(false); setCurrentStep(i) }
  const reset = () => { setPlaying(false); setCurrentStep(0) }

  const progressPct = total > 1 ? (currentStep / (total - 1)) * 100 : 0

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 700, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: '#ffffff', border: '1px solid #1e2b3e', borderRadius: 14,
        boxShadow: '0 24px 80px rgba(0,0,0,0.15)',
        fontFamily: "var(--font)", overflow: 'hidden',
      }}>

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid #1e2b3e',
          background: '#ffffff', display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 16 }}>▶</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>Execution Replay</div>
            <div style={{ fontSize: 10, color: '#71717a', marginTop: 1 }}>
              {total > 0 ? `Step ${currentStep + 1} of ${total}` : 'No steps recorded'}
              {current && <span style={{ color: STATUS_COLOR[current.status], marginLeft: 8 }}>● {current.status}</span>}
            </div>
          </div>

          {/* Mode tabs */}
          <div style={{ display: 'flex', gap: 1, background: '#f4f4f5', borderRadius: 7, padding: 2 }}>
            {(['live', 'saved'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} style={{
                padding: '4px 12px', borderRadius: 5, border: 'none',
                background: mode === m ? '#e4e4e7' : 'transparent',
                color: mode === m ? '#18181b' : '#71717a',
                fontSize: 11, cursor: 'pointer', fontFamily: "var(--font)",
                fontWeight: mode === m ? 700 : 400, textTransform: 'capitalize',
              }}>{m}</button>
            ))}
          </div>

          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#71717a', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

          {/* Left — step list */}
          <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid #1e2b3e', overflowY: 'auto' }}>
            {mode === 'saved' ? (
              <div style={{ padding: '8px' }}>
                <div style={{ fontSize: 9, color: '#71717a', padding: '4px 4px 8px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Saved Runs
                </div>
                {loadingRuns && <div style={{ padding: 12, fontSize: 10, color: '#71717a', textAlign: 'center' }}>Loading…</div>}
                {!loadingRuns && savedRuns.length === 0 && (
                  <div style={{ padding: 12, fontSize: 10, color: '#71717a', textAlign: 'center' }}>No saved runs yet</div>
                )}
                {savedRuns.map(run => (
                  <div key={run.id}
                    onClick={() => loadRun(run.id)}
                    style={{
                      padding: '8px 10px', borderRadius: 7, cursor: 'pointer', marginBottom: 4,
                      background: selectedRun === run.id ? '#e4e4e7' : '#f4f4f5',
                      border: `1px solid ${selectedRun === run.id ? '#2563eb' : '#e4e4e7'}`,
                    }}
                    onMouseEnter={e => { if (selectedRun !== run.id) (e.currentTarget as HTMLDivElement).style.background = '#f4f4f5' }}
                    onMouseLeave={e => { if (selectedRun !== run.id) (e.currentTarget as HTMLDivElement).style.background = '#f4f4f5' }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#18181b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {run.flow_name}
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 3 }}>
                      <span style={{ fontSize: 9, color: STATUS_COLOR[run.status] ?? '#52525b' }}>● {run.status}</span>
                      <span style={{ fontSize: 9, color: '#71717a' }}>{run.step_count} steps</span>
                    </div>
                    <div style={{ fontSize: 9, color: '#a1a1aa', marginTop: 2, ...mono }}>
                      {new Date(run.created_at).toLocaleDateString()}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {logs.map((log, i) => {
                  const color = STATUS_COLOR[log.status] ?? '#52525b'
                  const isActive = i === currentStep
                  return (
                    <div key={i} onClick={() => jumpTo(i)} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '5px 12px', cursor: 'pointer',
                      background: isActive ? '#eff6ff' : 'transparent',
                      borderLeft: `2px solid ${isActive ? color : 'transparent'}`,
                    }}
                      onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = '#f4f4f5' }}
                      onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
                    >
                      <span style={{ fontSize: 10, color, width: 12, flexShrink: 0 }}>
                        {log.status === 'success' ? '✓' : log.status === 'error' ? '✕' : log.status === 'skipped' ? '⚠' : '●'}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: isActive ? '#18181b' : '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {log.nodeName}
                        </div>
                        <div style={{ fontSize: 9, color: '#a1a1aa', ...mono }}>{log.durationMs ? `${log.durationMs}ms` : ''}</div>
                      </div>
                      <span style={{ fontSize: 9, color: '#a1a1aa', flexShrink: 0 }}>{i + 1}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Right — step detail */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px' }}>
            {!current ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
                <div style={{ fontSize: 32, opacity: 0.2 }}>▶</div>
                <div style={{ fontSize: 11, color: '#71717a', textAlign: 'center' }}>
                  {mode === 'saved' ? 'Select a saved run from the left panel' : 'No execution data — run the flow first'}
                </div>
              </div>
            ) : (
              <>
                {/* Node header */}
                <div style={{ marginBottom: 14, paddingBottom: 12, borderBottom: '1px solid #1e2b3e' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: '50%',
                      background: STATUS_COLOR[current.status] ?? '#52525b', flexShrink: 0,
                    }} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#18181b' }}>{current.nodeName}</span>
                    {current.iteration > 1 && (
                      <span style={{ fontSize: 10, color: '#f59e0b', background: '#f59e0b18', padding: '1px 6px', borderRadius: 4 }}>
                        ×{current.iteration}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 5 }}>
                    <span style={{ fontSize: 10, color: '#71717a' }}>{current.role}</span>
                    <span style={{ fontSize: 10, color: '#71717a', ...mono }}>{current.model}</span>
                    {current.durationMs && <span style={{ fontSize: 10, color: '#71717a', ...mono }}>{current.durationMs}ms</span>}
                  </div>
                </div>

                {/* Error */}
                {current.error && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, ...mono }}>Error</div>
                    <div style={{ background: '#fef2f2', border: '1px solid #f8717130', borderRadius: 6, padding: '8px 10px', fontSize: 10, color: '#f87171' }}>
                      {current.error}
                    </div>
                  </div>
                )}

                {/* LLM prompt */}
                {current.io?.llmPrompt && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, ...mono }}>↑ Prompt</div>
                    <pre style={{
                      background: '#ffffff', border: '1px solid #1a2535', borderRadius: 6,
                      padding: '8px 10px', fontSize: 9, color: '#71717a', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 120, overflowY: 'auto', margin: 0, ...mono,
                    }}>{current.io.llmPrompt}</pre>
                  </div>
                )}

                {/* LLM response */}
                {current.io?.llmResponse && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: '#34d399', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, ...mono }}>↓ Response</div>
                    <pre style={{
                      background: '#ffffff', border: '1px solid #1a2535', borderRadius: 6,
                      padding: '8px 10px', fontSize: 9, color: '#52525b', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 160, overflowY: 'auto', margin: 0, ...mono,
                    }}>{current.io.llmResponse}</pre>
                  </div>
                )}

                {/* Edge routing */}
                {current.routing && current.routing.length > 0 && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, ...mono }}>⇢ Routing</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {current.routing.map((r, i) => (
                        <div key={i} style={{
                          display: 'flex', alignItems: 'center', gap: 6,
                          padding: '4px 8px', borderRadius: 5,
                          background: r.result ? '#34d39910' : '#f8717110',
                          border: `1px solid ${r.result ? '#34d39930' : '#f8717130'}`,
                          fontSize: 9, ...mono,
                        }}>
                          <span style={{ color: r.result ? '#34d399' : '#f87171' }}>{r.result ? '✓' : '✕'}</span>
                          <span style={{ color: '#71717a', flex: 1 }}>{r.condition || 'unconditional'}</span>
                          <span style={{ color: r.result ? '#34d399' : '#f87171' }}>→ {r.target}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* State snapshot */}
                {current.stateSnapshot && Object.keys(current.stateSnapshot).length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4, ...mono }}>State Snapshot</div>
                    <pre style={{
                      background: '#ffffff', border: '1px solid #1a2535', borderRadius: 6,
                      padding: '8px 10px', fontSize: 9, color: '#52525b', lineHeight: 1.7,
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 100, overflowY: 'auto', margin: 0, ...mono,
                    }}>{JSON.stringify(
                      Object.fromEntries(
                        Object.entries(current.stateSnapshot)
                          .filter(([k]) => !k.startsWith('__') && !['flowStartTime','totalNodes','maxIterations'].includes(k))
                          .slice(0, 6)
                      ), null, 2
                    )}</pre>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* ── Progress bar ───────────────────────────────────────────────── */}
        <div style={{ height: 3, background: '#f4f4f5', flexShrink: 0 }}>
          <div style={{ height: '100%', background: '#2563eb', width: `${progressPct}%`, transition: 'width 0.15s' }} />
        </div>

        {/* ── Controls ───────────────────────────────────────────────────── */}
        <div style={{
          padding: '10px 18px', borderTop: '1px solid #1e2b3e',
          background: '#ffffff', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          {/* Playback buttons */}
          <button onClick={reset} disabled={total === 0} style={btnStyle}>⏮</button>
          <button onClick={prev}  disabled={currentStep === 0 || total === 0} style={btnStyle}>◀</button>
          <button
            onClick={() => setPlaying(p => !p)}
            disabled={total === 0 || currentStep >= total - 1}
            style={{ ...btnStyle, background: playing ? '#4f46e520' : '#2563eb', color: playing ? '#2563eb' : '#fff', width: 48 }}
          >
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={next}  disabled={currentStep >= total - 1 || total === 0} style={btnStyle}>▶</button>
          <button onClick={() => setCurrentStep(total - 1)} disabled={total === 0} style={btnStyle}>⏭</button>

          {/* Step counter */}
          <span style={{ fontSize: 10, color: '#71717a', ...mono, minWidth: 70 }}>
            {total > 0 ? `${currentStep + 1} / ${total}` : '0 / 0'}
          </span>

          {/* Speed */}
          <div style={{ display: 'flex', gap: 3, marginLeft: 'auto' }}>
            {SPEEDS.map(s => (
              <button key={s} onClick={() => setSpeed(s)} style={{
                padding: '3px 8px', borderRadius: 5, border: 'none',
                background: speed === s ? '#4f46e520' : '#f4f4f5',
                color: speed === s ? '#2563eb' : '#71717a',
                fontSize: 10, cursor: 'pointer', ...mono,
              }}>{s}×</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  width: 32, height: 32, borderRadius: 6, border: 'none',
  background: '#f4f4f5', color: '#52525b', fontSize: 12,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
