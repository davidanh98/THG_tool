import { useEffect } from 'react'
import { useSISStore } from '../store/sisStore'
import type { SISSignal } from '../types/sis'

export default function SISDashboard() {
    const { lanes, summary, loadLanes, loadSummary } = useSISStore()

    useEffect(() => {
        loadLanes()
        loadSummary()
        const id = setInterval(() => { loadLanes(); loadSummary(); }, 30000)
        return () => clearInterval(id)
    }, [])

    return (
        <div className="sis-dashboard">
            <header className="sis-header">
                <div>
                    <h1>SIS v2 Command Center</h1>
                    <p className="text-muted">Signal-Centric Seller Intelligence — {summary?.total_processed || 0} signals analyzed</p>
                </div>
                <div className="sis-stats-lite">
                    <div className="sis-stat-item">
                        <span className="label">Resolved</span>
                        <span className="val color-resolved">{summary?.lanes.resolved || 0}</span>
                    </div>
                    <div className="sis-stat-item">
                        <span className="label">Partial</span>
                        <span className="val color-partial">{summary?.lanes.partial || 0}</span>
                    </div>
                    <div className="sis-stat-item">
                        <span className="label">Anonymous</span>
                        <span className="val color-anonymous">{summary?.lanes.anonymous || 0}</span>
                    </div>
                </div>
            </header>

            <div className="sis-board">
                <Lane title="Resolved Leads" icon="🔵" signals={lanes.resolved} color="resolved" />
                <Lane title="Partial Leads" icon="🟡" signals={lanes.partial} color="partial" />
                <Lane title="Anonymous Signals" icon="⚪" signals={lanes.anonymous} color="anonymous" />
                <Lane title="Competitor Intel" icon="🔴" signals={lanes.competitor} color="competitor" />
            </div>
        </div>
    )
}

function Lane({ title, icon, signals, color }: { title: string; icon: string; signals: SISSignal[]; color: string }) {
    return (
        <div className={`sis-lane lane-${color}`}>
            <div className="lane-header">
                <h3>{icon} {title}</h3>
                <span className="badge">{signals.length}</span>
            </div>
            <div className="lane-content">
                {signals.length === 0 ? (
                    <div className="empty-state">No signals in this lane</div>
                ) : (
                    signals.map(s => <SignalCard key={s.id} signal={s} />)
                )}
            </div>
        </div>
    )
}

function SignalCard({ signal }: { signal: SISSignal }) {
    const cls = signal.classification
    const card = signal.leadCard

    return (
        <div className={`signal-card ${card ? 'has-strategy' : ''}`}>
            <div className="card-top">
                <span className="platform-tag">{signal.platform}</span>
                <span className="author">{signal.author_name}</span>
                {card && <span className="brain-badge">🧠</span>}
            </div>

            <p className="signal-content">{signal.content.substring(0, 150)}...</p>

            {cls && (
                <div className="metrics-grid">
                    <Metric label="Seller" val={cls.seller_likelihood} />
                    <Metric label="Pain" val={cls.pain_score} />
                    <Metric label="Intent" val={cls.intent_score} />
                </div>
            )}

            {card && (
                <div className="card-footer">
                    <div className="priority">
                        <span className="dot" /> Priority {card.sales_priority_score}
                    </div>
                    <button className="btn-view-strategy">View Strategy</button>
                </div>
            )}
        </div>
    )
}

function Metric({ label, val }: { label: string; val: number }) {
    const color = val > 75 ? '#10b981' : val > 40 ? '#f59e0b' : '#6b7280'
    return (
        <div className="metric">
            <div className="metric-label">{label}</div>
            <div className="metric-bar-bg">
                <div className="metric-bar-fill" style={{ width: `${val}%`, backgroundColor: color }} />
            </div>
            <div className="metric-val">{val}</div>
        </div>
    )
}
