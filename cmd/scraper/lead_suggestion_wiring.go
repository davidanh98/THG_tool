package main

import (
	"context"
	"log"
	"time"

	"github.com/thg/scraper/internal/ai"
	"github.com/thg/scraper/internal/config"
	"github.com/thg/scraper/internal/leadingest"
	"github.com/thg/scraper/internal/models"
	"github.com/thg/scraper/internal/notifications"
	"github.com/thg/scraper/internal/services/facebook"
	"github.com/thg/scraper/internal/store"
	knowledgeRuntime "github.com/thg/scraper/internal/workspace_knowledge/runtime"
)

// setupLeadSuggestionRuntime is composition-root wiring: the Facebook service
// owns grounding/generation policy, while neutral server packages receive only
// notification contracts and callbacks.
func setupLeadSuggestionRuntime(cfg *config.Config, db *store.Store, commentGen *ai.MessageGenerator) (leadingest.SuggestionBuild, func(int64) bool, *notifications.SuggestionRunner) {
	if cfg == nil || db == nil || !cfg.LeadSuggestionEnabled {
		return nil, nil, nil
	}
	allowlist := facebook.ParseOrgAllowlist(cfg.LeadSuggestionOrgIDs)
	if !allowlist.Configured() {
		log.Println("[LeadSuggestion] enabled but LEAD_SUGGESTION_ORG_IDS is empty/invalid; no org is allowed")
	}
	if commentGen == nil || !commentGen.Available() {
		log.Println("[LeadSuggestion] enabled but comment provider is unavailable; suggestions remain inactive")
		return nil, nil, nil
	}
	builder := knowledgeRuntime.NewBuilder(db.Knowledge())
	build := func(ctx context.Context, ev leadingest.LeadEvent) models.LeadSuggestion {
		if !allowlist.Allows(ev.OrgID) {
			return models.LeadSuggestion{}
		}
		return facebook.BuildLeadSuggestion(ctx, builder, commentGen, ai.LoadProfileForOrg(db, ev.OrgID), ev.OrgID, ev.Excerpt, ev.AuthorName)
	}
	runner := notifications.NewSuggestionRunner(cfg.LeadSuggestionMaxConcurrency, time.Duration(cfg.LeadSuggestionTimeoutMS)*time.Millisecond)
	return build, allowlist.Allows, runner
}
