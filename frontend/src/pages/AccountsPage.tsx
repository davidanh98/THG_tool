import { useEffect } from 'react'
import { useAccountStore } from '../store/accountStore'
import AccountTable from '../components/account/AccountTable'
import Account360View from '../components/account/Account360View'

export default function AccountsPage() {
    const { accounts, loading, selectedAccountId, loadAccounts, selectAccount, statusFilter, setStatusFilter } = useAccountStore()

    useEffect(() => {
        loadAccounts()
        const interval = setInterval(() => loadAccounts(), 60_000)
        return () => clearInterval(interval)
    }, [loadAccounts])

    // Compute basic stats
    const totalNew = accounts.filter(a => a.status === 'new').length
    const totalQualified = accounts.filter(a => a.status === 'qualified').length
    const totalContacted = accounts.filter(a => a.status === 'contacted').length

    // If an account is selected, show 360 View overlay
    if (selectedAccountId) {
        const selectedAcc = accounts.find((a) => a.id === selectedAccountId)
        if (selectedAcc) {
            return <Account360View account={selectedAcc} onClose={() => selectAccount(null)} />
        }
    }

    return (
        <div>
            {/* Stats Bar */}
            <div className="stat-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
                <div className="stat-card" onClick={() => setStatusFilter('all')} style={{ cursor: 'pointer', border: statusFilter === 'all' ? '2px solid var(--primary)' : '' }}>
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>🌍 Total Accounts</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: '#3b82f6' }}>{accounts.length}</div>
                </div>
                <div className="stat-card" onClick={() => setStatusFilter('new')} style={{ cursor: 'pointer', border: statusFilter === 'new' ? '2px solid var(--primary)' : '' }}>
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>💡 New (Unqualified)</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: '#ef4444' }}>{totalNew}</div>
                </div>
                <div className="stat-card" onClick={() => setStatusFilter('qualified')} style={{ cursor: 'pointer', border: statusFilter === 'qualified' ? '2px solid var(--primary)' : '' }}>
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>🔥 Qualified (Sales Task)</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, color: '#10b981' }}>{totalQualified}</div>
                </div>
                <div className="stat-card" onClick={() => setStatusFilter('contacted')} style={{ cursor: 'pointer', border: statusFilter === 'contacted' ? '2px solid var(--primary)' : '' }}>
                    <div className="stat-card-label" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-muted)' }}>📨 Contacted</div>
                    <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 700 }}>{totalContacted}</div>
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
                <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
                    🏢 Accounts / Businesses <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: 'var(--text-sm)' }}>({accounts.length})</span>
                </h2>
                <button className="btn btn-secondary btn-sm" onClick={loadAccounts} disabled={loading}>
                    {loading ? '⏳' : '🔄'} Refresh
                </button>
            </div>

            <AccountTable accounts={accounts} loading={loading} onSelectAccount={selectAccount} />
        </div>
    )
}
