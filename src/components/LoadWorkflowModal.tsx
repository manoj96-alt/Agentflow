import React, { useEffect, useState } from 'react'

interface WorkflowSummary {
  id: string
  name: string
  description: string
  node_count: number
  edge_count: number
  tags: string[]
  updated_at: string
}

interface LoadWorkflowModalProps {
  onLoad: (id: string) => void
  onClose: () => void
}

export const LoadWorkflowModal: React.FC<LoadWorkflowModalProps> = ({ onLoad, onClose }) => {
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [search, setSearch]       = useState('')

  useEffect(() => {
    fetch('http://localhost:8000/api/workflows/')
      .then(r => r.json())
      .then(data => { setWorkflows(data.items || []); setLoading(false) })
      .catch(() => { setError('Could not connect to backend'); setLoading(false) })
  }, [])

  const filtered = workflows.filter(w => w.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{
        width: 520, maxHeight: '70vh', background: '#fff',
        border: '1px solid #e4e4e7', borderRadius: 14,
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
        fontFamily: 'var(--font)',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 18px', borderBottom: '1px solid #f4f4f5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#18181b' }}>Load Workflow</div>
            <div style={{ fontSize: 10, color: '#a1a1aa', marginTop: 2 }}>{workflows.length} saved workflow{workflows.length !== 1 ? 's' : ''}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#a1a1aa', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* Search */}
        <div style={{ padding: '10px 18px', borderBottom: '1px solid #f4f4f5' }}>
          <input autoFocus value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search workflows…"
            style={{
              width: '100%', background: '#fafafa', border: '1px solid #e4e4e7',
              borderRadius: 7, color: '#18181b', fontSize: 12, padding: '7px 10px',
              outline: 'none', fontFamily: 'var(--font)', boxSizing: 'border-box',
            }}
            onFocus={e => (e.target.style.borderColor = '#2563eb')}
            onBlur={e => (e.target.style.borderColor = '#e4e4e7')} />
        </div>

        {/* List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {loading && <div style={{ padding: 20, textAlign: 'center', color: '#a1a1aa', fontSize: 11 }}>Loading…</div>}
          {error && <div style={{ padding: 20, textAlign: 'center', color: '#dc2626', fontSize: 11 }}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div style={{ padding: 20, textAlign: 'center', color: '#a1a1aa', fontSize: 11 }}>No workflows found</div>
          )}
          {filtered.map(w => (
            <div key={w.id} onClick={() => onLoad(w.id)} style={{
              padding: '10px 12px', borderRadius: 8, border: '1px solid #f4f4f5',
              marginBottom: 5, cursor: 'pointer', background: '#fff', transition: 'all 0.12s',
            }}
              onMouseEnter={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = '#bfdbfe'; el.style.background = '#eff6ff' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLDivElement; el.style.borderColor = '#f4f4f5'; el.style.background = '#fff' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#18181b' }}>{w.name}</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 10, color: '#a1a1aa' }}>{w.node_count} nodes</span>
                  <span style={{ fontSize: 10, color: '#a1a1aa' }}>{w.edge_count} edges</span>
                </div>
              </div>
              {w.description && <div style={{ fontSize: 11, color: '#71717a', marginTop: 3 }}>{w.description}</div>}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  {w.tags?.map(tag => (
                    <span key={tag} style={{
                      fontSize: 9, padding: '1px 6px', borderRadius: 3,
                      background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe',
                    }}>{tag}</span>
                  ))}
                </div>
                <span style={{ fontSize: 9, color: '#a1a1aa', fontFamily: 'var(--mono)' }}>
                  {new Date(w.updated_at).toLocaleDateString()}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 18px', borderTop: '1px solid #f4f4f5', fontSize: 10, color: '#a1a1aa', textAlign: 'center' }}>
          Click a workflow to load it onto the canvas
        </div>
      </div>
    </div>
  )
}
