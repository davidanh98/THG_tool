import type { Lead } from '../../types/lead'
import { useLeadStore } from '../../store/leadStore'
import { updateLead } from '../../api/leads'
import ScoreBadge from '../ui/ScoreBadge'
import StatusTag from '../ui/StatusTag'
import PlatformIcon from '../ui/PlatformIcon'

interface LeadRowProps {
    lead: Lead
    onSelect: (id: number) => void
}

const TRIVIAL_RE = /^(có|co|yes|ok|oke|không|khong|no|na|\.+|-+)$/i

const CAT_COLORS: Record<string, string> = {
    'THG Fulfillment': '#722ed1',
    Fulfillment: '#722ed1',
    POD: '#722ed1',
    Dropship: '#722ed1',
    'THG Express': '#1890ff',
    Express: '#1890ff',
    'THG Warehouse': '#fa8c16',
    Warehouse: '#fa8c16',
}

function getCatLabel(cat: string): string {
    if (['THG Fulfillment', 'Fulfillment', 'POD', 'Dropship'].includes(cat)) return 'Fulfill'
    if (['THG Express', 'Express'].includes(cat)) return 'Express'
    if (['THG Warehouse', 'Warehouse'].includes(cat)) return 'WH'
    return cat || 'General'
}

function getSmartSummary(lead: Lead): string {
    const candidates = [lead.gap_opportunity, lead.summary, lead.content]
    for (const s of candidates) {
        const trimmed = (s || '').trim()
        if (trimmed.length > 8 && !TRIVIAL_RE.test(trimmed)) {
            return trimmed.substring(0, 140)
        }
    }
    return ''
}




export default function LeadRow({ lead, onSelect }: LeadRowProps) {
    const toggleLanguage = useLeadStore((s) => s.toggleLanguage)
    const isClaimed = !!(lead.claimed_by || lead.assigned_to)
    const summary = getSmartSummary(lead)
    const rawDate = lead.post_created_at || lead.scraped_at || lead.created_at
    const dt = new Date(rawDate.endsWith('Z') ? rawDate : rawDate + 'Z')
    const dateLabel = dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    const timeLabel = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`
    const lang = lead.language || 'foreign'
    const langIcon = lang === 'vietnamese' ? '🇻🇳' : '🌍'
    const langTitle = lang === 'vietnamese' ? 'Khách VN → Bấm đổi thành Foreign' : 'Khách Foreign → Bấm đổi thành VN'

    const handleCatClick = async (e: React.MouseEvent, newCat: string) => {
        e.stopPropagation()
        await updateLead(lead.id, { category: newCat } as Partial<Lead>)
    }

    const catLabel = getCatLabel(lead.category || '')

    return (
        <tr
            className={`${lead.score >= 80 ? 'hot-row' : ''} ${isClaimed ? 'claimed-row' : ''}`}
            onClick={() => onSelect(lead.id)}
        >
            <td style={{ textAlign: 'center' }}>
                <ScoreBadge score={lead.score || 0} />
            </td>

            <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                {lead.post_url ? (
                    <a href={lead.post_url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                        <PlatformIcon platform={lead.platform} isComment={lead.item_type === 'comment'} />
                    </a>
                ) : (
                    <PlatformIcon platform={lead.platform} isComment={lead.item_type === 'comment'} />
                )}
            </td>

            <td onClick={(e) => e.stopPropagation()}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button
                        className={`lang-toggle ${lang === 'vietnamese' ? 'lang-toggle--vn' : 'lang-toggle--foreign'}`}
                        title={langTitle}
                        onClick={(e) => {
                            e.stopPropagation()
                            toggleLanguage(lead.id)
                        }}
                    >
                        {langIcon} {lang === 'vietnamese' ? 'VN' : 'Foreign'}
                    </button>
                    {lead.author_url ? (
                        <a
                            href={lead.author_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="truncate"
                            style={{ maxWidth: 120, fontWeight: 500 }}
                        >
                            {lead.author_name || 'Unknown'}
                        </a>
                    ) : (
                        <span className="truncate" style={{ maxWidth: 120, fontWeight: 500 }}>
                            {lead.author_name || 'Unknown'}
                        </span>
                    )}
                    {isClaimed && <span title="Being handled" style={{ marginLeft: 4 }}>⚡</span>}
                </div>
            </td>

            <td>
                <div className="truncate" style={{ maxWidth: 300, color: summary ? 'var(--text-primary)' : 'var(--text-muted)', marginBottom: 4 }}>
                    {summary || <em style={{ opacity: 0.4, fontSize: 'var(--text-xs)' }}>Chưa có tóm tắt</em>}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {lead.response_draft && (
                        <span style={{ fontSize: '0.6rem', background: 'var(--accent)', color: '#fff', padding: '1px 4px', borderRadius: 3, fontWeight: 700 }}>
                            🤖 COPILOT
                        </span>
                    )}
                    {Array.isArray(lead.tags) ? lead.tags.slice(0, 2).map((tag, i) => (
                        <span key={i} style={{ fontSize: '0.6rem', border: '1px solid var(--warning)', color: 'var(--warning)', padding: '0px 4px', borderRadius: 3 }}>
                            {tag}
                        </span>
                    )) : lead.tags && typeof lead.tags === 'string' && lead.tags.startsWith('[') ? JSON.parse(lead.tags).slice(0, 2).map((tag: string, i: number) => (
                        <span key={i} style={{ fontSize: '0.6rem', border: '1px solid var(--warning)', color: 'var(--warning)', padding: '0px 4px', borderRadius: 3 }}>
                            {tag}
                        </span>
                    )) : null}
                </div>
            </td>

            <td onClick={(e) => e.stopPropagation()}>
                <div className="cat-toggle-group">
                    {(['THG Fulfillment', 'THG Express', 'THG Warehouse'] as const).map((cat) => {
                        const label = getCatLabel(cat)
                        const isActive = catLabel === label
                        const color = CAT_COLORS[cat] || '#8c8c8c'
                        return (
                            <button
                                key={cat}
                                className={`cat-toggle-btn ${isActive ? 'cat-toggle-btn--active' : ''}`}
                                style={isActive ? { background: color, borderColor: color } : {}}
                                onClick={(e) => handleCatClick(e, cat)}
                            >
                                {label}
                            </button>
                        )
                    })}
                </div>
            </td>

            <td>
                <StatusTag status={lead.status || 'new'} />
            </td>

            <td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                <div>{dateLabel}</div>
                <div>{timeLabel}</div>
            </td>

            <td onClick={(e) => e.stopPropagation()}>
                <div className="quick-actions">
                    <button className="qa-btn qa-btn--green" title="Expert Reply (AI comment)"
                        onClick={() => onSelect(lead.id)}>
                        💬
                    </button>
                    {lead.author_url && (
                        <a href={lead.author_url} target="_blank" rel="noopener noreferrer"
                            className="qa-btn qa-btn--fb" title="Open Facebook Profile">
                            👤
                        </a>
                    )}
                    {lead.post_url && (
                        <a href={lead.post_url} target="_blank" rel="noopener noreferrer"
                            className="qa-btn qa-btn--fb" title="Open Facebook Post">
                            🔗
                        </a>
                    )}
                    <button className="qa-btn" title="Copy info"
                        onClick={() => {
                            const text = `${lead.author_name} (Score: ${lead.score})\n${lead.content?.substring(0, 200) || ''}\n${lead.author_url || ''}`
                            navigator.clipboard.writeText(text)
                        }}>
                        📋
                    </button>
                    <button
                        className="qa-btn"
                        title="Xóa lead"
                        style={{ color: '#ef4444' }}
                        onClick={async () => {
                            if (!confirm(`Xóa lead #${lead.id} — ${lead.author_name || 'Unknown'}?`)) return
                            const { removeLead } = useLeadStore.getState()
                            await removeLead(lead.id)
                        }}
                    >
                        🗑️
                    </button>
                </div>
            </td>
        </tr>
    )
}
