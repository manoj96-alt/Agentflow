import React, { useEffect, useState, useCallback } from 'react'

interface ToolEntry {
  name: string
  description: string
  input_schema: Record<string, any>
  category: string
  example_args: Record<string, any>
}

interface ToolRegistryProps {
  nodeId: string
  agentName: string
  attachedTools: string[]
  onAttach: (nodeId: string, tools: string[]) => void
  onClose: () => void
}

const CATEGORY_ICONS: Record<string, string> = {
  http: '🌐', database: '🗄️', file: '📁', custom: '⚡',
}
const CATEGORY_COLOR: Record<string, string> = {
  http: '#0891b2', database: '#7c3aed', file: '#059669', custom: '#d97706',
}

export const ToolRegistry: React.FC<ToolRegistryProps> = ({
  nodeId, agentName, attachedTools, onAttach, onClose,
}) => {
  const [tools, setTools]       = useState<ToolEntry[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'http' | 'database' | 'file'>('all')
  const [selected, setSelected] = useState<string[]>(attachedTools)
  const [testing, setTesting]   = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, any> | null>(null)

  // ── Server state ────────────────────────────────────────────────────────────
  const [servers, setServers]             = useState<{ name: string; builtin: boolean }[]>([])
  const [activeServer, setActiveServer]   = useState('flowforge')
  const [showAddServer, setShowAddServer] = useState(false)
  const [newName, setNewName]   = useState('')
  const [newCmd,  setNewCmd]    = useState('')
  const [newArgs, setNewArgs]   = useState('')
  const [addingServer, setAddingServer] = useState(false)

  // Fetch server list
  useEffect(() => {
    fetch('http://localhost:8000/api/mcp/servers/')
      .then(r => r.json())
      .then(d => setServers(d.servers || [{ name: 'flowforge', builtin: true }]))
      .catch(() => setServers([{ name: 'flowforge', builtin: true }]))
  }, [])

  // Fetch tools for active server
  useEffect(() => {
    setLoading(true); setTools([]); setError('')
    const url = activeServer === 'flowforge'
      ? 'http://localhost:8000/api/mcp/registry'
      : `http://localhost:8000/api/mcp/servers/${activeServer}/tools`
    fetch(url)
      .then(r => r.json())
      .then(data => {
        const list = activeServer === 'flowforge' ? data : (data.tools || [])
        setTools(list); setLoading(false)
      })
      .catch(() => { setError('Cannot reach backend'); setLoading(false) })
  }, [activeServer])

  const handleAddServer = async () => {
    if (!newName.trim() || !newCmd.trim()) return
    setAddingServer(true)
    try {
      const res = await fetch('http://localhost:8000/api/mcp/servers/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(), command: newCmd.trim(),
          args: newArgs.trim() ? newArgs.trim().split(' ') : [],
        }),
      })
      const d = await res.json()
      if (res.ok) {
        setServers(s => [...s, { name: newName.trim(), builtin: false }])
        setActiveServer(newName.trim())
        setShowAddServer(false); setNewName(''); setNewCmd(''); setNewArgs('')
      } else {
        alert(d.detail || 'Failed to register server')
      }
    } catch { alert('Could not connect') }
    finally { setAddingServer(false) }
  }

  const toggle = useCallback((toolName: string) => {
    setSelected(prev => prev.includes(toolName) ? prev.filter(t => t !== toolName) : [...prev, toolName])
    setTestResult(null)
  }, [])

  const handleTest = async (toolName: string) => {
    setTesting(toolName); setTestResult(null)
    try {
      const res = await fetch(`http://localhost:8000/api/mcp/tools/${toolName}/test`)
      const data = await res.json()
      setTestResult({ tool: toolName, ...data })
    } catch {
      setTestResult({ tool: toolName, error: 'Test failed' })
    } finally { setTesting(null) }
  }

  const visible = tools.filter(t => activeTab === 'all' || t.category === activeTab)

  const tabs = [
    { id: 'all',      label: 'All',       count: tools.length },
    { id: 'http',     label: '🌐 HTTP',    count: tools.filter(t => t.category === 'http').length },
    { id: 'database', label: '🗄️ Database', count: tools.filter(t => t.category === 'database').length },
    { id: 'file',     label: '📁 File',    count: tools.filter(t => t.category === 'file').length },
  ]

  const F: React.CSSProperties = {
    border: '1px solid var(--border)', borderRadius: 6,
    padding: '5px 8px', fontSize: 11, outline: 'none',
    fontFamily: 'var(--font)', background: 'var(--bg)', color: 'var(--text)',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 2000,
      background: 'rgba(0,0,0,0.2)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={e => e.target === e.currentTarget && onClose()}>

      <div style={{
        width: 660, maxHeight: '85vh', display: 'flex', flexDirection: 'column',
        background: '#fff', border: '1px solid var(--border)', borderRadius: 14,
        boxShadow: '0 16px 48px rgba(0,0,0,0.12)',
        fontFamily: 'var(--font)', overflow: 'hidden',
      }}>

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>🔧 MCP Tool Registry</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginTop: 2 }}>
              Attaching tools to <span style={{ color: '#2563eb', fontWeight: 600 }}>{agentName}</span>
              {selected.length > 0 && <span style={{ color: '#16a34a', marginLeft: 6 }}>· {selected.length} selected</span>}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-3)', cursor: 'pointer', fontSize: 18 }}>✕</button>
        </div>

        {/* ── Server tabs row ─────────────────────────────────────────── */}
        <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', background: '#fafafa', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-3)', marginRight: 2, flexShrink: 0 }}>MCP Server:</span>
          {(servers.length > 0 ? servers : [{ name: 'flowforge', builtin: true }]).map(s => (
            <button key={s.name} onClick={() => setActiveServer(s.name)} style={{
              padding: '3px 10px', borderRadius: 6,
              border: `1px solid ${activeServer === s.name ? '#2563eb' : 'var(--border)'}`,
              background: activeServer === s.name ? '#eff6ff' : '#fff',
              color: activeServer === s.name ? '#2563eb' : 'var(--text-2)',
              fontSize: 11, fontWeight: activeServer === s.name ? 600 : 400,
              cursor: 'pointer', fontFamily: 'var(--font)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              <span>{s.builtin ? '🔧' : '🔌'}</span> {s.name}
            </button>
          ))}
          <button onClick={() => setShowAddServer(v => !v)} style={{
            padding: '3px 10px', borderRadius: 6,
            border: '1px dashed var(--border-mid)',
            background: showAddServer ? '#eff6ff' : 'transparent',
            color: showAddServer ? '#2563eb' : 'var(--text-3)',
            fontSize: 11, cursor: 'pointer', fontFamily: 'var(--font)',
          }}>+ Add server</button>
        </div>

        {/* ── Add server form ─────────────────────────────────────────── */}
        {showAddServer && (
          <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', background: '#f0fdf4', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#166534' }}>Register New MCP Server</div>
            <div style={{ display: 'flex', gap: 5 }}>
              <input value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Server name (e.g. my-tools)" style={{ ...F, flex: 1 }}
                onFocus={e => (e.target.style.borderColor = '#2563eb')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
              <input value={newCmd} onChange={e => setNewCmd(e.target.value)}
                placeholder="Command (e.g. python)" style={{ ...F, flex: 1 }}
                onFocus={e => (e.target.style.borderColor = '#2563eb')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
              <input value={newArgs} onChange={e => setNewArgs(e.target.value)}
                placeholder="Args (space-separated)" style={{ ...F, flex: 1 }}
                onFocus={e => (e.target.style.borderColor = '#2563eb')}
                onBlur={e => (e.target.style.borderColor = 'var(--border)')} />
              <button onClick={handleAddServer} disabled={addingServer || !newName.trim() || !newCmd.trim()} style={{
                padding: '5px 12px', borderRadius: 6, border: 'none',
                background: addingServer ? '#f4f4f5' : '#2563eb', color: addingServer ? '#a1a1aa' : '#fff',
                fontSize: 11, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)',
              }}>{addingServer ? '…' : 'Register'}</button>
            </div>
            <div style={{ fontSize: 9, color: '#16a34a' }}>
              Example: <code>npx -y @modelcontextprotocol/server-filesystem /tmp</code> · or <code>python -m my_mcp_server</code>
            </div>
          </div>
        )}

        {/* ── Category tabs ───────────────────────────────────────────── */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          {tabs.filter(t => t.count > 0 || t.id === 'all').map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id as any)} style={{
              padding: '7px 14px', border: 'none', cursor: 'pointer', background: 'none',
              fontFamily: 'var(--font)', fontSize: 11,
              color: activeTab === tab.id ? '#2563eb' : 'var(--text-3)',
              borderBottom: `2px solid ${activeTab === tab.id ? '#2563eb' : 'transparent'}`,
              fontWeight: activeTab === tab.id ? 700 : 400,
            }}>
              {tab.label}
              <span style={{
                marginLeft: 5, fontSize: 9, padding: '1px 5px', borderRadius: 8,
                background: activeTab === tab.id ? '#eff6ff' : '#f4f4f5',
                color: activeTab === tab.id ? '#2563eb' : 'var(--text-3)',
              }}>{tab.count}</span>
            </button>
          ))}
        </div>

        {/* ── Tool list ───────────────────────────────────────────────── */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
          {loading && <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>Loading tools…</div>}
          {error && <div style={{ padding: 24, textAlign: 'center', color: '#dc2626', fontSize: 11 }}>{error}</div>}
          {!loading && !error && visible.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 11 }}>No tools in this category</div>
          )}

          {visible.map(tool => {
            const isAttached = selected.includes(tool.name)
            const catColor   = CATEGORY_COLOR[tool.category] ?? '#2563eb'
            const isTesting  = testing === tool.name

            return (
              <div key={tool.name} style={{
                marginBottom: 7, borderRadius: 10, overflow: 'hidden',
                border: `1px solid ${isAttached ? catColor + '40' : 'var(--border)'}`,
                background: isAttached ? catColor + '04' : '#fff',
                transition: 'all 0.12s',
              }}>
                {/* Tool header */}
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px' }}>
                  {/* Icon */}
                  <div style={{
                    width: 34, height: 34, borderRadius: 8, flexShrink: 0,
                    background: catColor + '12', border: `1px solid ${catColor}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
                  }}>
                    {CATEGORY_ICONS[tool.category] ?? '⚡'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', fontFamily: 'var(--mono)' }}>{tool.name}</span>
                      <span style={{
                        fontSize: 9, padding: '1px 6px', borderRadius: 4,
                        background: catColor + '15', color: catColor, border: `1px solid ${catColor}25`, fontWeight: 600,
                      }}>{tool.category}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-2)', lineHeight: 1.5, marginBottom: 4 }}>{tool.description}</div>
                    {Object.keys(tool.example_args ?? {}).length > 0 && (
                      <div style={{
                        fontSize: 9, color: 'var(--text-3)', fontFamily: 'var(--mono)',
                        background: '#fafafa', border: '1px solid var(--border)',
                        padding: '3px 7px', borderRadius: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {JSON.stringify(tool.example_args)}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', gap: 5, flexShrink: 0 }}>
                    <button onClick={() => handleTest(tool.name)} disabled={isTesting} style={{
                      padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                      background: '#fafafa', color: 'var(--text-2)', fontSize: 10,
                      cursor: isTesting ? 'not-allowed' : 'pointer', fontFamily: 'var(--font)',
                    }}>
                      {isTesting ? '…' : 'Test'}
                    </button>
                    <button onClick={() => toggle(tool.name)} style={{
                      padding: '4px 12px', borderRadius: 6, border: 'none',
                      background: isAttached ? catColor + '20' : '#2563eb',
                      color: isAttached ? catColor : '#fff',
                      fontSize: 10, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)',
                      transition: 'all 0.12s',
                    }}>
                      {isAttached ? '✓ Attached' : '+ Attach'}
                    </button>
                  </div>
                </div>

                {/* Test result */}
                {testResult && testResult.tool === tool.name && (
                  <div style={{
                    borderTop: '1px solid var(--border)', padding: '8px 12px',
                    background: testResult.error ? '#fef2f2' : '#f0fdf4',
                  }}>
                    <div style={{ fontSize: 9, color: testResult.error ? '#dc2626' : '#16a34a', marginBottom: 3, fontWeight: 600 }}>
                      {testResult.error ? '✕ Test failed' : '✓ Test passed'}
                    </div>
                    <pre style={{
                      fontSize: 9, color: 'var(--text-2)', margin: 0, lineHeight: 1.6,
                      fontFamily: 'var(--mono)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      maxHeight: 80, overflowY: 'auto',
                    }}>
                      {JSON.stringify(testResult.parsed || testResult.error, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────── */}
        <div style={{
          padding: '12px 18px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: '#fafafa',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)' }}>
            {selected.length === 0
              ? 'No tools attached — agent uses role defaults'
              : `${selected.length} tool${selected.length > 1 ? 's' : ''} will be available to this agent`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{
              padding: '7px 14px', borderRadius: 7, border: '1px solid var(--border)',
              background: '#fff', color: 'var(--text-2)', fontSize: 11,
              cursor: 'pointer', fontFamily: 'var(--font)',
            }}>Cancel</button>
            <button onClick={() => { onAttach(nodeId, selected); onClose() }} style={{
              padding: '7px 18px', borderRadius: 7, border: 'none',
              background: '#2563eb', color: '#fff',
              fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)',
              boxShadow: '0 2px 8px rgba(37,99,235,0.25)',
            }}>
              Save tools
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
