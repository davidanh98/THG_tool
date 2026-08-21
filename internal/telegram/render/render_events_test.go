package render

import (
	"strings"
	"testing"
)

func TestLeadOmitsOperatorSuggestionWhenEmpty(t *testing.T) {
	got := Lead(LeadMsg{Workspace: "Acme", Status: "Sẵn sàng xử lý"})
	if strings.Contains(got, "Gợi ý trả lời") || strings.Contains(got, "Link sản phẩm") {
		t.Fatalf("empty suggestion changed the legacy notice:\n%s", got)
	}
}

func TestLeadRendersOperatorSuggestion(t *testing.T) {
	got := Lead(LeadMsg{
		SuggestedReply: "Bạn có thể xem mẫu phù hợp ở đây.",
		ProductName:    "Áo hoodie",
		ProductURL:     "https://catalog.example/p/hoodie",
	})
	for _, want := range []string{"Gợi ý trả lời", "Bạn có thể xem", "Áo hoodie", "https://catalog.example/p/hoodie"} {
		if !strings.Contains(got, want) {
			t.Fatalf("suggestion notice missing %q:\n%s", want, got)
		}
	}
}
