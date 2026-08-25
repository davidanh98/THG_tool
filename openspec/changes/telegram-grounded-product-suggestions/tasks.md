# Implementation and verification tasks

## Completed in repository

- [x] Add `SourceURL` to `KnowledgeCandidate` and `GroundedItem`.
- [x] Surface `PayloadV1.SourceURL` from product retrieval.
- [x] Copy `SourceURL` through `groundForRole`.
- [x] Update the THG catalog PDP template to
      `https://thgfulfill.com/vi/catalog?productId={id}`.
- [x] Add `LeadSuggestion` and `PickSuggestedProduct`.
- [x] Add best-effort `BuildLeadSuggestion` using KnowledgeOS retrieval and
      the configured comment-path LLM.
- [x] Add `LEAD_SUGGESTION_ENABLED`, defaulting to false.
- [x] Wire suggestion generation into both scraper connector-ingest and worker
      lead-notification composition roots.
- [x] Extend `LeadNotice` and Telegram rendering with optional suggestion and
      product link fields.
- [x] Add tests for source URL propagation, product selection, and Telegram
      rendering.
- [x] Validate with `go build ./...`, `go vet ./...`, and targeted tests.

## Mentor/agent verification after merge

- [ ] Confirm the feature branch/PR is merged into `main`.
- [ ] Confirm CI build and validation are green for the merge commit.
- [ ] Confirm `/etc/thg-scraper/env` has valid provider keys; no secret is in
      GitHub or the repository.
- [ ] Confirm the THG catalog KnowledgeOS source exists for the target org.
- [ ] Run a catalog sync and inspect one product asset's `SourceURL`.
- [ ] Confirm the asset kind is `POD_product` and the URL uses the new
      `?productId=` format.
- [ ] Enable `LEAD_SUGGESTION_ENABLED=true` only on staging first.
- [ ] Restart `thg-scraper` and `thg-worker` after changing env.
- [ ] Trigger one controlled crawl with a known lead.
- [ ] Verify Telegram contains the existing lead block, a reply suggestion,
      and the grounded product link.
- [ ] Verify a lead with no matching product still creates a normal Telegram
      notification and does not fail ingestion.
- [ ] Verify retrieval/LLM failure leaves lead creation successful.
- [ ] Roll back by setting the flag to false and restarting the two services.
- [ ] Promote to production only after operator review of Vietnamese reply
      quality and link correctness.

## Explicit non-goals to protect during implementation

- Do not add product links to Facebook comments in this change.
- Do not alter `ScreenCommentQuality`, `RepairCommentContacts`, or the
      public-comment URL allow-list.
- Do not add image upload or browser DOM changes.
- Do not generate or download AI images.
- Do not add a new product database; reuse KnowledgeOS and its store owner.
