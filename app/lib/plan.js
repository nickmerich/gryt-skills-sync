// GRYT plan builder: turn a SKILL.md or workflow markdown file into a GitHub
// project plan (one milestone, one tracking issue, one issue per section).
// Transport-agnostic: pass an `api(method, path, body)` function.

export const PLAN_LABEL = "gryt-plan";
const GUIDANCE = /^(voice|tone|see also|references?|related|notes?|why|about)\b/i;

export function stripFrontmatter(text) {
  const meta = {};
  if (!text.startsWith("---")) return { meta, body: text };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { meta, body: text };
  for (const line of text.slice(3, end).split("\n")) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return { meta, body: text.slice(end + 4).replace(/^\s*\n/, "") };
}

export const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// Lists become task-list checkboxes; everything else is kept verbatim.
function toChecklist(lines) {
  let inCode = false;
  return lines
    .map((l) => {
      if (/^\s*```/.test(l)) inCode = !inCode;
      if (inCode) return l;
      const num = l.match(/^(\s*)\d+[.)]\s+(.*)$/);
      if (num) return `${num[1]}- [ ] ${num[2]}`;
      const bul = l.match(/^(\s*)[-*+]\s+(?!\[[ xX]\])(.*)$/);
      if (bul) return `${bul[1]}- [ ] ${bul[2]}`;
      return l;
    })
    .join("\n")
    .trim();
}

export function parsePlan(markdown, { name } = {}) {
  const { meta, body } = stripFrontmatter(markdown.replace(/\r\n/g, "\n"));
  const lines = body.split("\n");
  let title = meta.title || null;
  const intro = [];
  const sections = [];
  let cur = null;
  let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const h1 = !inCode && line.match(/^#\s+(.+)/);
    const h2 = !inCode && line.match(/^##\s+(.+)/);
    if (h1 && !title) { title = h1[1].trim(); continue; }
    if (h2) { cur = { heading: h2[1].trim(), lines: [] }; sections.push(cur); continue; }
    (cur ? cur.lines : intro).push(line);
  }
  const skillName = meta.name || name || slug(title || "plan");
  title = title || skillName;
  const tasks = [];
  const guidance = [];
  for (const s of sections) {
    const content = s.lines.join("\n").trim();
    if (!content) continue;
    if (GUIDANCE.test(s.heading)) { guidance.push(`### ${s.heading}\n\n${content}`); continue; }
    tasks.push({ heading: s.heading, key: slug(s.heading), body: toChecklist(s.lines) });
  }
  return { name: skillName, title, description: meta.description || "", intro: intro.join("\n").trim(), tasks, guidance };
}

export function assignWeeks(tasks, weeks) {
  const w = Math.max(1, Math.min(weeks || 4, tasks.length || 1));
  return tasks.map((t, i) => ({ ...t, week: Math.floor((i * w) / tasks.length) + 1 }));
}

const marker = (src, key) => `<!-- gryt-plan:${src}#${key} -->`;

// Create (or top up) the plan in `targetRepo`. Idempotent: re-running skips
// issues whose hidden marker already exists.
export async function createPlan(api, { targetRepo, sourceRepo, sourcePath, sourceUrl, sourceSha, markdown, weeks = 4, start = new Date(), dryRun = false }) {
  const plan = parsePlan(markdown, { name: sourcePath?.split("/").slice(-2, -1)[0] });
  const src = `${sourceRepo}/${sourcePath}`;
  const tasks = assignWeeks(plan.tasks, weeks);
  const nWeeks = Math.max(1, ...tasks.map((t) => t.week));
  const due = new Date(start.getTime() + nWeeks * 7 * 864e5);
  const result = { plan: plan.title, targetRepo, milestone: null, tracking: null, created: [], skipped: [], dryRun };

  if (dryRun) {
    result.created = tasks.map((t) => ({ title: `${plan.title}: ${t.heading}`, week: t.week }));
    return result;
  }

  // Labels (ignore "already exists")
  for (const [name, color, description] of [
    [PLAN_LABEL, "f97316", "Created by GRYT from a skill or workflow"],
    [`skill:${plan.name}`.slice(0, 50), "1d4ed8", `Tasks from ${plan.name}`],
  ]) {
    try { await api("POST", `/repos/${targetRepo}/labels`, { name, color, description }); } catch (e) { if (e.status !== 422) throw e; }
  }

  // Milestone
  const msTitle = `GRYT: ${plan.title}`;
  const milestones = (await api("GET", `/repos/${targetRepo}/milestones?state=all&per_page=100`)) || [];
  let ms = milestones.find((m) => m.title === msTitle);
  if (!ms) {
    ms = await api("POST", `/repos/${targetRepo}/milestones`, {
      title: msTitle,
      description: `${plan.description}`.slice(0, 900) + `\n\nSource: ${src}`,
      due_on: due.toISOString().replace(/\.\d+Z$/, "Z"),
    });
  }
  result.milestone = { number: ms.number, title: ms.title, url: ms.html_url };

  // The milestone description carries a key -> issue-number map. Milestone
  // reads are consistent right after writes; issue listings can lag.
  const MAP_RE = /<!-- gryt-issues:(\{.*?\}) -->/;
  let map = {};
  try { map = JSON.parse((ms.description || "").match(MAP_RE)?.[1] || "{}"); } catch { map = {}; }

  // Existing GRYT issues, for idempotency
  const existing = [];
  for (let page = 1; page < 20; page++) {
    const batch = await api("GET", `/repos/${targetRepo}/issues?state=all&labels=${PLAN_LABEL}&per_page=100&page=${page}`);
    if (!batch?.length) break;
    existing.push(...batch);
    if (batch.length < 100) break;
  }
  const findByMarker = (m, key) => {
    if (map[key]) return { number: map[key], title: existing.find((i) => i.number === map[key])?.title || `#${map[key]}` };
    return existing.find((i) => (i.body || "").includes(m));
  };
  const labels = [PLAN_LABEL, `skill:${plan.name}`.slice(0, 50)];
  const sourceLink = sourceUrl ? `[${sourcePath}](${sourceUrl})` : `\`${src}\``;

  const children = [];
  for (const t of tasks) {
    const mk = marker(src, t.key);
    const found = findByMarker(mk, t.key);
    if (found) { map[t.key] = found.number; result.skipped.push({ number: found.number, title: found.title }); children.push({ ...t, number: found.number }); continue; }
    const body = [
      `**Week ${t.week} of ${nWeeks}** · from ${sourceLink}${sourceSha ? ` @ \`${sourceSha.slice(0, 7)}\`` : ""}`,
      "",
      t.body,
      "",
      "---",
      "Done when every box is checked. Add what you learned as a comment before closing; GRYT saves it back to your library when the plan closes.",
      mk,
    ].join("\n");
    const issue = await api("POST", `/repos/${targetRepo}/issues`, { title: `${plan.title}: ${t.heading}`, body, labels, milestone: ms.number });
    map[t.key] = issue.number;
    result.created.push({ number: issue.number, title: issue.title, url: issue.html_url, week: t.week });
    children.push({ ...t, number: issue.number });
  }

  // Tracking issue
  const tmk = marker(src, "__tracking__");
  const byWeek = {};
  for (const c of children) (byWeek[c.week] ||= []).push(c);
  const trackingBody = [
    `GRYT turned ${sourceLink} into a ${nWeeks}-week plan. Work the issues below, then close this one to save a check-in back to your library.`,
    plan.intro ? `\n> ${plan.intro.split("\n").join("\n> ")}` : "",
    "",
    ...Object.keys(byWeek).sort((a, b) => a - b).flatMap((w) => [`### Week ${w}`, ...byWeek[w].map((c) => `- [ ] #${c.number}`), ""]),
    plan.guidance.length ? `<details><summary>Guidance from the skill</summary>\n\n${plan.guidance.join("\n\n")}\n\n</details>` : "",
    "",
    tmk,
  ].join("\n");
  const tFound = findByMarker(tmk, "__tracking__");
  const tracking = tFound
    ? await api("PATCH", `/repos/${targetRepo}/issues/${tFound.number}`, { body: trackingBody })
    : await api("POST", `/repos/${targetRepo}/issues`, { title: `GRYT plan: ${plan.title}`, body: trackingBody, labels, milestone: ms.number });
  map.__tracking__ = tracking.number;
  const desc = (ms.description || "").replace(MAP_RE, "").trimEnd();
  await api("PATCH", `/repos/${targetRepo}/milestones/${ms.number}`, { description: `${desc}\n\n<!-- gryt-issues:${JSON.stringify(map)} -->` });
  result.tracking = { number: tracking.number, url: tracking.html_url || `https://github.com/${targetRepo}/issues/${tracking.number}`, updated: !!tFound };
  return result;
}

// Find skills/workflows in a repo: any SKILL.md, or markdown under workflows/.
export async function listSkills(api, repo) {
  const info = await api("GET", `/repos/${repo}`);
  const tree = await api("GET", `/repos/${repo}/git/trees/${info.default_branch}?recursive=1`);
  return (tree?.tree || [])
    .filter((i) => i.type === "blob" && (/(^|\/)SKILL\.md$/.test(i.path) || /(^|\/)workflows\/[^/]+\.md$/i.test(i.path)))
    .map((i) => ({
      repo,
      path: i.path,
      name: /SKILL\.md$/.test(i.path) ? i.path.split("/").slice(-2, -1)[0] || repo.split("/")[1] : i.path.split("/").pop().replace(/\.md$/i, ""),
      branch: info.default_branch,
    }));
}

export async function readFile(api, repo, path, ref) {
  const f = await api("GET", `/repos/${repo}/contents/${encodeURI(path)}${ref ? `?ref=${ref}` : ""}`);
  return { text: Buffer.from(f.content, "base64").toString("utf8"), sha: f.sha, url: f.html_url };
}

// Write a check-in back to the repo when a plan's tracking issue closes.
export async function saveCheckin(api, { repo, trackingIssue, now = new Date() }) {
  const m = (trackingIssue.body || "").match(/<!-- gryt-plan:(.+?)#__tracking__ -->/);
  if (!m) return null;
  const nums = [...(trackingIssue.body || "").matchAll(/- \[[ xX]\] #(\d+)/g)].map((x) => +x[1]);
  const rows = [];
  for (const n of nums) {
    const i = await api("GET", `/repos/${repo}/issues/${n}`);
    const comments = i.comments ? await api("GET", `/repos/${repo}/issues/${n}/comments?per_page=100`) : [];
    const learned = comments.filter((c) => c.user?.type !== "Bot").map((c) => c.body.trim()).filter(Boolean);
    rows.push({ n, title: i.title, state: i.state, learned });
  }
  const done = rows.filter((r) => r.state === "closed").length;
  const date = now.toISOString().slice(0, 10);
  const name = trackingIssue.title.replace(/^GRYT plan:\s*/i, "");
  const md = [
    `# Check-in: ${name}`,
    "",
    `- Date: ${date}`,
    `- Source: \`${m[1]}\``,
    `- Plan: #${trackingIssue.number}`,
    `- Completed: ${done} of ${rows.length}`,
    "",
    "## Tasks",
    "",
    ...rows.map((r) => `- [${r.state === "closed" ? "x" : " "}] ${r.title} (#${r.n})`),
    "",
    "## What we learned",
    "",
    ...(rows.some((r) => r.learned.length)
      ? rows.filter((r) => r.learned.length).flatMap((r) => [`### ${r.title}`, ...r.learned.map((l) => `> ${l.split("\n").join("\n> ")}`), ""])
      : ["No notes were left on the task issues this round."]),
    "",
    "## Next round",
    "",
    rows.filter((r) => r.state !== "closed").length
      ? `Carry over: ${rows.filter((r) => r.state !== "closed").map((r) => `#${r.n}`).join(", ")}`
      : "Everything shipped. Pick the next skill or rerun this one with a harder target.",
    "",
  ].join("\n");
  const path = `gryt/checkins/${date}-${slug(name)}.md`;
  let sha;
  try { sha = (await api("GET", `/repos/${repo}/contents/${path}`))?.sha; } catch (e) { if (e.status !== 404) throw e; }
  const res = await api("PUT", `/repos/${repo}/contents/${path}`, {
    message: `GRYT check-in: ${name}`,
    content: Buffer.from(md).toString("base64"),
    ...(sha ? { sha } : {}),
  });
  return { path, url: res.content?.html_url, done, total: rows.length };
}
