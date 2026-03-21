import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../api/client'

interface ActivityItem {
    id: string; type: string; icon: string; label: string;
    leadName?: string; leadScore?: number; leadUrl?: string; postUrl?: string;
    detail?: string; staff?: string; timestamp: string;
}

interface Summary {
    replies: number; engagements: number; alerts: number; dms: number;
    scans: number; newLeads: number; totalActions: number;
}

interface EngagerLead {
    id: number; author_name: string; author_url: string; score: number; category: string;
}

function timeAgo(ts: string): string {
    const diff = Date.now() - new Date(ts).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'vừa xong'
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h`
    return `${Math.floor(hrs / 24)}d`
}

export default function StrategiesPage() {
    const [summary, setSummary] = useState<Summary | null>(null)
    const [feed, setFeed] = useState<ActivityItem[]>([])
    const [engagerLeads, setEngagerLeads] = useState<EngagerLead[]>([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState<string | null>(null)

    const fetchData = async () => {
        try {
            const [sumRes, feedRes, engRes] = await Promise.all([
                apiGet<{ today: Summary }>('/api/activity/summary'),
                apiGet<{ data: ActivityItem[] }>('/api/activity/feed?limit=20'),
                apiGet<{ data: EngagerLead[] }>('/api/strategy/engager-leads?limit=10').catch(() => ({ data: [] })),
            ])
            setSummary(sumRes.today || null)
            setFeed(feedRes.data || [])
            setEngagerLeads(engRes.data || [])
        } catch { }
        setLoading(false)
    }

    useEffect(() => { fetchData() }, [])

    // Auto-refresh every 30s
    useEffect(() => {
        const interval = setInterval(fetchData, 30000)
        return () => clearInterval(interval)
    }, [])

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>

    return (
        <div>
            <div className="page-header">
                <h2 className="page-title">🎯 Strategies</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', margin: 0 }}>
                    Giám sát các chiến dịch tự động 24/7 — Nhấn nút để ép AI chạy ngay lập tức (Manual Override)
                </p>
            </div>

            {/* Summary Stats */}
            {summary && (
                <div className="activity-banner" style={{ marginBottom: 'var(--space-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div className="ab-pulse" />
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--success)' }}>LIVE</span>
                    </div>
                    <div className="ab-divider" />
                    {[
                        { v: summary.replies, l: 'Replies', icon: '🏆' },
                        { v: summary.engagements, l: 'Engaged', icon: '👀' },
                        { v: summary.alerts, l: 'Alerts', icon: '⚡' },
                        { v: summary.dms, l: 'DMs', icon: '💬' },
                        { v: summary.newLeads, l: 'New Leads', icon: '🎯' },
                    ].map((s, i) => (
                        <div key={i} className="ab-stat">
                            <div className="ab-stat-value">{s.icon} {s.v}</div>
                            <div className="ab-stat-label">{s.l} today</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Strategy Cards */}
            <div className="strategy-grid">
                {/* Expert Reply */}
                <div className="strategy-card strategy-card--green">
                    <div className="strategy-header">
                        <div className="strategy-title">🏆 Expert Reply</div>
                        <div className="strategy-stat">{summary?.replies || 0} hôm nay</div>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md)' }}>
                        AI tự động phân tích và viết comment/inbox hữu ích cho khách theo kịch bản Sales.
                    </p>
                    <button
                        className="btn btn-primary btn-sm"
                        disabled={actionLoading === 'batch_reply'}
                        onClick={async () => {
                            setActionLoading('batch_reply')
                            try { await apiPost('/api/strategy/expert-reply-batch', { minScore: 70, limit: 3 }) } catch { }
                            setActionLoading(null)
                            fetchData()
                        }}
                    >
                        {actionLoading === 'batch_reply' ? '⏳ Generating...' : '🚀 Auto-Reply Top 3 Leads'}
                    </button>
                </div>

                {/* Profile Engager */}
                <div className="strategy-card strategy-card--blue">
                    <div className="strategy-header">
                        <div className="strategy-title">👀 Auto Engager (24/7)</div>
                        <div className="strategy-stat">{summary?.engagements || 0} engaged</div>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md)' }}>
                        Cỗ máy chạy ngầm: Tự động dùng Clone đi Thả Tim, React Story khách hàng cũ báo thù.
                    </p>
                    {engagerLeads.length > 0 && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-sm)' }}>
                            {engagerLeads.length} leads chờ engage:
                        </div>
                    )}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 'var(--space-sm)' }}>
                        {engagerLeads.slice(0, 5).map(l => (
                            <span key={l.id} className="agent-badge agent-badge--engage" title={`Score: ${l.score}`}>
                                {l.author_name?.substring(0, 12)} ({l.score})
                            </span>
                        ))}
                        {engagerLeads.length > 5 && (
                            <span className="agent-badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                                +{engagerLeads.length - 5} more
                            </span>
                        )}
                    </div>
                </div>

                {/* Hot Lead Alert */}
                <div className="strategy-card strategy-card--orange">
                    <div className="strategy-header">
                        <div className="strategy-title">⚡ Hot Lead Alert</div>
                        <div className="strategy-stat">{summary?.alerts || 0} alerts</div>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md)' }}>
                        Bắn thông báo qua Telegram cho Sale ngay khi có Lead điểm tuyệt đối (80+).
                    </p>
                    <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.3)' }}
                        disabled={actionLoading === 'alert_all'}
                        onClick={async () => {
                            setActionLoading('alert_all')
                            try { await apiPost('/api/strategy/hot-alert-all', { minScore: 80, limit: 5 }) } catch { }
                            setActionLoading(null)
                            fetchData()
                        }}
                    >
                        {actionLoading === 'alert_all' ? '⏳ Sending...' : '📢 Alert All Hot Leads (80+)'}
                    </button>
                </div>

                {/* Account Farming (Fanpage Sharer) */}
                <div className="strategy-card" style={{ borderTop: '4px solid #10b981' }}>
                    <div className="strategy-header">
                        <div className="strategy-title" style={{ color: '#10b981' }}>🚜 Nuôi Trust & Clone</div>
                        <div className="strategy-stat">Auto 24/7</div>
                    </div>
                    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '0 0 var(--space-md)' }}>
                        Hệ thống đã TỰ ĐỘNG lướt Feed ngầm. Nút này dùng để ÉP 1 nick đi Share bài Fanpage ngay lập tức.
                    </p>
                    <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', border: '1px solid rgba(16,185,129,0.3)' }}
                        disabled={actionLoading === 'farm_account'}
                        onClick={async () => {
                            setActionLoading('farm_account')
                            try { await apiPost('/api/strategy/fanpage-share', {}) } catch { }
                            setActionLoading(null)
                            fetchData()
                        }}
                    >
                        {actionLoading === 'farm_account' ? '⏳ Đang đi share...' : '🚜 Gọi 1 Acc Đi Share Bài Mới'}
                    </button>
                </div>
            </div>

            {/* Activity Timeline */}
            <div style={{ marginTop: 'var(--space-xl)' }}>
                <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, marginBottom: 'var(--space-md)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    📡 Activity Feed
                    <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 500 }}>auto-refresh 30s</span>
                </h3>
                <div className="activity-timeline">
                    {feed.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: 'var(--space-xl)', color: 'var(--text-muted)' }}>
                            Chưa có hoạt động nào
                        </div>
                    ) : feed.map(item => (
                        <div key={item.id} className="activity-item">
                            <span className="ai-icon">{item.icon}</span>
                            <div className="ai-body">
                                <div className="ai-label">
                                    {item.label}
                                    {item.leadName && <span style={{ fontWeight: 400 }}> → {item.leadName}</span>}
                                    {item.leadScore && <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', marginLeft: 4 }}>({item.leadScore}pts)</span>}
                                </div>
                                {item.detail && <div className="ai-detail">{item.detail}</div>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                    {item.postUrl && (
                                        <a href={item.postUrl} target="_blank" rel="noopener noreferrer" className="ai-fb-link">🔗 Post</a>
                                    )}
                                    {item.leadUrl && (
                                        <a href={item.leadUrl} target="_blank" rel="noopener noreferrer" className="ai-fb-link">👤 Profile</a>
                                    )}
                                </div>
                            </div>
                            <span className="ai-time">{timeAgo(item.timestamp)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
