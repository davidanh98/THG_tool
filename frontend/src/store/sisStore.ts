import { create } from 'zustand'
import { apiGet } from '../api/client'
import type { SISSignal, SISSummary } from '../types/sis'

interface SISState {
    lanes: {
        resolved: SISSignal[]
        partial: SISSignal[]
        anonymous: SISSignal[]
        competitor: SISSignal[]
    }
    summary: SISSummary | null
    loading: boolean
    activeTab: 'resolved' | 'partial' | 'anonymous' | 'competitor'

    loadLanes: () => Promise<void>
    loadSummary: () => Promise<void>
    setActiveTab: (tab: 'resolved' | 'partial' | 'anonymous' | 'competitor') => void
}

export const useSISStore = create<SISState>((set) => ({
    lanes: {
        resolved: [],
        partial: [],
        anonymous: [],
        competitor: []
    },
    summary: null,
    loading: false,
    activeTab: 'resolved',

    setActiveTab: (tab) => set({ activeTab: tab }),

    loadLanes: async () => {
        set({ loading: true })
        try {
            const [r, p, a, c] = await Promise.all([
                apiGet<{ data: SISSignal[] }>('/api/sis/lanes/resolved_lead'),
                apiGet<{ data: SISSignal[] }>('/api/sis/lanes/partial_lead'),
                apiGet<{ data: SISSignal[] }>('/api/sis/lanes/anonymous_signal'),
                apiGet<{ data: SISSignal[] }>('/api/sis/lanes/competitor_intel')
            ])

            set({
                lanes: {
                    resolved: r.data || [],
                    partial: p.data || [],
                    anonymous: a.data || [],
                    competitor: c.data || []
                },
                loading: false
            })
        } catch (err) {
            console.error('SIS Store Error:', err)
            set({ loading: false })
        }
    },

    loadSummary: async () => {
        try {
            const res = await apiGet<SISSummary>('/api/sis/summary')
            set({ summary: res })
        } catch (err) {
            console.error('SIS Summary Error:', err)
        }
    }
}))
