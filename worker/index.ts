import handler from "vinext/server/fetch-handler";
import { runWithWaitlistContext } from "../lib/waitlist/request-context";
import { processCampaignQueues } from "../lib/waitlist/campaigns";
import { processEmailQueue } from "../lib/waitlist/mail";
import { cleanupAdminAuth, processAdminLoginEmails } from "../lib/waitlist/auth";
import { maintenance } from "../lib/waitlist/data";
import { isAdminRequestPath } from "../lib/waitlist/network-access";
import { adminAccessResponse } from "../lib/waitlist/access";

async function backgroundWork(env: Cloudflare.Env) {
  if (!env.DB) return;
  const login = await processAdminLoginEmails(env, { limit: 1 });
  // Keep owner sign-in ahead of marketing within the background time budget.
  if (!login.processed) {
    await processCampaignQueues(env, { limit: 25 });
    await processEmailQueue(env, { budgetMs: 20_000 });
  }
}

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const denied = await adminAccessResponse(request, env);
    if (denied) return denied;
    return runWithWaitlistContext(ctx, async () => {
      const response = await handler.fetch(request, env, ctx);
      const pathname = new URL(request.url).pathname;
      if (env.DB && pathname.startsWith("/api/")) {
        ctx.waitUntil(backgroundWork(env).catch(() => {
          console.warn("Waitlist background processing was interrupted.");
        }));
      }
      const headers = new Headers(response.headers);
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
      if (isAdminRequestPath(pathname) || pathname.startsWith("/api/")) {
        headers.set("Cache-Control", "private, no-store, max-age=0");
      }
      if (isAdminRequestPath(pathname)) {
        headers.set("CDN-Cache-Control", "no-store");
        headers.set("Cloudflare-CDN-Cache-Control", "no-store");
        headers.append("Vary", "CF-Connecting-IP");
        headers.append("Vary", "Cf-Access-Jwt-Assertion");
        headers.append("Vary", "Cookie");
      }
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  },
  scheduled(_event: ScheduledController, env: Cloudflare.Env, ctx: ExecutionContext) {
    ctx.waitUntil(runWithWaitlistContext(ctx, async () => {
      await backgroundWork(env);
      await maintenance(env);
      await cleanupAdminAuth(env);
    }).catch(() => {
      console.warn("Waitlist scheduled maintenance was interrupted.");
    }));
  },
};

export default worker;
