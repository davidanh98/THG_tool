package facebook

import (
	"context"
	"strings"

	"github.com/thg/scraper/internal/ai"
	"github.com/thg/scraper/internal/models"
	knowledgeRuntime "github.com/thg/scraper/internal/workspace_knowledge/runtime"
)

// Operator reply-suggestion helpers (Telegram lead notice). These are PURE:
// the composition root does the retrieval + generation IO and hands the results
// here; the sink only renders the assembled fields. No store, no network.

// LeadSuggestion is the operator-facing reply suggestion attached to a new-lead
// Telegram notice. Any field may be empty (suggestions are best-effort + opt-in).
type LeadSuggestion struct {
	Reply       string
	ProductName string
	ProductURL  string
}

// PickSuggestedProduct returns the first grounded POD-product candidate that
// carries a real catalog PDP link, as (name, url). Retrieval already ranked the
// candidates, so the first product with a link is the best-matched one. Returns
// ("","") when no product candidate has a link — the notice then omits the
// product block. Never fabricates: only a candidate's own Title/SourceURL is used.
func PickSuggestedProduct(candidates []models.KnowledgeCandidate) (name, url string) {
	for _, c := range candidates {
		if c.Kind != "POD_product" {
			continue
		}
		if link := strings.TrimSpace(c.SourceURL); link != "" {
			return strings.TrimSpace(c.Title), link
		}
	}
	return "", ""
}

// BuildLeadSuggestion performs the optional, operator-facing suggestion work.
// It is intentionally best-effort: retrieval or generation failure returns an
// empty suggestion and must never affect lead ingestion.
func BuildLeadSuggestion(ctx context.Context, builder *knowledgeRuntime.Builder, msgGen *ai.MessageGenerator, profile *ai.BusinessProfile, orgID int64, leadText, author string) LeadSuggestion {
	if builder == nil || msgGen == nil || !msgGen.Available() || profile == nil {
		return LeadSuggestion{}
	}
	candidates, _, err := builder.CandidatesForLead(ctx, orgID, leadText)
	if err != nil {
		return LeadSuggestion{}
	}
	name, url := PickSuggestedProduct(candidates)
	if name == "" && url == "" {
		return LeadSuggestion{}
	}
	serviceMatch := name + " " + url
	reply, err := msgGen.GenerateCommentWithService(ctx, leadText, author, profile.ToPromptBlock(), serviceMatch, models.CompanyIdentity{}, models.ActorPersona{})
	if err != nil {
		return LeadSuggestion{ProductName: name, ProductURL: url}
	}
	return LeadSuggestion{Reply: strings.TrimSpace(reply), ProductName: name, ProductURL: url}
}
