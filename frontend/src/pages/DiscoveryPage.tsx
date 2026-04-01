import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiPost, apiGet } from '../api/client'

interface AutomationPayload {
    dm: string;
    comment: string;
    linkedin: string;
    pain_signal?: string;
    estimated_volume?: string;
    ai_score?: number;
}

interface WebLead {
    rawPostId: number;
    name: string;
    source?: string;
    platform_found?: string;
    lane: string;
    service: string;
    ai_score: number;
    pain_signal: string;
    automation_payload: AutomationPayload | null;
}

interface FbHintTactic {
    rawPostId: number;
    tactic_type: string;
    target_group: string;
    group_id: string;
    group_url: string;
    content: string;
    use_case: string;
    expected_signal: string;
    priority: 'high' | 'medium' | 'low';
    opener_script: { inbox?: string; comment?: string };
    pain_addressed: string;
}

interface DiscoveryResult {
    mode: 'web' | 'facebook';
    query: string;
    total_found: number;
    after_filter: number;
    saved: number;
    skipped: number;
    leads?: WebLead[];
    tactics?: FbHintTactic[];
    discovery_run_id: number;
}

interface HistoryRow {
    id: number;
    author_name: string;
    post_url: string;
    group_name: string;
    scraped_at: string;
    recommended_lane: string;
    thg_service_needed: string;
    assigned_to: string;
    reason_summary: string;
}

const ensureHttp = (url?: string) => {
    if (!url) return '';
    if (url.includes(' ')) return `https://www.google.com/search?q=${encodeURIComponent(url)}`;
    return url.startsWith('http') ? url : `https://${url}`;
}

const LANE_COLORS: Record<string, string> = {
    resolved_lead: '#10b981',
    partial_lead: '#f59e0b',
    anonymous_signal: '#6366f1',
    fb_hint: '#3b82f6',
}
const SERVICE_COLORS: Record<string, string> = {
    warehouse: '#3b82f6', express: '#f59e0b', pod: '#10b981', quote_needed: '#8b5cf6', unknown: '#6b7280',
}
const SERVICE_ICONS: Record<string, string> = {
    warehouse: '🏭', express: '⚡', pod: '🖨️', quote_needed: '💰', unknown: '❓'
}
const PLATFORM_ICONS: Record<string, string> = {
    reddit: '🟠', etsy: '🟠', linkedin: '💼', forum: '💬', facebook_page: '🔵', shopify: '🟢', other: '🌐'
}
const PRIORITY_COLORS: Record<string, string> = {
    high: '#10b981', medium: '#f59e0b', low: '#6b7280'
}

// ─── Query templates per mode ─────────────────────────────────────────────────
const WEB_QUERY_TEMPLATES = [
    { label: '🏭 Warehouse FBA', query: 'Amazon FBA sellers Vietnam needing US warehouse 3PL prep center' },
    { label: '⚡ Express VN→US', query: 'Vietnam Shopify sellers needing fast express shipping to United States' },
    { label: '🖨️ POD Etsy', query: 'Etsy print on demand sellers Vietnam looking for fulfillment partner US' },
    { label: '📦 Dropship TQ', query: 'Dropship sellers sourcing from China 1688 Taobao shipping to US EU customers' },
    { label: '🛒 TikTok Shop', query: 'TikTok Shop US sellers Vietnam needing express logistics line' },
    { label: '🌏 Reddit Seller', query: 'r/ecommerce r/dropship Vietnam seller cần fulfillment kho US giá rẻ' },
]

const FB_QUERY_TEMPLATES = [
    { label: '📦 Đặt hàng TQ', query: 'Tệp seller đặt hàng Trung Quốc cần ship đi Mỹ trong group VN' },
    { label: '🖨️ POD Seller VN', query: 'Người bán POD Etsy/Amazon cần tìm xưởng fulfill giá rẻ hơn Printful' },
    { label: '🇺🇸 Việt kiều Mỹ', query: 'Việt kiều tại Mỹ cần mua hàng VN ship về hoặc cần gửi hàng sang Mỹ' },
    { label: '⚡ Cần forwarder', query: 'Seller đang tìm forwarder ship hàng VN/TQ đi Mỹ giá tốt' },
    { label: '🏭 Kho US', query: 'Seller FBA Amazon cần kho lưu trữ và fulfillment tại Mỹ giá tốt' },
    { label: '😤 Phàn nàn ship', query: 'Khách phàn nàn ship chậm, mất hàng, phí cao, muốn đổi đơn vị vận chuyển' },
]

function ScoreBar({ score }: { score: number }) {
    const color = score >= 80 ? '#10b981' : score >= 65 ? '#f59e0b' : '#6b7280'
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden', maxWidth: 80 }}>
                <div style={{ width: `${score}%`, height: '100%', background: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
            </div>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color, minWidth: 36 }}>{score}%</span>
        </div>
    )
}

function CopyButton({ text, label }: { text: string; label: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            onClick={() => {
                navigator.clipboard.writeText(text).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                })
            }}
            style={{
                padding: '4px 10px', borderRadius: 6,
                border: `1px solid ${copied ? '#10b981' : 'var(--border)'}`,
                background: copied ? 'rgba(16,185,129,0.1)' : 'var(--bg-elevated)',
                color: copied ? '#10b981' : 'var(--text-muted)',
                fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600,
                transition: 'all 0.2s', whiteSpace: 'nowrap'
            }}
        >
            {copied ? '✅ Copied!' : `📋 ${label}`}
        </button>
    )
}

// ─── Web Lead Card ────────────────────────────────────────────────────────────
function WebLeadCard({ lead, onFindSupplier }: { lead: WebLead; onFindSupplier: (query: string) => void }) {
    const [expanded, setExpanded] = useState(false)
    const p = lead.automation_payload

    return (
        <div style={{
            border: `1px solid var(--border)`,
            borderLeft: `4px solid ${SERVICE_COLORS[lead.service] || '#6b7280'}`,
            borderRadius: 10, marginBottom: '0.75rem', overflow: 'hidden', background: 'var(--bg)'
        }}>
            <div style={{ padding: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }} onClick={() => setExpanded(!expanded)}>
                <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>
                    {PLATFORM_ICONS[lead.platform_found || 'other'] || '🌐'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '0.95rem' }}>{lead.name}</strong>
                        {lead.source && (
                            <a href={ensureHttp(lead.source)} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: 'var(--primary-color)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                🔗 {lead.source.replace(/^https?:\/\//, '')}
                            </a>
                        )}
                        {lead.platform_found && (
                            <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                                {lead.platform_found}
                            </span>
                        )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{lead.pain_signal}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <ScoreBar score={lead.ai_score} />
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: `${SERVICE_COLORS[lead.service]}20`, color: SERVICE_COLORS[lead.service], fontWeight: 700 }}>
                            {SERVICE_ICONS[lead.service]} {lead.service}
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: `${LANE_COLORS[lead.lane] || '#6b7280'}20`, color: LANE_COLORS[lead.lane] || '#6b7280', fontWeight: 700 }}>
                            {lead.lane?.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 600, marginLeft: 'auto' }}>
                            {expanded ? '▲ Ẩn' : '▼ Payload'}
                        </span>
                    </div>
                </div>
            </div>

            {expanded && p && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                    {p.dm && (
                        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#3b82f6' }}>💬 DM / Inbox</span>
                                <CopyButton text={p.dm} label="Copy DM" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{p.dm}</p>
                        </div>
                    )}
                    {p.comment && (
                        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981' }}>💬 Comment</span>
                                <CopyButton text={p.comment} label="Copy Comment" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>{p.comment}</p>
                        </div>
                    )}
                    {p.linkedin && (
                        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0ea5e9' }}>🔗 LinkedIn (EN)</span>
                                <CopyButton text={p.linkedin} label="Copy LinkedIn" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>{p.linkedin}</p>
                        </div>
                    )}
                    {/* Find Supplier CTA */}
                    <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)' }}>
                        <button
                            onClick={(e) => { e.stopPropagation(); onFindSupplier(lead.pain_signal || lead.name); }}
                            style={{
                                width: '100%', padding: '0.6rem', borderRadius: 8, cursor: 'pointer',
                                border: '1px solid rgba(99,102,241,0.3)', background: 'rgba(99,102,241,0.08)',
                                color: 'var(--primary-color)', fontWeight: 700, fontSize: '0.78rem',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                            }}
                        >
                            🔍 Tìm Supplier cho sản phẩm này
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Facebook Hint Card ───────────────────────────────────────────────────────
function FbHintCard({ tactic }: { tactic: FbHintTactic }) {
    const [expanded, setExpanded] = useState(false)
    const priorityColor = PRIORITY_COLORS[tactic.priority] || '#6b7280'

    return (
        <div style={{
            border: `1px solid var(--border)`,
            borderLeft: `4px solid ${priorityColor}`,
            borderRadius: 10, marginBottom: '0.75rem', overflow: 'hidden', background: 'var(--bg)'
        }}>
            <div style={{ padding: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }} onClick={() => setExpanded(!expanded)}>
                <span style={{ fontSize: '1.25rem', flexShrink: 0 }}>
                    {tactic.tactic_type === 'search_keyword' ? '🔍' :
                        tactic.tactic_type === 'post_template' ? '📝' :
                            tactic.tactic_type === 'comment_template' ? '💬' :
                                tactic.tactic_type === 'dm_template' ? '📩' : '🎯'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '0.9rem' }}>{tactic.target_group}</strong>
                        <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 8, background: `${priorityColor}20`, color: priorityColor, fontWeight: 700, border: `1px solid ${priorityColor}40` }}>
                            {tactic.priority?.toUpperCase()}
                        </span>
                        <span style={{ fontSize: '0.65rem', padding: '1px 6px', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                            {tactic.tactic_type?.replace(/_/g, ' ')}
                        </span>
                    </div>
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '0 0 0.5rem', lineHeight: 1.4 }}>{tactic.use_case}</p>

                    {/* Content to copy */}
                    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '0.5rem 0.75rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text)', fontFamily: 'monospace', flex: 1, lineHeight: 1.5 }}>{tactic.content}</span>
                        <CopyButton text={tactic.content} label="Copy" />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {tactic.group_url && (
                            <a href={tactic.group_url} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: '#3b82f6', fontWeight: 600 }} onClick={e => e.stopPropagation()}>
                                👥 Mở Group FB
                            </a>
                        )}
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', flex: 1 }}>
                            Dấu hiệu: <em>{tactic.expected_signal}</em>
                        </span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 600 }}>
                            {expanded ? '▲ Ẩn script' : '▼ Xem script inbox'}
                        </span>
                    </div>
                </div>
            </div>

            {expanded && tactic.opener_script && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                    {tactic.opener_script.inbox && (
                        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#3b82f6' }}>📩 Script Inbox Facebook</span>
                                <CopyButton text={tactic.opener_script.inbox} label="Copy Inbox" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>{tactic.opener_script.inbox}</p>
                        </div>
                    )}
                    {tactic.opener_script.comment && (
                        <div style={{ padding: '0.875rem 1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981' }}>💬 Script Comment dưới post</span>
                                <CopyButton text={tactic.opener_script.comment} label="Copy Comment" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0 }}>{tactic.opener_script.comment}</p>
                        </div>
                    )}
                    {tactic.pain_addressed && (
                        <div style={{ padding: '0.75rem 1rem', borderTop: '1px solid var(--border)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            💊 Pain được giải quyết: {tactic.pain_addressed}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DiscoveryPage() {
    const [query, setQuery] = useState('')
    const [maxLeads, setMaxLeads] = useState(5)
    const [mode, setMode] = useState<'web' | 'facebook'>('facebook')
    const [searching, setSearching] = useState(false)
    const [result, setResult] = useState<DiscoveryResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [history, setHistory] = useState<HistoryRow[]>([])
    const [historyLoading, setHistoryLoading] = useState(true)
    const navigate = useNavigate()

    const handleFindSupplier = (query: string) => {
        navigate(`/sourcing?q=${encodeURIComponent(query)}`)
    }

    useEffect(() => { loadHistory() }, [])

    const loadHistory = () => {
        setHistoryLoading(true)
        apiGet<any>('/api/sis/discovery/history')
            .then(res => setHistory(res?.data || []))
            .catch(console.error)
            .finally(() => setHistoryLoading(false))
    }

    const handleSearch = async () => {
        if (!query.trim()) return
        setSearching(true)
        setError(null)
        setResult(null)
        try {
            const res = await apiPost<{ ok: boolean; data: DiscoveryResult; error?: string }>(
                '/api/sis/discovery',
                { query: query.trim(), maxLeads, mode }
            )
            if (!res.ok) throw new Error(res.error || 'Discovery failed')
            setResult(res.data)
            loadHistory()
        } catch (e: any) {
            setError(e.message || 'Lỗi không xác định')
        }
        setSearching(false)
    }

    const templates = mode === 'facebook' ? FB_QUERY_TEMPLATES : WEB_QUERY_TEMPLATES

    return (
        <div style={{ padding: '0 0.5rem', maxWidth: 960 }}>
            <div className="page-header" style={{ marginBottom: '1.5rem' }}>
                <h2 className="page-title">🌐 AI Discovery</h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    Tìm tệp seller tiềm năng. <strong>Mode Facebook</strong>: generate keyword + script thực chiến cho staff dùng tay trong group.
                    <strong> Mode Web</strong>: tìm seller qua Google (Reddit, diễn đàn, LinkedIn).
                </p>
            </div>

            {/* Mode Switch */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
                {([
                    { key: 'facebook', label: '👥 Facebook Groups', desc: 'Keyword + Script cho staff', badge: 'Chính' },
                    { key: 'web', label: '🌐 Web Discovery', desc: 'Google Search Grounding', badge: '' },
                ] as const).map(m => (
                    <button
                        key={m.key}
                        onClick={() => { setMode(m.key); setResult(null); setQuery(''); }}
                        style={{
                            flex: 1, padding: '0.875rem 1rem', borderRadius: 10, cursor: 'pointer',
                            border: `2px solid ${mode === m.key ? 'var(--primary-color)' : 'var(--border)'}`,
                            background: mode === m.key ? 'rgba(99,102,241,0.08)' : 'var(--bg-elevated)',
                            textAlign: 'left', transition: 'all 0.2s'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.2rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: mode === m.key ? 'var(--primary-color)' : 'var(--text)' }}>{m.label}</span>
                            {m.badge && <span style={{ fontSize: '0.6rem', padding: '1px 6px', borderRadius: 8, background: '#10b981', color: 'white', fontWeight: 700 }}>{m.badge}</span>}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{m.desc}</div>
                    </button>
                ))}
            </div>

            {/* Mode explanation */}
            {mode === 'facebook' && (
                <div style={{ background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    💡 <strong>Vì sao không cào trực tiếp Facebook?</strong> Google Search Grounding không thể truy cập vào Facebook Group private. Mode này thay vào đó generate <strong>keyword tìm kiếm + script inbox/comment</strong> được tối ưu cho từng group trong danh sách 19 groups của THG — để staff copy-paste và thực chiến thủ công.
                </div>
            )}

            {/* Search Box */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem' }}>
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !searching && handleSearch()}
                        placeholder={mode === 'facebook'
                            ? 'Ví dụ: Seller đặt hàng TQ cần ship đi Mỹ...'
                            : 'Ví dụ: Vietnam POD Etsy sellers looking for US fulfillment...'
                        }
                        style={{
                            flex: 1, background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                            color: 'var(--text)', borderRadius: 8, padding: '0.75rem 1rem', fontSize: '0.95rem',
                        }}
                    />
                    <select
                        value={maxLeads}
                        onChange={e => setMaxLeads(parseInt(e.target.value))}
                        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 8, padding: '0 0.75rem', fontSize: '0.875rem' }}
                    >
                        {[3, 5, 8, 10].map(n => <option key={n} value={n}>{n} {mode === 'facebook' ? 'tactics' : 'leads'}</option>)}
                    </select>
                    <button
                        className="btn btn-primary"
                        onClick={handleSearch}
                        disabled={searching || !query.trim()}
                        style={{ minWidth: 150, display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                        {searching ? <span className="spinner" style={{ width: 16, height: 16 }} /> : (mode === 'facebook' ? '🎯' : '⚡')}
                        {searching ? 'Đang xử lý...' : (mode === 'facebook' ? 'Tạo tactics FB' : 'Bắt đầu quét')}
                    </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {templates.map(t => (
                        <button key={t.label} onClick={() => setQuery(t.query)} style={{
                            padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)',
                            background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer',
                        }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Info badges */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {(mode === 'facebook' ? [
                    { icon: '👥', title: '19 FB Groups', desc: 'Targeting đúng nhóm VN seller + Việt kiều Mỹ' },
                    { icon: '📋', title: 'Script sẵn sàng', desc: 'Inbox + Comment tối ưu cho từng nhóm cụ thể' },
                    { icon: '🚫', title: 'Không checkpoint', desc: 'Staff dùng tay — không automation, không bị khóa acc' },
                ] : [
                    { icon: '🛡️', title: 'Anti-Checkpoint', desc: 'Google public data, không cần FB account' },
                    { icon: '🤖', title: 'Auto Payload', desc: 'DM + Comment + LinkedIn sẵn sàng copy-paste' },
                    { icon: '📊', title: 'AI Score 1-100', desc: 'Ưu tiên leads chất lượng, lọc nhà cung cấp' },
                ]).map(item => (
                    <div key={item.title} className="card" style={{ padding: '0.875rem' }}>
                        <div style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>{item.icon}</div>
                        <div style={{ fontWeight: 600, fontSize: '0.82rem', marginBottom: '0.2rem' }}>{item.title}</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.desc}</div>
                    </div>
                ))}
            </div>

            {/* Error */}
            {error && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '0.75rem 1rem', marginBottom: '1rem', color: '#ef4444', fontSize: '0.875rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                    ⚠️ {error}
                    <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
                </div>
            )}

            {/* Results */}
            {result && (
                <div style={{ marginBottom: '1.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.875rem' }}>
                        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>
                            {result.mode === 'facebook' ? '🎯 Facebook Tactics: ' : '🌐 Web Leads: '}
                            <span style={{ color: 'var(--primary-color)' }}>"{result.query}"</span>
                        </h3>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem' }}>
                            <span>Tạo được: <strong>{result.total_found}</strong></span>
                            <span style={{ color: '#10b981' }}>Saved: <strong>{result.saved}</strong></span>
                        </div>
                    </div>

                    {result.mode === 'facebook' && result.tactics && (
                        <>
                            {['high', 'medium', 'low'].map(p => {
                                const group = result.tactics!.filter(t => t.priority === p)
                                if (!group.length) return null
                                return (
                                    <div key={p}>
                                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: PRIORITY_COLORS[p], textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <div style={{ height: 1, flex: 1, background: `${PRIORITY_COLORS[p]}30` }}></div>
                                            {p === 'high' ? '🔥 Ưu tiên cao' : p === 'medium' ? '⚡ Ưu tiên trung bình' : '📋 Bổ sung'}
                                            <div style={{ height: 1, flex: 1, background: `${PRIORITY_COLORS[p]}30` }}></div>
                                        </div>
                                        {group.map((t, i) => <FbHintCard key={i} tactic={t} />)}
                                    </div>
                                )
                            })}
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                                ✅ Tactics đã lưu vào SIS. Dùng script trên để tìm và inbox thủ công trong các group Facebook.
                            </p>
                        </>
                    )}

                    {result.mode === 'web' && result.leads && (
                        <>
                            {result.leads.sort((a, b) => b.ai_score - a.ai_score).map(lead => (
                                <WebLeadCard key={lead.rawPostId} lead={lead} onFindSupplier={handleFindSupplier} />
                            ))}
                            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                                ✅ Leads đã vào SIS pipeline. Xem tại <a href="/" style={{ color: 'var(--primary-color)' }}>Dashboard → Tiềm năng</a>
                            </p>
                        </>
                    )}
                </div>
            )}

            {/* History */}
            <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem' }}>
                    Lịch sử Discovery
                    <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({history.length} entries)</span>
                </h3>
                {historyLoading ? (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="spinner" /></div>
                ) : history.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">🌐</div>
                        <div className="empty-state-text">Chưa có discovery nào. Thực hiện tìm kiếm đầu tiên.</div>
                    </div>
                ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Seller / Tactic</th>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Query / Group</th>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Type</th>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Lane</th>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Staff</th>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Thời gian</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map(row => (
                                <tr key={row.id} style={{ borderBottom: '1px solid var(--border)' }}>
                                    <td style={{ padding: '0.5rem 0.75rem', fontWeight: 600 }}>
                                        {row.post_url
                                            ? <a href={ensureHttp(row.post_url)} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)' }}>{row.author_name}</a>
                                            : row.author_name}
                                    </td>
                                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {row.group_name?.replace('AI Discovery: ', '')}
                                    </td>
                                    <td style={{ padding: '0.5rem 0.75rem' }}>
                                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: `${SERVICE_COLORS[row.thg_service_needed] || '#6b7280'}20`, color: SERVICE_COLORS[row.thg_service_needed] || '#6b7280', fontWeight: 600 }}>
                                            {SERVICE_ICONS[row.thg_service_needed]} {row.thg_service_needed || 'unknown'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.5rem 0.75rem' }}>
                                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: `${LANE_COLORS[row.recommended_lane] || '#6b7280'}20`, color: LANE_COLORS[row.recommended_lane] || '#6b7280', fontWeight: 600 }}>
                                            {row.recommended_lane?.replace(/_/g, ' ')}
                                        </span>
                                    </td>
                                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)' }}>{row.assigned_to || '—'}</td>
                                    <td style={{ padding: '0.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                                        {new Date(row.scraped_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    )
}
