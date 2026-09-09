// Package crmleadsync owns the durable local outbox for CRM lead projection.
package crmleadsync

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"

	"github.com/thg/scraper/internal/leadingest"
)

const sourceSystem = "THG_TOOL"

type payload struct {
	EventKey         string  `json:"eventKey"`
	OrgID            int64   `json:"orgId"`
	AuthorName       string  `json:"authorName"`
	AuthorProfileURL string  `json:"authorProfileUrl"`
	SourceURL        string  `json:"sourceUrl"`
	PostID           string  `json:"postId"`
	Excerpt          string  `json:"excerpt"`
	Score            float64 `json:"score"`
	Category         string  `json:"category"`
}

func payloadFor(event leadingest.LeadEvent) (payload, bool) {
	if event.OrgID <= 0 || strings.TrimSpace(event.PostURL) == "" || strings.TrimSpace(event.AuthorName) == "" {
		return payload{}, false
	}
	key := sourceSystem + ":" + itoa(event.OrgID) + ":" + digest(event.PostURL)
	return payload{
		EventKey: key, OrgID: event.OrgID, AuthorName: strings.TrimSpace(event.AuthorName),
		AuthorProfileURL: strings.TrimSpace(event.AuthorProfileURL), SourceURL: strings.TrimSpace(event.PostURL),
		PostID: strings.TrimSpace(event.PostFBID), Excerpt: strings.TrimSpace(event.Excerpt),
		Score: event.Score, Category: strings.TrimSpace(event.Category),
	}, true
}

func digest(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func itoa(value int64) string {
	const digits = "0123456789"
	if value == 0 {
		return "0"
	}
	buf := [20]byte{}
	i := len(buf)
	for value > 0 {
		i--
		buf[i] = digits[value%10]
		value /= 10
	}
	return string(buf[i:])
}
