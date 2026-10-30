// Dependency-free lint: syntax check every JS file, plus project rules that
// matter for a GitHub App handling tokens.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const roots = ["app", "tests", "marketplace", "scripts"];
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (f === "node_modules" || f.startsWith(".")) continue; statSync(p).isDirectory() ? walk(p) : /\.(m?js)$/.test(f) && files.push(p); } };
roots.forEach(walk);

const problems = [];
for (const f of files) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) problems.push(`${f}: syntax error\n${r.stderr}`);
  const src = readFileSync(f, "utf8");
  const lines = src.split("\n");
  lines.forEach((l, i) => {
    if (/console\.(log|error)\([^)]*(token|privateKey|PRIVATE_KEY|jwt|Authorization)/i.test(l) && !/lint-ok/.test(l)) problems.push(`${f}:${i + 1}: possible credential in log`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(l) && !f.startsWith("tests")) problems.push(`${f}:${i + 1}: private key literal`);
    if (/\bgh[pousr]_[A-Za-z0-9]{20,}/.test(l)) problems.push(`${f}:${i + 1}: GitHub token literal`);
    if (new RegExp("\\bdebug" + "ger\\b").test(l)) problems.push(`${f}:${i + 1}: leftover debug breakpoint`);
    if (/\s+$/.test(l)) problems.push(`${f}:${i + 1}: trailing whitespace`);
  });
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
console.log(`lint ok: ${files.length} files`);
