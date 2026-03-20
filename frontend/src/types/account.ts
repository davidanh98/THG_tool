export interface Identity {
    id: number;
    account_id: number;
    type: string;
    value: string;
    confidence_score: number;
    discovered_from: string;
}

export interface Signal {
    id: number;
    platform: string;
    author_name: string;
    author_url: string;
    content: string;
    post_url: string;
    score: number;
    category: string;
    summary: string;
    status: string;
    created_at: string;
}

export interface Account {
    id: number;
    brand_name: string;
    primary_domain: string;
    primary_email: string;
    category: string;
    platform: string;
    market: string;
    maturity_stage: string;
    estimated_volume_band: string;
    contactability_score: number;
    pain_score: number;
    revenue_score: number;
    switching_score: number;
    urgency_score: number;
    priority_score: number;
    status: 'new' | 'qualified' | 'contacted' | 'replied' | 'booked_call' | 'pilot' | 'active_customer' | 'churned';
    created_at: string;
    updated_at: string;
    identities?: Identity[];
    signals?: Signal[];
}
