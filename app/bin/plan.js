#!/usr/bin/env node
// Usage: node bin/plan.js SOURCE_REPO SKILL_OR_PATH TARGET_REPO [--weeks 4] [--dry-run]
// Auth: GITHUB_TOKEN, or falls back to `gh auth token`.
import { spawnSync } from "node:child_process";
import { makeApi } from "../lib/github.js";
import { createPlan, listSkills, readFile } from "../lib/plan.js";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i === -1) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const dryRun = args.includes("--dry-run"); if (dryRun) args.splice(args.indexOf("--dry-run"), 1);
const weeks = +(flag("--weeks") || 4);
const [sourceRepo, skill, targetRepo] = args;
if (!sourceRepo || !skill || !targetRepo) { console.error("Usage: plan.js SOURCE_REPO SKILL TARGET_REPO [--weeks N] [--dry-run]"); process.exit(1); }
// Transport: GITHUB_TOKEN over HTTPS, or the GitHub CLI if you're signed in with `gh`.
function ghCliApi(method, path, body) {
  const r = spawnSync("gh", ["api", "-X", method, path.replace(/^\//, ""), "-H", "X-GitHub-Api-Version: 2022-11-28", ...(body ? ["--input", "-"] : [])], { input: body ? JSON.stringify(body) : undefined, encoding: "utf8" });
  if (r.status !== 0) {
    const m = (r.stdout + r.stderr).match(/HTTP (\d{3})/);
    const err = new Error(`gh api ${method} ${path} failed: ${(r.stderr || r.stdout).slice(0, 200)}`);
    err.status = m ? +m[1] : 500;
    throw err;
  }
  return Promise.resolve(r.stdout ? JSON.parse(r.stdout) : {});
}
const api = process.env.GITHUB_TOKEN ? makeApi(process.env.GITHUB_TOKEN) : ghCliApi;
const skills = await listSkills(api, sourceRepo);
const s = skills.find((x) => x.name === skill || x.path === skill);
if (!s) { console.error(`No skill "${skill}" in ${sourceRepo}. Have: ${skills.map((x) => x.name).join(", ")}`); process.exit(1); }
const f = await readFile(api, s.repo, s.path, s.branch);
const r = await createPlan(api, { targetRepo, sourceRepo, sourcePath: s.path, sourceUrl: f.url, sourceSha: f.sha, markdown: f.text, weeks, dryRun });
console.log(JSON.stringify(r, null, 2));
