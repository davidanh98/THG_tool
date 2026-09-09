package crmleadsync

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/thg/scraper/internal/leadingest"
)

type Store struct {
	db *sql.DB
}

type item struct {
	ID       int64
	Payload  payload
	Attempts int
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) Enqueue(ctx context.Context, event leadingest.LeadEvent) error {
	p, ok := payloadFor(event)
	if !ok {
		return nil
	}
	body, err := json.Marshal(p)
	if err != nil {
		return fmt.Errorf("marshal CRM lead payload: %w", err)
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT OR IGNORE INTO crm_lead_sync_outbox (event_key, payload_json, state, available_at)
		 VALUES (?, ?, 'pending', 0)`, p.EventKey, string(body))
	if err != nil {
		return fmt.Errorf("enqueue CRM lead: %w", err)
	}
	return nil
}

func (s *Store) Claim(ctx context.Context, now time.Time, limit int) ([]item, error) {
	if limit < 1 {
		return nil, nil
	}
	if limit > 20 {
		limit = 20
	}
	nowUnix := now.UTC().Unix()
	if _, err := s.db.ExecContext(ctx,
		`UPDATE crm_lead_sync_outbox SET state='pending', locked_until=0, available_at=?
		 WHERE state='sending' AND locked_until > 0 AND locked_until <= ?`, nowUnix, nowUnix); err != nil {
		return nil, fmt.Errorf("reclaim CRM lead sync: %w", err)
	}
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, payload_json, attempts FROM crm_lead_sync_outbox
		 WHERE state='pending' AND available_at <= ? ORDER BY id LIMIT ?`, nowUnix, limit)
	if err != nil {
		return nil, fmt.Errorf("list CRM lead sync: %w", err)
	}
	defer rows.Close()
	var candidates []item
	for rows.Next() {
		var raw string
		var candidate item
		if err := rows.Scan(&candidate.ID, &raw, &candidate.Attempts); err != nil {
			return nil, fmt.Errorf("scan CRM lead sync: %w", err)
		}
		if err := json.Unmarshal([]byte(raw), &candidate.Payload); err != nil {
			return nil, fmt.Errorf("decode CRM lead sync %d: %w", candidate.ID, err)
		}
		candidates = append(candidates, candidate)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	claimed := make([]item, 0, len(candidates))
	for _, candidate := range candidates {
		result, err := s.db.ExecContext(ctx,
			`UPDATE crm_lead_sync_outbox SET state='sending', locked_until=?
		 WHERE id=? AND state='pending' AND available_at <= ?`, nowUnix+30, candidate.ID, nowUnix)
		if err != nil {
			return nil, fmt.Errorf("claim CRM lead sync %d: %w", candidate.ID, err)
		}
		if changed, _ := result.RowsAffected(); changed == 1 {
			claimed = append(claimed, candidate)
		}
	}
	return claimed, nil
}

func (s *Store) Succeed(ctx context.Context, id int64) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE crm_lead_sync_outbox SET state='succeeded', locked_until=0, last_error=''
		 WHERE id=? AND state='sending'`, id)
	return err
}

func (s *Store) Retry(ctx context.Context, item item, now time.Time, message string) error {
	attempts := item.Attempts + 1
	if attempts >= 8 {
		_, err := s.db.ExecContext(ctx,
			`UPDATE crm_lead_sync_outbox SET state='failed', attempts=?, locked_until=0, last_error=?
		 WHERE id=? AND state='sending'`, attempts, truncate(message, 500), item.ID)
		return err
	}
	_, err := s.db.ExecContext(ctx,
		`UPDATE crm_lead_sync_outbox SET state='pending', attempts=?, available_at=?, locked_until=0, last_error=?
		 WHERE id=? AND state='sending'`, attempts, now.UTC().Add(retryDelay(attempts)).Unix(), truncate(message, 500), item.ID)
	return err
}

func (s *Store) Block(ctx context.Context, item item, message string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE crm_lead_sync_outbox SET state='blocked', attempts=?, locked_until=0, last_error=?
		 WHERE id=? AND state='sending'`, item.Attempts+1, truncate(message, 500), item.ID)
	return err
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		return 5 * time.Second
	}
	delay := 5 * time.Second * time.Duration(1<<(attempt-1))
	if delay > 15*time.Minute {
		return 15 * time.Minute
	}
	return delay
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
