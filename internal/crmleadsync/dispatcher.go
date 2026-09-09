package crmleadsync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/thg/scraper/internal/leadingest"
)

type Dispatcher struct {
	store  *Store
	url    string
	secret string
	client *http.Client
}

func NewDispatcher(store *Store, endpoint, secret string) *Dispatcher {
	if store == nil || strings.TrimSpace(endpoint) == "" || strings.TrimSpace(secret) == "" {
		return nil
	}
	return &Dispatcher{store: store, url: strings.TrimRight(strings.TrimSpace(endpoint), "/"), secret: secret, client: &http.Client{Timeout: 8 * time.Second}}
}

func (d *Dispatcher) Run(ctx context.Context) {
	d.Dispatch(ctx)
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			d.Dispatch(ctx)
		}
	}
}

func (d *Dispatcher) Enqueue(ctx context.Context, event leadingest.LeadEvent) error {
	return d.store.Enqueue(ctx, event)
}

func (d *Dispatcher) Dispatch(ctx context.Context) {
	items, err := d.store.Claim(ctx, time.Now(), 10)
	if err != nil {
		slog.ErrorContext(ctx, "CRM lead sync claim failed", "error", err)
		return
	}
	for _, item := range items {
		d.deliver(ctx, item)
	}
}

func (d *Dispatcher) deliver(ctx context.Context, item item) {
	body, err := json.Marshal(item.Payload)
	if err != nil {
		_ = d.store.Block(ctx, item, fmt.Sprintf("encode payload: %v", err))
		return
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, d.url, bytes.NewReader(body))
	if err != nil {
		_ = d.store.Block(ctx, item, fmt.Sprintf("build request: %v", err))
		return
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("x-thg-integration-key", d.secret)
	response, err := d.client.Do(req)
	if err != nil {
		_ = d.store.Retry(ctx, item, time.Now(), err.Error())
		return
	}
	defer response.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	if response.StatusCode >= http.StatusOK && response.StatusCode < http.StatusMultipleChoices {
		if err := d.store.Succeed(ctx, item.ID); err != nil {
			slog.ErrorContext(ctx, "CRM lead sync acknowledgement failed", "id", item.ID, "error", err)
		}
		return
	}
	message := fmt.Sprintf("CRM responded %d", response.StatusCode)
	if response.StatusCode >= http.StatusBadRequest && response.StatusCode < http.StatusInternalServerError && response.StatusCode != http.StatusTooManyRequests {
		_ = d.store.Block(ctx, item, message)
		return
	}
	_ = d.store.Retry(ctx, item, time.Now(), message)
}
