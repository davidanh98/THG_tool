import { Link, useLocation } from 'react-router-dom'
import { useAccountStore } from '../../store/accountStore'
import { apiPost, apiGet } from '../../api/client'
import { useState, useEffect } from 'react'

type NavItem = { section: string } | { to: string; icon: string; label: string; badge?: string }

const NAV_ITEMS: NavItem[] = [
    { section: 'Pipeline' },
    { to: '/', icon: '🏢', label: 'Accounts' },
    { to: '/analytics', icon: '📊', label: 'Analytics' },
    { section: 'Channels' },
    { to: '/inbox', icon: '💬', label: 'Inbox' },
    { to: '/groups', icon: '👥', label: 'Groups' },
    { section: 'Team' },
    { to: '/agents', icon: '🧠', label: 'AI Agents' },
    { to: '/strategies', icon: '🎯', label: 'Strategies', badge: 'NEW' },
    { to: '/leaderboard', icon: '🏆', label: 'Leaderboard', badge: 'LIVE' },
    { section: 'System' },
    { to: '/system', icon: '🏗️', label: 'Tổng Quan Hệ Thống', badge: 'AI' },
    { to: '/settings', icon: '⚙️', label: 'Settings' },
]

export default function Sidebar() {
    const location = useLocation()
    const accountCount = useAccountStore((s) => s.accounts.length)
    const [scanning, setScanning] = useState(false)

    const triggerScan = async () => {
        setScanning(true)
        try {
            await apiPost('/api/scan', {})
        } catch { /* ignore */ }
        // Poll for new leads
        setTimeout(() => setScanning(false), 30000)
    }

    return (
        <aside className="app-sidebar">
            <div className="sidebar-brand">
                <span className="sidebar-brand-icon">🔍</span>
                <div>
                    <span className="sidebar-brand-name">THG Lead</span>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500 }}>AI Cyborg Pipeline</div>
                </div>
            </div>

            <nav className="sidebar-nav">
                {NAV_ITEMS.map((item, i) => {
                    if ('section' in item) {
                        return (
                            <div key={i} className="sidebar-section-title">
                                {item.section}
                            </div>
                        )
                    }
                    const isActive = item.to === '/'
                        ? location.pathname === '/'
                        : location.pathname.startsWith(item.to)

                    return (
                        <Link key={item.to} to={item.to} style={{ textDecoration: 'none' }}>
                            <div className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''}`}>
                                <span className="sidebar-item-icon">{item.icon}</span>
                                <span>{item.label}</span>
                                {item.to === '/' && accountCount > 0 ? (
                                    <span className="sidebar-item-badge">{accountCount}</span>
                                ) : null}
                                {item.badge && (
                                    <span className="sidebar-item-badge" style={
                                        item.badge === 'LIVE'
                                            ? { background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }
                                            : { background: 'rgba(139,92,246,0.2)', color: '#a78bfa', fontSize: '0.6rem' }
                                    }>{item.badge}</span>
                                )}
                            </div>
                        </Link>
                    )
                })}

                {/* Scan Section */}
                <div style={{ padding: 'var(--space-md) var(--space-sm)', borderTop: '1px solid var(--border)', marginTop: 'var(--space-md)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: scanning ? '#f59e0b' : '#10b981' }} />
                        <span>{scanning ? '⏳ Scanning...' : '✅ System Ready'}</span>
                    </div>
                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', fontSize: 'var(--text-xs)' }}
                        onClick={triggerScan}
                        disabled={scanning}
                    >
                        {scanning ? '⏳ Scanning...' : '🔍 Keyword Scan'}
                    </button>
                </div>
            </nav>

            <div className="sidebar-footer">
                <AgentMiniStatus />
                <button className="sidebar-item" onClick={() => {
                    const theme = document.documentElement.getAttribute('data-theme')
                    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'dark' : 'light')
                    localStorage.setItem('theme', theme === 'light' ? 'dark' : 'light')
                }}>
                    <span className="sidebar-item-icon">🌙</span>
                    <span>Toggle Theme</span>
                </button>
            </div>
        </aside>
    )
}

function AgentMiniStatus() {
    const [summary, setSummary] = useState<{ totalActions: number; replies: number; engagements: number; alerts: number } | null>(null)

    useEffect(() => {
        const fetch = () => apiGet<{ today: any }>('/api/activity/summary')
            .then(r => setSummary(r.today)).catch(() => { })
        fetch()
        const id = setInterval(fetch, 60000)
        return () => clearInterval(id)
    }, [])

    const active = summary && summary.totalActions > 0

    return (
        <div className="sidebar-agent-status">
            <div className={`sidebar-agent-dot ${active ? '' : 'sidebar-agent-dot--idle'}`} />
            <span>{active ? `🤖 ${summary!.totalActions} actions today` : '🤖 Agent idle'}</span>
        </div>
    )
}
