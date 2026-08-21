package facebook

import (
	"testing"

	"github.com/thg/scraper/internal/models"
)

func TestPickSuggestedProduct_FirstProductWithLink(t *testing.T) {
	cands := []models.KnowledgeCandidate{
		{Kind: "sales_playbook", Title: "US fulfillment", SourceURL: "https://x/playbook"}, // not a product
		{Kind: "POD_product", Title: "Áo thun", SourceURL: ""},                              // product, no link → skip
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
