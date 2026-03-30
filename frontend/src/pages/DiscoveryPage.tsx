import { useState, useEffect } from 'react'
import { apiPost, apiGet } from '../api/client'

interface AutomationPayload {
    dm: string;
    comment: string;
    linkedin: string;
    pain_signal?: string;
    estimated_volume?: string;
    ai_score?: number;
}

interface DiscoveryLead {
    rawPostId: number;
    name: string;
    source?: string;
    lane: string;
    service: string;
    ai_score: number;
    pain_signal: string;
    automation_payload: AutomationPayload | null;
}

interface DiscoveryResult {
    query: string;
    total_found: number;
    after_filter: number;
    saved: number;
    skipped: number;
    leads: DiscoveryLead[];
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

const LANE_COLORS: Record<string, string> = {
    resolved_lead: '#10b981',
    partial_lead: '#f59e0b',
    anonymous_signal: '#6366f1',
}
const SERVICE_COLORS: Record<string, string> = {
    warehouse: '#3b82f6',
    express: '#f59e0b',
    pod: '#10b981',
    quote_needed: '#8b5cf6',
    unknown: '#6b7280',
}
const SERVICE_ICONS: Record<string, string> = {
    warehouse: '🏭', express: '⚡', pod: '🖨️', quote_needed: '💰', unknown: '❓'
}

const QUERY_TEMPLATES = [
    { label: '🏭 Warehouse FBA', query: 'Amazon FBA sellers Vietnam needing US warehouse 3PL prep center' },
    { label: '⚡ Express VN→US', query: 'Vietnam Shopify sellers needing fast express shipping to United States' },
    { label: '🖨️ POD Etsy', query: 'Etsy print on demand sellers Vietnam looking for fulfillment partner US' },
    { label: '📦 Dropship TQ', query: 'Dropship sellers sourcing from China 1688 Taobao shipping to US EU customers' },
    { label: '🛒 TikTok Shop', query: 'TikTok Shop US sellers Vietnam needing express logistics line' },
    { label: '🌏 Shopify Scale', query: 'Shopify store owners Vietnam scaling to US market needing fulfillment center' },
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
    const handleCopy = () => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        })
    }
    return (
        <button
            onClick={handleCopy}
            style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${copied ? '#10b981' : 'var(--border)'}`,
                background: copied ? 'rgba(16,185,129,0.1)' : 'var(--bg-elevated)',
                color: copied ? '#10b981' : 'var(--text-muted)',
                fontSize: '0.72rem',
                cursor: 'pointer',
                fontWeight: 600,
                transition: 'all 0.2s',
                whiteSpace: 'nowrap'
            }}
        >
            {copied ? '✅ Copied!' : `📋 ${label}`}
        </button>
    )
}

function LeadPayloadCard({ lead }: { lead: DiscoveryLead }) {
    const [expanded, setExpanded] = useState(false)
    const p = lead.automation_payload

    return (
        <div style={{
            border: `1px solid var(--border)`,
            borderLeft: `4px solid ${SERVICE_COLORS[lead.service] || '#6b7280'}`,
            borderRadius: 10,
            marginBottom: '0.75rem',
            overflow: 'hidden',
            background: 'var(--bg)'
        }}>
            {/* Header */}
            <div
                style={{ padding: '1rem', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '0.75rem' }}
                onClick={() => setExpanded(!expanded)}
            >
                <span style={{ fontSize: '1.5rem', flexShrink: 0 }}>{SERVICE_ICONS[lead.service] || '📋'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                        <strong style={{ fontSize: '0.95rem' }}>{lead.name}</strong>
                        {lead.source && (
                            <a href={lead.source.startsWith('http') ? lead.source : `https://${lead.source}`} target="_blank" rel="noreferrer" style={{ fontSize: '0.7rem', color: 'var(--primary-color)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                                🔗 {lead.source.replace(/^https?:\/\//, '')}
                            </a>
                        )}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.5rem' }}>{lead.pain_signal}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        <ScoreBar score={lead.ai_score} />
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: `${SERVICE_COLORS[lead.service]}20`, color: SERVICE_COLORS[lead.service], fontWeight: 700 }}>
                            {lead.service}
                        </span>
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: `${LANE_COLORS[lead.lane] || '#6b7280'}20`, color: LANE_COLORS[lead.lane] || '#6b7280', fontWeight: 700 }}>
                            {lead.lane?.replace(/_/g, ' ')}
                        </span>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>#{lead.rawPostId}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--primary-color)', fontWeight: 600 }}>
                            {expanded ? '▲ Ẩn payload' : '▼ Xem payload'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Automation Payload */}
            {expanded && p && (
                <div style={{ borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
                    {p.dm && (
                        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#3b82f6' }}>💬 DM / Inbox</span>
                                <CopyButton text={p.dm} label="Copy DM" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{p.dm}</p>
                        </div>
                    )}
                    {p.comment && (
                        <div style={{ padding: '0.875rem 1rem', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#10b981' }}>💬 Comment (Group/Forum)</span>
                                <CopyButton text={p.comment} label="Copy Comment" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0, color: 'var(--text)' }}>{p.comment}</p>
                        </div>
                    )}
                    {p.linkedin && (
                        <div style={{ padding: '0.875rem 1rem' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#0ea5e9' }}>🔗 LinkedIn Message (EN)</span>
                                <CopyButton text={p.linkedin} label="Copy LinkedIn" />
                            </div>
                            <p style={{ fontSize: '0.85rem', lineHeight: 1.6, margin: 0, color: 'var(--text)' }}>{p.linkedin}</p>
                        </div>
                    )}
                </div>
            )}

            {expanded && !p && (
                <div style={{ padding: '1rem', borderTop: '1px solid var(--border)', background: 'var(--bg-elevated)', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Không có automation payload. Lead này cần được tạo opener thủ công.
                </div>
            )}
        </div>
    )
}

export default function DiscoveryPage() {
    const [query, setQuery] = useState('')
    const [maxLeads, setMaxLeads] = useState(5)
    const [searching, setSearching] = useState(false)
    const [result, setResult] = useState<DiscoveryResult | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [history, setHistory] = useState<HistoryRow[]>([])
    const [historyLoading, setHistoryLoading] = useState(true)

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
                { query: query.trim(), maxLeads }
            )
            if (!res.ok) throw new Error(res.error || 'Discovery failed')
            setResult(res.data)
            loadHistory()
        } catch (e: any) {
            setError(e.message || 'Lỗi không xác định')
        }
        setSearching(false)
    }

    return (
        <div style={{ padding: '0 0.5rem', maxWidth: 920 }}>
            <div className="page-header" style={{ marginBottom: '1.5rem' }}>
                <h2 className="page-title">🌐 AI Discovery</h2>
                <p style={{ margin: '4px 0 0', fontSize: '0.875rem', color: 'var(--text-muted)' }}>
                    Tìm seller tiềm năng từ Google, LinkedIn, Shopify — không cần Facebook, không checkpoint.
                    AI tự generate <strong>DM · Comment · LinkedIn</strong> sẵn sàng copy-paste.
                </p>
            </div>

            {/* Search Box */}
            <div className="card" style={{ padding: '1.5rem', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '0.875rem' }}>
                    <input
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && !searching && handleSearch()}
                        placeholder="Ví dụ: POD sellers Vietnam Etsy looking for US fulfillment..."
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
                        {[3, 5, 8, 10].map(n => <option key={n} value={n}>{n} leads</option>)}
                    </select>
                    <button
                        className="btn btn-primary"
                        onClick={handleSearch}
                        disabled={searching || !query.trim()}
                        style={{ minWidth: 150, display: 'flex', alignItems: 'center', gap: 8 }}
                    >
                        {searching ? <span className="spinner" style={{ width: 16, height: 16 }} /> : '⚡'}
                        {searching ? 'Đang quét...' : 'Bắt đầu quét'}
                    </button>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {QUERY_TEMPLATES.map(t => (
                        <button key={t.label} onClick={() => setQuery(t.query)} style={{
                            padding: '4px 10px', borderRadius: 20, border: '1px solid var(--border)',
                            background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: '0.75rem', cursor: 'pointer',
                        }}>
                            {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Badges */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem', marginBottom: '1.25rem' }}>
                {[
                    { icon: '🛡️', title: 'Anti-Checkpoint', desc: 'Google public data, không cần FB account' },
                    { icon: '🤖', title: 'Auto Payload', desc: 'DM + Comment + LinkedIn sẵn sàng copy-paste' },
                    { icon: '📊', title: 'AI Score 1-100', desc: 'Ưu tiên leads chất lượng, lọc nhà cung cấp' },
                ].map(item => (
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
                            Kết quả: <span style={{ color: 'var(--primary-color)' }}>"{result.query}"</span>
                        </h3>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', gap: '1rem' }}>
                            <span>Tìm được: <strong>{result.total_found}</strong></span>
                            <span>Sau lọc: <strong>{result.after_filter}</strong></span>
                            <span style={{ color: '#10b981' }}>Saved: <strong>{result.saved}</strong></span>
                            {result.skipped > 0 && <span>Trùng: {result.skipped}</span>}
                        </div>
                    </div>
                    {result.leads.sort((a, b) => b.ai_score - a.ai_score).map(lead => (
                        <LeadPayloadCard key={lead.rawPostId} lead={lead} />
                    ))}
                    <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.75rem' }}>
                        ✅ Leads đã vào SIS pipeline. Xem tại <a href="/" style={{ color: 'var(--primary-color)' }}>Dashboard → Tiềm năng</a>
                    </p>
                </div>
            )}

            {/* History */}
            <div className="card" style={{ padding: '1.25rem' }}>
                <h3 style={{ margin: '0 0 1rem 0', fontSize: '0.95rem' }}>
                    Lịch sử Discovery
                    <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>({history.length} leads)</span>
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
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Seller / Brand</th>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Query nguồn</th>
                                <th style={{ padding: '0.5rem 0.75rem', textAlign: 'left' }}>Dịch vụ</th>
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
                                            ? <a href={row.post_url.startsWith('http') ? row.post_url : `https://${row.post_url}`} target="_blank" rel="noreferrer" style={{ color: 'var(--primary-color)' }}>{row.author_name}</a>
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
