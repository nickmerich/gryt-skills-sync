# Changelog

## 0.2.0 (staging, 2026-10-29)

Hardening pass from the Developer Program builder checklist.

- REST client: conditional GETs (ETag), Link pagination, Retry-After and reset handling with a wait ceiling, exponential backoff for 5xx and network errors, credential-free header logging
- Webhooks: drop unsubscribed events, dedupe by `X-GitHub-Delivery`, serial queue with retry ceiling and dead-letter, 202 for long jobs, no internal error text in responses, `npm run redeliver` for controlled retries
- Unhappy paths with a visible recoverable state: revoked installation, removed repo access, 429, upstream 5xx, invalid source file, weeks out of range, read-only installs (check-in posted as a comment)
- Private-data boundary: private guides are never copied into public repos; uninstall purges cached tokens and delivery records
- Replayed check-ins no longer create duplicate commits
- Least privilege: app registration defaults to private; `--read-only` option
- CI: lint, 30 tests, build check on every PR, actions pinned to commit SHAs, read-only token
- Live staging acceptance script (`node bin/staging-acceptance.js`)
- Weekly review workflow and ops docs (rate limits, spend, pilot, distribution, credit screening)

## 0.1.0 (2026-10-23)

First GitHub App implementation: plans from skills, check-ins back to the repo, Marketplace events.
