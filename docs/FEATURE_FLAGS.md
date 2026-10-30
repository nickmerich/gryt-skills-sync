# Feature preview inventory

Account flags are only visible while signed in: profile picture > Feature preview. They can't be read through the API, so fill this in by hand and update it during the weekly review.

| Feature | Availability | Enabled? | Relevant to this app? | Feedback URL | Checked |
|---|---|---|---|---|---|
| | | | | | |

Known previews/GA changes that matter here (from the changelog, not account flags):

| Change | Status | Date | Action |
|---|---|---|---|
| Actions workflow lockfiles | Public preview Oct 14, GA Oct 28, 2026 | 2026-10-28 | See `docs/LOCKFILES.md` |
| Stateless GitHub App installation tokens | Rolled out | 2026-10-02 | Read the entry before hosting and confirm the in-memory token cache in `app/lib/github.js` still fits |

Reference: [Exploring early access releases with feature preview](https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview)
