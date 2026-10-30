# Workflow lockfiles

Status: started with the lowest-risk workflow (`weekly-review.yml`). Lockfile generation is not committed yet.

What was done

- Both workflows pin every action to a full commit SHA with the version in a comment (`actions/checkout@3d3c42e… # v7.0.1`, `actions/setup-node@949feb2… # v7.1.0`). That already gives the main lockfile guarantee: a moved tag can't change what runs.
- `gh actions-lock` v0.4.0 was built from source and run against `weekly-review.yml`. It stopped with `HTTP 403` from the build sandbox's network proxy on GitHub's GraphQL API, and wrote nothing. That's an environment limit, not a finding about the workflow.
- Known-good rollback point for workflow changes: the commit that adds these workflows on branch `devprogram-checklist`.

To finish on your machine (about 2 minutes):

```bash
gh extension install github/gh-actions-lock
gh actions-lock .github/workflows/weekly-review.yml   # onboard the low-risk one first
git diff                                              # review .github/workflows/actions.lock
gh actions-lock --verify                              # frozen check
# after one clean weekly-review run, onboard CI:
gh actions-lock .github/workflows/ci.yml
```

Then add a CI step `gh actions-lock --verify-local` (offline, no auth) and consider the repository "Require lockfile" policy once both workflows are onboarded. Lockfiles went GA on Oct 28, 2026; recheck the docs for any GA changes before turning on the policy.

Reference: [Workflow lockfiles announcement](https://github.blog/changelog/2026-10-14-github-actions-workflow-lockfiles-in-public-preview/)
