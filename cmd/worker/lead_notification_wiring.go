package main

import (
	"context"
	"log"
	"os"
	"time"

	"github.com/thg/scraper/internal/ai"
	"github.com/thg/scraper/internal/config"
	facebookcrawl "github.com/thg/scraper/internal/jobhandlers/facebook_crawl"
	"github.com/thg/scraper/internal/leadingest"
	"github.com/thg/scraper/internal/models"
	"github.com/thg/scraper/internal/notifications"
	"github.com/thg/scraper/internal/services/facebook"
	"github.com/thg/scraper/internal/store"
	tgclient "github.com/thg/scraper/internal/telegram/client"
	"github.com/thg/scraper/internal/telegram/control"
	knowledgeRuntime "github.com/thg/scraper/internal/workspace_knowledge/runtime"
)

type workerSuggestionRuntime struct {
	build     leadingest.SuggestionBuild
	allowlist facebook.OrgAllowlist
	runner    *notifications.SuggestionRunner
}

func newWorkerSuggestionRuntime(mainStore *store.Store) workerSuggestionRuntime {
	cfg := config.Load()
	runtime := workerSuggestionRuntime{allowlist: facebook.ParseOrgAllowlist("")}
	if !cfg.LeadSuggestionEnabled {
		return runtime
	}
	runtime.allowlist = facebook.ParseOrgAllowlist(cfg.LeadSuggestionOrgIDs)
	builder := knowledgeRuntime.NewBuilder(mainStore.Knowledge())
	commentGen := ai.NewMessageGeneratorWithEndpoint(cfg.LLMCommentAPIKey, cfg.OpenAICommentModel, cfg.LLMCommentBaseURL)
	if !commentGen.Available() {
		log.Println("[LeadSuggestion] enabled but comment provider is unavailable; suggestions remain inactive")
		return runtime
	}
	runtime.build = func(ctx context.Context, ev leadingest.LeadEvent) models.LeadSuggestion {
		if !runtime.allowlist.Allows(ev.OrgID) {
			return models.LeadSuggestion{}
		}
		return facebook.BuildLeadSuggestion(ctx, builder, commentGen, ai.LoadProfileForOrg(mainStore, ev.OrgID), ev.OrgID, ev.Excerpt, ev.AuthorName)
	}
	runtime.runner = notifications.NewSuggestionRunner(cfg.LeadSuggestionMaxConcurrency, time.Duration(cfg.LeadSuggestionTimeoutMS)*time.Millisecond)
	logWorkerSuggestionPolicy(runtime.allowlist)
	return runtime
}

func logWorkerSuggestionPolicy(allowlist facebook.OrgAllowlist) {
	if allowlist.Configured() {
		log.Println("✅ Operator lead suggestions enabled for explicit org allowlist")
		return
	}
	log.Println("⚠️  Operator lead suggestions enabled but LEAD_SUGGESTION_ORG_IDS is empty/invalid; no org is allowed")
}

func setupWorkerLeadNotifications(mainStore *store.Store, handler *facebookcrawl.Handler) {
	tgControl := control.NewService(mainStore.Telegram(), tgclient.Bot, control.Flags{
		NotifyEnabled:       envOr("TELEGRAM_NOTIFY_ENABLED", "true") != "false",
		GlobalToken:         os.Getenv("TELEGRAM_BOT_TOKEN"),
		AllowGlobalFallback: envOr("TELEGRAM_ALLOW_GLOBAL_FALLBACK", "false") == "true",
	})
	baseURL := envOr("PUBLIC_APP_URL", os.Getenv("APP_BASE_URL"))
	if baseURL == "" {
		log.Println("ℹ️  [PLATFORM] PUBLIC_APP_URL/APP_BASE_URL not set — Telegram lead notifications will omit the dashboard link (internal config).")
	}
	suggestion := newWorkerSuggestionRuntime(mainStore)
	handler.SetLeadNotifier(workerLeadNotifier(mainStore, tgControl, baseURL, suggestion))
	log.Println("✅ Telegram lead-created channel notifier wired (per-org bot)")
}

func workerLeadNotifier(mainStore *store.Store, tgControl *control.Service, baseURL string, suggestion workerSuggestionRuntime) func(leadingest.LeadEvent) {
	return func(ev leadingest.LeadEvent) {
		workspace := ""
		if org, _ := mainStore.GetOrganization(ev.OrgID); org != nil {
			workspace = org.Name
		}
		deliver := func(enrichment models.LeadSuggestion) {
			tgControl.NotifyLead(control.LeadNotice{
				OrgID: ev.OrgID, LeadID: ev.LeadID, Channel: "facebook", Workspace: workspace,
				Author: ev.AuthorName, PostURL: ev.PostURL, Excerpt: ev.Excerpt, Reason: ev.Reason, BaseURL: baseURL,
				SuggestedReply: enrichment.Reply, ProductName: enrichment.ProductName, ProductURL: enrichment.ProductURL,
				ProductImageURL: enrichment.ProductImageURL,
			})
		}
		if suggestion.build != nil && suggestion.allowlist.Allows(ev.OrgID) && suggestion.runner != nil && suggestion.runner.Try(
			func(ctx context.Context) models.LeadSuggestion { return suggestion.build(ctx, ev) }, deliver,
		) {
			return
		}
		deliver(models.LeadSuggestion{})
	}
}
