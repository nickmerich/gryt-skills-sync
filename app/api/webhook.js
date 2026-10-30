import { verifySignature, installationApi } from "../lib/github.js";
import { handleEvent, HANDLED_EVENTS } from "../lib/handler.js";
import { createQueue, defaultStore } from "../lib/queue.js";

// One queue per warm instance. Delivery claims go to the shared store when
// UPSTASH_* is configured, so duplicates are caught across instances too.
const queue = createQueue({ store: defaultStore() });
const log = (o) => console.log(typeof o === "string" ? o : JSON.stringify(o));

// GitHub waits 10 seconds for a response. Answer within ~8s; if the job is
// still running, return 202 and let it finish (waitUntil keeps the function
// alive on Vercel when available).
const RESPOND_WITHIN_MS = 8000;

export function makeWebhook({ q = queue, getApi = (id) => installationApi(id, process.env, fetch, { log }), secret = () => process.env.GITHUB_WEBHOOK_SECRET, waitUntil } = {}) {
  return async function POST(request) {
    const raw = await request.text();
    if (!verifySignature(secret(), raw, request.headers.get("x-hub-signature-256"))) {
      return new Response("bad signature", { status: 401 });
    }
    const event = request.headers.get("x-github-event");
    const delivery = request.headers.get("x-github-delivery");
    if (!HANDLED_EVENTS.includes(event)) return Response.json({ ok: true, note: "event not subscribed" });

    let payload;
    try { payload = JSON.parse(raw); } catch { return Response.json({ ok: false, error: "invalid json" }, { status: 400 }); }

    const job = await q.enqueue({
      id: delivery,
      event,
      installationId: payload.installation?.id,
      run: () => handleEvent(event, payload, getApi, log, { store: q.store }),
    });
    if (job.duplicate) return Response.json({ ok: true, note: "duplicate delivery", delivery });

    const timeout = new Promise((r) => setTimeout(() => r("pending"), RESPOND_WITHIN_MS).unref?.());
    const outcome = await Promise.race([job.done, timeout]);
    if (outcome === "pending") {
      (waitUntil || globalThis[Symbol.for("@vercel/request-context")]?.get?.()?.waitUntil)?.(job.done);
      return Response.json({ ok: true, note: "accepted", delivery }, { status: 202 });
    }
    if (!outcome.ok) {
      // No internal error text leaves the server; the delivery id lets you find
      // the log line and redeliver from the app settings.
      return Response.json({ ok: false, error: "processing failed", delivery }, { status: 500 });
    }
    return Response.json({ ...outcome.result, delivery });
  };
}

export const POST = makeWebhook();

export function GET() {
  return Response.json({ ok: true, app: "GRYT Skills", status: "listening" });
}
