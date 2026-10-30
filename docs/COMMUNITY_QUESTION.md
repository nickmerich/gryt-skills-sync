# Draft community question (not posted: needs approval)

Category: Apps, API and Webhooks. Secrets and private repo content removed.

**Title:** Dedupe for redelivered webhooks across serverless instances: is X-GitHub-Delivery stable on manual redelivery?

**Body:**

I'm building a small GitHub App (issues + issue_comment events) on a serverless host. I claim each `X-GitHub-Delivery` GUID in a shared store with a 3-day TTL and skip repeats. When a job fails I release the claim so I can redeliver from the app settings or `POST /app/hook/deliveries/{id}/attempts`.

Minimal repro of the logic:

```js
const fresh = await store.claim(req.headers.get("x-github-delivery"), 3 * 24 * 3600);
if (!fresh) return Response.json({ note: "duplicate delivery" });
```

Questions:

1. Does a manual redelivery reuse the original `X-GitHub-Delivery` GUID, or get a new one? (Docs mention a `redelivery` flag on the deliveries list; I want the claim logic to match.)
2. Is there a recommended TTL for delivery-id dedupe?
3. What REST rate limit should I expect for an installation token on a single small personal-account installation, and does it change once the app is public?

Thanks.
