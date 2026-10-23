#!/usr/bin/env node
// Prints a prefilled "Register new GitHub App" link.
// Usage: node marketplace/register-url.js https://your-deploy-host [org]
const host = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(host)) { console.error("Pass the deployed https host, e.g. https://gryt-skills.vercel.app"); process.exit(1); }
const org = process.argv[3];
const p = new URLSearchParams({
  name: "GRYT Skills",
  description: "Turn the skills and workflows in your repos into GitHub plans: a milestone, a tracking issue and one issue per step. Close the plan to save a check-in back to your repo.",
  url: host,
  public: "true",
  webhook_active: "true",
  webhook_url: `${host}/api/github/webhooks`,
  metadata: "read",
  contents: "write",
  issues: "write",
});
p.append("events[]", "issues");
p.append("events[]", "issue_comment");
const base = org ? `https://github.com/organizations/${org}/settings/apps/new` : "https://github.com/settings/apps/new";
console.log(`${base}?${p}`);
