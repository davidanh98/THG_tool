import { useState } from 'react'
import type { SISSignal } from '../../types/sis'
import { useSISStore } from '../../store/sisStore'
import ScoreBadge from '../ui/ScoreBadge'

interface ClosingRoomProps {
    signal: SISSignal
    onClose: () => void
}

const TEMPLATES: Record<string, Record<string, string>> = {
    quote: {
        friendly: 'Dạ chào bạn! Bên em hiện đang có dịch vụ phù hợp nè. Bạn có thể inbox em để được tư vấn chi tiết và báo giá tốt nhất nhé! 🎉',
        professional: 'Xin chào! THG Fulfillment cung cấp dịch vụ fulfillment/express/warehouse toàn diện. Liên hệ để nhận báo giá ạ.',
        concise: 'THG cung cấp Fulfill/Express/WH. Inbox để báo giá!',
    },
    fulfill: {
        friendly: 'Hello bạn! Bên em có kho tại VN, US, EU. Pick-pack-ship tự động, track real-time! Inbox em nghe tư vấn nhé 🚀',
        professional: 'THG Fulfill: Kho VN/US/EU, pick-pack-ship tự động. Inbox để tư vấn!',
        concise: 'THG Fulfill: Kho VN/US/EU, pick-pack-ship tự động. Inbox!',
    },
}

const STAFF = ['AI Copilot', 'Trang', 'Hậu', 'Vinh', 'David']

function timeAgo(dateStr: string): string {
    if (!dateStr) return ''
    const dt = new Date(dateStr.endsWith('Z') ? dateStr : dateStr + 'Z')
    const diffMs = Date.now() - dt.getTime()
    if (isNaN(diffMs)) return ''
    const mins = Math.floor(diffMs / 60000)
    if (mins < 60) return `⏱️ ${mins} phút trước`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `⏱️ ${hours} giờ trước`
    return `📅 ${Math.floor(hours / 24)} ngày trước`
}

export default function ClosingRoom({ signal, onClose }: ClosingRoomProps) {
    const { deleteSignal, activeTab: currentModeTab } = useSISStore()
    const [activeTab, setActiveTab] = useState<'outreach' | 'response' | 'notes' | 'agent'>('outreach')

    // Safety destructure
    const cls = signal.classification || {} as any
    const card = signal.leadCard || {} as any

    const [response, setResponse] = useState(card.suggested_opener || '')
    const [notes, setNotes] = useState('')
    const [feedbackText, setFeedbackText] = useState('')
    const [tone, setTone] = useState<'friendly' | 'professional' | 'concise'>('friendly')
    const [showDealModal, setShowDealModal] = useState(false)

    // ── Outreach state ──
    const [outreachMsg, setOutreachMsg] = useState(card.suggested_opener || '')
    const [outreachTone, setOutreachTone] = useState<'friendly' | 'professional' | 'urgent'>('friendly')
    const [outreachType, setOutreachType] = useState<'dm' | 'comment'>('dm')
    const [outreachStaff, setOutreachStaff] = useState(STAFF[0])
    const [outreachLoading] = useState(false)
    const [outreachHistory] = useState<any[]>([])
    const [copySuccess, setCopySuccess] = useState(false)
    const [pipelineStage, setPipelineStage] = useState('new')

    const claimedArr: string[] = [] // Stubbed for now
    const postDate = signal.created_at || new Date().toISOString()
    const score = card.sales_priority_score || cls.seller_likelihood || 0
    const hotColor = score >= 80 ? 'var(--hot)' : score >= 60 ? 'var(--warm)' : 'var(--cold)'

    // ── Outreach handlers (Stubbed for v2) ──
    const handleGenerateOutreach = async () => {
        alert('Tính năng Outreach tự động qua API cũ tạm tắt trong bản cập nhật SIS v2. Vui lòng dùng tin nhắn Copilot Draft.')
    }

    const handleCopyOutreach = () => {
        navigator.clipboard.writeText(outreachMsg || '')
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 2000)
    }

    const handleMarkSent = async () => {
        setPipelineStage('contacted')
        alert('Đã ghi nhận Pipeline: Contacted (Chạy offline mode)')
    }

    const handleOpenProfile = () => {
        if (signal.author_url) window.open(signal.author_url, '_blank')
    }

    const handleOpenPost = () => {
        if (signal.post_url) window.open(signal.post_url, '_blank')
    }

    const handleClaim = async (_name: string) => {
        alert('Claim account tạm tắt cho v2. Đang chờ Data Model mới.')
    }

    const handleStatus = async (status: string) => {
        setPipelineStage(status)
    }

    const handleDelete = async () => {
        if (confirm('Xóa lead này vĩnh viễn khỏi SIS v2?')) {
            deleteSignal(currentModeTab, signal.id)
            onClose()
        }
    }

    const fillTemplate = (caseType: string) => {
        const tmpl = TEMPLATES[caseType]
        if (tmpl?.[tone]) setResponse(tmpl[tone])
    }

    const handleSaveResponse = async () => { }
    const handleSaveNotes = async () => { }
    const handleFeedback = async (_type: string, _correctRole?: string, _note?: string) => { }

    // Clean content for display
    let rawContent = signal.content || '—'
    if (signal.platform === 'facebook') {
        rawContent = rawContent.replace(/(Facebook\n)+/gi, '')
        const stops = ['Like\nComment', 'Thích\nBình luận', 'Tất cả cảm xúc:', 'All reactions:']
        for (const s of stops) {
            const idx = rawContent.indexOf(s)
            if (idx !== -1) rawContent = rawContent.substring(0, idx)
        }
    }

    const PIPELINE_STAGES = [
        { key: 'new', label: '🆕 New', color: '#6b7280' },
        { key: 'contacted', label: '📞 Contacted', color: '#3b82f6' },
        { key: 'interested', label: '🔥 Interested', color: '#f59e0b' },
        { key: 'negotiating', label: '🤝 Negotiating', color: '#8b5cf6' },
        { key: 'won', label: '🏆 Won', color: '#10b981' },
        { key: 'lost', label: '❌ Lost', color: '#ef4444' },
    ]

    return (
        <div className="closing-room-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-main)', zIndex: 9999, overflowY: 'auto', padding: 'var(--space-xl)' }}>
            <div style={{ maxWidth: 1400, margin: '0 auto' }}>
                {/* Top bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-xl)' }}>
                    <button className="btn btn-secondary btn-sm" onClick={onClose}>← Quay lại</button>
                    <span style={{ color: 'var(--text-muted)' }}>Leads</span>
                    <span style={{ color: 'var(--text-muted)' }}>›</span>
                    <span style={{ fontWeight: 600 }}>{signal.author_name || 'Khách hàng'}</span>
                    <span style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--accent)' }}>🎯 The Closing Room</span>
                </div>

                {/* Pipeline Stage Bar */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-lg)', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)' }}>
                    {PIPELINE_STAGES.map(s => (
                        <button
                            key={s.key}
                            onClick={() => setPipelineStage(s.key)}
                            style={{
                                flex: 1,
                                padding: '6px 4px',
                                fontSize: 'var(--text-xs)',
                                fontWeight: pipelineStage === s.key ? 700 : 400,
                                color: pipelineStage === s.key ? '#fff' : 'var(--text-secondary)',
                                background: pipelineStage === s.key ? s.color : 'transparent',
                                border: `1px solid ${pipelineStage === s.key ? s.color : 'var(--border)'}`,
                                borderRadius: 6,
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>

                <div className="closing-room-grid">
                    {/* LEFT: Lead info */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                        {/* Author card */}
                        <div className="card">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)', marginBottom: 'var(--space-md)' }}>
                                <div style={{ fontSize: '2rem' }}>👤</div>
                                <div>
                                    <div style={{ fontWeight: 700 }}>
                                        {signal.author_url ? (
                                            <a href={signal.author_url} target="_blank" rel="noopener noreferrer">{signal.author_name}</a>
                                        ) : signal.author_name}
                                    </div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', display: 'flex', gap: 'var(--space-sm)', alignItems: 'center' }}>
                                        <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>📘 {signal.platform}</span>
                                        <span>·</span>
                                        <span>{timeAgo(postDate)}</span>
                                    </div>
                                </div>
                                {/* Quick profile/post links */}
                                <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                                    {signal.author_url && (
                                        <button className="btn btn-secondary btn-sm" onClick={handleOpenProfile} title="Mở profile Facebook">
                                            👤 Profile
                                        </button>
                                    )}
                                    {signal.post_url && (
                                        <button className="btn btn-secondary btn-sm" onClick={handleOpenPost} title="Mở bài post gốc">
                                            📄 Post
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                <span className="status-tag" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6' }}>{pipelineStage.toUpperCase()}</span>
                                {/* Display Pain Tags */}
                                {cls.pain_tags && Array.isArray(cls.pain_tags) ? cls.pain_tags.map((tag: string, i: number) => (
                                    <span key={i} className="status-tag" style={{ background: 'var(--bg-secondary)', color: 'var(--warning)', borderColor: 'var(--warning)' }}>
                                        {tag}
                                    </span>
                                )) : null}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="card">
                            <div className="card-title">📄 Nội dung gốc</div>
                            <div style={{ whiteSpace: 'pre-wrap', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', maxHeight: 200, overflow: 'auto' }}>
                                {rawContent.trim()}
                            </div>
                        </div>

                        {/* AI Analysis */}
                        {(cls.reason_summary || card.strategic_summary || card.suggested_opener) && (
                            <div className="card" style={{ border: card.suggested_opener ? '1px solid var(--accent)' : undefined }}>
                                <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>🧠 AI Analysis (SIS v2)</span>
                                    {card.suggested_opener && <span style={{ fontSize: '0.6rem', background: 'var(--accent)', color: '#fff', padding: '2px 6px', borderRadius: 4 }}>COPILOT READY</span>}
                                </div>
                                {card.suggested_opener && (
                                    <div style={{ marginBottom: 'var(--space-md)', background: 'rgba(99, 102, 241, 0.05)', padding: '10px', borderRadius: '8px', border: '1px dashed var(--accent)' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--accent)', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
                                            🚀 BẢN NHÁP SALES (SUGGESTED OPENER)
                                        </div>
                                        <div style={{ fontSize: 'var(--text-sm)', whiteSpace: 'pre-wrap', color: 'var(--text-primary)', lineHeight: 1.5 }}>
                                            {card.suggested_opener}
                                        </div>
                                    </div>
                                )}
                                {cls.reason_summary && (
                                    <div style={{ marginBottom: 'var(--space-md)' }}>
                                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>💡 Tóm tắt Signal</div>
                                        <div style={{ fontSize: 'var(--text-sm)' }}>{cls.reason_summary}</div>
                                    </div>
                                )}
                                {card.strategic_summary && (
                                    <div>
                                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 4 }}>🔍 Cơ hội cốt lõi & Hành động</div>
                                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--accent)' }}>
                                            {card.strategic_summary}<br /><br />
                                            <strong>Next action:</strong> {card.next_best_action}<br />
                                            <strong>Objection prevention:</strong> {card.objection_prevention}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}



                        {/* Tabs: Outreach / Response / Notes / Agent */}
                        <div className="card">
                            <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-lg)' }}>
                                {(['outreach', 'response', 'notes', 'agent'] as const).map((tab) => (
                                    <button
                                        key={tab}
                                        className={`btn btn-sm ${activeTab === tab ? 'btn-primary' : 'btn-secondary'}`}
                                        onClick={() => setActiveTab(tab)}
                                    >
                                        {tab === 'outreach' ? '🤖 AI Outreach' : tab === 'response' ? '💬 Response' : tab === 'notes' ? '📝 Notes' : '🧠 Agent'}
                                    </button>
                                ))}
                            </div>

                            {/* ─── AI OUTREACH TAB ─── */}
                            {activeTab === 'outreach' && (
                                <div>
                                    {/* Controls row */}
                                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 'var(--space-md)', alignItems: 'center' }}>
                                        {/* Staff select */}
                                        <select
                                            value={outreachStaff}
                                            onChange={e => setOutreachStaff(e.target.value)}
                                            style={{ height: 32, borderRadius: 6, border: '1px solid var(--border)', padding: '0 8px', fontSize: 'var(--text-xs)' }}
                                        >
                                            {STAFF.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>

                                        {/* Type toggle */}
                                        <div style={{ display: 'flex', gap: 2, background: 'var(--bg-secondary)', borderRadius: 6, padding: 2 }}>
                                            <button
                                                className={`btn btn-sm ${outreachType === 'dm' ? 'btn-primary' : ''}`}
                                                onClick={() => setOutreachType('dm')}
                                                style={{ fontSize: 'var(--text-xs)' }}
                                            >
                                                💬 DM
                                            </button>
                                            <button
                                                className={`btn btn-sm ${outreachType === 'comment' ? 'btn-primary' : ''}`}
                                                onClick={() => setOutreachType('comment')}
                                                style={{ fontSize: 'var(--text-xs)' }}
                                            >
                                                💭 Comment
                                            </button>
                                        </div>

                                        {/* Tone selector */}
                                        <div style={{ display: 'flex', gap: 2, marginLeft: 'auto' }}>
                                            {([
                                                { key: 'friendly', icon: '🤝', label: 'Thân thiện' },
                                                { key: 'professional', icon: '👔', label: 'Chuyên nghiệp' },
                                                { key: 'urgent', icon: '⚡', label: 'Gấp' },
                                            ] as const).map(t => (
                                                <button
                                                    key={t.key}
                                                    className={`btn btn-sm ${outreachTone === t.key ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setOutreachTone(t.key)}
                                                    title={t.label}
                                                >
                                                    {t.icon}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Generate button */}
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleGenerateOutreach}
                                        disabled={outreachLoading}
                                        style={{
                                            width: '100%',
                                            marginBottom: 'var(--space-md)',
                                            padding: '10px',
                                            fontSize: 'var(--text-sm)',
                                            fontWeight: 700,
                                            background: outreachLoading ? 'var(--text-muted)' : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                        }}
                                    >
                                        {outreachLoading ? '⏳ AI đang viết...' : `🤖 AI Viết ${outreachType === 'dm' ? 'tin nhắn DM' : 'comment reply'}`}
                                    </button>

                                    {/* Message preview */}
                                    {outreachMsg && (
                                        <>
                                            <textarea
                                                rows={5}
                                                value={outreachMsg}
                                                onChange={e => setOutreachMsg(e.target.value)}
                                                style={{
                                                    width: '100%',
                                                    marginBottom: 'var(--space-sm)',
                                                    border: '2px solid var(--accent)',
                                                    borderRadius: 8,
                                                    padding: 12,
                                                    fontSize: 'var(--text-sm)',
                                                }}
                                            />
                                            {/* Action buttons */}
                                            <div style={{ display: 'flex', gap: 'var(--space-sm)', flexWrap: 'wrap' }}>
                                                <button
                                                    className="btn btn-primary btn-sm"
                                                    onClick={handleCopyOutreach}
                                                    style={{
                                                        background: copySuccess ? 'var(--success)' : undefined,
                                                        transition: 'background 0.3s',
                                                    }}
                                                >
                                                    {copySuccess ? '✅ Đã copy!' : '📋 Copy tin nhắn'}
                                                </button>
                                                {signal.author_url && (
                                                    <button className="btn btn-secondary btn-sm" onClick={() => { handleCopyOutreach(); handleOpenProfile() }}>
                                                        📤 Copy & Mở Profile
                                                    </button>
                                                )}
                                                {signal.post_url && outreachType === 'comment' && (
                                                    <button className="btn btn-secondary btn-sm" onClick={() => { handleCopyOutreach(); handleOpenPost() }}>
                                                        💭 Copy & Mở Post
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-sm"
                                                    onClick={handleMarkSent}
                                                    style={{ marginLeft: 'auto', background: 'var(--success)', color: '#fff', fontWeight: 600 }}
                                                >
                                                    ✅ Đánh dấu đã gửi
                                                </button>
                                            </div>
                                        </>
                                    )}

                                    {/* Outreach History */}
                                    {outreachHistory.length > 0 && (
                                        <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
                                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                                                📋 Lịch sử outreach ({outreachHistory.length})
                                            </div>
                                            {outreachHistory.slice(0, 5).map((h: any) => (
                                                <div key={h.id} style={{
                                                    fontSize: 'var(--text-xs)',
                                                    padding: '8px',
                                                    marginBottom: 4,
                                                    background: 'var(--bg-secondary)',
                                                    borderRadius: 6,
                                                    borderLeft: `3px solid ${h.status === 'sent' ? 'var(--success)' : h.status === 'replied' ? 'var(--accent)' : 'var(--text-muted)'}`,
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                                        <span style={{ fontWeight: 600 }}>{h.staff_name} · {h.channel}</span>
                                                        <span style={{ color: 'var(--text-muted)' }}>{timeAgo(h.created_at)}</span>
                                                    </div>
                                                    <div style={{ color: 'var(--text-secondary)' }}>{h.message?.substring(0, 100)}...</div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* ─── RESPONSE TAB (original) ─── */}
                            {activeTab === 'response' && (
                                <div>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                                        <button className="btn btn-secondary btn-sm" onClick={() => fillTemplate('quote')}>📋 Báo giá</button>
                                        <button className="btn btn-secondary btn-sm" onClick={() => fillTemplate('fulfill')}>🏭 Kho/FF</button>
                                        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                                            {(['friendly', 'professional', 'concise'] as const).map(t => (
                                                <button
                                                    key={t}
                                                    className={`btn btn-sm ${tone === t ? 'btn-primary' : 'btn-secondary'}`}
                                                    onClick={() => setTone(t)}
                                                >
                                                    {t === 'friendly' ? '🤝' : t === 'professional' ? '👔' : '⚡'}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <textarea
                                        rows={4}
                                        value={response}
                                        onChange={(e) => setResponse(e.target.value)}
                                        style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
                                    />
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                                        <button className="btn btn-secondary btn-sm" onClick={() => navigator.clipboard.writeText(response)}>📋 Copy</button>
                                        <button className="btn btn-secondary btn-sm" onClick={handleSaveResponse}>💾 Save</button>
                                    </div>
                                </div>
                            )}

                            {/* ─── NOTES TAB ─── */}
                            {activeTab === 'notes' && (
                                <div>
                                    <textarea
                                        rows={4}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Ghi chú: giá đã báo, deal progress, follow-up date..."
                                        style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
                                    />
                                    <button className="btn btn-secondary btn-sm" onClick={handleSaveNotes}>💾 Lưu ghi chú</button>
                                </div>
                            )}

                            {/* ─── AGENT TAB ─── */}
                            {activeTab === 'agent' && (
                                <div>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 'var(--space-sm)' }}>
                                        <button className="btn btn-secondary btn-sm" onClick={() => handleFeedback('correct', undefined, '✅ Đúng')}>✅ Đúng</button>
                                        <button className="btn btn-secondary btn-sm" onClick={() => handleFeedback('wrong', 'provider', '❌ Sai → Provider')}>❌ Sai→Provider</button>
                                    </div>
                                    <textarea
                                        rows={3}
                                        value={feedbackText}
                                        onChange={(e) => setFeedbackText(e.target.value)}
                                        placeholder="Ghi chú thêm cho Agent..."
                                        style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
                                    />
                                    <button className="btn btn-primary btn-sm" onClick={() => handleFeedback('text_feedback')}>📤 Gửi feedback</button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT: Action panel */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-lg)' }}>
                        {/* Score */}
                        <div className="card" style={{ textAlign: 'center' }}>
                            <ScoreBadge score={score} />
                            <div style={{ marginTop: 'var(--space-sm)' }}>
                                <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                                    <div style={{ height: '100%', width: `${score}%`, background: hotColor, borderRadius: 3, transition: 'width 0.3s' }} />
                                </div>
                                <div style={{ fontSize: 'var(--text-xs)', color: hotColor, marginTop: 4, fontWeight: 600 }}>Lead Score</div>
                            </div>
                            {cls.pain_score > 0 && <div style={{ fontSize: 'var(--text-xs)', marginTop: 8, color: 'var(--warning)' }}>⚡ Pain: {cls.pain_score}</div>}
                        </div>

                        {/* Quick Actions */}
                        <div className="card">
                            <div className="card-title">⚡ Quick Actions</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                <button className={`btn btn-sm ${pipelineStage === 'contacted' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handleStatus('contacted')}>📞 Contacted</button>
                                <button className={`btn btn-sm ${pipelineStage === 'converted' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => handleStatus('won')}>✅ Converted</button>
                                <button className={`btn btn-sm ${pipelineStage === 'ignored' ? 'btn-danger' : 'btn-secondary'}`} onClick={() => handleStatus('lost')}>⛔ Lost / Ignore</button>
                                <button className="btn btn-sm btn-danger" onClick={handleDelete}>🗑️ Delete</button>
                            </div>
                        </div>

                        {/* Deal */}
                        <div className="card">
                            <div className="card-title">🏆 Deal</div>
                            <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowDealModal(true)}>
                                🏆 BÁO CÁO CHỐT ĐƠN
                            </button>
                        </div>

                        {/* Staff */}
                        <div className="card">
                            <div className="card-title">👥 Phân công Sale</div>
                            <div className="staff-pills">
                                {STAFF.map((name) => {
                                    const isActive = claimedArr.includes(name)
                                    return (
                                        <button
                                            key={name}
                                            className={`staff-pill ${isActive ? 'staff-pill--active' : ''}`}
                                            onClick={() => handleClaim(name)}
                                        >
                                            {name}{isActive ? ' ✓' : ''}
                                        </button>
                                    )
                                })}
                            </div>
                            {claimedArr.length > 0 && (
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)', marginTop: 8 }}>
                                    Đang xử lý: <strong>{claimedArr.join(', ')}</strong>
                                </div>
                            )}
                        </div>

                        {/* Lead Info */}
                        <div className="card">
                            <div className="card-title">📋 Signal Info (SIS)</div>
                            <div style={{ fontSize: 'var(--text-xs)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>ID</span><span>#{signal.id}</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Platform</span><span>{signal.platform}</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Urgency</span><span>{cls.contactability_score > 70 ? 'High' : 'Normal'}</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Time</span><span>{timeAgo(postDate)}</span></div>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>Pipeline</span><span style={{ fontWeight: 600 }}>{pipelineStage.toUpperCase()}</span></div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Deal Modal */}
                {showDealModal && (
                    <DealModal leadId={signal.id} onClose={() => setShowDealModal(false)} onDone={() => {
                        handleStatus('won')
                        setShowDealModal(false)
                    }} />
                )}
            </div>
        </div>
    )
}

function DealModal({ leadId, onClose, onDone }: { leadId: number; onClose: () => void; onDone: (staff: string, value: number) => void }) {
    const [staff, setStaff] = useState('')
    const [value, setValue] = useState(0)

    const handleSubmit = async () => {
        if (!staff) return
        alert(`Tính năng report Deal lên cloud đang chờ Backend v2 Update. ID: ${leadId}`)
        onDone(staff, value)
    }

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={onClose}>
            <div className="card" style={{ maxWidth: 400, width: '90%' }} onClick={e => e.stopPropagation()}>
                <div className="card-title">🏆 Chốt đơn</div>
                <select value={staff} onChange={e => setStaff(e.target.value)} style={{ width: '100%', marginBottom: 'var(--space-md)', height: 40 }}>
                    <option value="">Chọn Sale...</option>
                    {STAFF.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
                <input type="number" placeholder="Giá trị deal ($)" value={value || ''} onChange={e => setValue(Number(e.target.value))} style={{ width: '100%', marginBottom: 'var(--space-lg)', height: 40 }} />
                <div style={{ display: 'flex', gap: 'var(--space-sm)', justifyContent: 'flex-end' }}>
                    <button className="btn btn-secondary" onClick={onClose}>Hủy</button>
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={!staff}>🏆 Chốt!</button>
                </div>
            </div>
        </div>
    )
}
