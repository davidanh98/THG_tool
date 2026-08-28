package facebook

import (
	"testing"

	"github.com/thg/scraper/internal/models"
)

func TestPickSuggestedProduct_FirstProductWithLink(t *testing.T) {
	cands := []models.KnowledgeCandidate{
		{Kind: "sales_playbook", Title: "US fulfillment", SourceURL: "https://x/playbook"}, // not a product
		{Kind: "POD_product", Title: "Áo thun", SourceURL: ""},                             // product, no link → skip
		{Kind: "POD_product", Title: "Áo hoodie", SourceURL: "https://thgfulfill.com/vi/catalog?productId=p9"},
		{Kind: "POD_product", Title: "Áo khác", SourceURL: "https://thgfulfill.com/vi/catalog?productId=p10"},
	}
	name, url := PickSuggestedProduct(cands)
	if name != "Áo hoodie" || url != "https://thgfulfill.com/vi/catalog?productId=p9" {
		t.Fatalf("expected first product WITH a link, got name=%q url=%q", name, url)
	}
}

func TestPickSuggestedProduct_NoneWhenNoProductLink(t *testing.T) {
	cands := []models.KnowledgeCandidate{
		{Kind: "sales_playbook", Title: "playbook", SourceURL: "https://x/p"},
		{Kind: "POD_product", Title: "no-link", SourceURL: ""},
	}
	if name, url := PickSuggestedProduct(cands); name != "" || url != "" {
		t.Fatalf("expected empty when no product has a link, got name=%q url=%q", name, url)
	}
}

func TestPickSuggestedProductDetails_RequiresHTTPSAndAvailability(t *testing.T) {
	cands := []models.KnowledgeCandidate{
		{Kind: "POD_product", Title: "unsafe", SourceURL: "javascript:alert(1)"},
		{Kind: "POD_product", Title: "sold", SourceURL: "https://catalog.example/sold", Availability: "out_of_stock"},
		{Kind: "POD_product", Title: "ready", SourceURL: "https://catalog.example/p/1", ImageURL: "https://cdn.example/p/1.png", Availability: "in_stock"},
	}
	got := PickSuggestedProductDetails(cands)
	if got.Name != "ready" || got.URL != "https://catalog.example/p/1" || got.ImageURL != "https://cdn.example/p/1.png" {
		t.Fatalf("expected first safe available product, got %+v", got)
	}
}

func TestPickSuggestedProductDetails_DropsUnsafeImageOnly(t *testing.T) {
	got := PickSuggestedProductDetails([]models.KnowledgeCandidate{{
		Kind: "POD_product", Title: "ready", SourceURL: "https://catalog.example/p/1", ImageURL: "http://cdn.example/p/1.png",
	}})
	if got.URL == "" || got.ImageURL != "" {
		t.Fatalf("expected PDP but no insecure image, got %+v", got)
	}
}

func TestParseOrgAllowlist_FailClosed(t *testing.T) {
	tests := []struct {
		name    string
		raw     string
		allowed []int64
		denied  []int64
	}{
		{name: "empty", raw: "", denied: []int64{1}},
		{name: "ids", raw: "1, 9", allowed: []int64{1, 9}, denied: []int64{2, 0}},
		{name: "wildcard", raw: "*", allowed: []int64{1, 99}, denied: []int64{0, -1}},
		{name: "malformed invalidates all", raw: "1,nope", denied: []int64{1, 2}},
		{name: "wildcard cannot mix", raw: "*,1", denied: []int64{1, 2}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			list := ParseOrgAllowlist(tt.raw)
			for _, id := range tt.allowed {
				if !list.Allows(id) {
					t.Fatalf("org %d should be allowed", id)
				}
			}
			for _, id := range tt.denied {
				if list.Allows(id) {
					t.Fatalf("org %d should be denied", id)
				}
			}
		})
	}
}
