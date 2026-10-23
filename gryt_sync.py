#!/usr/bin/env python3
"""GRYT Skills Sync: build one library from private GitHub skill repos.

Uses the GitHub REST API to:
  - list skills (SKILL.md files) across one or more repositories
  - pull them into a single library index (library/index.json + library/README.md)
  - push an updated file back to a repository (create or update via the Contents API)

Auth: set GITHUB_TOKEN to a token with read access to the source repos
(and write access to the target repo for `push`), or sign in with the
GitHub CLI and leave GITHUB_TOKEN unset.
"""
import argparse
import base64
import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request

API = "https://api.github.com"
CONFIG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sources.json")


def gh_cli(method, path, body=None):
    """Fallback transport: call the same REST endpoints through the GitHub CLI."""
    cmd = ["gh", "api", "-X", method, path.lstrip("/"), "-H", "X-GitHub-Api-Version: 2022-11-28"]
    if body is not None:
        cmd += ["--input", "-"]
    r = subprocess.run(cmd, input=json.dumps(body) if body is not None else None,
                       capture_output=True, text=True)
    if r.returncode != 0:
        if "404" in (r.stderr + r.stdout) and method == "GET":
            return None
        sys.exit(f"GitHub API {method} {path} failed: {r.stderr.strip()[:300]}")
    return json.loads(r.stdout or "{}")


def gh(method, path, body=None):
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        if shutil.which("gh"):
            return gh_cli(method, path, body)
        sys.exit("Set GITHUB_TOKEN or sign in with the GitHub CLI (gh auth login)")
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "gryt-skills-sync",
        },
    )
    try:
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        if e.code == 404 and method == "GET":
            return None
        sys.exit(f"GitHub API {method} {path} failed: {e.code} {e.read().decode()[:300]}")


def frontmatter(text):
    meta = {}
    if text.startswith("---"):
        block = text.split("---", 2)[1]
        for line in block.splitlines():
            if ":" in line and not line.startswith(" "):
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip().strip('"')
    return meta


def list_skills(repo):
    info = gh("GET", f"/repos/{repo}")
    branch = info["default_branch"]
    tree = gh("GET", f"/repos/{repo}/git/trees/{branch}?recursive=1")
    skills = []
    for item in tree.get("tree", []):
        if item["type"] == "blob" and item["path"].endswith("SKILL.md"):
            f = gh("GET", f"/repos/{repo}/contents/{item['path']}?ref={branch}")
            text = base64.b64decode(f["content"]).decode("utf-8", "replace")
            meta = frontmatter(text)
            skills.append({
                "name": meta.get("name") or item["path"].split("/")[-2],
                "description": meta.get("description", ""),
                "repo": repo,
                "path": item["path"],
                "sha": f["sha"],
                "url": f["html_url"],
            })
    return skills


def load_sources(args):
    if args.repos:
        return args.repos
    with open(CONFIG) as fh:
        return json.load(fh)["repos"]


def cmd_list(args):
    for repo in load_sources(args):
        for s in list_skills(repo):
            print(f"{s['repo']}\t{s['name']}")


def cmd_pull(args):
    library = []
    for repo in load_sources(args):
        library.extend(list_skills(repo))
    os.makedirs(args.out, exist_ok=True)
    with open(os.path.join(args.out, "index.json"), "w") as fh:
        json.dump({"count": len(library), "skills": library}, fh, indent=2)
    lines = ["# GRYT Skills Library", "", f"{len(library)} skills across {len(set(s['repo'] for s in library))} repositories.", ""]
    for repo in sorted(set(s["repo"] for s in library)):
        lines += [f"## {repo}", ""]
        for s in [x for x in library if x["repo"] == repo]:
            desc = s["description"].split(". ")[0][:160]
            lines.append(f"- [{s['name']}]({s['url']}): {desc}")
        lines.append("")
    with open(os.path.join(args.out, "README.md"), "w") as fh:
        fh.write("\n".join(lines))
    print(f"Pulled {len(library)} skills into {args.out}/")


def cmd_push(args):
    with open(args.file, "rb") as fh:
        content = base64.b64encode(fh.read()).decode()
    existing = gh("GET", f"/repos/{args.repo}/contents/{args.path}")
    body = {"message": args.message, "content": content}
    if existing:
        body["sha"] = existing["sha"]
    res = gh("PUT", f"/repos/{args.repo}/contents/{args.path}", body)
    print(f"{'Updated' if existing else 'Created'} {args.repo}/{args.path} @ {res['commit']['sha'][:7]}")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("list", help="List skills in the source repos")
    a.add_argument("repos", nargs="*")
    a.set_defaults(fn=cmd_list)
    b = sub.add_parser("pull", help="Build library/index.json and library/README.md")
    b.add_argument("repos", nargs="*")
    b.add_argument("--out", default="library")
    b.set_defaults(fn=cmd_pull)
    c = sub.add_parser("push", help="Create or update a file in a repo")
    c.add_argument("repo")
    c.add_argument("path")
    c.add_argument("file")
    c.add_argument("--message", default="Update via GRYT Skills Sync")
    c.set_defaults(fn=cmd_push)
    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
