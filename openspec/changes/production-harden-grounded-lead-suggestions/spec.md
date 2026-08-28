# Runtime specification delta

## Requirement: fail-closed tenant canary

Suggestion generation MUST run only when the global flag is enabled and the
lead's positive `org_id` is explicitly allowed. Missing, empty, or malformed
allowlist configuration MUST allow no organization.

## Requirement: ingest independence

Suggestion retrieval and generation MUST NOT execute inline on the lead-ingest
critical path. Concurrency and duration MUST be bounded. Saturation, timeout,
or provider failure MUST still produce the base Telegram lead notice.

## Requirement: correct generator

Reply generation MUST use the configured comment-path message generator, not
the classifier generator.

## Requirement: safe grounded links

Rendered product and image links MUST be copied from the selected persisted
product candidate and MUST be absolute HTTPS URLs. Products known to be out of
stock or discontinued MUST NOT be suggested.

## Requirement: operator-only catalog image link

When a selected product has a valid persisted image URL, Telegram MAY render a
clickable image URL. The system MUST NOT generate, download, upload, or publish
the image to Facebook.

## Requirement: production rollout

Production deployment MUST initially keep the feature disabled. Enabling MUST
start with one explicitly allowed organization and retain a flag-only rollback.
