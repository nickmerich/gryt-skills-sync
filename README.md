# GRYT Skills Sync

Status: in development.

GRYT helps people turn goals into repeatable practice. This tool connects to private GitHub repositories through the GitHub REST API to retrieve and update reusable skills, learning routines, and project workflows, and combines them into one GRYT library.

## Commands

```bash
export GITHUB_TOKEN=...            # or leave unset and use `gh auth login`
python gryt_sync.py list           # list every SKILL.md across sources.json
python gryt_sync.py pull           # write library/index.json and library/README.md
python gryt_sync.py push OWNER/REPO path/in/repo local-file --message "..."
```

## GitHub API endpoints used

- `GET /repos/{owner}/{repo}` for the default branch
- `GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1` to find skills
- `GET /repos/{owner}/{repo}/contents/{path}` to read skills
- `PUT /repos/{owner}/{repo}/contents/{path}` to create or update files

Standard library only, Python 3.9+.

Support: nick@gryt.club · https://gryt.club

## License

MIT. See [LICENSE](LICENSE).
