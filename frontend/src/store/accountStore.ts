import { create } from 'zustand'
import type { Account } from '../types/account'
import { fetchAccounts, fetchAccountById, updateAccount as apiUpdateAccount } from '../api/accounts'

interface AccountState {
    accounts: Account[]
    loading: boolean
    selectedAccountId: number | null
    statusFilter: string

    loadAccounts: () => Promise<void>
    setStatusFilter: (status: string) => void
    selectAccount: (id: number | null) => Promise<void>
    updateAccount: (id: number, data: Partial<Account>) => Promise<void>
}

export const useAccountStore = create<AccountState>((set, get) => ({
    accounts: [],
    loading: false,
    selectedAccountId: null,
    statusFilter: 'new', // default to mostly unqualified tasks

    loadAccounts: async () => {
        set({ loading: true })
        try {
            const res = await fetchAccounts(get().statusFilter === 'all' ? undefined : get().statusFilter)
            set({ accounts: res.data || [], loading: false })
        } catch {
            set({ loading: false })
        }
    },

    setStatusFilter: (status) => {
        set({ statusFilter: status })
        get().loadAccounts()
    },

    selectAccount: async (id) => {
        set({ selectedAccountId: id })
        if (id) {
            // Fetch detailed account info (identities + signals)
            try {
                const res = await fetchAccountById(id)
                if (res.data) {
                    set((s) => ({
                        accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...res.data } : a)),
                    }))
                }
            } catch { /* ignore */ }
        }
    },

    updateAccount: async (id, data) => {
        await apiUpdateAccount(id, data)
        set((s) => ({
            accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...data } : a)),
        }))
    },
}))
