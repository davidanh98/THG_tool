export interface SISClassification {
    id: number;
    raw_post_id: number;
    model_name: string;
    is_relevant: boolean;
    entity_type: string;
    seller_likelihood: number;
    pain_score: number;
    intent_score: number;
    resolution_confidence: number;
    contactability_score: number;
    competitor_probability: number;
    pain_tags: string[];
    market_tags: string[];
    seller_stage_estimate: string;
    language_signals: string[];
    possible_identity_clues: string[];
    recommended_lane: "resolved_lead" | "partial_lead" | "anonymous_signal" | "competitor_intel" | "discard";
    reason_summary: string;
    confidence: "low" | "medium" | "high";
    created_at: string;
}

export interface SISLeadCard {
    id: number;
    raw_post_id: number;
    strategic_summary: string;
    suggested_opener: string;
    objection_prevention: string;
    mini_audit: string;
    next_best_action: string;
    sales_priority_score: number;
    created_at: string;
}

export interface SISSignal {
    id: number;
    classification_id?: number;
    lane?: string;
    platform: string;
    author_name: string;
    author_url?: string;
    author_avatar?: string;
    content: string;
    post_url: string;
    group_name?: string;
    language?: string;
    source_group?: string;
    item_type?: string;
    created_at?: string;
    classification?: SISClassification;
    leadCard?: SISLeadCard;
    reason_summary?: string;
    confidence?: string;
    seller_likelihood?: number;
    pain_score?: number;
    intent_score?: number;
    strategic_summary?: string;
    suggested_opener?: string;
    sales_priority_score?: number;
}

export interface SISSummary {
    lanes: {
        resolved: number;
        partial: number;
        anonymous: number;
        competitor: number;
    };
    total_processed: number;
}
