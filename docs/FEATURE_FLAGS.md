# Feature preview inventory

Account flags are only visible while signed in: profile picture > Feature preview. Read in Comet on 2026-10-30 (8 previews listed for nickmerich). Update during the weekly review.

| Feature | Enabled? | Relevant to this app? | Feedback URL | Checked |
|---|---|---|---|---|
| Colorblind themes | On | No | https://github.com/github/feedback/discussions/categories/general-feedback | 2026-10-30 |
| Command Palette | Off | No | https://github.com/github/feedback/discussions/categories/general-feedback | 2026-10-30 |
| Organization Custom Instructions (Copilot) | On | No | https://support.github.com/contact/feedback | 2026-10-30 |
| Rich Jupyter Notebook Diffs | Off | No | https://github.com/community/community/discussions/37376 | 2026-10-30 |
| New Files Changed Experience | Off | Low (PR review only) | https://gh.io/new-files-changed-feedback | 2026-10-30 |
| New Files Changed Perf Experiment | On | Low (PR review only) | https://gh.io/new-files-changed-feedback | 2026-10-30 |
| New Repository Pull Requests Dashboard | On | No | none listed | 2026-10-30 |
| Slash Commands | On | Watch: issue-comment UI may suggest `/` commands while people type `/gryt` | https://github.com/orgs/community/discussions/40299 | 2026-10-30 |

None of these change the App's API or webhook behavior. Slash Commands is the only one that touches the `/gryt` comment UX; commands still post as plain text.

Known previews/GA changes that matter here (from the changelog, not account flags):

| Change | Status | Date | Action |
|---|---|---|---|
| Actions workflow lockfiles | Public preview Oct 14, GA Oct 28, 2026 | 2026-10-28 | See `docs/LOCKFILES.md` |
| Stateless GitHub App installation tokens | Rolled out | 2026-10-02 | Read the entry before hosting and confirm the in-memory token cache in `app/lib/github.js` still fits |

Reference: [Exploring early access releases with feature preview](https://docs.github.com/en/get-started/using-github/exploring-early-access-releases-with-feature-preview)
