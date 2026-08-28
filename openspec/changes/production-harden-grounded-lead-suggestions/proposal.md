# Production-harden grounded lead suggestions

## Why

The grounded Telegram suggestion feature is merged and production is healthy,
but enabling it is not yet safe. The scraper composition root supplies the
classifier generator instead of the comment generator, generation runs inline
on the crawl-ingest path, and the only rollout control is a global flag. The
frontend THG catalog preset also persists an obsolete PDP URL.

## Change

- Wire the comment-path generator in both runtime composition roots.
- Gate execution by both a default-off feature flag and an explicit org
  allowlist.
- Move suggestion generation off the synchronous ingest path with bounded
  concurrency and a short timeout; preserve the base Telegram notice on
  saturation or failure.
- Reject non-HTTPS product/image links and products known to be unavailable.
- Carry the catalog's first real image URL into the operator-only Telegram
  notice as a clickable URL. Do not download, upload, generate, or publish it.
- Correct the frontend THG catalog PDP template and document all runtime knobs.
- Patch production frontend dependencies when the deployment gate reports a
  critical/high advisory, then rebuild from a clean lockfile install.

## Non-goals

- No automatic Facebook comment or inbox execution.
- No image generation, image upload, browser DOM change, or CAPTCHA behavior.
- No database migration or new data plane.
- No broad rollout before one-org canary evidence exists.

## Rollout

Deploy code with `LEAD_SUGGESTION_ENABLED=false`. Then enable one explicit org
through `LEAD_SUGGESTION_ORG_IDS`, verify catalog sync and Telegram output, and
expand only after the canary is stable. Rollback is the flag plus a targeted
scraper/worker restart; Cloudflare configuration remains unchanged.
