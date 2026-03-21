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
                    <h1>Trung Tâm Chỉ Huy SIS v2</h1>
                    <p className="text-muted">Phân Tích Tín Hiệu Thương Mại — {summary?.total_processed || 0} tín hiệu đã xử lý</p>
                </div>
                <div className="sis-stats-lite">
                    <div className="sis-stat-item">
                        <span className="label">Đã Xác Định</span>
                        <span className="val color-resolved">{summary?.lanes?.resolved || 0}</span>
                    </div>
                    <div className="sis-stat-item">
                        <span className="label">Tiềm Năng</span>
                        <span className="val color-partial">{summary?.lanes?.partial || 0}</span>
                    </div>
                    <div className="sis-stat-item">
                        <span className="label">Ẩn Danh</span>
                        <span className="val color-anonymous">{summary?.lanes?.anonymous || 0}</span>
                    </div>
                </div>
            </header>

            <div className="sis-board">
                <Section title="Khách Hàng Đã Xác Định" icon="🔵" signals={lanes?.resolved || []} color="resolved" />
                <Section title="Khách Hàng Tiềm Năng" icon="🟡" signals={lanes?.partial || []} color="partial" />
                <Section title="Tín Hiệu Ẩn Danh" icon="⚪" signals={lanes?.anonymous || []} color="anonymous" />
                <Section title="Thông Tin Đối Thủ" icon="🔴" signals={lanes?.competitor || []} color="competitor" />
            </div>
        </div>
    )
}

function Section({ title, icon, signals, color }: { title: string; icon: string; signals: SISSignal[]; color: string }) {
    if (signals.length === 0 && color === 'competitor') return null; // Hide competitor if empty

    return (
        <section className="sis-section">
            <div className="section-header">
                <h2>{icon} {title}</h2>
                <span className="section-badge">{signals.length} tín hiệu</span>
            </div>
            <div className="signal-grid">
                {signals.length === 0 ? (
                    <div className="empty-state">Chưa có tín hiệu trong mục này</div>
                ) : (
                    signals.map(s => <SignalCard key={s.id} signal={s} />)
                )}
            </div>
        </section>
    )
}

function SignalCard({ signal }: { signal: SISSignal }) {
    const cls = signal.classification
    const card = signal.leadCard

    return (
        <div className={`signal-card ${card ? 'has-strategy' : ''}`}>
            <div className="card-top">
                <div className="author-info">
                    <span className="author-name">{signal.author_name}</span>
                    <span className="platform-label">{signal.platform}</span>
                </div>
                {card && <div className="brain-indicator" title="Chiến lược AI sẵn sàng">🧠</div>}
            </div>

            <p className="signal-body">
                {(signal.content || '').substring(0, 180)}
                {(signal.content || '').length > 180 ? '...' : ''}
            </p>

            {cls && (
                <div className="metrics-row">
                    <MetricBox label="Người bán" val={cls.seller_likelihood} />
                    <MetricBox label="Nỗi đau" val={cls.pain_score} />
                    <MetricBox label="Ý định" val={cls.intent_score} />
                </div>
            )}

            <div className="card-actions">
                <div className="prio-tag">
                    {card ? (
                        <>
                            <span className="pulse" />
                            Ưu tiên {card.sales_priority_score}
                        </>
                    ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Mức độ: {cls?.confidence || 'thấp'}</span>
                    )}
                </div>
                {signal.post_url && (
                    <a href={signal.post_url} target="_blank" rel="noreferrer" className="btn-action-view">
                        Xem gốc
                    </a>
                )}
            </div>
        </div>
    )
}

function MetricBox({ label, val }: { label: string; val: number }) {
    const color = val > 75 ? 'var(--success)' : val > 40 ? 'var(--warning)' : 'var(--text-muted)'
    return (
        <div className="metric-box">
            <span className="m-label">{label}</span>
            <div className="m-bar-container">
                <div className="m-bar-fill" style={{ width: `${val}%`, backgroundColor: color }} />
            </div>
            <span className="m-val" style={{ color }}>{val}</span>
        </div>
    )
}
