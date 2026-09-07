import { aggregateEvents, loadSnapshot, saveSnapshot } from "./aggregate.js";
import { renderDashboardHtml } from "./dashboard.js";
import { buildDigest } from "./digest.js";
import { sendDigestEmail } from "./email.js";
import type { Env } from "./types.js";

async function refreshAndStore(env: Env) {
  const snapshot = await aggregateEvents(env);
  await saveSnapshot(env, snapshot);
  return snapshot;
}

async function runDailyDigest(env: Env) {
  const snapshot = await refreshAndStore(env);
  const lookaheadDays = Number.parseInt(env.DIGEST_LOOKAHEAD_DAYS, 10) || 14;
  const digest = buildDigest(snapshot.events, lookaheadDays);
  const result = await sendDigestEmail(env, digest);
  if (!result.ok) {
    console.error(`[digest] failed to send: ${result.error}`);
  } else {
    console.log(`[digest] sent with ${digest.eventCount} events`);
  }
  return { snapshot, digest, emailResult: result };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/events") {
      let snapshot = await loadSnapshot(env);
      if (!snapshot) {
        snapshot = await refreshAndStore(env);
      }
      return Response.json(snapshot);
    }

    if (url.pathname === "/api/refresh" && request.method === "POST") {
      const snapshot = await refreshAndStore(env);
      return Response.json({ ok: true, eventCount: snapshot.eventCount, generatedAt: snapshot.generatedAt });
    }

    if (url.pathname === "/api/send-digest" && request.method === "POST") {
      const { digest, emailResult } = await runDailyDigest(env);
      return Response.json({ ok: emailResult.ok, error: emailResult.error, eventCount: digest.eventCount });
    }

    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(renderDashboardHtml(), { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runDailyDigest(env));
  },
};
