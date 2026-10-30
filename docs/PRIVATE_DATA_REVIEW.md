# Private-data boundary review (2026-10-29)

Scope: everything a user, a visitor or a log reader can see.

| Surface | Risk | Result |
|---|---|---|
| `GET /api/webhook` | Config leak | Returns `{ok, app, status}` only. Build check fails if it ever mentions key/secret/token |
| Webhook error responses | Internal error text | Fixed. Was returning `e.message`; now returns `processing failed` plus the delivery id |
| Logs | Tokens, guide content | Only event/action/account/repo and rate-limit headers. Lint fails on logging token-like values |
| Plans in a public repo | Private library content copied into public issues | Fixed. `crossesBoundary()` refuses private source to public target, with a reply explaining why |
| Check-in files | Guide content | Contain task titles, done state and the person's own comments, not the guide body (asserted in the acceptance test) |
| `/gryt list` in a public repo | Lists private skill names | Accepted for now: only the installer's selected repos are listed, and only to people who can comment there. Revisit before a public listing |
| Public pages (`/`, `/privacy`, `/support`) | Private library names | None present |
| Repo access changes | Acting on stale access | Every command re-reads `/installation/repositories` with the installation token; removed repos are skipped or produce an "add it back" reply |
| Uninstall / suspend | Data retention | Cached token and delivery records for that installation are purged. Privacy page updated |

Data-deletion path: uninstall removes access immediately and triggers the purge; email nick@gryt.club for hosting-log deletion. Everything the app creates lives in the user's own repo.

Before a pilot: re-run this table, and confirm the Vercel log retention setting matches the privacy page.
