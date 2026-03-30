import { useEffect, useState } from 'react'
import { useSISStore } from '../store/sisStore'
import type { SISSignal } from '../types/sis'
import ClosingRoom from '../components/lead/ClosingRoom'
import '../premium-row.css'

const SERVICE_FILTERS = [
    { id: 'all', label: 'Tất cả', icon: '📋' },
    { id: 'warehouse', label: 'Warehouse', icon: '🏭', staff: 'Hạnh' },
    { id: 'express', label: 'Express', icon: '⚡', staff: 'Lê Huyền' },
    { id: 'pod', label: 'POD', icon: '🖨️', staff: 'Moon' },
    { id: 'quote_needed', label: 'Báo giá', icon: '💰', staff: 'Thư' },
    { id: 'unknown', label: 'Chưa xác định', icon: '❓' },
]

export default function SISDashboard() {
    const { lanes, summary, activeTab, setActiveTab, loadLanes, loadSummary } = useSISStore()
    const [closingSignal, setClosingSignal] = useState<SISSignal | null>(null)
    const [serviceFilter, setServiceFilter] = useState<string>('all')

    useEffect(() => {
        loadLanes()
        loadSummary()
        const id = setInterval(() => { loadLanes(); loadSummary(); }, 30000)
        return () => clearInterval(id)
    }, [])

    const activeSignals = lanes[activeTab] || []
    const filteredSignals = serviceFilter === 'all'
        ? activeSignals
        : activeSignals.filter(s => (s as any).thg_service_needed === serviceFilter)

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
                </div>
            </header>

            <div style={{ display: 'flex', gap: '0.5rem', padding: '0.5rem 1rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }}>
                {SERVICE_FILTERS.map(f => (
                    <button
                        key={f.id}
                        onClick={() => setServiceFilter(f.id)}
                        style={{
                            padding: '4px 12px',
                            borderRadius: '20px',
                            border: '1px solid var(--border)',
                            background: serviceFilter === f.id ? 'var(--primary-color)' : 'var(--bg-elevated)',
                            color: serviceFilter === f.id ? 'white' : 'var(--text)',
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        {f.icon} {f.label} {'staff' in f ? <span style={{ opacity: 0.7, fontSize: '0.7rem' }}>({f.staff})</span> : ''}
                    </button>
                ))}
            </div>

            <main className={`sis-content-view tab-${activeTab}-view`}>
                <div className="signal-list-container">
                    {filteredSignals.length === 0 ? (
                        <div className="empty-state">
                            <span className="empty-state-icon">🔎</span>
                            <div className="empty-state-text">Chưa có tín hiệu trong danh mục này</div>
                        </div>
                    ) : (
                        filteredSignals.map(s => <SignalRow key={s.id} signal={s} onOpenClosingRoom={() => setClosingSignal(s)} />)
                    )}
                </div>
            </main>

            {closingSignal && (
                <ClosingRoom signal={closingSignal} onClose={() => setClosingSignal(null)} />
            )}
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

function SignalRow({ signal, onOpenClosingRoom }: { signal: SISSignal, onOpenClosingRoom: () => void }) {
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
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    <span className="platform-badge">{signal.platform}</span>
                    {signal.language === 'foreign' ? (
                        <span className="platform-badge" style={{ background: 'rgba(59, 130, 246, 0.15)', color: 'var(--info)' }}>FOREIGN</span>
                    ) : signal.language === 'vietnamese' || signal.language === 'vi' ? (
                        <span className="platform-badge" style={{ background: 'rgba(16, 185, 129, 0.15)', color: 'var(--success)' }}>VN</span>
                    ) : null}
                    {signal.thg_service_needed && signal.thg_service_needed !== 'unknown' && (
                        <span className="platform-badge" style={{ background: 'rgba(139, 92, 246, 0.15)', color: '#8b5cf6', fontSize: '0.7rem' }}>
                            {signal.thg_service_needed === 'warehouse' ? '🏭' : signal.thg_service_needed === 'express' ? '⚡' : signal.thg_service_needed === 'pod' ? '🖨️' : '💰'} {signal.thg_service_needed}
                        </span>
                    )}
                </div>
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
                    <a href={signal.post_url.startsWith('http') ? signal.post_url : `https://${signal.post_url}`} target="_blank" rel="noreferrer" className="action-btn" title="Xem bài post gốc">
                        📄 Post
                    </a>
                )}
                {card && (
                    <button
                        className="action-btn"
                        style={{ background: 'var(--accent)', color: '#fff', border: 'none', fontWeight: 600, padding: '6px 16px' }}
                        onClick={() => onOpenClosingRoom()}
                    >
                        🤝 P. Chốt Đơn
                    </button>
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
