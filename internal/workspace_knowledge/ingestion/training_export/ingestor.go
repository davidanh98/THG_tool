// Package training_export ingests a signed, read-only THG Training export.
// It never crawls protected pages and never writes back to Training.
package training_export

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/thg/scraper/internal/workspace_knowledge/assets"
	"github.com/thg/scraper/internal/workspace_knowledge/ingestion"
	"github.com/thg/scraper/internal/workspace_knowledge/sources"
)

const maxResponseBytes = 4 << 20

type exportResponse struct {
	SchemaVersion int           `json:"schema_version"`
	SourceSystem  string        `json:"source_system"`
	Assets        []exportAsset `json:"assets"`
	NextCursor    *int64        `json:"next_cursor"`
}

type exportAsset struct {
	ExternalID     string `json:"external_id"`
	SourceID       string `json:"source_id"`
	Title          string `json:"title"`
	Content        string `json:"content"`
	SourceURL      string `json:"source_url"`
	Scope          string `json:"scope"`
	Revision       string `json:"revision"`
	UpdatedAt      string `json:"updated_at"`
	Classification string `json:"classification"`
}

type Ingestor struct{ HTTP *http.Client }

func New() *Ingestor { return &Ingestor{} }

func (i *Ingestor) Type() sources.SourceType { return sources.SourceTrainingExport }

func (i *Ingestor) Sync(ctx context.Context, src *sources.Source, w ingestion.AssetWriter) (ingestion.SyncResult, error) {
	if src == nil || w == nil {
		return ingestion.SyncResult{}, ingestion.WrapPermanent(errors.New("training_export: source and writer are required"))
	}
	cfg, err := parseConfig(src.ConnectionConfig)
	if err != nil {
		return ingestion.SyncResult{}, ingestion.WrapPermanent(err)
	}
	secret, err := loadSecret(cfg)
	if err != nil {
		return ingestion.SyncResult{}, ingestion.WrapPermanent(err)
	}
	client := i.HTTP
	if client == nil {
		client = &http.Client{Timeout: time.Duration(cfg.TimeoutSeconds) * time.Second}
	}

	result := ingestion.SyncResult{}
	cursor := int64(0)
	for page := 0; page < cfg.MaxPages; page++ {
		response, err := requestExport(ctx, client, cfg, secret, cursor)
		if err != nil {
			return result, err
		}
		for _, item := range response.Assets {
			result.AssetsSeen++
			asset, assetErr := assetFromExport(item)
			if assetErr != nil {
				result.AssetsRejected++
				result.Errors = append(result.Errors, ingestion.SyncError{ExternalID: strings.TrimSpace(item.ExternalID), Reason: assetErr.Error()})
				continue
			}
			if err := w.Write(ctx, asset); err != nil {
				return result, ingestion.WrapRecoverable(fmt.Errorf("training_export: write %s: %w", item.ExternalID, err))
			}
			result.AssetsCreated++
		}
		if response.NextCursor == nil {
			return result, nil
		}
		if *response.NextCursor <= cursor {
			return result, ingestion.WrapPermanent(errors.New("training_export: non-advancing cursor"))
		}
		cursor = *response.NextCursor
	}
	return result, ingestion.WrapPermanent(errors.New("training_export: exceeded max_pages"))
}

func requestExport(ctx context.Context, client *http.Client, cfg Config, secret string, cursor int64) (exportResponse, error) {
	u, err := url.Parse(cfg.BaseURL)
	if err != nil {
		return exportResponse{}, ingestion.WrapPermanent(fmt.Errorf("training_export: parse base_url: %w", err))
	}
	q := u.Query()
	q.Set("scope", strings.Join(cfg.Scopes, ","))
	q.Set("cursor", strconv.FormatInt(cursor, 10))
	u.RawQuery = q.Encode()
	timestamp := strconv.FormatInt(time.Now().UTC().Unix(), 10)
	canonical := strings.Join([]string{timestamp, http.MethodGet, u.Path, "scope=" + strings.Join(cfg.Scopes, ",") + "&cursor=" + strconv.FormatInt(cursor, 10)}, "\n")
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte(canonical))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return exportResponse{}, ingestion.WrapPermanent(fmt.Errorf("training_export: build request: %w", err))
	}
	req.Header.Set("x-thg-export-timestamp", timestamp)
	req.Header.Set("x-thg-export-signature", hex.EncodeToString(mac.Sum(nil)))
	resp, err := client.Do(req)
	if err != nil {
		return exportResponse{}, ingestion.WrapRecoverable(fmt.Errorf("training_export: request: %w", err))
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil {
		return exportResponse{}, ingestion.WrapRecoverable(fmt.Errorf("training_export: read response: %w", err))
	}
	if len(body) > maxResponseBytes {
		return exportResponse{}, ingestion.WrapPermanent(errors.New("training_export: response exceeds limit"))
	}
	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusBadRequest {
		return exportResponse{}, ingestion.WrapPermanent(fmt.Errorf("training_export: upstream returned %d", resp.StatusCode))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return exportResponse{}, ingestion.WrapRecoverable(fmt.Errorf("training_export: upstream returned %d", resp.StatusCode))
	}
	var decoded exportResponse
	if err := json.Unmarshal(body, &decoded); err != nil {
		return exportResponse{}, ingestion.WrapPermanent(fmt.Errorf("training_export: decode response: %w", err))
	}
	if decoded.SchemaVersion != 1 || decoded.SourceSystem != "THG_TRAINING" {
		return exportResponse{}, ingestion.WrapPermanent(errors.New("training_export: unsupported response contract"))
	}
	return decoded, nil
}

func assetFromExport(item exportAsset) (*assets.Asset, error) {
	item.ExternalID = strings.TrimSpace(item.ExternalID)
	item.Title = strings.TrimSpace(item.Title)
	item.Content = strings.TrimSpace(item.Content)
	if item.ExternalID == "" || item.Title == "" || item.Content == "" {
		return nil, errors.New("missing external_id, title, or content")
	}
	payload, err := json.Marshal(map[string]string{
		"source_url": strings.TrimSpace(item.SourceURL), "scope": strings.TrimSpace(item.Scope),
		"revision": strings.TrimSpace(item.Revision), "updated_at": strings.TrimSpace(item.UpdatedAt),
		"classification": strings.TrimSpace(item.Classification), "source_system": "THG_TRAINING",
	})
	if err != nil {
		return nil, fmt.Errorf("marshal provenance: %w", err)
	}
	return &assets.Asset{Type: assets.AssetSalesPlaybook, ExternalID: item.ExternalID, Title: item.Title,
		Description: item.Content, Tags: assets.NormalizeTags([]string{"training", item.Scope, "sales_playbook"}), Payload: payload, State: assets.StatePending}, nil
}
