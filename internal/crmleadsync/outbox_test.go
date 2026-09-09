package crmleadsync

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/thg/scraper/internal/leadingest"
	_ "modernc.org/sqlite"
)

func TestEnqueueDeduplicatesAndDispatches(t *testing.T) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE crm_lead_sync_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,
    state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, available_at INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0, last_error TEXT NOT NULL DEFAULT '',
    created_at DATETIME, updated_at DATETIME)`); err != nil {
		t.Fatal(err)
	}
	store := NewStore(db)
	event := leadingest.LeadEvent{OrgID: 7, AuthorName: "A", PostURL: "https://facebook.com/groups/1/posts/2", Excerpt: "Need fulfilment", Category: "warm"}
	if err := store.Enqueue(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	if err := store.Enqueue(context.Background(), event); err != nil {
		t.Fatal(err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM crm_lead_sync_outbox`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("outbox rows = %d, err = %v", count, err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-thg-integration-key") != "test-key" {
			t.Error("missing integration key")
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()
	dispatcher := NewDispatcher(store, server.URL, "test-key")
	dispatcher.Dispatch(context.Background())
	var state string
	if err := db.QueryRow(`SELECT state FROM crm_lead_sync_outbox`).Scan(&state); err != nil || state != "succeeded" {
		t.Fatalf("outbox state = %q, err = %v", state, err)
	}
}
