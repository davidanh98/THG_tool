package models

// LeadSuggestion is optional operator-facing enrichment for a new-lead
// notification. URLs are copied from persisted catalog assets, never generated.
type LeadSuggestion struct {
	Reply           string
	ProductName     string
	ProductURL      string
	ProductImageURL string
}
