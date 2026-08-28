# Implementation and production verification

## Repository

- [x] Add fail-closed org allowlist and bounded suggestion runner.
- [x] Wire the scraper to the comment generator and apply the same policy in the worker.
- [x] Validate grounded PDP/image URLs and skip unavailable products.
- [x] Carry the grounded image URL through the operator-only Telegram renderer.
- [x] Correct the frontend THG catalog PDP template and document production env knobs.
- [x] Resolve critical/high production dependency advisories found by the rollout audit.
- [x] Add focused unit/integration coverage for policy, saturation, timeout, grounding, and rendering.

## Gates

- [ ] Run focused Go tests and race tests.
- [ ] Run repository AI preflight and validation workflows.
- [x] Run extension tests and frontend production build.
- [x] Review the final diff for tenant, outbound, browser, and data-plane invariants.

## Production

- [ ] Push the branch and obtain green required CI checks.
- [ ] Merge/deploy code with suggestions disabled and verify public health.
- [ ] Confirm production catalog source/assets and provider configuration for one org.
- [ ] Enable exactly one org, restart only active non-held services, and verify a controlled live notice.
- [ ] Record rollback evidence and expand only after operator approval.
