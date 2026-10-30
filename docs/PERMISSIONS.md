# Permissions (least privilege)

GRYT Skills is a GitHub App, not an OAuth app or a personal token. It only sees the repositories you select at install time.

| Permission | Level | Why | What breaks without it |
|---|---|---|---|
| Metadata | Read | Required by GitHub for every app | Nothing installs |
| Issues | Read and write | Create the milestone, labels, tracking issue and task issues; reply to `/gryt` commands | No plans, no replies |
| Contents | Read and write | Read `SKILL.md` / `workflows/*.md`; write `gryt/checkins/*.md` when a plan closes | Read-only mode below |

Events: `issues`, `issue_comment`. Installation events arrive automatically. The webhook drops every other event (`HANDLED_EVENTS` in `app/lib/handler.js`).

## Read-only mode

Register with `node marketplace/register-url.js https://<host> --read-only` to grant contents read only. Check-ins are then posted as a comment on the tracking issue instead of a file. Use this for any repo where you don't want the app committing.

## Separate source and writeback repos

The cleanest setup is two installations scopes in one install:

- Library repos (`run-club-skills`, `artist-led-events-skills`, `music-tech-growth-skills`): the app only reads `SKILL.md` and workflow files there.
- One working repo (for example `gryt-plan-sandbox`): plans, issues and check-ins are written only to the repo where the command was typed.

GitHub App permissions are per installation, not per repo, so read-only for libraries is enforced by behavior (the app never writes to a source repo) and by branch protection on the library `main` branches. The private-to-public guard refuses to copy a private guide into a public repo.

## Secrets

`GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET` and installation tokens live only in server env/memory. Tokens are cached in memory until five minutes before expiry and dropped on uninstall/suspend. Nothing logs request headers; only rate-limit and request-id response headers are logged (`safeHeaders`).

## Registration defaults

`register-url.js` now defaults to a private app (`public=false`), so only your account can install it until a release is approved. Pass `--public` later.

Reference: [GitHub App best practices](https://docs.github.com/en/apps/creating-github-apps/about-creating-github-apps/best-practices-for-creating-a-github-app)
