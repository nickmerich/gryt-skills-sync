// Transport over the GitHub CLI for local runs (`gh` handles auth; this code
// never sees the token).
import { spawnSync } from "node:child_process";

export function ghCliApi(method, path, body) {
  const r = spawnSync("gh", ["api", "-X", method, path.replace(/^\//, ""), "-H", "X-GitHub-Api-Version: 2022-11-28", ...(body ? ["--input", "-"] : [])], { input: body ? JSON.stringify(body) : undefined, encoding: "utf8" });
  if (r.status !== 0) {
    const m = (r.stdout + r.stderr).match(/HTTP (\d{3})/);
    const err = new Error(`gh api ${method} ${path} failed: ${(r.stderr || r.stdout).slice(0, 200)}`);
    err.status = m ? +m[1] : 500;
    throw err;
  }
  return Promise.resolve(r.stdout ? JSON.parse(r.stdout) : {});
}
