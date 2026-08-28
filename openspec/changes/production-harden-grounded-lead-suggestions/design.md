# Design

## Runtime policy

`LEAD_SUGGESTION_ENABLED` remains the global emergency switch and defaults to
false. When it is true, `LEAD_SUGGESTION_ORG_IDS` is still required. An empty or
invalid allowlist permits no organization. `*` is supported only for an
intentional, post-canary full rollout.

## Bounded asynchronous delivery

Lead persistence remains synchronous, but optional suggestion generation does
not. Each process owns a small semaphore-backed runner. If a slot is available,
the runner generates under a bounded timeout and sends one enriched Telegram
notice. If all slots are occupied, it immediately sends the existing base
notice. This bounds goroutines and provider traffic while ensuring notification
delivery never depends on the LLM.

## Grounding and links

Selection continues to use ranked, org-scoped, approved KnowledgeOS candidates.
It skips `out_of_stock` and `discontinued` candidates and accepts only absolute
HTTPS PDP URLs. The first product image is copied from the persisted product
payload only when it is also an absolute HTTPS URL. The model never supplies
either URL.

## Composition

The scraper and worker composition roots construct the comment-path generator,
org policy, and bounded runner. Neutral server packages receive only lead-ingest
and notification contracts. Both runtime roots share the same policy semantics.

## Failure and rollback

Retrieval, generation, malformed links, timeout, or saturation degrade to a
base Telegram lead notice. No lead/database mutation is rolled back. Disable
the feature and restart only `thg-scraper` and `thg-worker` to roll back.

## Frontend security gate

Production uses a supported Next.js Maintenance LTS release. Patched compatible
transitive versions are pinned when npm advisories affect the framework's
bundled PostCSS/nanoid versions. A clean `npm ci`, zero critical/high production
audit, and production build are required before merge.
