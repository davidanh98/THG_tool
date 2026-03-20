import { useState } from 'react'
import type { Account, Signal } from '../../types/account'
import { updateAccount } from '../../api/accounts'
import ScoreBadge from '../ui/ScoreBadge'
import StatusTag from '../ui/StatusTag'

interface Account360Props {
    account: Account
    onClose: () => void
}

export default function Account360View({ account, onClose }: Account360Props) {
    const [status, setStatus] = useState(account.status)
    const [loading, setLoading] = useState(false)

    const handleSaveStatus = async (newStatus: string) => {
        setLoading(true)
        try {
            await updateAccount(account.id, { status: newStatus as any })
            setStatus(newStatus as any)
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="closing-room">
            <div className="cr-header">
                <div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 800 }}>{account.brand_name} <StatusTag status={status} /></h2>
                    <p style={{ color: 'var(--text-muted)' }}>{account.category} • Priority: {account.priority_score}</p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn btn-secondary" onClick={onClose}>Back to Queue</button>
                    {status === 'qualified' && (
                        <button className="btn btn-primary" onClick={() => handleSaveStatus('contacted')} disabled={loading}>
                            Mark Contacted
                        </button>
                    )}
                    {status === 'contacted' && (
                        <button className="btn btn-primary" onClick={() => handleSaveStatus('replied')} disabled={loading} style={{ background: 'var(--success)', borderColor: 'var(--success)' }}>
                            Mark Replied
                        </button>
                    )}
                    {status === 'replied' && (
                        <button className="btn btn-primary" onClick={() => handleSaveStatus('booked_call')} disabled={loading} style={{ background: '#f59e0b', borderColor: '#f59e0b' }}>
                            Booked Call 📅
                        </button>
                    )}
                    {status === 'booked_call' && (
                        <button className="btn btn-primary" onClick={() => handleSaveStatus('pilot')} disabled={loading} style={{ background: '#8b5cf6', borderColor: '#8b5cf6' }}>
                            Start Pilot 🚀
                        </button>
                    )}
                    {status === 'pilot' && (
                        <button className="btn btn-primary" onClick={() => handleSaveStatus('active_customer')} disabled={loading} style={{ background: '#ec4899', borderColor: '#ec4899' }}>
                            Won Deal 🏆
                        </button>
                    )}
                </div>
            </div>

            <div className="cr-grid">
                {/* 1. Account Intelligence Matrix */}
                <div className="cr-card">
                    <h3 className="cr-card-title">🧠 Intelligence Matrix</h3>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600 }}>Pain (Needs Help)</span>
                            <ScoreBadge score={account.pain_score} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600 }}>Revenue Potential</span>
                            <ScoreBadge score={account.revenue_score} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600 }}>Urgency (Timeline)</span>
                            <ScoreBadge score={account.urgency_score} />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600 }}>Switching Probability</span>
                            <ScoreBadge score={account.switching_score} />
                        </div>
                        <div style={{ padding: '12px', background: 'var(--bg)', borderRadius: 8, marginTop: 8 }}>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: 4 }}>Contactability</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <ScoreBadge score={account.contactability_score} />
                                <span style={{ fontSize: '12px' }}>
                                    {account.contactability_score > 60 ? 'Easy to reach' : 'Hard to find contact'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* 2. Discovered Identities (Contact Points) */}
                <div className="cr-card">
                    <h3 className="cr-card-title">🔍 Known Identities</h3>
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {account.identities && account.identities.length > 0 ? (
                            account.identities.map((id) => (
                                <div key={id.id} style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: 16, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {id.type === 'fb_profile' ? '👤' : id.type === 'domain' ? '🌐' : '📱'}
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 14, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {id.value}
                                        </div>
                                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                            {id.type} • Source: {id.discovered_from}
                                        </div>
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-muted)' }}>No identities discovered yet.</div>
                        )}
                    </div>
                </div>

                {/* 3. Signal Timeline (Consolidated Leads) */}
                <div className="cr-card" style={{ gridColumn: '1 / -1' }}>
                    <h3 className="cr-card-title">📊 Signal Timeline</h3>
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        {account.signals && account.signals.length > 0 ? (
                            account.signals.map((sig: Signal) => (
                                <div key={sig.id} style={{ display: 'flex', gap: 16, paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
                                    <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>
                                        {sig.platform === 'facebook' ? '👥' : '💬'}
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                            <span style={{ fontWeight: 600 }}>{sig.author_name} ({sig.platform})</span>
                                            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(sig.created_at).toLocaleString()}</span>
                                        </div>
                                        <div style={{ fontSize: 14, lineHeight: 1.5, background: 'var(--bg)', padding: 12, borderRadius: 6, marginBottom: 8 }}>
                                            {sig.content}
                                        </div>
                                        {sig.summary && (
                                            <div style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 500, display: 'flex', gap: 6 }}>
                                                <span>✨ AI Insight:</span>
                                                <span>{sig.summary}</span>
                                            </div>
                                        )}
                                        {sig.post_url && (
                                            <a href={sig.post_url} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#3b82f6', textDecoration: 'none', display: 'inline-block', marginTop: 8 }}>
                                                View Original Source →
                                            </a>
                                        )}
                                    </div>
                                </div>
                            ))
                        ) : (
                            <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)' }}>
                                No raw signals available.
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}
