import { useEffect, useState } from 'react'
import { useLeadStore } from '../store/leadStore'
import { apiGet } from '../api/client'
import { useNavigate } from 'react-router-dom'
import LeadTable from '../components/lead/LeadTable'
import LeadFilters from '../components/lead/LeadFilters'
import ClosingRoom from '../components/lead/ClosingRoom'

export default function LeadsPage() {
    const { leads, loading, stats, selectedLeadId, loadLeads, loadStats, selectLead } = useLeadStore()
    const navigate = useNavigate()

    useEffect(() => {
        loadLeads()
        loadStats()
        const interval = setInterval(loadLeads, 60_000)
        return () => clearInterval(interval)
    }, [loadLeads, loadStats])

    // If a lead is selected, show the Closing Room
    if (selectedLeadId) {
        const selectedLead = leads.find((l) => l.id === selectedLeadId)
        if (selectedLead) {
            return <ClosingRoom lead={selectedLead} onClose={() => selectLead(null)} />
        }
    }

    return (
        <div>
            {/* Agent Activity Banner */}
            <AgentBanner />

            {/* Stats Bar — matching original dashboard */}
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                <div className="stat-card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', gridColumn: 'span 2' }}>
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>🌍 Foreign</div>
                        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: '#3b82f6' }}>{stats?.totalForeign || 0}</div>
                    </div>
                    <div style={{ width: 1, height: 40, background: 'var(--border)' }} />
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>🇻🇳 Vietnamese</div>
                        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: '#ef4444' }}>{stats?.totalViet || 0}</div>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>High Value</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{stats?.highValue || 0}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Score ≥ 80</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Avg Score</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{stats?.avgScore || 0}</div>
                </div>
                <div className="stat-card" style={{ cursor: 'pointer' }} onClick={() => navigate('/inbox')}>
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>📬 Inbox</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{stats?.pending || 0}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>Chờ phản hồi</div>
                </div>
                <div className="stat-card">
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>Platforms</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{stats?.platformCount || '-'}</div>
                    <div style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>{stats?.platformDetail || 'FB: 0 | IG: 0'}</div>
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
                    🎯 Leads <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>({leads.length})</span>
                </h2>
                <button className="btn btn-secondary btn-sm" onClick={loadLeads} disabled={loading}>
                    {loading ? '⏳' : '🔄'} Refresh
                </button>
            </div>

            <LeadFilters />
            <LeadTable leads={leads} loading={loading} onSelectLead={selectLead} />
        </div>
    )
}

function AgentBanner() {
    const [s, setS] = useState<{ replies: number; engagements: number; alerts: number; newLeads: number; totalActions: number } | null>(null)

    useEffect(() => {
        const fetch = () => apiGet<{ today: any }>('/api/activity/summary').then(r => setS(r.today)).catch(() => { })
        fetch()
        const id = setInterval(fetch, 60000)
        return () => clearInterval(id)
    }, [])

    if (!s || s.totalActions === 0) return null

    return (
        <div className="activity-banner">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div className="ab-pulse" />
                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--success)' }}>AGENTS</span>
            </div>
            <div className="ab-divider" />
            {[
                { v: s.replies, l: 'Replies', icon: '🏆' },
                { v: s.engagements, l: 'Engaged', icon: '👀' },
                { v: s.alerts, l: 'Alerts', icon: '⚡' },
                { v: s.newLeads, l: 'New Leads', icon: '🎯' },
            ].map((stat, i) => (
                <div key={i} className="ab-stat">
                    <div className="ab-stat-value">{stat.icon} {stat.v}</div>
                    <div className="ab-stat-label">{stat.l}</div>
                </div>
            ))}
        </div>
    )
}
