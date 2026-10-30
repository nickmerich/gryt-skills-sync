#!/usr/bin/env node
// Live acceptance test against a PRIVATE staging repo.
// Usage: node bin/staging-acceptance.js [SOURCE_REPO] [SKILL] [STAGING_REPO]
// Defaults: nickmerich/run-club-skills newcomer-welcome nickmerich/gryt-plan-sandbox
//
// 1. Refuses to run if the staging repo is public (private-data boundary).
// 2. Reads one approved guide and generates (or tops up) its plan.
// 3. Replays the same plan: must create 0 issues.
// 4. Saves a check-in from the tracking issue, then replays it: must not add a commit.
// Prints counts only; no guide content is printed.
import { makeApi } from "../lib/github.js";
import { ghCliApi } from "../lib/ghcli.js";
import { createPlan, listSkills, readFile, saveCheckin, validateSource } from "../lib/plan.js";

const [sourceRepo = "nickmerich/run-club-skills", skill = "newcomer-welcome", staging = "nickmerich/gryt-plan-sandbox"] = process.argv.slice(2);
const api = process.env.GITHUB_TOKEN ? makeApi(process.env.GITHUB_TOKEN) : ghCliApi;
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`); if (!cond) process.exitCode = 1; };

const info = await api("GET", `/repos/${staging}`);
if (!info.private) { console.error(`${staging} is public. Staging must be private.`); process.exit(2); }

const s = (await listSkills(api, sourceRepo)).find((x) => x.name === skill);
if (!s) { console.error(`No ${skill} in ${sourceRepo}`); process.exit(2); }
const f = await readFile(api, s.repo, s.path, s.branch);
check(validateSource(f.text) === null, `source guide ${s.path} is valid`);

const args = { targetRepo: staging, sourceRepo, sourcePath: s.path, sourceUrl: f.url, sourceSha: f.sha, markdown: f.text, weeks: 4 };
const first = await createPlan(api, args);
console.log(`      plan: ${first.created.length} created, ${first.skipped.length} existing, tracker #${first.tracking.number}`);
const replay = await createPlan(api, args);
check(replay.created.length === 0, `replayed plan created ${replay.created.length} issues (want 0)`);

const tracker = await api("GET", `/repos/${staging}/issues/${first.tracking.number}`);
const c1 = await saveCheckin(api, { repo: staging, trackingIssue: tracker });
const commitsBefore = (await api("GET", `/repos/${staging}/commits?path=${encodeURIComponent(c1.path)}&per_page=100`)).length;
const c2 = await saveCheckin(api, { repo: staging, trackingIssue: tracker });
const commitsAfter = (await api("GET", `/repos/${staging}/commits?path=${encodeURIComponent(c1.path)}&per_page=100`)).length;
check(c1.mode === "file", `check-in saved to ${c1.path} (${c1.done}/${c1.total} done)`);
check(c2.unchanged === true && commitsAfter === commitsBefore, `replayed check-in added ${commitsAfter - commitsBefore} commits (want 0)`);
