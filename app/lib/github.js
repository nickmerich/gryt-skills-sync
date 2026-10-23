import crypto from "node:crypto";

const API = "https://api.github.com";

export function verifySignature(secret, rawBody, header) {
  if (!secret || !header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function appJwt(appId, privateKey, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: String(appId) }));
  const sig = crypto.createSign("RSA-SHA256").update(`${header}.${payload}`).sign(privateKey.replace(/\\n/g, "\n"));
  return `${header}.${payload}.${b64url(sig)}`;
}

export function makeApi(token, fetchImpl = fetch) {
  return async function api(method, path, body) {
    const res = await fetchImpl(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "gryt-skills-app",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error(`GitHub ${method} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
      err.status = res.status;
      throw err;
    }
    return text ? JSON.parse(text) : {};
  };
}

export async function installationApi(installationId, env = process.env, fetchImpl = fetch) {
  const jwt = appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const res = await fetchImpl(`${API}/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "User-Agent": "gryt-skills-app" },
  });
  if (!res.ok) throw new Error(`Installation token failed: ${res.status} ${await res.text()}`);
  const { token } = await res.json();
  return makeApi(token, fetchImpl);
}
