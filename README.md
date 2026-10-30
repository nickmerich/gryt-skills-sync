# GRYT Skills Sync + GRYT Skills GitHub App

Status: v0.2.0 staging. Tested against a private sandbox repo; not yet registered, hosted or listed. See CHANGELOG.md.

GRYT helps people turn goals into repeatable practice. This repo connects private GitHub repositories of skills and workflows to real GitHub work.

## What it does

| Feature | How |
|---|---|
| Read skill guides and workflow templates from repos you pick | Any `SKILL.md` or `workflows/*.md` |
| Turn one into a project plan | Milestone with a due date, one issue per section (list items become checkboxes), tracking issue grouped by week. Idempotent |
| Save updated routines back | Closing the `GRYT plan:` issue writes `gryt/checkins/<date>-<plan>.md` with done / carry-over / notes |
| GitHub Marketplace events | `marketplace_purchase` handled (free plan) |

## Use it now (CLI)

```bash
cd app
# GITHUB_TOKEN=... or be signed in with `gh`
node bin/plan.js nickmerich/run-club-skills newcomer-welcome nickmerich/gryt-plan-sandbox --weeks 4
node bin/plan.js nickmerich/run-club-skills bring-a-friend OWNER/REPO --dry-run
```

## GitHub App

`app/api/webhook.js` (Vercel-style Web handler). Comment on any issue:

```
/gryt list
/gryt plan <skill> [weeks]
/gryt help
```

Env: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`; optional `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` for cross-instance webhook dedupe. Permissions: metadata read, contents write, issues write. Events: issues, issue_comment.

Register: `node marketplace/register-url.js https://<deployed-host>` prints a prefilled registration link (private app by default; `--public`, `--read-only`). Listing copy, pricing and submit steps: `marketplace/LISTING.md`.

Public pages (needed for the listing): `/`, `/privacy`, `/support` in `app/public/`.

## Tests and checks

```bash
cd app
npm run check                     # lint + 30 tests + build check (same as CI)
node bin/staging-acceptance.js    # live round trip against private gryt-plan-sandbox
```

## Permissions, limits and known limits

- Permissions and why: docs/PERMISSIONS.md (least privilege, read-only mode)
- Rate limits, webhooks, spend controls, redelivery: docs/OPERATIONS.md
- Private-data review and deletion path: docs/PRIVATE_DATA_REVIEW.md

Known limits:

- Webhook dedupe is per warm instance unless `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN` are set
- Jobs that hit a long rate-limit reset are not auto-resumed; the person gets a reply with a retry time, and reruns are idempotent
- `/gryt list` shows skill names from every repo in the installation
- One plan per skill per repo (re-running tops up the same plan)

## Release docs

docs/DEMO.md (one-minute demo) · docs/PILOT.md · docs/DISTRIBUTION.md · docs/WEEKLY_REVIEW.md · docs/CREDIT_PROGRAMS.md · docs/LOCKFILES.md · docs/FEATURE_FLAGS.md

## Legacy Python sync

`python gryt_sync.py list|pull|push` still builds `library/index.json` from `sources.json`. Standard library only, Python 3.9+.

Support: nick@gryt.club · https://gryt.club
