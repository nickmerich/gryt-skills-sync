# Builder checklist status (2026-10-29)

14 of 20 done. The other 6 need you (approval, your login, or a hosted app).

| Phase | Task | Status | Evidence |
|---|---|---|---|
| Set up | Verify the member support inbox | Done | docs/SUPPORT_INBOX.md, received in 6 s |
| Set up | Request the current member benefit schedule | Needs you | Draft in docs/BENEFIT_REQUEST.md, not sent |
| Set up | Write one small acceptance test | Done | `bin/staging-acceptance.js` 4/4 PASS live; acceptance test in tests/hardening.test.js |
| Build | Use least-privilege installation access | Done | docs/PERMISSIONS.md, private-by-default registration, `--read-only` |
| Build | Verify webhooks and queue updates | Done | app/lib/queue.js, delivery dedupe, dead-letter, `npm run redeliver` |
| Build | Cache reads and handle rate limits | Done | app/lib/github.js, 8 client tests |
| Build | Record real API headroom | Partial | CLI token recorded (5,000/h core). App installation limit needs the hosted app; logging is in place (docs/OPERATIONS.md) |
| Build | Add lint, tests and a build check | Done | .github/workflows/ci.yml, green on PR #2 in 12 s |
| Build | Set spend controls before paid usage | Done | docs/OPERATIONS.md: $0 net all months, retention 90 to 7 days, no Codespaces. Confirm budgets page once |
| Test | Inventory your actual feature flags | Needs you | Comet didn't connect; docs/FEATURE_FLAGS.md |
| Test | Test workflow lockfiles in isolation | Partial | Actions SHA-pinned; `gh actions-lock` blocked by sandbox proxy (docs/LOCKFILES.md) |
| Test | Exercise the unhappy paths | Done | revoked install, removed access, duplicate webhook, 429, 5xx, invalid file: all tested |
| Test | Review private-data boundaries | Done | docs/PRIVATE_DATA_REVIEW.md, two leaks fixed |
| Ship | Prepare a demo, README and support path | Done | docs/DEMO.md, README, support page, issue template, CHANGELOG |
| Ship | Ship a versioned staging release | Done | v0.2.0-staging prerelease, rollback v0.1.0 (7/7 tests) |
| Ship | Invite a small pilot after approval | Needs you | docs/PILOT.md, invite drafted, nothing sent |
| Grow | Screen separate credit programs | Done | docs/CREDIT_PROGRAMS.md: GitHub for Startups not eligible yet |
| Grow | Share one reproducible technical question | Needs you | docs/COMMUNITY_QUESTION.md, not posted |
| Grow | Choose distribution after pilot evidence | Done | docs/DISTRIBUTION.md: stay private until pilot |
| Grow | Run a 20-minute weekly review | Done | weekly-review.yml (Mondays 9 ET after merge), first issue #3 |
