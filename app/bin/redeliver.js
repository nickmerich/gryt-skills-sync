#!/usr/bin/env node
// Controlled retry path for failed webhook deliveries.
// Usage: node bin/redeliver.js            list recent failed deliveries
//        node bin/redeliver.js <id> ...   redeliver specific deliveries
//        node bin/redeliver.js --all      redeliver every failed one (max 20)
// Env: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY (app JWT; never printed).
import { appJwt } from "../lib/github.js";

const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY } = process.env;
if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) { console.error("Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY."); process.exit(1); } // lint-ok: names only
const h = () => ({ Authorization: `Bearer ${appJwt(GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY)}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "gryt-skills-app" });
const call = async (method, path) => { const r = await fetch(`https://api.github.com${path}`, { method, headers: h() }); if (!r.ok && r.status !== 202) throw new Error(`${method} ${path} -> ${r.status}`); return r.status === 202 ? {} : r.json(); };

const args = process.argv.slice(2);
const deliveries = await call("GET", "/app/hook/deliveries?per_page=100");
const failed = deliveries.filter((d) => d.status !== "OK" && !d.redelivery);
if (!args.length) {
  if (!failed.length) console.log("No failed deliveries in the last page.");
  for (const d of failed) console.log(`${d.id}\t${d.delivered_at}\t${d.event}.${d.action || ""}\t${d.status_code} ${d.status}`);
  process.exit(0);
}
const ids = args[0] === "--all" ? failed.slice(0, 20).map((d) => d.id) : args;
for (const id of ids) { await call("POST", `/app/hook/deliveries/${id}/attempts`); console.log(`redelivery requested: ${id}`); }
