// Build check: the deployable app loads, exports the right handlers, and the
// public pages the listing needs exist. Writes nothing.
import { existsSync, readFileSync } from "node:fs";

const fail = (m) => { console.error(`build check failed: ${m}`); process.exit(1); };
const hook = await import("../app/api/webhook.js");
if (typeof hook.POST !== "function" || typeof hook.GET !== "function") fail("api/webhook.js must export POST and GET");
const health = await (await hook.GET()).json();
if (health.status !== "listening") fail("health check payload changed");
if (JSON.stringify(health).match(/key|secret|token/i)) fail("health check leaks config");

const vercel = JSON.parse(readFileSync("app/vercel.json", "utf8"));
if (!vercel.rewrites?.some((r) => r.source === "/api/github/webhooks")) fail("webhook rewrite missing from vercel.json");
for (const p of ["index.html", "privacy.html", "support.html", "style.css"]) if (!existsSync(`app/public/${p}`)) fail(`app/public/${p} missing`);

const pkg = JSON.parse(readFileSync("app/package.json", "utf8"));
if (!/^\d+\.\d+\.\d+/.test(pkg.version)) fail("app/package.json version is not semver");
if (pkg.dependencies && Object.keys(pkg.dependencies).length) console.log("note: runtime dependencies present", Object.keys(pkg.dependencies));
console.log(`build ok: gryt-skills-app ${pkg.version}`);
