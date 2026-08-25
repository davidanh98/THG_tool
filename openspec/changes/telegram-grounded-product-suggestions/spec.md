# Runtime specification

## Requirement: operator-only suggestion

When a new lead event is emitted and `LEAD_SUGGESTION_ENABLED=true`, the system
MUST attempt to build an operator-facing suggestion for the Telegram lead
notification. The suggestion MUST NOT enqueue, approve, or execute a Facebook
outbound action.

## Requirement: grounded product URL

The product URL shown in Telegram MUST be copied from a retrieved
`POD_product` candidate's persisted `SourceURL`. The system MUST omit the
product block when no such candidate exists. It MUST NOT use an LLM-generated
URL or synthesize a URL from arbitrary text.

## Requirement: catalog URL format

For the THG catalog fixture, the source URL template MUST be:

```text
https://thgfulfill.com/vi/catalog?productId={id}
```

## Requirement: best effort

Knowledge retrieval and reply generation failures MUST NOT fail lead ingestion,
lead persistence, or the base Telegram lead notification.

## Requirement: default off

When `LEAD_SUGGESTION_ENABLED` is absent, empty, or false, the system MUST
preserve the existing Telegram lead notification and MUST NOT invoke the
additional suggestion retrieval/generation path.

## Requirement: no public-comment behavior change

This module MUST NOT change Facebook comment text, comment URL policy, outbound
approval state, browser execution, or extension behavior.

## Requirement: tenant isolation

Suggestion retrieval MUST use the event's `org_id`; candidates from another
organization MUST never be selected or rendered.
