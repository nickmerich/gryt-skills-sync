// Webhook delivery dedupe + a small serial job queue.
//
// GitHub can deliver the same event more than once (redeliveries, retries on
// timeouts). Each delivery carries a unique X-GitHub-Delivery GUID; we claim it
// before doing work and skip any delivery we have already claimed.
//
// Storage: in-memory by default (fine for one warm instance and for tests).
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN to share claims across
// serverless instances (SET NX EX, no SDK needed).

export function memoryStore({ now = () => Date.now() } = {}) {
  const m = new Map();
  const live = (k) => { const v = m.get(k); if (v && v.exp < now()) { m.delete(k); return undefined; } return v; };
  return {
    async claim(key, ttlSec, meta = {}) { if (live(key)) return false; m.set(key, { exp: now() + ttlSec * 1000, meta }); return true; },
    async release(key) { m.delete(key); },
    async purge(match) { let n = 0; for (const [k, v] of m) if (match(k, v.meta)) { m.delete(k); n++; } return n; },
    size: () => m.size,
  };
}

export function upstashStore(url, token, fetchImpl = fetch) {
  const cmd = async (...args) => {
    const r = await fetchImpl(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(args) });
    if (!r.ok) throw new Error(`delivery store ${r.status}`);
    return (await r.json()).result;
  };
  return {
    async claim(key, ttlSec, meta = {}) { return (await cmd("SET", `gryt:delivery:${key}`, JSON.stringify(meta), "NX", "EX", String(ttlSec))) === "OK"; },
    async release(key) { await cmd("DEL", `gryt:delivery:${key}`); },
    // Claims expire on their own (TTL); explicit purge is a no-op here.
    async purge() { return 0; },
  };
}

export function defaultStore(env = process.env) {
  return env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
    ? upstashStore(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN)
    : memoryStore();
}

/**
 * Serial queue with a retry ceiling. Retryable failures (rate limits, 5xx,
 * network) are retried with backoff; anything else, or a job that exhausts its
 * attempts, goes to `deadLetter` and its delivery claim is released so that a
 * manual redelivery from the GitHub App settings (or `bin/redeliver.js`) can
 * run it again. That is the controlled retry path.
 */
export function createQueue({ store = memoryStore(), maxAttempts = 3, baseDelayMs = 1000, maxDelayMs = 10_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = console.log } = {}) {
  let tail = Promise.resolve();
  const deadLetter = [];

  async function runWithRetry(job) {
    let lastErr;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return { ok: true, attempts: attempt, result: await job.run() };
      } catch (e) {
        lastErr = e;
        const retryable = !!e.retryable;
        log(JSON.stringify({ type: "job_error", delivery: job.id, event: job.event, attempt, retryable, status: e.status, error: e.name }));
        if (!retryable || attempt === maxAttempts) break;
        const wait = e.retryAt ? Math.max(0, e.retryAt - Date.now()) : baseDelayMs * 2 ** (attempt - 1);
        if (wait > maxDelayMs) break; // don't hold a serverless function open for a long reset
        await sleep(wait);
      }
    }
    deadLetter.push({ id: job.id, event: job.event, error: lastErr?.name, status: lastErr?.status, retryAt: lastErr?.retryAt, at: new Date().toISOString() });
    if (deadLetter.length > 100) deadLetter.shift();
    await store.release(job.id);
    return { ok: false, error: lastErr };
  }

  return {
    store,
    deadLetter,
    // Returns { duplicate: true } if this delivery was already claimed,
    // otherwise a promise for the job outcome.
    async enqueue({ id, event, installationId, run, ttlSec = 3 * 24 * 3600 }) {
      if (!id) return { duplicate: false, done: runWithRetry({ id: "no-id", event, run }) };
      const fresh = await store.claim(id, ttlSec, { installationId, event });
      if (!fresh) return { duplicate: true };
      const done = (tail = tail.then(() => runWithRetry({ id, event, run }), () => runWithRetry({ id, event, run })));
      return { duplicate: false, done };
    },
  };
}
