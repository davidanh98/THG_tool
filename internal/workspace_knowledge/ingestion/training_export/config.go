package training_export

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
)

type Config struct {
	BaseURL        string   `json:"base_url"`
	SecretEnv      string   `json:"secret_env"`
	SecretFile     string   `json:"secret_file"`
	Scopes         []string `json:"scopes"`
	TimeoutSeconds int      `json:"timeout_seconds,omitempty"`
	MaxPages       int      `json:"max_pages,omitempty"`
}

func parseConfig(raw json.RawMessage) (Config, error) {
	var cfg Config
	if len(raw) == 0 || json.Unmarshal(raw, &cfg) != nil {
		return cfg, errors.New("training_export: invalid connection_config")
	}
	cfg.BaseURL = strings.TrimSpace(cfg.BaseURL)
	cfg.SecretEnv = strings.TrimSpace(cfg.SecretEnv)
	cfg.SecretFile = strings.TrimSpace(cfg.SecretFile)
	if !strings.HasPrefix(cfg.BaseURL, "https://") || (cfg.SecretEnv == "" && cfg.SecretFile == "") {
		return cfg, errors.New("training_export: base_url must be https and one secret source is required")
	}
	if cfg.SecretEnv != "" && cfg.SecretFile != "" {
		return cfg, errors.New("training_export: configure secret_env or secret_file, not both")
	}
	seen := map[string]struct{}{}
	clean := make([]string, 0, len(cfg.Scopes))
	for _, scope := range cfg.Scopes {
		scope = strings.ToLower(strings.TrimSpace(scope))
		if scope == "sales" {
			scope = "sale"
		}
		if scope != "sale" && scope != "marketing" {
			return cfg, fmt.Errorf("training_export: invalid scope %q", scope)
		}
		if _, ok := seen[scope]; !ok {
			seen[scope] = struct{}{}
			clean = append(clean, scope)
		}
	}
	if len(clean) == 0 {
		return cfg, errors.New("training_export: at least one scope is required")
	}
	sort.Strings(clean)
	cfg.Scopes = clean
	if cfg.TimeoutSeconds <= 0 {
		cfg.TimeoutSeconds = 20
	}
	if cfg.MaxPages <= 0 {
		cfg.MaxPages = 20
	}
	return cfg, nil
}

func loadSecret(cfg Config) (string, error) {
	if cfg.SecretEnv != "" {
		if secret := strings.TrimSpace(os.Getenv(cfg.SecretEnv)); secret != "" {
			return secret, nil
		}
		return "", fmt.Errorf("training_export: %s is empty", cfg.SecretEnv)
	}
	contents, err := os.ReadFile(cfg.SecretFile)
	if err != nil {
		return "", fmt.Errorf("training_export: read secret_file: %w", err)
	}
	if secret := strings.TrimSpace(string(contents)); secret != "" {
		return secret, nil
	}
	return "", errors.New("training_export: secret_file is empty")
}
