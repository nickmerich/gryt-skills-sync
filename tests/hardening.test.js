import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { makeApi, parseLink, rateLimitWaitMs, safeHeaders, RateLimitError, InstallationGoneError, GitHubError, installationApi } from "../app/lib/github.js";
import { createQueue, memoryStore } from "../app/lib/queue.js";
import { handleEvent, crossesBoundary } from "../app/lib/handler.js";
import { validateSource, saveCheckin } from "../app/lib/plan.js";
import { makeWebhook } from "../app/api/webhook.js";

const noSleep = async () => {};
const res = (status, body = {}, headers = {}) => new Response(status === 304 ? null : JSON.stringify(body), { status, headers });

// ---------- REST client ----------

test("conditional GET: second read sends If-None-Match and serves the cache on 304", async () => {
  const seen = [];
  const f = async (url, init) => { seen.push(init.headers["If-None-Match"]); return seen.length === 1 ? res(200, { v: 1 }, { etag: '"abc"' }) : res(304); };
  const api = makeApi("t", { fetchImpl: f, sleep: noSleep });
  assert.deepEqual(await api("GET", "/x"), { v: 1 });
  assert.deepEqual(await api("GET", "/x"), { v: 1 });
  assert.deepEqual(seen, [undefined, '"abc"']);
});

test("429 with Retry-After is retried, then succeeds", async () => {
  let n = 0; const waits = [];
  const f = async () => (++n === 1 ? res(429, {}, { "retry-after": "2" }) : res(200, { ok: 1 }));
  const api = makeApi("t", { fetchImpl: f, sleep: async (ms) => waits.push(ms) });
  assert.deepEqual(await api("GET", "/y"), { ok: 1 });
  assert.deepEqual(waits, [2000]);
});

test("primary limit exhausted beyond the wait ceiling throws RateLimitError with retryAt", async () => {
  const now = 1_000_000_000_000;
  const f = async () => res(403, {}, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 600) });
  const api = makeApi("t", { fetchImpl: f, sleep: noSleep, now: () => now, maxWaitMs: 15_000 });
  await assert.rejects(api("GET", "/z"), (e) => e instanceof RateLimitError && e.retryAt > now);
});

test("plain 403 is a permission error, not a rate limit", async () => {
  const api = makeApi("t", { fetchImpl: async () => res(403, { message: "Resource not accessible by integration" }), sleep: noSleep });
  await assert.rejects(api("GET", "/p"), (e) => e instanceof GitHubError && !(e instanceof RateLimitError) && e.status === 403 && !e.retryable);
});

test("5xx retried with backoff up to the ceiling, then retryable error", async () => {
  let n = 0;
  const api = makeApi("t", { fetchImpl: async () => { n++; return res(502); }, sleep: noSleep, maxRetries: 3 });
  await assert.rejects(api("GET", "/u"), (e) => e.retryable && e.status === 502);
  assert.equal(n, 4);
});

test("network failure becomes a retryable 503", async () => {
  const api = makeApi("t", { fetchImpl: async () => { throw new Error("ECONNRESET"); }, sleep: noSleep, maxRetries: 1 });
  await assert.rejects(api("GET", "/n"), (e) => e.retryable && e.status === 503);
});

test("paginate follows Link rel=next", async () => {
  const pages = { "https://api.github.com/r?per_page=1": [res(200, [1], { link: '<https://api.github.com/r?page=2>; rel="next"' })], "https://api.github.com/r?page=2": [res(200, [2])] };
  const api = makeApi("t", { fetchImpl: async (u) => pages[u].shift(), sleep: noSleep });
  assert.deepEqual(await api.paginate("/r?per_page=1"), [1, 2]);
  assert.deepEqual(parseLink('<a>; rel="next", <b>; rel="last"'), { next: "a", last: "b" });
});

test("logged headers never include credentials", async () => {
  const logs = [];
  const api = makeApi("SECRET-TOKEN", { fetchImpl: async () => res(200, {}, { "x-ratelimit-remaining": "42", "set-cookie": "x" }), log: (o) => logs.push(JSON.stringify(o)) });
  await api("GET", "/h");
  assert.match(logs[0], /"x-ratelimit-remaining":"42"/);
  assert.doesNotMatch(logs.join(), /SECRET-TOKEN|set-cookie|Authorization/i);
  assert.deepEqual(Object.keys(safeHeaders(new Headers({ authorization: "x", "retry-after": "1" }))), ["retry-after"]);
  assert.equal(rateLimitWaitMs(403, new Headers({})), null);
});

test("revoked installation: token mint 401/404 becomes InstallationGoneError", async () => {
  const { privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const env = { GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: privateKey.export({ type: "pkcs1", format: "pem" }) };
  for (const s of [401, 404]) await assert.rejects(installationApi(777 + s, env, async () => res(s)), InstallationGoneError);
});

// ---------- queue + dedupe ----------

test("duplicate delivery ids are processed once", async () => {
  const q = createQueue({ store: memoryStore(), sleep: noSleep, log: () => {} });
  let runs = 0;
  const a = await q.enqueue({ id: "d1", event: "issues", run: async () => ++runs });
  await a.done;
  const b = await q.enqueue({ id: "d1", event: "issues", run: async () => ++runs });
  assert.equal(b.duplicate, true);
  assert.equal(runs, 1);
});

test("retryable failure is retried; exhausted jobs dead-letter and release the claim for redelivery", async () => {
  const q = createQueue({ store: memoryStore(), sleep: noSleep, log: () => {}, maxAttempts: 3 });
  let n = 0;
  const ok = await (await q.enqueue({ id: "r1", event: "issues", run: async () => { if (++n < 3) throw Object.assign(new Error("x"), { retryable: true }); return "done"; } })).done;
  assert.equal(ok.ok, true); assert.equal(ok.attempts, 3);
  const bad = await (await q.enqueue({ id: "r2", event: "issues", run: async () => { throw Object.assign(new Error("boom"), { status: 500, retryable: true }); } })).done;
  assert.equal(bad.ok, false);
  assert.equal(q.deadLetter.at(-1).id, "r2");
  const again = await q.enqueue({ id: "r2", event: "issues", run: async () => "ok" });
  assert.equal(again.duplicate, false, "manual redelivery can run again");
});

test("non-retryable failure is not retried", async () => {
  const q = createQueue({ store: memoryStore(), sleep: noSleep, log: () => {} });
  let n = 0;
  await (await q.enqueue({ id: "x", event: "issues", run: async () => { n++; throw new Error("bad input"); } })).done;
  assert.equal(n, 1);
});

// ---------- fake GitHub for handler-level tests ----------

const GUIDE = "---\nname: welcome\ndescription: d\n---\n# Welcome\n\n## Greet\n\n1. Say hi\n\n## Pair\n\n- Find a buddy\n";

function fakeGitHub({ repos = [{ full_name: "o/lib", private: true }], fail = {} } = {}) {
  const s = { issues: [], milestones: [], labels: [], comments: [], files: {}, commits: 0 };
  const api = async (method, path, body) => {
    const p = path.split("?")[0];
    for (const [re, err] of Object.entries(fail)) if (new RegExp(re).test(`${method} ${p}`)) throw typeof err === "function" ? err() : err;
    if (method === "POST" && p.endsWith("/labels")) { if (s.labels.includes(body.name)) throw Object.assign(new Error("exists"), { status: 422 }); s.labels.push(body.name); return body; }
    if (method === "GET" && p.endsWith("/milestones")) return s.milestones;
    if (method === "POST" && p.endsWith("/milestones")) { const m = { ...body, number: s.milestones.length + 1, html_url: "u" }; s.milestones.push(m); return m; }
    if (method === "PATCH" && /\/milestones\/\d+$/.test(p)) return Object.assign(s.milestones[+p.split("/").pop() - 1], body);
    if (method === "GET" && /\/issues$/.test(p)) return [];
    if (method === "POST" && /\/issues$/.test(p)) { const i = { ...body, number: s.issues.length + 1, html_url: "u", state: "open", comments: 0 }; s.issues.push(i); return i; }
    if (method === "PATCH" && /\/issues\/\d+$/.test(p)) return Object.assign(s.issues[+p.split("/").pop() - 1], body);
    if (method === "GET" && /\/issues\/\d+$/.test(p)) return s.issues[+p.split("/").pop() - 1];
    if (method === "POST" && p.endsWith("/comments")) { s.comments.push(body.body); return {}; }
    if (method === "GET" && p === "/installation/repositories") return { repositories: repos };
    if (method === "GET" && p === "/repos/o/lib") return { default_branch: "main" };
    if (method === "GET" && p.startsWith("/repos/o/lib/git/trees")) return { tree: [{ type: "blob", path: "skills/welcome/SKILL.md" }] };
    if (method === "GET" && p.startsWith("/repos/o/lib/contents/")) return { content: Buffer.from(s.guide ?? GUIDE).toString("base64"), sha: "abc1234", html_url: "https://x" };
    if (method === "GET" && p.includes("/contents/gryt/checkins/")) { const f = s.files[p]; if (!f) throw Object.assign(new Error("nf"), { status: 404 }); return { content: Buffer.from(f).toString("base64"), sha: "s", html_url: "f" }; }
    if (method === "PUT" && p.includes("/contents/gryt/checkins/")) { s.files[p] = Buffer.from(body.content, "base64").toString(); s.commits++; return { content: { html_url: "f" } }; }
    throw new Error(`unhandled ${method} ${path}`);
  };
  return { s, api };
}
const comment = (body, extra = {}) => ({ action: "created", comment: { body, user: { type: "User" } }, issue: { number: 99 }, repository: { full_name: "o/t", private: true }, installation: { id: 1 }, ...extra });
const quiet = () => {};

// ---------- acceptance test (checklist item: one small acceptance test) ----------

test("ACCEPTANCE: read one guide -> plan -> close -> one check-in; replaying every event creates no duplicates", async () => {
  const { s, api } = fakeGitHub();
  const q = createQueue({ store: memoryStore(), sleep: noSleep, log: quiet });
  const deliver = async (id, event, payload) => { const j = await q.enqueue({ id, event, run: () => handleEvent(event, payload, async () => api, quiet, { store: q.store }) }); return j.duplicate ? { duplicate: true } : (await j.done).result; };

  const planEvt = comment("/gryt plan welcome 2");
  assert.equal((await deliver("d-plan", "issue_comment", planEvt)).note, "command plan");
  assert.equal(s.issues.length, 3, "2 task issues + 1 tracker");
  assert.deepEqual(await deliver("d-plan", "issue_comment", planEvt), { duplicate: true }, "same delivery replayed");

  // Same command sent again as a NEW delivery (person re-runs it): still no new issues.
  await deliver("d-plan-2", "issue_comment", planEvt);
  assert.equal(s.issues.length, 3, "re-run is idempotent");

  // Finish one task, close the tracker.
  s.issues[0].state = "closed";
  const tracker = s.issues.find((i) => /^GRYT plan:/.test(i.title));
  const closeEvt = { action: "closed", issue: { ...tracker, labels: [{ name: "gryt-plan" }] }, repository: { full_name: "o/t", private: true }, installation: { id: 1 } };
  assert.equal((await deliver("d-close", "issues", closeEvt)).note, "checkin saved");
  assert.equal(s.commits, 1);
  const file = Object.values(s.files)[0];
  assert.match(file, /Completed: 1 of 2/);
  assert.doesNotMatch(file, /Say hi/, "check-in records task titles and outcomes, not the guide body");

  await deliver("d-close", "issues", closeEvt);          // duplicate delivery
  await deliver("d-close-2", "issues", closeEvt);        // fresh delivery, same content
  assert.equal(s.commits, 1, "no duplicate check-in commit");
});

// ---------- unhappy paths ----------

test("revoked installation: handler returns a quiet recoverable result", async () => {
  const r = await handleEvent("issue_comment", comment("/gryt list"), async () => { throw new InstallationGoneError("gone", { status: 404 }); }, quiet);
  assert.equal(r.note, "installation unavailable");
});

test("removed repository access: tells the person how to fix it", async () => {
  const { s, api } = fakeGitHub({ fail: { "GET /repos/o/lib/contents/": () => Object.assign(new Error("nf"), { status: 404 }) } });
  await handleEvent("issue_comment", comment("/gryt plan welcome"), async () => api, quiet);
  assert.match(s.comments[0], /can't read `welcome` anymore/);
  assert.equal(s.issues.length, 0);
});

test("API 429 beyond the retry window: recoverable message, nothing half-created", async () => {
  const { s, api } = fakeGitHub({ fail: { "POST /repos/o/t/milestones": () => new RateLimitError("rl", { status: 429, retryAt: Date.UTC(2026, 9, 29, 15, 30) }) } });
  const r = await handleEvent("issue_comment", comment("/gryt plan welcome"), async () => api, quiet);
  assert.equal(r.recoverable, true);
  assert.match(s.comments[0], /rate limiting me.*after 15:30 UTC/);
});

test("unavailable upstream (5xx) is rethrown so the queue retries it", async () => {
  const { api } = fakeGitHub({ fail: { "GET /installation/repositories": () => new GitHubError("502", { status: 502, retryable: true }) } });
  await assert.rejects(handleEvent("issue_comment", comment("/gryt list"), async () => api, quiet), (e) => e.retryable);
});

test("invalid source files are refused with a reason", async () => {
  assert.match(validateSource(""), /empty/);
  assert.match(validateSource("# Title\n\nno sections"), /no `## ` sections/);
  assert.match(validateSource("---\nname: x\n# never closed"), /front matter/);
  assert.match(validateSource("x".repeat(250_000)), /larger than/);
  assert.match(validateSource("## a\n\u0000\u0000"), /Markdown/);
  assert.equal(validateSource(GUIDE), null);
  const { s, api } = fakeGitHub(); s.guide = "# Only a title";
  await handleEvent("issue_comment", comment("/gryt plan welcome"), async () => api, quiet);
  assert.match(s.comments[0], /can't turn `welcome` into a plan/);
  assert.equal(s.issues.length, 0);
});

test("weeks out of range is rejected before any API writes", async () => {
  const { s, api } = fakeGitHub();
  await handleEvent("issue_comment", comment("/gryt plan welcome 99"), async () => api, quiet);
  assert.match(s.comments[0], /1 to 12 weeks/);
  assert.equal(s.issues.length, 0);
});

test("read-only install: check-in falls back to an issue comment", async () => {
  const { s, api } = fakeGitHub({ fail: { "PUT /repos/o/t/contents/": () => Object.assign(new Error("forbidden"), { status: 403 }) } });
  s.issues.push({ number: 1, title: "Welcome: Greet", state: "closed", comments: 0 });
  const r = await saveCheckin(api, { repo: "o/t", trackingIssue: { number: 2, title: "GRYT plan: Welcome", body: "- [ ] #1\n<!-- gryt-plan:o/lib/skills/welcome/SKILL.md#__tracking__ -->" } });
  assert.equal(r.mode, "comment");
  assert.match(s.comments[0], /# Check-in: Welcome/);
});

// ---------- private-data boundaries ----------

test("private guide is never copied into a public repo", async () => {
  assert.equal(crossesBoundary({ private: true }, { private: false }), true);
  assert.equal(crossesBoundary({ private: false }, { private: false }), false);
  const { s, api } = fakeGitHub();
  await handleEvent("issue_comment", comment("/gryt plan welcome", { repository: { full_name: "o/t", private: false } }), async () => api, quiet);
  assert.match(s.comments[0], /private repository and this one is public/);
  assert.equal(s.issues.length, 0);
});

test("uninstall purges delivery records for that installation", async () => {
  const store = memoryStore();
  await store.claim("a", 60, { installationId: 1 }); await store.claim("b", 60, { installationId: 2 });
  const r = await handleEvent("installation", { action: "deleted", installation: { id: 1, account: { login: "x" } } }, null, quiet, { store });
  assert.match(r.note, /purged 1/);
  assert.equal(store.size(), 1);
});

test("webhook endpoint: bad signature 401, unsubscribed events ignored, duplicates short-circuit, errors don't leak", async () => {
  const secret = "s3cret";
  const sign = (b) => "sha256=" + crypto.createHmac("sha256", secret).update(b).digest("hex");
  const req = (event, body, id, sig = sign(body)) => new Request("https://h/api/webhook", { method: "POST", body, headers: { "x-github-event": event, "x-github-delivery": id, "x-hub-signature-256": sig } });
  const q = createQueue({ store: memoryStore(), sleep: noSleep, log: quiet, maxAttempts: 1 });
  const POST = makeWebhook({ q, secret: () => secret, getApi: async () => { throw new GitHubError("internal detail: token xyz", { status: 400 }); } });

  assert.equal((await POST(req("ping", "{}", "1", "sha256=bad"))).status, 401);
  assert.equal((await (await POST(req("star", "{}", "2"))).json()).note, "event not subscribed");
  const body = JSON.stringify(comment("/gryt list"));
  const first = await POST(req("issue_comment", body, "3"));
  assert.equal(first.status, 500);
  const text = await first.text();
  assert.doesNotMatch(text, /internal detail|token/);
  assert.match(text, /"delivery":"3"/);
  // claim released after failure, so a redelivery is processed (fails again here, but not as a duplicate)
  assert.notEqual((await (await POST(req("issue_comment", body, "3"))).json()).note, "duplicate delivery");
  const okBody = JSON.stringify({ zen: "x" });
  await POST(req("ping", okBody, "4"));
  assert.equal((await (await POST(req("ping", okBody, "4"))).json()).note, "duplicate delivery");
});
