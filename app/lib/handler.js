// GRYT GitHub App event handling. Pure function of (event, payload, api) so it
// can be tested without a server.
import { createPlan, listSkills, readFile, saveCheckin, validateSource, PLAN_LABEL } from "./plan.js";
import { InstallationGoneError, RateLimitError, forgetInstallation } from "./github.js";

// Only these events do work. Everything else is acknowledged and dropped, and
// the app registration subscribes to nothing more.
export const HANDLED_EVENTS = ["ping", "issues", "issue_comment", "installation", "installation_repositories", "marketplace_purchase"];

const HELP = [
  "**GRYT commands** (comment on any issue):",
  "",
  "- `/gryt list` shows the skills and workflows this installation can read",
  "- `/gryt plan <skill> [weeks]` turns a skill into a milestone, a tracking issue and one issue per step",
  "- `/gryt help` shows this message",
  "",
  "Close a `GRYT plan:` tracking issue to save a check-in to `gryt/checkins/` in this repo.",
].join("\n");

async function accessibleRepos(api) {
  // Returns [{ full_name, private }]. Uses Link-header pagination when the
  // client supports it.
  if (api.paginate) return (await api.paginate("/installation/repositories?per_page=100", { pick: (b) => b.repositories })).map((x) => ({ full_name: x.full_name, private: x.private !== false }));
  const r = await api("GET", "/installation/repositories?per_page=100");
  return r.repositories.map((x) => ({ full_name: x.full_name, private: x.private !== false }));
}

async function allSkills(api, here) {
  const repos = await accessibleRepos(api);
  // Search the current repo first so local skills win name collisions.
  repos.sort((a, b) => (a.full_name === here ? -1 : b.full_name === here ? 1 : 0));
  const skills = [];
  for (const r of repos) {
    try { skills.push(...(await listSkills(api, r.full_name)).map((s) => ({ ...s, private: r.private }))); }
    catch (e) { if (e.retryable) throw e; /* empty repo or access removed: skip */ }
  }
  return skills;
}

// Private-data boundary: never copy a private guide into a repo more people
// can read. Public target + private source is refused.
export function crossesBoundary(source, target) {
  return source.private !== false && target.private === false;
}

export function parseCommand(text = "") {
  const line = text.split("\n").map((l) => l.trim()).find((l) => /^\/gryt\b/i.test(l));
  if (!line) {
    const t = text.trim().match(/^gryt plan:\s*([\w./-]+)(?:\s+(\d+))?/i);
    return t ? { cmd: "plan", skill: t[1], weeks: t[2] ? +t[2] : undefined } : null;
  }
  const [, cmd = "help", skill, weeks] = line.split(/\s+/);
  return { cmd: cmd.toLowerCase(), skill, weeks: weeks ? +weeks : undefined };
}

async function runCommand(api, repo, issueNumber, command, target = { private: true }) {
  const reply = (body) => api("POST", `/repos/${repo}/issues/${issueNumber}/comments`, { body });
  if (command.cmd === "help") return reply(HELP);
  const skills = await allSkills(api, repo);
  if (command.cmd === "list") {
    if (!skills.length) return reply("I can't see any `SKILL.md` or `workflows/*.md` files yet. Add the repos that hold your library to this installation.");
    const byRepo = {};
    for (const s of skills) (byRepo[s.repo] ||= []).push(s.name);
    return reply(["**Skills GRYT can plan from**", "", ...Object.entries(byRepo).map(([r, n]) => `- \`${r}\`: ${n.map((x) => `\`${x}\``).join(", ")}`), "", "Run `/gryt plan <skill>` to start one."].join("\n"));
  }
  if (command.cmd === "plan") {
    if (!command.skill) return reply("Which one? Try `/gryt plan newcomer-welcome`, or `/gryt list` to see options.");
    if (command.weeks != null && !(command.weeks >= 1 && command.weeks <= 12)) return reply("Plans can run 1 to 12 weeks. Try `/gryt plan <skill> 4`.");
    const want = command.skill.toLowerCase();
    const s = skills.find((x) => x.name.toLowerCase() === want || `${x.repo}/${x.name}`.toLowerCase() === want);
    if (!s) return reply(`I couldn't find \`${command.skill}\`. Run \`/gryt list\` to see what's available.`);
    if (crossesBoundary(s, target)) return reply(`\`${s.name}\` lives in a private repository and this one is public, so I won't copy it here. Run the command in a private repo instead.`);
    let f;
    try { f = await readFile(api, s.repo, s.path, s.branch); }
    catch (e) {
      if (e.status === 404 || e.status === 403) return reply(`I can't read \`${s.name}\` anymore. Its repository may have been removed from this installation. Add it back under the app's installation settings and try again.`);
      throw e;
    }
    const problem = validateSource(f.text);
    if (problem) return reply(`I can't turn \`${s.name}\` into a plan: ${problem}`);
    const r = await createPlan(api, { targetRepo: repo, sourceRepo: s.repo, sourcePath: s.path, sourceUrl: f.url, sourceSha: f.sha, markdown: f.text, weeks: command.weeks || 4 });
    return reply([
      `Plan ready: **${r.plan}** → #${r.tracking.number} (milestone [${r.milestone.title}](${r.milestone.url}))`,
      "",
      r.created.length ? `Created ${r.created.length} issue${r.created.length === 1 ? "" : "s"}${r.skipped.length ? `, kept ${r.skipped.length} that already existed` : ""}.` : `All ${r.skipped.length} issues already existed, so I just refreshed the tracking issue.`,
    ].join("\n"));
  }
  return reply(`I don't know \`${command.cmd}\` yet.\n\n${HELP}`);
}

// Turn failures into a recoverable state the person can see, where possible.
async function guarded(api, repo, issueNumber, fn) {
  try { return await fn(); }
  catch (e) {
    const say = (body) => api("POST", `/repos/${repo}/issues/${issueNumber}/comments`, { body }).catch(() => {});
    if (e instanceof RateLimitError) {
      const when = e.retryAt ? ` after ${new Date(e.retryAt).toISOString().slice(11, 16)} UTC` : " in a few minutes";
      await say(`GitHub is rate limiting me right now. Plans are safe to re-run, so send the same command again${when} and I'll pick up where I left off.`);
      return { ok: false, recoverable: true, note: "rate limited" };
    }
    if (e.retryable) throw e; // let the queue retry 5xx / network failures
    if (e.status === 404 || e.status === 403) {
      await say("I lost access to something I needed. Check that this repository and your library repositories are still selected in the app's installation settings.");
      return { ok: false, recoverable: true, note: "access removed" };
    }
    throw e;
  }
}

export async function handleEvent(event, payload, getApi, log = console.log, ctx = {}) {
  if (event === "ping") return { ok: true, note: "pong" };
  if (!HANDLED_EVENTS.includes(event)) return { ok: true, note: "ignored" };

  // Marketplace events: GRYT ships a free plan, so we record the change and
  // acknowledge. No billing state to reconcile.
  if (event === "marketplace_purchase") {
    const p = payload.marketplace_purchase || {};
    log(JSON.stringify({ type: "marketplace", action: payload.action, account: p.account?.login, plan: p.plan?.name, effective: payload.effective_date }));
    return { ok: true, note: `marketplace ${payload.action}` };
  }

  if (event === "installation" || event === "installation_repositories") {
    log(JSON.stringify({ type: event, action: payload.action, account: payload.installation?.account?.login }));
    // Data-deletion path: on uninstall/suspend, drop the cached token and any
    // delivery records tied to the installation. We hold nothing else.
    if (event === "installation" && ["deleted", "suspend"].includes(payload.action)) {
      forgetInstallation(payload.installation?.id);
      const purged = ctx.store ? await ctx.store.purge((_k, meta) => meta?.installationId === payload.installation?.id) : 0;
      return { ok: true, note: `installation ${payload.action}; purged ${purged}` };
    }
    return { ok: true, note: `${event} ${payload.action}` };
  }

  const installationId = payload.installation?.id;
  const repo = payload.repository?.full_name;
  if (!installationId || !repo) return { ok: true, note: "ignored" };
  const target = { private: payload.repository?.private !== false };

  let api;
  const connect = async () => {
    try { return (api = await getApi(installationId)); }
    catch (e) {
      if (e instanceof InstallationGoneError) { forgetInstallation(installationId); return null; }
      throw e;
    }
  };

  if (event === "issue_comment" && payload.action === "created") {
    if (payload.comment?.user?.type === "Bot") return { ok: true, note: "own comment" };
    const command = parseCommand(payload.comment.body);
    if (!command) return { ok: true, note: "no command" };
    if (!(await connect())) return { ok: true, note: "installation unavailable" };
    const r = await guarded(api, repo, payload.issue.number, () => runCommand(api, repo, payload.issue.number, command, target));
    return r?.recoverable ? r : { ok: true, note: `command ${command.cmd}` };
  }

  if (event === "issues" && payload.action === "opened") {
    const command = parseCommand(payload.issue.title);
    if (!command) return { ok: true, note: "no command" };
    if (!(await connect())) return { ok: true, note: "installation unavailable" };
    const r = await guarded(api, repo, payload.issue.number, () => runCommand(api, repo, payload.issue.number, command, target));
    return r?.recoverable ? r : { ok: true, note: `issue command ${command.cmd}` };
  }

  if (event === "issues" && payload.action === "closed") {
    const isPlan = /^GRYT plan:/i.test(payload.issue.title) && (payload.issue.labels || []).some((l) => l.name === PLAN_LABEL);
    if (!isPlan) return { ok: true, note: "not a plan" };
    if (!(await connect())) return { ok: true, note: "installation unavailable" };
    return await guarded(api, repo, payload.issue.number, async () => {
      const saved = await saveCheckin(api, { repo, trackingIssue: payload.issue });
      if (!saved) return { ok: true, note: "not a plan" };
      const where = saved.mode === "comment" ? "as a comment below (this installation can't write files)" : `to [\`${saved.path}\`](${saved.url})`;
      if (saved.mode !== "comment") await api("POST", `/repos/${repo}/issues/${payload.issue.number}/comments`, { body: `Saved your check-in ${where}. ${saved.done} of ${saved.total} tasks done.` });
      return { ok: true, note: saved.mode === "comment" ? "checkin commented" : "checkin saved" };
    });
  }

  return { ok: true, note: "ignored" };
}
