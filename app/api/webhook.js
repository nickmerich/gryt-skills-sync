import { verifySignature, installationApi } from "../lib/github.js";
import { handleEvent } from "../lib/handler.js";

export async function POST(request) {
  const raw = await request.text();
  if (!verifySignature(process.env.GITHUB_WEBHOOK_SECRET, raw, request.headers.get("x-hub-signature-256"))) {
    return new Response("bad signature", { status: 401 });
  }
  const event = request.headers.get("x-github-event");
  try {
    const result = await handleEvent(event, JSON.parse(raw), (id) => installationApi(id));
    return Response.json(result);
  } catch (e) {
    console.error(e);
    return Response.json({ ok: false, error: e.message }, { status: 500 });
  }
}

export function GET() {
  return Response.json({ ok: true, app: "GRYT Skills", status: "listening" });
}
