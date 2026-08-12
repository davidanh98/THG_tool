package copilot

import "testing"

func TestAgentChatURL(t *testing.T) {
	cases := []struct {
		name    string
		baseURL string
		want    string
	}{
		{"blank keeps OpenAI", "", "https://api.openai.com/v1/chat/completions"},
		{"provider base", "https://api.deepseek.com", "https://api.deepseek.com/chat/completions"},
		{"trailing slash trimmed", "https://api.together.xyz/v1/", "https://api.together.xyz/v1/chat/completions"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NewAgentWithEndpoint("k", "m", tc.baseURL, nil).chatURL(); got != tc.want {
				t.Fatalf("chatURL() = %q, want %q", got, tc.want)
			}
		})
	}
}
