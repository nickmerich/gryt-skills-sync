import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { parsePlan, assignWeeks, createPlan } from "../app/lib/plan.js";
import { verifySignature, appJwt } from "../app/lib/github.js";
import { handleEvent, parseCommand } from "../app/lib/handler.js";

const SKILL = `---
name: demo-skill
description: A demo.
---

# Demo Skill

Intro line.

## Step one

1. Do a thing
2. Do another

## Step two

- bullet
- [ ] already a box

\`\`\`
## not a heading
1. not a task
\`\`\`

## Voice

Be kind.
`;

test("parsePlan: sections become tasks, lists become checkboxes, guidance split out", () => {
  const p = parsePlan(SKILL);
  assert.equal(p.name, "demo-skill");
  assert.equal(p.title, "Demo Skill");
  assert.deepEqual(p.tasks.map((t) => t.heading), ["Step one", "Step two"]);
  assert.match(p.tasks[0].body, /- \[ \] Do a thing/);
  assert.match(p.tasks[1].body, /- \[ \] bullet/);
  assert.equal((p.tasks[1].body.match(/\[ \]/g) || []).length, 2, "existing box not doubled");
  assert.match(p.tasks[1].body, /\n1\. not a task/, "code blocks untouched");
  assert.equal(p.guidance.length, 1);
});

test("assignWeeks spreads tasks and never exceeds task count", () => {
  const t = assignWeeks([{}, {}, {}, {}, {}, {}], 4).map((x) => x.week);
  assert.deepEqual(t, [1, 1, 2, 3, 3, 4]);
  assert.deepEqual(assignWeeks([{}, {}], 4).map((x) => x.week), [1, 2]);
});

function fakeGitHub() {
  const s = { issues: [], milestones: [], labels: [], comments: [], files: {} };
  const api = async (method, path, body) => {
    const p = path.split("?")[0];
    if (method === "POST" && p.endsWith("/labels")) { if (s.labels.includes(body.name)) { const e = new Error("exists"); e.status = 422; throw e; } s.labels.push(body.name); return body; }
    if (method === "GET" && p.endsWith("/milestones")) return s.milestones;
    if (method === "POST" && p.endsWith("/milestones")) { const m = { ...body, number: s.milestones.length + 1, html_url: "u" }; s.milestones.push(m); return m; }
    if (method === "PATCH" && /\/milestones\/\d+$/.test(p)) { const m = s.milestones[+p.split("/").pop() - 1]; Object.assign(m, body); return m; }
    if (method === "GET" && p.endsWith("/issues")) return [];  // simulate listing lag
    if (method === "POST" && p.endsWith("/issues")) { const i = { ...body, number: s.issues.length + 1, html_url: "u" }; s.issues.push(i); return i; }
    if (method === "PATCH" && /\/issues\/\d+$/.test(p)) { const i = s.issues[+p.split("/").pop() - 1]; Object.assign(i, body); return i; }
    if (method === "POST" && p.endsWith("/comments")) { s.comments.push(body.body); return {}; }
    if (method === "GET" && p === "/installation/repositories") return { repositories: [{ full_name: "o/skills" }] };
    if (method === "GET" && p === "/repos/o/skills") return { default_branch: "main" };
    if (method === "GET" && p.startsWith("/repos/o/skills/git/trees")) return { tree: [{ type: "blob", path: "skills/demo-skill/SKILL.md" }] };
    if (method === "GET" && p.startsWith("/repos/o/skills/contents/")) return { content: Buffer.from(SKILL).toString("base64"), sha: "abc1234", html_url: "https://x" };
    throw new Error(`unhandled ${method} ${path}`);
  };
  return { s, api };
}

test("createPlan is idempotent even when issue listing lags", async () => {
  const { s, api } = fakeGitHub();
  const args = { targetRepo: "o/t", sourceRepo: "o/skills", sourcePath: "skills/demo-skill/SKILL.md", markdown: SKILL };
  const a = await createPlan(api, args);
  assert.equal(a.created.length, 2);
  const b = await createPlan(api, args);
  assert.equal(b.created.length, 0);
  assert.equal(b.skipped.length, 2);
  assert.equal(s.issues.length, 3, "2 tasks + 1 tracking, no duplicates");
  assert.equal(s.milestones.length, 1);
});

test("parseCommand", () => {
  assert.deepEqual(parseCommand("hey\n/gryt plan newcomer-welcome 3"), { cmd: "plan", skill: "newcomer-welcome", weeks: 3 });
  assert.equal(parseCommand("/gryt list").cmd, "list");
  assert.equal(parseCommand("GRYT plan: drifter-save").skill, "drifter-save");
  assert.equal(parseCommand("nothing here"), null);
});

test("handleEvent: /gryt plan comment builds plan and replies", async () => {
  const { s, api } = fakeGitHub();
  const r = await handleEvent("issue_comment", { action: "created", comment: { body: "/gryt plan demo-skill", user: { type: "User" } }, issue: { number: 99 }, repository: { full_name: "o/t" }, installation: { id: 1 } }, async () => api, () => {});
  assert.equal(r.note, "command plan");
  assert.equal(s.issues.length, 3);
  assert.match(s.comments[0], /Plan ready: \*\*Demo Skill\*\*/);
});

test("handleEvent: bot comments ignored, marketplace events acknowledged", async () => {
  const { api } = fakeGitHub();
  const bot = await handleEvent("issue_comment", { action: "created", comment: { body: "/gryt list", user: { type: "Bot" } }, issue: { number: 1 }, repository: { full_name: "o/t" }, installation: { id: 1 } }, async () => api, () => {});
  assert.equal(bot.note, "own comment");
  for (const action of ["purchased", "changed", "cancelled", "pending_change", "pending_change_cancelled"]) {
    const r = await handleEvent("marketplace_purchase", { action, marketplace_purchase: { account: { login: "a" }, plan: { name: "Free" } } }, null, () => {});
    assert.equal(r.ok, true);
  }
});

test("verifySignature + appJwt", () => {
  const body = '{"a":1}';
  const sig = "sha256=" + crypto.createHmac("sha256", "s3cret").update(body).digest("hex");
  assert.equal(verifySignature("s3cret", body, sig), true);
  assert.equal(verifySignature("wrong", body, sig), false);
  assert.equal(verifySignature("s3cret", body, undefined), false);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" });
  const [h, p, sgn] = appJwt(123, pem, 1000).split(".");
  assert.equal(JSON.parse(Buffer.from(p, "base64url")).iss, "123");
  assert.ok(crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sgn, "base64url")));
});
