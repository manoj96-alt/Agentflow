/**
 * MarketplacePanel
 * ================
 * Browse saved workflows, import community templates, export as JSON.
 * Two tabs: My Workflows (from backend) | Templates (built-in + community)
 */
import React, { useEffect, useState } from 'react'
import { TEMPLATES } from '../utils/templates'

interface SavedWorkflow {
  id: string
  name: string
  description: string
  node_count: number
  edge_count: number
  tags: string[]
  updated_at: string
}

interface MarketplacePanelProps {
  onLoad: (id: string) => void
  onLoadTemplate: (key: string) => void
  onImportJSON: (json: string) => void
  onClose: () => void
}

const CATEGORY_COLORS: Record<string, string> = {
  Documents: '#7c3aed', Reasoning: '#0891b2', Data: '#059669',
  Business: '#d97706', Engineering: '#2563eb', Research: '#dc2626',
}

export const MarketplacePanel: React.FC<MarketplacePanelProps> = ({
  onLoad, onLoadTemplate, onImportJSON, onClose,
}) => {
  const [tab, setTab]           = useState<'mine' | 'templates'>('templates')
  const [saved, setSaved]       = useState<SavedWorkflow[]>([])
  const [loading, setLoading]   = useState(false)
  const [search, setSearch]     = useState('')
  const [importing, setImporting] = useState(false)
  const [importText, setImportText] = useState('')

  useEffect(() => {
    if (tab === 'mine') {
      setLoading(true)
      fetch('http://localhost:8000/api/workflows/')
        .then(r => r.json())
        .then(d => { setSaved(d.items || []); setLoading(false) })
        .catch(() => setLoading(false))
    }
  }, [tab])

  const filteredSaved = saved.filter(w => !search || w.name.toLowerCase().includes(search.toLowerCase()))
  const filteredTemplates = Object.entries(TEMPLATES).filter(([, t]) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase())
  )

  const handleExport = (workflow: SavedWorkflow) => {
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${workflow.name.replace(/\s+/g, '_')}.json`
    a.click(); URL.revokeObjectURL(url)
  }

  const F: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px',
    fontSize: 11, fontFamily: 'var(--font)', outline: 'none',
    background: 'var(--bg)', color: 'var(--text)',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 3000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 760, maxHeight: '88vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)', fontFamily: 'var(--font)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>🛒 Workflow Marketplace</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 1 }}>Browse templates, load saved workflows, import/export JSON</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Search + tabs */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows…" style={{ ...F, flex: 1 }}
            onFocus={e => (e.target.style.borderColor = '#2563eb')}
            onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
          <button onClick={() => setImporting(v => !v)} style={{
            padding: '6px 12px', borderRadius: 7, border: '1px solid var(--border)',
            background: importing ? '#eff6ff' : 'var(--bg)', color: importing ? '#2563eb' : 'var(--text-2)',
            fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>⬆ Import JSON</button>
        </div>

        {/* Import form */}
        {importing && (
          <div style={{ padding: '10px 18px', borderBottom: '1px solid var(--border)', background: '#eff6ff' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#1d4ed8', marginBottom: 6 }}>Paste workflow JSON</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <textarea value={importText} onChange={e => setImportText(e.target.value)}
                rows={3} placeholder='{"name":"...","nodes":[...],"edges":[...]}'
                style={{ ...F, flex: 1, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 10 }} />
              <button onClick={() => { if (importText.trim()) { onImportJSON(importText); setImporting(false); setImportText('') } }} style={{
                padding: '6px 14px', borderRadius: 7, border: 'none', background: '#2563eb', color: '#fff',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)', alignSelf: 'flex-start',
              }}>Import</button>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {[
            { id: 'templates', label: `⊞ Templates (${filteredTemplates.length})` },
            { id: 'mine',      label: `💾 My Workflows (${saved.length})` },
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

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>

          {/* Templates grid */}
          {tab === 'templates' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {filteredTemplates.map(([key, tmpl]) => {
                const catColor = CATEGORY_COLORS[tmpl.category] ?? '#2563eb'
                return (
                  <div key={key} style={{
                    padding: '12px', borderRadius: 10, border: '1px solid var(--border)',
                    cursor: 'pointer', transition: 'all 0.12s',
                  }}
                    onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = catColor + '60'; el.style.background = catColor + '05' }}
                    onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = 'var(--border)'; el.style.background = '#fff' }}
                    onClick={() => { onLoadTemplate(key); onClose() }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <span style={{ fontSize: 20 }}>{tmpl.icon}</span>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{tmpl.name}</div>
                        <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, background: catColor + '15', color: catColor, border: `1px solid ${catColor}25`, fontWeight: 600 }}>{tmpl.category}</span>
                      </div>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 8 }}>{tmpl.description}</div>
                    <div style={{ fontSize: 9, color: 'var(--text-3)' }}>{tmpl.nodes.length} agents · {tmpl.edges.length} connections</div>
                  </div>
                )
              })}
            </div>
          )}

          {/* My workflows */}
          {tab === 'mine' && (
            <div>
              {loading && <div style={{ textAlign: 'center', padding: 24, color: 'var(--text-3)', fontSize: 11 }}>Loading…</div>}
              {!loading && filteredSaved.length === 0 && (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--text-3)', fontSize: 11 }}>
                  <div style={{ fontSize: 32, marginBottom: 8 }}>💾</div>
                  No saved workflows yet. Click Save in the sidebar to save your first workflow.
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {filteredSaved.map(w => (
                  <div key={w.id} style={{
                    padding: '12px', borderRadius: 10, border: '1px solid var(--border)',
                    background: '#fff', transition: 'all 0.12s',
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 4 }}>{w.name}</div>
                    {w.description && <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 8 }}>{w.description}</div>}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                      {w.tags?.map(tag => (
                        <span key={tag} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>{tag}</span>
                      ))}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                        {w.node_count} nodes · {new Date(w.updated_at).toLocaleDateString()}
                      </span>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button onClick={() => handleExport(w)} style={{
                          padding: '3px 8px', borderRadius: 5, border: '1px solid var(--border)',
                          background: 'var(--bg)', color: 'var(--text-2)', fontSize: 10, cursor: 'pointer', fontFamily: 'var(--font)',
                        }}>⬇ Export</button>
                        <button onClick={() => { onLoad(w.id); onClose() }} style={{
                          padding: '3px 10px', borderRadius: 5, border: 'none',
                          background: '#2563eb', color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
                        }}>Load</button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
