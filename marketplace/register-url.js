#!/usr/bin/env node
// Prints a prefilled "Register new GitHub App" link with least-privilege defaults.
// Usage: node marketplace/register-url.js https://your-deploy-host [org] [--public] [--read-only]
//
// Defaults: private app (only installable on your own account) until a release
// is approved. --read-only drops contents:write; check-ins are then posted as a
// comment on the tracking issue instead of a file. See docs/PERMISSIONS.md.
const args = process.argv.slice(2);
const flag = (f) => { const i = args.indexOf(f); if (i === -1) return false; args.splice(i, 1); return true; };
const isPublic = flag("--public");
const readOnly = flag("--read-only");
const host = (args[0] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(host)) { console.error("Pass the deployed https host, e.g. https://gryt-skills.vercel.app"); process.exit(1); }
const org = args[1];
const p = new URLSearchParams({
  name: "GRYT Skills",
  description: "Turn the skills and workflows in your repos into GitHub plans: a milestone, a tracking issue and one issue per step. Close the plan to save a check-in back to your repo.",
  url: host,
  public: String(isPublic),
  webhook_active: "true",
  webhook_url: `${host}/api/github/webhooks`,
  metadata: "read",
  contents: readOnly ? "read" : "write",
  issues: "write",
});
// Only the two events the handler acts on. Installation events are always sent.
p.append("events[]", "issues");
p.append("events[]", "issue_comment");
const base = org ? `https://github.com/organizations/${org}/settings/apps/new` : "https://github.com/settings/apps/new";
console.log(`${base}?${p}`);
