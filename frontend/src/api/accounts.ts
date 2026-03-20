import { apiGet, apiPatch } from './client'
import type { Account } from '../types/account'
import type { ApiResponse } from '../types/api'

export async function fetchAccounts(status?: string) {
    const params = new URLSearchParams()
    if (status) params.set('status', status)

    const qs = params.toString()
    return apiGet<ApiResponse<Account[]>>(`/api/sis/accounts${qs ? '?' + qs : ''}`)
}

export async function fetchAccountById(id: number) {
    return apiGet<ApiResponse<Account>>(`/api/sis/accounts/${id}`)
}

export async function updateAccount(id: number, data: Partial<Account>) {
    return apiPatch<ApiResponse<Account>>(`/api/sis/accounts/${id}`, data)
}
