interface StatusTagProps {
    status: string
}

const STATUS_MAP: Record<string, { label: string; cls: string; style?: React.CSSProperties }> = {
    new: { label: '● New', cls: 'status-tag--new' },
    qualified: { label: '● Qualified', cls: 'status-tag--contacted' },
    contacted: { label: '● Contacted', cls: 'status-tag--contacted' },
    replied: { label: '● Replied', cls: 'status-tag--contacted', style: { border: '1px solid #10b981', color: '#10b981' } },
    booked_call: { label: '📅 Booked Call', cls: 'status-tag--contacted', style: { border: '1px solid #f59e0b', color: '#f59e0b', background: 'rgba(245,158,11,0.1)' } },
    pilot: { label: '🚀 Pilot', cls: 'status-tag--contacted', style: { border: '1px solid #8b5cf6', color: '#8b5cf6', background: 'rgba(139,92,246,0.1)' } },
    active_customer: { label: '🏆 Active', cls: 'status-tag--converted', style: { background: 'var(--success)' } },
    churned: { label: '❌ Churned', cls: 'status-tag--ignored' },
    converted: { label: '● Converted', cls: 'status-tag--converted' },
    ignored: { label: '● Ignored', cls: 'status-tag--ignored' },
    claimed: { label: '● Claimed', cls: 'status-tag--contacted' },
}

export default function StatusTag({ status }: StatusTagProps) {
    const info = STATUS_MAP[status] || STATUS_MAP['new']
    return <span className={`status-tag ${info.cls}`} style={info.style}>{info.label}</span>
}
