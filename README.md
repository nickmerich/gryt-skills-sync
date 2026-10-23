# GRYT Skills Sync + GRYT Skills GitHub App

Status: in development. Tested against a private sandbox repo; not yet registered, deployed or listed.

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

Env: `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`. Permissions: metadata read, contents write, issues write. Events: issues, issue_comment.

Register: `node marketplace/register-url.js https://<deployed-host>` prints a prefilled GitHub App registration link. Listing copy, pricing and submit steps: `marketplace/LISTING.md`.

Public pages (needed for the listing): `/`, `/privacy`, `/support` in `app/public/`.

## Tests

```bash
cd app && npm test
```

## Legacy Python sync

`python gryt_sync.py list|pull|push` still builds `library/index.json` from `sources.json`. Standard library only, Python 3.9+.

Support: nick@gryt.club · https://gryt.club
