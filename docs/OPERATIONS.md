# Operations

## API headroom (recorded 2026-10-29)

Context: the connected `gh` CLI user token, not an app installation token.

| Resource | Limit / hour | Source |
|---|---|---|
| core (REST) | 5,000 | `gh api rate_limit`, `X-RateLimit-Limit: 5000`, `X-RateLimit-Resource: core` |
| graphql | 5,000 points | `gh api rate_limit` |
| search | 30 / minute | `gh api rate_limit` |

This is not the app's limit. Installation tokens get their own bucket (GitHub documents a 5,000/hour floor that scales with repos and users on non-Enterprise accounts). Record the real number the first time the hosted app runs:

```bash
# inside the deployed app, or with an installation token in GITHUB_TOKEN
curl -sI -H "Authorization: Bearer $GITHUB_TOKEN" https://api.github.com/rate_limit | grep -i x-ratelimit
```

Every API call already logs `x-ratelimit-limit/remaining/used/reset/resource` and `x-github-request-id` (never the token), so the first real `/gryt plan` gives the number in the logs.

API calls per sync: count `github_api` log lines per delivery id during the pilot. That is one of the pilot metrics in `docs/PILOT.md`.

## Rate-limit behavior

- Conditional GETs with ETag (`If-None-Match`); 304s are served from cache.
- `Link: rel="next"` pagination for installation repositories.
- 429 or 403 with `Retry-After` / `x-ratelimit-remaining: 0`: wait per header, up to 15 s inside a webhook, max 3 retries. Beyond that the person gets a reply with the UTC time to retry. Re-running is safe (idempotent).
- 5xx and network errors: exponential backoff (0.5 s, 1 s, 2 s), then the queue retries the job up to 3 times.
- A plain 403 is treated as a permission problem, not a rate limit.

Reference: [REST best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api), [rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## Webhooks

1. Signature verified (`X-Hub-Signature-256`, timing-safe compare) before parsing.
2. Unsubscribed events return 200 and are dropped.
3. `X-GitHub-Delivery` is claimed in the delivery store (3-day TTL). A repeat delivery returns `duplicate delivery` without doing work.
4. Jobs run through a serial queue with a retry ceiling. Failed jobs go to a dead-letter list and their claim is released.
5. Response within 8 s; long jobs return 202 and finish under `waitUntil`.

Multi-instance dedupe: set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without them, dedupe is per warm instance (fine for a pilot of three).

Controlled retry:

```bash
cd app
npm run redeliver            # list failed deliveries
npm run redeliver -- <id>    # redeliver one
npm run redeliver -- --all   # redeliver up to 20
```

## Spend controls (checked 2026-10-29)

| Item | Status |
|---|---|
| Plan | GitHub Free |
| Actions minutes, Oct 2026 | 225 Linux minutes used, $1.35 gross, $0.00 net (inside the included 2,000) |
| Actions minutes, Jul to Sep | 168 / 137 / 195, all $0.00 net |
| Codespaces | None running. Last use June 2026 (1.07 h), $0.00 net |
| Artifact and log retention, this repo | Lowered from 90 to 7 days |
| Actions cache, this repo | 0 bytes |
| CI cost guard | `timeout-minutes: 5`, `cancel-in-progress` concurrency, no artifacts uploaded |
| Weekly review job | `timeout-minutes: 2`, about 4 minutes a month |
| Budgets | Not readable by API on this account. Confirm at github.com/settings/billing/budgets that Actions and Codespaces are $0 with "stop usage" on |

Do not add a payment method or a paid plan to chase API headroom. The app does not need it.

Reference: [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions), [Codespaces billing](https://docs.github.com/en/billing/concepts/product-billing/github-codespaces)
