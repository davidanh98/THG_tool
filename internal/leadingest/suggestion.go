package leadingest

import (
	"context"

	"github.com/thg/scraper/internal/models"
)

// SuggestionBuild is optional notification enrichment invoked after a lead is
// durably created. It must remain best-effort and org-scoped.
type SuggestionBuild func(context.Context, LeadEvent) models.LeadSuggestion
