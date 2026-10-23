# GRYT Skills: GitHub Marketplace listing kit

Status: app built and tested against a private sandbox repo. Not yet registered as a GitHub App, deployed, or submitted.

## Requirement checklist

| Area | Requirement | Status |
|---|---|---|
| Integration | Useful GitHub functionality beyond sign-in | Done: reads skills, creates milestone + issues, writes check-ins back (`app/lib/plan.js`) |
| Marketplace events | Handle `marketplace_purchase` purchased / changed / cancelled / pending_change / pending_change_cancelled | Done: acknowledged and logged (`app/lib/handler.js`), covered by tests |
| Webhook security | HMAC SHA-256 signature check | Done (`app/lib/github.js`) |
| Privacy policy link | Public URL | Page written (`app/public/privacy.html`), live once deployed. Review before submitting |
| Support link/email | Public URL or email | `/support` page + nick@gryt.club (inbox delivery not yet verified) |
| Publisher contact | Email + website | nick@gryt.club · https://gryt.club |
| Product availability | Public, not invite-only | Pending: register app as public, deploy |
| Visuals | Logo, feature card, screenshots | To do: use GRYT logo; screenshots from the sandbox repo |
| Pricing | At least one plan | Free plan (below) |
| Developer Agreement | Accept in listing flow | To do (Nick) |
| Paid-plan thresholds | 100 installs (GitHub App) + publisher verification | Not needed for a free listing |

## Listing copy

Name: GRYT Skills

Short description (≤ 80 chars): Turn the playbooks in your repos into plans you actually work.

Introductory description:
GRYT Skills reads the skill guides and workflow templates in a repository you choose and turns one into a GitHub plan: a milestone, a tracking issue grouped by week and one issue per step, with every list item as a checkbox. Close the plan and GRYT saves a check-in to your repo with what shipped, what carries over and the notes you left on each task.

Detailed description:
- `/gryt list` on any issue shows the `SKILL.md` and `workflows/*.md` files the app can read
- `/gryt plan <skill> [weeks]` builds the plan (default 4 weeks). Safe to rerun; nothing duplicates
- Closing the `GRYT plan:` tracking issue writes `gryt/checkins/<date>-<plan>.md`
- Works across repos: keep your library in one private repo, plan in another
- No database of your content. Free

Categories: Project management, Learning

Permissions: Metadata read · Contents read & write · Issues read & write
Events: Issues · Issue comment (Marketplace events go to the same webhook URL)

URLs (replace host after deploy):
- Website: https://gryt.club (or deployed host `/`)
- Privacy: `<host>/privacy`
- Support: `<host>/support`
- Webhook: `<host>/api/github/webhooks`

## Pricing plan

| Field | Value |
|---|---|
| Name | Free |
| Type | Free |
| Description | Unlimited plans, repos and check-ins. |
| Bullets | Plans from any SKILL.md or workflow · Weekly milestones and checklists · Check-ins saved to your repo |

## Submit sequence

1. Deploy `app/` (Vercel or any Node 20 host). Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`.
2. `node marketplace/register-url.js https://<host>` and open the link; set a webhook secret, create the app, generate a private key, copy the App ID. Put them in the host's env vars and redeploy.
3. Install on `gryt-plan-sandbox` + one library repo; comment `/gryt plan newcomer-welcome`; screenshot the reply, tracking issue and check-in file.
4. Make the app public (App settings, Advanced).
5. Marketplace: App settings, "List in Marketplace", paste the copy above, add Free plan, upload logo, feature card and screenshots, accept the Developer Agreement.
6. Overview, Request publish.
