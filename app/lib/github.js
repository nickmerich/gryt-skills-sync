import crypto from "node:crypto";

const API = "https://api.github.com";
const UA = "gryt-skills-app";

// Errors the queue and handler understand. `retryable` drives the retry policy.
export class GitHubError extends Error {
  constructor(message, { status, retryable = false, retryAt, requestId } = {}) {
    super(message);
    this.name = "GitHubError";
    this.status = status;
    this.retryable = retryable;
    this.retryAt = retryAt;
    this.requestId = requestId;
  }
}
export class RateLimitError extends GitHubError {
  constructor(message, opts) { super(message, { ...opts, retryable: true }); this.name = "RateLimitError"; }
}
export class InstallationGoneError extends GitHubError {
  constructor(message, opts) { super(message, { ...opts, retryable: false }); this.name = "InstallationGoneError"; }
}

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

// Only these response headers are ever logged. Request headers (which carry
// the token) are never logged.
const LOG_HEADERS = ["x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-used", "x-ratelimit-reset", "x-ratelimit-resource", "retry-after", "x-github-request-id"];
export function safeHeaders(headers) {
  const out = {};
  for (const h of LOG_HEADERS) { const v = headers.get(h); if (v != null) out[h] = v; }
  return out;
}

// Parse a Link header into { next, last, ... }.
export function parseLink(header) {
  const out = {};
  for (const part of (header || "").split(",")) {
    const m = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (m) out[m[2]] = m[1];
  }
  return out;
}

// How long to wait before retrying a limited response, per GitHub's REST
// guidance: Retry-After first, then x-ratelimit-reset when remaining is 0,
// otherwise at least one minute for secondary limits.
export function rateLimitWaitMs(status, headers, nowMs = Date.now()) {
  const retryAfter = headers.get("retry-after");
  if (retryAfter != null && !Number.isNaN(+retryAfter)) return Math.max(0, +retryAfter * 1000);
  if (headers.get("x-ratelimit-remaining") === "0" && headers.get("x-ratelimit-reset")) {
    return Math.max(0, +headers.get("x-ratelimit-reset") * 1000 - nowMs) + 1000;
  }
  if (status === 429) return 60_000;
  return null; // a plain 403 is a permission problem, not a rate limit
}

/**
 * REST client with:
 * - conditional GETs (ETag / If-None-Match) through a small in-memory cache;
 *   304 responses do not count against the primary rate limit
 * - Retry-After / x-ratelimit-reset handling with a wait ceiling
 * - exponential backoff for 5xx and network errors, with a retry ceiling
 * - header logging that never includes credentials
 */
export function makeApi(token, opts = {}) {
  if (typeof opts === "function") opts = { fetchImpl: opts }; // back-compat
  const {
    fetchImpl = fetch,
    cache = new Map(),
    maxRetries = 3,
    maxWaitMs = 15_000, // never sleep longer than this inside one webhook
    baseDelayMs = 500,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    log = () => {},
  } = opts;

  async function request(method, pathOrUrl, body) {
    const url = pathOrUrl.startsWith("http") ? pathOrUrl : API + pathOrUrl;
    const cached = method === "GET" ? cache.get(url) : undefined;
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetchImpl(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": UA,
            ...(cached?.etag ? { "If-None-Match": cached.etag } : {}),
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (e) {
        if (attempt < maxRetries) { await sleep(baseDelayMs * 2 ** attempt); continue; }
        throw new GitHubError(`GitHub unreachable: ${e.message}`, { status: 503, retryable: true });
      }
      const hdr = safeHeaders(res.headers);
      log({ type: "github_api", method, path: url.replace(API, "").split("?")[0], status: res.status, attempt, ...hdr });
      const requestId = hdr["x-github-request-id"];

      if (res.status === 304 && cached) return { status: 200, headers: res.headers, body: cached.body, fromCache: true };

      if (res.status === 429 || res.status === 403) {
        const wait = rateLimitWaitMs(res.status, res.headers, now());
        if (wait != null) {
          if (attempt < maxRetries && wait <= maxWaitMs) { await sleep(wait); continue; }
          throw new RateLimitError(`GitHub rate limit on ${method} ${url.replace(API, "")}`, { status: res.status, retryAt: now() + wait, requestId });
        }
      }
      if (res.status >= 500) {
        if (attempt < maxRetries) { await sleep(baseDelayMs * 2 ** attempt); continue; }
        throw new GitHubError(`GitHub ${res.status} on ${method} ${url.replace(API, "")}`, { status: res.status, retryable: true, requestId });
      }

      const text = await res.text();
      if (!res.ok) {
        throw new GitHubError(`GitHub ${method} ${url.replace(API, "")} -> ${res.status}: ${text.slice(0, 200)}`, { status: res.status, requestId });
      }
      const parsed = text ? JSON.parse(text) : {};
      const etag = res.headers.get("etag");
      if (method === "GET" && etag) {
        cache.set(url, { etag, body: parsed });
        if (cache.size > 500) cache.delete(cache.keys().next().value);
      }
      return { status: res.status, headers: res.headers, body: parsed };
    }
  }

  async function api(method, path, body) {
    return (await request(method, path, body)).body;
  }
  api.request = request;
  // Follow Link: rel="next" until done (or maxPages). `pick` extracts the array
  // from wrapped responses such as /installation/repositories.
  api.paginate = async (path, { pick = (b) => b, maxPages = 20 } = {}) => {
    const out = [];
    let url = path;
    for (let i = 0; url && i < maxPages; i++) {
      const r = await request("GET", url);
      out.push(...(pick(r.body) || []));
      url = parseLink(r.headers.get("link")).next;
    }
    return out;
  };
  return api;
}

// Installation tokens are cached until five minutes before expiry and are
// only ever held in server memory.
const tokenCache = new Map();
export function forgetInstallation(installationId) { tokenCache.delete(String(installationId)); }

export async function installationApi(installationId, env = process.env, fetchImpl = fetch, opts = {}) {
  const key = String(installationId);
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt - 5 * 60_000 > Date.now()) return makeApi(hit.token, { fetchImpl, ...opts });
  const jwt = appJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  let res;
  try {
    res = await fetchImpl(`${API}/app/installations/${installationId}/access_tokens`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": UA },
    });
  } catch (e) {
    throw new GitHubError(`GitHub unreachable while minting token: ${e.message}`, { status: 503, retryable: true });
  }
  if ([401, 403, 404].includes(res.status)) {
    tokenCache.delete(key);
    throw new InstallationGoneError(`Installation ${installationId} is suspended, revoked or deleted (${res.status})`, { status: res.status });
  }
  if (res.status >= 500 || res.status === 429) throw new GitHubError(`Token mint failed: ${res.status}`, { status: res.status, retryable: true });
  if (!res.ok) throw new GitHubError(`Token mint failed: ${res.status}`, { status: res.status });
  const { token, expires_at } = await res.json();
  tokenCache.set(key, { token, expiresAt: Date.parse(expires_at) || Date.now() + 55 * 60_000 });
  return makeApi(token, { fetchImpl, ...opts });
}
