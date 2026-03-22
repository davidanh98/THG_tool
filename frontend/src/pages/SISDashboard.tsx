import { useEffect } from 'react'
import { useSISStore } from '../store/sisStore'
import type { SISSignal } from '../types/sis'

export default function SISDashboard() {
    const { lanes, summary, activeTab, setActiveTab, loadLanes, loadSummary } = useSISStore()

    useEffect(() => {
        loadLanes()
        loadSummary()
        const id = setInterval(() => { loadLanes(); loadSummary(); }, 30000)
        return () => clearInterval(id)
    }, [])

    const activeSignals = lanes[activeTab] || []

    return (
        <div className="sis-dashboard">
            <header className="sis-header">
                <div className="header-main">
                    <div>
                        <h1>Trung Tâm Chỉ Huy SIS v2</h1>
                        <p className="text-muted">Hệ Thống Phân Tích Tín Hiệu Thương Mại — {summary?.total_processed || 0} tín hiệu</p>
                    </div>
                </div>

                <div className="ux-switcher">
                    <Tab
                        id="resolved"
                        label="Đã Xác Định"
                        icon="🔵"
                        count={summary?.lanes?.resolved || 0}
                        active={activeTab === 'resolved'}
                        onClick={() => setActiveTab('resolved')}
                    />
                    <Tab
                        id="partial"
                        label="Tiềm Năng"
                        icon="🟡"
                        count={summary?.lanes?.partial || 0}
                        active={activeTab === 'partial'}
                        onClick={() => setActiveTab('partial')}
                    />
                    <Tab
                        id="anonymous"
                        label="Ẩn Danh"
                        icon="⚪"
                        count={summary?.lanes?.anonymous || 0}
                        active={activeTab === 'anonymous'}
                        onClick={() => setActiveTab('anonymous')}
                    />
                    <Tab
                        id="competitor"
                        label="Đối Thủ"
                        icon="🔴"
                        count={summary?.lanes?.competitor || 0}
                        active={activeTab === 'competitor'}
                        onClick={() => setActiveTab('competitor')}
                    />
                </div>
            </header>

            <main className={`sis-content-view tab-${activeTab}-view`}>
                <div className="signal-grid">
                    {activeSignals.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-state-icon">🔎</span>
                            <div className="empty-state-text">Chưa có tín hiệu trong danh mục này</div>
                        </div>
                    ) : (
                        activeSignals.map(s => <SignalCard key={s.id} signal={s} />)
                    )}
                </div>
            </main>
        </div>
    )
}

function Tab({ label, icon, count, active, onClick, id }: { label: string; icon: string; count: number; active: boolean; onClick: () => void; id: string }) {
    return (
        <div className={`ux-tab ${active ? 'active' : ''} tab-${id}`} onClick={onClick}>
            <span>{icon} {label}</span>
            <span className="tab-count">{count}</span>
        </div>
    )
}

function SignalCard({ signal }: { signal: SISSignal }) {
    const cls = signal.classification
    const card = signal.leadCard

    return (
        <div className={`signal-card ${card ? 'has-strategy' : ''}`}>
            <div className="card-accent" />

            <div className="author-header">
                <div className="author-primary">
                    <span className="author-name">{signal.author_name}</span>
                    <span className="platform-badge">{signal.platform}</span>
                </div>
                {card && <div className="brain-indicator" title="AI Strategy Ready">🧠</div>}
            </div>

            <p className="signal-text">
                {card?.strategic_summary || cls?.reason_summary || signal.content || 'Không có nội dung tín hiệu.'}
            </p>

            {cls && (
                <div className="metrics-container">
                    <MetricItem label="Người bán" val={cls.seller_likelihood} />
                    <MetricItem label="Nỗi đau" val={cls.pain_score} />
                    <MetricItem label="Ý định" val={cls.intent_score} />
                </div>
            )}

            <div className="card-footer">
                <div className="prio-tag">
                    {card ? (
                        <>
                            <span className="pulse" />
                            Ưu tiên {card.sales_priority_score}
                        </>
                    ) : (
                        <span style={{ color: 'var(--text-muted)' }}>Confidence: {cls?.confidence || 'thấp'}</span>
                    )}
                </div>
                {signal.post_url && (
                    <a href={signal.post_url} target="_blank" rel="noreferrer" className="action-btn">
                        Xem chi tiết
                    </a>
                )}
            </div>
        </div>
    )
}

function MetricItem({ label, val }: { label: string; val: number }) {
    const color = val > 75 ? '#10b981' : val > 40 ? '#f59e0b' : '#6b7280'
    return (
        <div className="metric-item">
            <span className="m-label">{label}</span>
            <div className="m-progress">
                <div className="m-fill" style={{ width: `${val}%`, backgroundColor: color }} />
            </div>
            <span className="m-value" style={{ color }}>{val}%</span>
        </div>
    )
}
