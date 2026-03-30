import { useState, useEffect } from 'react'
import type { SISSignal } from '../../types/sis'
import { useSISStore } from '../../store/sisStore'
import { apiGet, apiPost } from '../../api/client'
import ScoreBadge from '../ui/ScoreBadge'

interface SalesAction {
    id: number;
    raw_post_id: number;
    action_type: string;
    action_data: string;
    staff_name: string | null;
    created_at: string;
}

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

const STAFF = ['Hạnh', 'Lê Huyền', 'Moon', 'Thư', 'Trang', 'Ngọc Huyền', 'Min', "Đức Anh's Agent"]

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
    const [notes, setNotes] = useState(signal.sales_notes ?? '')
    const [notesSaving, setNotesSaving] = useState(false)
    const [feedbackText, setFeedbackText] = useState('')
    const [tone, setTone] = useState<'friendly' | 'professional' | 'concise'>('friendly')
    const [showDealModal, setShowDealModal] = useState(false)
    const [dealModal, setDealModal] = useState(false)
    const [dealValue, setDealValue] = useState('')
    const [actionHistory, setActionHistory] = useState<SalesAction[]>([])
    const [savingStage, setSavingStage] = useState(false)

    // ── Outreach state ──
    const [outreachMsg, setOutreachMsg] = useState(card.suggested_opener || '')
    const [outreachTone, setOutreachTone] = useState<'friendly' | 'professional' | 'urgent'>('friendly')
    const [outreachType, setOutreachType] = useState<'dm' | 'comment'>('dm')
    const [outreachStaff, setOutreachStaff] = useState(STAFF[0])
    const [outreachLoading] = useState(false)
    const [copySuccess, setCopySuccess] = useState(false)
    const [pipelineStage, setPipelineStage] = useState(signal.pipeline_stage || 'new')
    const [assignedTo, setAssignedTo] = useState(signal.assigned_to || '')

    const claimedArr: string[] = assignedTo ? [assignedTo] : []

    // Load action history on mount
    useEffect(() => {
        apiGet<SalesAction[]>(`/api/sis/signals/${signal.id}/actions`)
            .then(res => setActionHistory(res || []))
            .catch(() => { })
    }, [signal.id])
    const postDate = signal.created_at || new Date().toISOString()
    const score = card.sales_priority_score || cls.seller_likelihood || 0
    const hotColor = score >= 80 ? 'var(--hot)' : score >= 60 ? 'var(--warm)' : 'var(--cold)'

    const postAction = async (action_type: string, action_data: object, staff?: string) => {
        try {
            await apiPost(`/api/sis/signals/${signal.id}/action`, { action_type, action_data, staff_name: staff || null })
            const updated = await apiGet<SalesAction[]>(`/api/sis/signals/${signal.id}/actions`)
            setActionHistory(updated || [])
        } catch (e) {
            console.error('Action failed:', e)
        }
    }

    const postKpi = async (actionType: string, staff: string, dealValue?: number, note?: string) => {
        try {
            await apiPost(`/api/sis/signals/${signal.id}/kpi`, {
                action_type: actionType,
                staff_name: staff,
                deal_value: dealValue || 0,
                note: note || ''
            });
        } catch (e) {
            console.error('KPI log failed:', e);
        }
    };

    const handleGenerateOutreach = async () => {
        alert('Tính năng Outreach tự động đang phát triển. Vui lòng dùng Copilot Draft bên dưới.')
    }

    const handleCopyOutreach = () => {
        navigator.clipboard.writeText(outreachMsg || '')
        setCopySuccess(true)
        setTimeout(() => setCopySuccess(false), 2000)
        // Auto-log KPI: opener copied (1 pt, instant)
        if (outreachStaff) postKpi('opener_copied', outreachStaff, 0, 'Copied AI opener');
    }

    const handleMarkSent = async () => {
        setSavingStage(true)
        setPipelineStage('contacted')
        await postAction('stage_change', { stage: 'contacted' }, outreachStaff)
        if (outreachStaff) await postKpi('contacted', outreachStaff, 0, `Contacted via ${outreachType}`);
        setSavingStage(false)
    }

    const handleOpenProfile = () => {
        if (signal.author_url) window.open(signal.author_url, '_blank')
    }

    const handleOpenPost = () => {
        if (signal.post_url) window.open(signal.post_url, '_blank')
    }

    const handleClaim = async (name: string) => {
        setAssignedTo(name)
        await postAction('assign', { assigned_to: name }, name)
    }

    const handleStatus = async (status: string) => {
        if (status === 'won') {
            setDealModal(true);
            return; // Don't process yet, wait for modal
        }
        setSavingStage(true)
        setPipelineStage(status)
        await postAction('stage_change', { stage: status }, outreachStaff || undefined)
        if (status === 'interested' && outreachStaff) {
            await postKpi('interested', outreachStaff, 0, 'Marked as interested');
        }
        setSavingStage(false)
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

    const handleSaveResponse = async () => {
        await postAction('note', { notes: response, note_type: 'response_draft' }, outreachStaff || undefined)
    }

    const handleSaveNotes = async () => {
        setNotesSaving(true)
        await postAction('note', { notes, note_type: 'sales_note' }, outreachStaff || undefined)
        setNotesSaving(false)
    }

    const handleFeedback = async (type: string, correctRole?: string, note?: string) => {
        const text = note || feedbackText
        await apiPost('/api/sis/feedback', {
            raw_post_id: signal.id,
            is_correct: type === 'correct' ? 1 : 0,
            corrected_lane: correctRole || null,
            feedback_text: text
        })
        await postAction('feedback', { type, corrected_lane: correctRole, note: text })
        setFeedbackText('')
        alert('Feedback đã được ghi nhận. Cảm ơn!')
    }

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
        <div className="closing-room-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'var(--bg-primary)', zIndex: 9999, overflowY: 'auto', padding: 'var(--space-xl)' }}>
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
                <div style={{ display: 'flex', gap: 4, marginBottom: 'var(--space-lg)', padding: '8px 12px', background: 'var(--bg-card)', borderRadius: 8, border: '1px solid var(--border)', opacity: savingStage ? 0.6 : 1, pointerEvents: savingStage ? 'none' : 'auto' }}>
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

                                    {/* Outreach History từ actionHistory */}
                                    {actionHistory.filter(a => a.action_type === 'stage_change').length > 0 && (
                                        <div style={{ marginTop: 'var(--space-lg)', borderTop: '1px solid var(--border)', paddingTop: 'var(--space-md)' }}>
                                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                                                📋 Lịch sử pipeline
                                            </div>
                                            {actionHistory.filter(a => a.action_type === 'stage_change').map(h => {
                                                const data = (() => { try { return JSON.parse(h.action_data) } catch { return {} } })()
                                                return (
                                                    <div key={h.id} style={{ fontSize: 'var(--text-xs)', padding: '6px 8px', marginBottom: 4, background: 'var(--bg-secondary)', borderRadius: 6, display: 'flex', justifyContent: 'space-between' }}>
                                                        <span>🔄 Stage → <strong>{data.stage || '?'}</strong>{h.staff_name ? ` · ${h.staff_name}` : ''}</span>
                                                        <span style={{ color: 'var(--text-muted)' }}>{timeAgo(h.created_at)}</span>
                                                    </div>
                                                )
                                            })}
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
                                        rows={5}
                                        value={notes}
                                        onChange={(e) => setNotes(e.target.value)}
                                        placeholder="Ghi chú: giá đã báo, deal progress, follow-up date..."
                                        style={{ width: '100%', marginBottom: 'var(--space-sm)' }}
                                    />
                                    <div style={{ display: 'flex', gap: 'var(--space-sm)', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
                                        <button className="btn btn-primary btn-sm" onClick={handleSaveNotes} disabled={notesSaving}>
                                            {notesSaving ? '⏳ Đang lưu...' : '💾 Lưu ghi chú'}
                                        </button>
                                    </div>
                                    {/* Action Timeline */}
                                    {actionHistory.length > 0 && (
                                        <div>
                                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                                                📋 Lịch sử hành động ({actionHistory.length})
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                                {actionHistory.slice().reverse().map(a => {
                                                    const data = (() => { try { return JSON.parse(a.action_data) } catch { return {} } })()
                                                    const iconMap: Record<string, string> = { stage_change: '🔄', note: '📝', assign: '👤', deal_closed: '🏆', feedback: '💬', follow_up: '⏰' }
                                                    const icon = iconMap[a.action_type] || '•'
                                                    const labelMap: Record<string, string> = { stage_change: `Stage → ${data.stage || '?'}`, note: `Note saved`, assign: `Assigned to ${data.assigned_to || '?'}`, deal_closed: `Deal closed $${data.value || '?'}`, feedback: `Feedback: ${data.type || '?'}`, follow_up: 'Follow-up set' }
                                                    return (
                                                        <div key={a.id} style={{ display: 'flex', gap: 8, fontSize: 'var(--text-xs)', padding: '6px 8px', background: 'var(--bg-secondary)', borderRadius: 6 }}>
                                                            <span>{icon}</span>
                                                            <span style={{ flex: 1 }}>{labelMap[a.action_type] || a.action_type}</span>
                                                            {a.staff_name && <span style={{ color: 'var(--accent)' }}>{a.staff_name}</span>}
                                                            <span style={{ color: 'var(--text-muted)' }}>{timeAgo(a.created_at)}</span>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}
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

                {/* KPI Deal Close Modal */}
                {dealModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div className="card" style={{ width: 400, padding: '2rem' }}>
                            <h3 style={{ margin: '0 0 1rem 0' }}>🏆 Xác nhận chốt deal</h3>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginBottom: '1rem' }}>
                                Nhập giá trị deal (USD). Deal sẽ được chờ duyệt trong 24h trước khi tính điểm.
                            </p>
                            <input
                                type="number"
                                value={dealValue}
                                onChange={e => setDealValue(e.target.value)}
                                placeholder="VD: 500"
                                style={{ width: '100%', padding: '0.75rem', background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: '6px', marginBottom: '1rem', fontSize: '1rem' }}
                            />
                            <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
                                <button className="btn btn-secondary" onClick={() => setDealModal(false)}>Hủy</button>
                                <button
                                    className="btn btn-primary"
                                    disabled={!dealValue || parseFloat(dealValue) <= 0}
                                    onClick={async () => {
                                        setDealModal(false);
                                        setSavingStage(true);
                                        setPipelineStage('won');
                                        await postAction('stage_change', { stage: 'won' }, outreachStaff || undefined);
                                        if (outreachStaff) {
                                            const result = await apiPost<{ ok: boolean; data: { points: number; flagged: boolean; status: string; reason: string } }>(`/api/sis/signals/${signal.id}/kpi`, {
                                                action_type: 'deal_closed',
                                                staff_name: outreachStaff,
                                                deal_value: parseFloat(dealValue),
                                                note: `Deal $${dealValue} - ${signal.author_name}`
                                            });
                                            if (result?.ok && result.data) {
                                                const r = result.data;
                                                if (r.flagged) {
                                                    alert(`⚠️ Deal đã được ghi nhận nhưng BỊ GẮN CỜ để admin xét duyệt.\nLý do: ${r.reason || 'Suspicious activity'}`);
                                                } else if (r.status === 'pending') {
                                                    alert(`✅ Deal $${dealValue} ghi nhận thành công!\n⏳ Đang chờ admin duyệt (+${r.points} pts pending)`);
                                                } else {
                                                    alert(`🏆 Deal đã chốt! +${r.points} điểm`);
                                                }
                                            }
                                        }
                                        setDealValue('');
                                        setSavingStage(false);
                                    }}
                                >
                                    ✅ Xác nhận chốt deal
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* Deal Modal */}
                {showDealModal && (
                    <DealModal
                        leadId={signal.id}
                        onClose={() => setShowDealModal(false)}
                        onDone={async (staff, value) => {
                            await postAction('deal_closed', { value, staff_name: staff }, staff)
                            handleStatus('won')
                            setShowDealModal(false)
                        }}
                    />
                )}
            </div>
        </div>
    )
}

function DealModal({ leadId: _leadId, onClose, onDone }: { leadId: number; onClose: () => void; onDone: (staff: string, value: number) => Promise<void> }) {
    const [staff, setStaff] = useState('')
    const [value, setValue] = useState(0)
    const [submitting, setSubmitting] = useState(false)

    const handleSubmit = async () => {
        if (!staff) return
        setSubmitting(true)
        await onDone(staff, value)
        setSubmitting(false)
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
                    <button className="btn btn-primary" onClick={handleSubmit} disabled={!staff || submitting}>
                        {submitting ? '⏳ Đang lưu...' : '🏆 Chốt!'}
                    </button>
                </div>
            </div>
        </div>
    )
}
