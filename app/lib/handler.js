// GRYT GitHub App event handling. Pure function of (event, payload, api) so it
// can be tested without a server.
import { createPlan, listSkills, readFile, saveCheckin, PLAN_LABEL } from "./plan.js";

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
  const out = [];
  for (let page = 1; page < 10; page++) {
    const r = await api("GET", `/installation/repositories?per_page=100&page=${page}`);
    out.push(...r.repositories.map((x) => x.full_name));
    if (r.repositories.length < 100) break;
  }
  return out;
}

async function allSkills(api, here) {
  const repos = await accessibleRepos(api);
  // Search the current repo first so local skills win name collisions.
  repos.sort((a, b) => (a === here ? -1 : b === here ? 1 : 0));
  const skills = [];
  for (const r of repos) {
    try { skills.push(...(await listSkills(api, r))); } catch { /* empty repo or no access */ }
  }
  return skills;
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

async function runCommand(api, repo, issueNumber, command) {
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
    const want = command.skill.toLowerCase();
    const s = skills.find((x) => x.name.toLowerCase() === want || `${x.repo}/${x.name}`.toLowerCase() === want);
    if (!s) return reply(`I couldn't find \`${command.skill}\`. Run \`/gryt list\` to see what's available.`);
    const f = await readFile(api, s.repo, s.path, s.branch);
    const r = await createPlan(api, { targetRepo: repo, sourceRepo: s.repo, sourcePath: s.path, sourceUrl: f.url, sourceSha: f.sha, markdown: f.text, weeks: command.weeks || 4 });
    return reply([
      `Plan ready: **${r.plan}** → #${r.tracking.number} (milestone [${r.milestone.title}](${r.milestone.url}))`,
      "",
      r.created.length ? `Created ${r.created.length} issue${r.created.length === 1 ? "" : "s"}${r.skipped.length ? `, kept ${r.skipped.length} that already existed` : ""}.` : `All ${r.skipped.length} issues already existed, so I just refreshed the tracking issue.`,
    ].join("\n"));
  }
  return reply(`I don't know \`${command.cmd}\` yet.\n\n${HELP}`);
}

export async function handleEvent(event, payload, getApi, log = console.log) {
  if (event === "ping") return { ok: true, note: "pong" };

  // Marketplace events: GRYT ships a free plan, so we record the change and
  // acknowledge. No billing state to reconcile.
  if (event === "marketplace_purchase") {
    const p = payload.marketplace_purchase || {};
    log(JSON.stringify({ type: "marketplace", action: payload.action, account: p.account?.login, plan: p.plan?.name, effective: payload.effective_date }));
    return { ok: true, note: `marketplace ${payload.action}` };
  }

  if (event === "installation" || event === "installation_repositories") {
    log(JSON.stringify({ type: event, action: payload.action, account: payload.installation?.account?.login }));
    return { ok: true, note: `${event} ${payload.action}` };
  }

  const installationId = payload.installation?.id;
  const repo = payload.repository?.full_name;
  if (!installationId || !repo) return { ok: true, note: "ignored" };

  if (event === "issue_comment" && payload.action === "created") {
    if (payload.comment?.user?.type === "Bot") return { ok: true, note: "own comment" };
    const command = parseCommand(payload.comment.body);
    if (!command) return { ok: true, note: "no command" };
    await runCommand(await getApi(installationId), repo, payload.issue.number, command);
    return { ok: true, note: `command ${command.cmd}` };
  }

  if (event === "issues" && payload.action === "opened") {
    const command = parseCommand(payload.issue.title);
    if (!command) return { ok: true, note: "no command" };
    await runCommand(await getApi(installationId), repo, payload.issue.number, command);
    return { ok: true, note: `issue command ${command.cmd}` };
  }

  if (event === "issues" && payload.action === "closed") {
    const isPlan = /^GRYT plan:/i.test(payload.issue.title) && (payload.issue.labels || []).some((l) => l.name === PLAN_LABEL);
    if (!isPlan) return { ok: true, note: "not a plan" };
    const api = await getApi(installationId);
    const saved = await saveCheckin(api, { repo, trackingIssue: payload.issue });
    if (saved) await api("POST", `/repos/${repo}/issues/${payload.issue.number}/comments`, { body: `Saved your check-in to [\`${saved.path}\`](${saved.url}). ${saved.done} of ${saved.total} tasks done.` });
    return { ok: true, note: "checkin saved" };
  }

  return { ok: true, note: "ignored" };
}
