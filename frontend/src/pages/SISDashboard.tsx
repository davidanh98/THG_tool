import { useEffect } from 'react'
import { useSISStore } from '../store/sisStore'
import type { SISSignal } from '../types/sis'
import '../premium-row.css'

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
                        <h1>THG data</h1>
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
                <div className="signal-list-container">
                    {activeSignals.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-state-icon">🔎</span>
                            <div className="empty-state-text">Chưa có tín hiệu trong danh mục này</div>
                        </div>
                    ) : (
                        activeSignals.map(s => <SignalRow key={s.id} signal={s} />)
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

function SignalRow({ signal }: { signal: SISSignal }) {
    const cls = signal.classification
    const card = signal.leadCard
    const { deleteSignal, activeTab } = useSISStore()

    const handleDelete = (e: React.MouseEvent) => {
        e.preventDefault()
        if (confirm('🗑️ Xóa vĩnh viễn lead này khỏi hệ thống? ⚡')) {
            deleteSignal(activeTab, signal.id)
        }
    }

    return (
        <div className={`signal-row ${card ? 'has-strategy' : ''}`}>
            {/* Left: Author */}
            <div className="row-author">
                <span className="author-name" title={signal.author_name}>{signal.author_name}</span>
                <span className="platform-badge">{signal.platform}</span>
            </div>

            {/* Middle: Content & Tags */}
            <div className="row-content">
                <p className="signal-text">{signal.strategic_summary || signal.reason_summary || 'Không có nội dung tín hiệu.'}</p>
                {cls && cls.pain_tags && cls.pain_tags.length > 0 && typeof cls.pain_tags === 'object' && (
                    <div className="row-tags">
                        {Array.isArray(cls.pain_tags) ? cls.pain_tags.map((t, i) => <span key={i} className="row-tag">{t}</span>) : null}
                    </div>
                )}
            </div>

            {/* Middle-Right: Metrics inline */}
            {cls && (
                <div className="row-metrics">
                    <MiniMetric label="Seller" val={cls.seller_likelihood} />
                    <MiniMetric label="Pain" val={cls.pain_score} />
                    <MiniMetric label="Intent" val={cls.intent_score} />
                </div>
            )}

            {/* Extra Info: Priority */}
            <div className="row-extra">
                {card ? (
                    <div className="prio-tag" title="Sales Priority Score">
                        <span className="pulse" /> Ưu tiên {card.sales_priority_score}
                    </div>
                ) : (
                    <div className="prio-tag" style={{ color: 'var(--text-muted)' }}>
                        Cfd: {cls?.confidence || 'thấp'}
                    </div>
                )}
                {card && <div className="brain-indicator" title="AI Strategy Ready" style={{ marginLeft: '8px' }}>🧠</div>}
            </div>

            {/* Actions */}
            <div className="row-actions">
                <button onClick={handleDelete} className="action-btn-danger" title="Xóa tín hiệu bị sai">🗑️ Xóa</button>
                {signal.post_url && (
                    <a href={signal.post_url} target="_blank" rel="noreferrer" className="action-btn" title="Xem chi tiết gốc">
                        Chi tiết
                    </a>
                )}
            </div>
        </div>
    )
}

function MiniMetric({ label, val }: { label: string; val: number }) {
    const color = val > 75 ? '#10b981' : val > 40 ? '#f59e0b' : '#6b7280'
    return (
        <div className="mini-metric">
            <span className="mini-label">{label} <span style={{ color }}>{val}%</span></span>
            <div className="mini-bar-bg">
                <div className="mini-bar-fill" style={{ width: `${val}%`, backgroundColor: color }} />
            </div>
        </div>
    )
}
