# Pilot plan (not started: needs approval)

Gate: green CI, hosted staging app registered as private, tested rollback, and your explicit OK. Nothing here has been sent.

Target: three testers who already keep routines in GitHub or will try. Suggested profiles, not invitations:

1. A GRYT regular who coordinates newcomer buddies (Newcomer Welcome plan)
2. A run-club organizer in another city (Bring-a-Friend plan)
3. A music-tech builder (a `music-tech-growth-skills` workflow)

These are targets, not existing adoption.

## Metrics

| Metric | How | Good enough |
|---|---|---|
| Successful first sync | Bot replied "Plan ready" on first try | 3 of 3 |
| Time to first result | Install time to first "Plan ready" comment | Under 10 minutes |
| Repeat use | A second `/gryt plan` or a closed tracker within 14 days | 2 of 3 |
| API calls per sync | Count `github_api` log lines per delivery id | Stays well under 100 |
| Support friction | Emails or "I couldn't…" replies per tester | 1 or fewer |

## Draft invite (do not send without approval)

> Subject: Try a GitHub plan from a GRYT routine?
>
> Hey [name], I built a small GitHub App that turns a routine (like our newcomer buddy flow) into a GitHub milestone with one issue per step, then saves a check-in back to your repo when you close it. It's private and early. Would you try it on a private repo for two weeks and tell me where it gets confusing? Setup is about 5 minutes and I'll walk you through it.
>
> Nick
