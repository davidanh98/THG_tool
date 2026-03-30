import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../api/client'

interface Ranking {
    name: string;
    total_points: number;
    pending_points: number;
    contacted: number;
    reply_received: number;
    converted: number;
    deals_closed: number;
    total_deal_value: number
}
interface LogEntry {
    id: number;
    staff_name: string;
    action_type: string;
    points: number;
    deal_value: number;
    note: string;
    suspicious: number;
    status: string;
    created_at: string
}

const STAFF_EMOJI: Record<string, string> = {
    "Đức Anh's Agent": '🤖', Trang: '💗', 'Lê Huyền': '🧡',
    'Ngọc Huyền': '💚', Hạnh: '💛', Min: '💜', Moon: '🩵', Thư: '🌸'
}
const MEDALS = ['🥇', '🥈', '🥉']

const ACTION_ICONS: Record<string, string> = {
    opener_copied: '📋 +1 Copy opener',
    contacted: '📞 +3 Contacted',
    reply_received: '↩️ +8 Customer replied',
    interested: '🔥 +10 Interested',
    deal_closed: '🏆 Deal closed',
}

function relativeTime(ts: string) {
    const ms = Date.now() - new Date(ts).getTime()
    const min = Math.floor(ms / 60000)
    if (min < 60) return `${min}m ago`
    const h = Math.floor(min / 60)
    if (h < 24) return `${h}h ago`
    return `${Math.floor(h / 24)}d ago`
}

export default function LeaderboardPage() {
    const [rankings, setRankings] = useState<Ranking[]>([])
    const [log, setLog] = useState<LogEntry[]>([])
    const [flagged, setFlagged] = useState<LogEntry[]>([])
    const [loading, setLoading] = useState(true)
    const [isAdmin, setIsAdmin] = useState(false)

    useEffect(() => {
        apiGet<{ data: { rankings: Ranking[]; log: LogEntry[]; flagged: LogEntry[] } }>('/api/leaderboard')
            .then((res) => {
                setRankings(res.data?.rankings || [])
                setLog(res.data?.log || [])
                setFlagged(res.data?.flagged || [])
            })
            .catch(() => { })
            .finally(() => setLoading(false))
    }, [])

    if (loading) return <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}><div className="spinner" /></div>

    const sorted = [...rankings].sort((a, b) => b.total_points - a.total_points)
    const top3 = sorted.slice(0, 3)
    // Reorder for podium: 2nd, 1st, 3rd
    const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3
    const heights = ['130px', '170px', '110px']

    return (
        <div>
            <div className="page-header"><h2 className="page-title">🏆 Leaderboard</h2></div>

            {/* Podium */}
            <div className="podium">
                {podiumOrder.map((p, i) => {
                    const rank = i === 1 ? 0 : i === 0 ? 1 : 2
                    return (
                        <div className="podium-card" key={p.name} style={{ height: heights[i] }}>
                            <div style={{ fontSize: '2rem' }}>{MEDALS[rank]}</div>
                            <div style={{ fontSize: '1.5rem' }}>{STAFF_EMOJI[p.name] || '🤖'}</div>
                            <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', marginTop: 4 }}>{p.name}</div>
                            <div style={{ fontWeight: 800, fontSize: 'var(--text-lg)', color: 'var(--accent)' }}>{p.total_points} pts</div>
                        </div>
                    )
                })}
            </div>

            {/* Full table */}
            <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
                <div className="card-title">📊 Full Rankings</div>
                <div style={{ overflow: 'auto' }}>
                    <table className="group-table">
                        <thead><tr><th>#</th><th>Staff</th><th>Points</th><th>Pending</th><th>Contacted</th><th>Replied</th><th>Deals</th><th>Revenue</th></tr></thead>
                        <tbody>
                            {sorted.map((r, i) => (
                                <tr key={r.name}>
                                    <td style={{ fontWeight: 700 }}>{i < 3 ? MEDALS[i] : `#${i + 1}`}</td>
                                    <td><span style={{ marginRight: 4 }}>{STAFF_EMOJI[r.name] || '🤖'}</span>{r.name}</td>
                                    <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{r.total_points}</td>
                                    <td style={{ color: '#f59e0b', fontSize: '0.8rem' }}>{r.pending_points > 0 ? `⏳ +${r.pending_points}` : '—'}</td>
                                    <td>{r.contacted || 0}</td>
                                    <td style={{ color: '#10b981' }}>{r.reply_received || 0} ↩️</td>
                                    <td>{r.deals_closed || 0}</td>
                                    <td style={{ color: 'var(--success)', fontWeight: 600 }}>${r.total_deal_value?.toLocaleString() || 0}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Activity feed */}
            <div className="card" style={{ marginBottom: 'var(--space-xl)' }}>
                <div className="card-title">🔔 Recent Activity</div>
                {log.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>No activity yet</div>
                ) : (
                    <div style={{ maxHeight: 300, overflow: 'auto' }}>
                        {log.slice(0, 20).map((e) => (
                            <div key={e.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: 'var(--text-sm)' }}>
                                <span>{STAFF_EMOJI[e.staff_name] || '🤖'}</span>
                                <span style={{ fontWeight: 600 }}>{e.staff_name}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{ACTION_ICONS[e.action_type] || e.action_type}</span>
                                <span style={{ fontWeight: 700, color: 'var(--success)' }}>+{e.points}</span>
                                {e.note && <span style={{ color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>— {e.note}</span>}
                                {e.suspicious ? <span style={{ background: '#ef4444', color: 'white', fontSize: '0.65rem', padding: '1px 4px', borderRadius: 3 }}>⚠️ FLAGGED</span> : null}
                                {e.status === 'pending' ? <span style={{ background: '#f59e0b', color: 'white', fontSize: '0.65rem', padding: '1px 4px', borderRadius: 3 }}>⏳ PENDING</span> : null}
                                <span style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 'var(--text-xs)' }}>{relativeTime(e.created_at)}</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Admin toggle */}
            <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <label style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    <input type="checkbox" checked={isAdmin} onChange={e => setIsAdmin(e.target.checked)} style={{ marginRight: '0.5rem' }} />
                    Chế độ Admin (Giám sát)
                </label>
            </div>

            {isAdmin && (
                <div className="card" style={{ marginTop: '1rem', border: '1px solid #ef4444' }}>
                    <div className="card-title" style={{ color: '#ef4444' }}>⚠️ Admin Monitor — Hoạt động đáng ngờ</div>
                    {flagged.length === 0 ? (
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>✅ Không có hoạt động đáng ngờ</div>
                    ) : (
                        flagged.map(f => (
                            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '8px 0', borderBottom: '1px solid var(--border)', fontSize: '0.875rem' }}>
                                <span>⚠️</span>
                                <span style={{ fontWeight: 600 }}>{f.staff_name}</span>
                                <span style={{ color: 'var(--text-muted)' }}>{f.action_type}</span>
                                <span style={{ color: '#f59e0b' }}>+{f.points} pts</span>
                                {f.deal_value > 0 && <span style={{ color: '#10b981' }}>${f.deal_value}</span>}
                                {f.note && <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>— {f.note}</span>}
                                <span style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                                    <button
                                        className="btn btn-sm"
                                        style={{ background: '#10b981', color: 'white', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem' }}
                                        onClick={async () => {
                                            await apiPost(`/api/leaderboard/approve/${f.id}`, {});
                                            setFlagged(prev => prev.filter(x => x.id !== f.id));
                                        }}
                                    >✅ Duyệt</button>
                                    <button
                                        className="btn btn-sm"
                                        style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: '0.75rem' }}
                                        onClick={async () => {
                                            const reason = prompt('Lý do từ chối:') || 'Admin rejected';
                                            await apiPost(`/api/leaderboard/reject/${f.id}`, { reason });
                                            setFlagged(prev => prev.filter(x => x.id !== f.id));
                                        }}
                                    >❌ Từ chối</button>
                                </span>
                            </div>
                        ))
                    )}
                </div>
            )}
        </div>
    )
}
