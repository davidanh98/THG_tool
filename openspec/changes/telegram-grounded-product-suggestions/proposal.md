# Telegram grounded product suggestions

## Status

Implementation is present on branch `feat/comment-product-link-grounding` and
has been validated locally. The implementation commits are:

- `c33d393` — carries the catalog PDP URL through the knowledge/grounding path.
- `6a12c4c` — adds the gated Telegram lead suggestion and rendering path.

This document is the handoff for production verification and operational setup.

## Goal

When a new Facebook lead is created, send the operator a Telegram notification
that may include:

1. the existing lead details;
2. an AI-generated reply suggestion; and
3. the name and canonical product link for the best grounded THG catalog product.

The product link must come from the ingested catalog record. The system must
never construct a product claim from an LLM response or invent a URL.

## Scope

In scope:

- THG catalog product URL propagation through KnowledgeOS retrieval and
  grounding;
- operator-only Telegram rendering of the suggestion and product link;
- an environment flag to enable/disable suggestion generation;
- best-effort behavior: suggestion failures never fail lead ingestion;
- tests, build, validation, rollout and rollback instructions.

Out of scope:

- automatic Facebook comments or inbox messages;
- changing the outbound approval gate;
- adding product links to public Facebook comments;
- uploading or attaching product images to Facebook;
- generating AI images;
- changing the catalog API schema or introducing a new database plane.

## Product safety contract

- Telegram is an operator review channel, not an execution channel for this
  feature.
- The suggestion is informational. The operator decides whether and how to
  reply.
- If no grounded product with a real PDP URL is retrieved, the product block is
  omitted.
- If retrieval or text generation fails, lead creation and the base Telegram
  lead notification continue.
- `LEAD_SUGGESTION_ENABLED` defaults to `false`.
- Existing Facebook outbound behavior remains unchanged.
