import type { Account } from '../../types/account'
import ScoreBadge from '../ui/ScoreBadge'
import StatusTag from '../ui/StatusTag'

interface AccountTableProps {
    accounts: Account[]
    loading: boolean
    onSelectAccount: (id: number) => void
}

export default function AccountTable({ accounts, loading, onSelectAccount }: AccountTableProps) {
    if (loading) {
        return (
            <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
                <span className="spin" style={{ display: 'inline-block', fontSize: '2rem', marginBottom: 'var(--space-sm)' }}>⏳</span>
                <div>Loading accounts from radar...</div>
            </div>
        )
    }

    if (accounts.length === 0) {
        return (
            <div className="card" style={{ padding: 'var(--space-2xl)', textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '3rem', marginBottom: 'var(--space-md)', opacity: 0.5 }}>📭</div>
                <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text)' }}>No accounts found</div>
                <div style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-xs)' }}>Adjust filters or wait for the scraper to find more signals.</div>
            </div>
        )
    }

    return (
        <div className="card" style={{ overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                    <thead>
                        <tr>
                            <th style={{ width: '40px' }}>ID</th>
                            <th>Brand / Name</th>
                            <th>Category</th>
                            <th style={{ width: '120px', textAlign: 'center' }}>Contactable</th>
                            <th style={{ width: '100px', textAlign: 'center' }}>Pain</th>
                            <th style={{ width: '100px', textAlign: 'center' }}>Priority</th>
                            <th style={{ width: '120px' }}>Status</th>
                            <th style={{ width: '100px', textAlign: 'right' }}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {accounts.map((acc) => (
                            <tr key={acc.id} onClick={() => onSelectAccount(acc.id)} style={{ cursor: 'pointer' }}>
                                <td style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)' }}>#{acc.id}</td>
                                <td>
                                    <div style={{ fontWeight: 600, color: 'var(--text)' }}>{acc.brand_name}</div>
                                    {acc.primary_domain && <div style={{ fontSize: '0.75rem', color: 'var(--primary)' }}>{acc.primary_domain}</div>}
                                </td>
                                <td>
                                    <span style={{ fontSize: '0.8rem', background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: 4 }}>
                                        {acc.category || 'Unknown'}
                                    </span>
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <ScoreBadge score={acc.contactability_score} />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <ScoreBadge score={acc.pain_score} />
                                </td>
                                <td style={{ textAlign: 'center' }}>
                                    <ScoreBadge score={acc.priority_score} />
                                </td>
                                <td>
                                    <StatusTag status={acc.status} />
                                </td>
                                <td style={{ textAlign: 'right' }}>
                                    <button className="btn btn-secondary btn-sm" onClick={(e) => { e.stopPropagation(); onSelectAccount(acc.id); }}>
                                        View 360
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    )
}
