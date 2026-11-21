import { ApiError, nowIso, publicOrigin, type PersonalData, type SignupRow, type WaitlistEnv } from "./config.js";
import { decrypt, encrypt, signToken } from "./crypto.js";
import { database } from "./data.js";
import { renderBrandedEmail } from "./email-template.js";
type Message = { to: string; subject: string; text: string; unsubscribe: string; };
type OutboxRow = { id:string;signup_id:string;kind:string;encrypted_payload:string;idempotency_key:string;status:string;attempts:number };
export function welcomeBody(firstName: string, city: string, referralUrl: string) {
  return `Hi ${firstName},\n\nThanks for joining. I'm building Imladri because I'm tired of what dating apps have turned into: endless swiping, paywalls on who likes you, and a business model that profits when you stay single.\n\nHere's the plan: no swiping and a few compatible matches a week based on your answers. You're in ${city}, and I'll email you as we build and when we know more. Anyone 18 or older can join, from any city.\n\nThe best way to help is to share this with friends in your city:\n${referralUrl}\n\nOsama`;
}
export async function messageFor(row: SignupRow, p: PersonalData, request: Request, env: WaitlistEnv, subject: string, body: string): Promise<Message> {
  const origin = publicOrigin(request, env);
  const unsubscribe = `${origin}/api/waitlist/unsubscribe?token=${await signToken(row.id,"unsubscribe",env)}`;
  const visibleUnsubscribe = `${origin}/unsubscribe?token=${await signToken(row.id,"unsubscribe",env)}`;
  const deletion = `${origin}/delete-data?token=${await signToken(row.id,"delete",env)}`;
  return { to: p.email, subject, unsubscribe, text: `${body}\n\n—\nYou're receiving this because you joined the Imladri waitlist and agreed to launch updates.\nUnsubscribe: ${visibleUnsubscribe}\nDelete your waitlist data: ${deletion}\nPrivacy policy: ${origin}/privacy\nContact us: ${origin}/contact` };
}
export async function queueMessage(row: SignupRow, message: Message, env: WaitlistEnv, kind: string, idempotencyKey: string, campaignId: string | null = null) {
  const id = crypto.randomUUID(); const now = nowIso();
  await database(env).prepare("INSERT OR IGNORE INTO waitlist_email_outbox (id,signup_id,campaign_id,kind,encrypted_payload,idempotency_key,status,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',0,?,?)").bind(id,row.id,campaignId,kind,await encrypt(message,env),idempotencyKey,now,now).run();
  const saved = await database(env).prepare("SELECT id FROM waitlist_email_outbox WHERE idempotency_key=?").bind(idempotencyKey).first<{id:string}>();
  return saved!.id;
}
export async function sendOutbox(id: string, env: WaitlistEnv, fetcher: typeof fetch = fetch) {
  const db = database(env); const now = nowIso();
  const backoff=await db.prepare("SELECT expires_at FROM waitlist_rate_limits WHERE key='email-provider-backoff' AND expires_at>?").bind(now).first<{expires_at:string}>();
  if(backoff)return "deferred";
  const claimed = await db.prepare("UPDATE waitlist_email_outbox SET status='sending',attempts=attempts+1,updated_at=?,error=NULL WHERE id=? AND status IN ('pending','failed')").bind(now,id).run();
  if (!claimed.meta.changes) return (await db.prepare("SELECT status FROM waitlist_email_outbox WHERE id=?").bind(id).first<{status:string}>())?.status || "cancelled";
  const row = await db.prepare("SELECT * FROM waitlist_email_outbox WHERE id=?").bind(id).first<OutboxRow>();
  if (!row) return "cancelled";
  const signup = await db.prepare("SELECT status,expires_at FROM waitlist_signups WHERE id=?").bind(row.signup_id).first<{status:string;expires_at:string}>();
  if (!signup || ((signup.status !== "active" || signup.expires_at <= now) && row.kind !== "delete-request")) {
    await db.prepare("UPDATE waitlist_email_outbox SET status='cancelled',updated_at=? WHERE id=?").bind(now,id).run(); return "cancelled";
  }
  try {
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new ApiError(503,"Email delivery is not configured.","email_not_configured");
    const message = await decrypt<Message>(row.encrypted_payload,env);
    const postalAddress = env.EMAIL_POSTAL_ADDRESS?.trim();
    const text = postalAddress ? `${message.text}\nBusiness mailing address: ${postalAddress}` : message.text;
    const response = await fetcher("https://api.resend.com/emails", {
      method:"POST", signal:AbortSignal.timeout(12_000),
      headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":row.idempotency_key},
      body:JSON.stringify({from:env.EMAIL_FROM,to:[message.to],reply_to:env.EMAIL_REPLY_TO || "osama@imladri.com",subject:message.subject,text,html:renderBrandedEmail({subject:message.subject,text:message.text,kind:row.kind,origin:env.PUBLIC_APP_URL||env.SITE_BASE_URL,postalAddress}),headers:{"List-Unsubscribe":`<${message.unsubscribe}>`,"List-Unsubscribe-Post":"List-Unsubscribe=One-Click"}}),
    });
    if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}.`);
    const payload = await response.json() as {id?:string};
    await db.prepare("UPDATE waitlist_email_outbox SET status='sent',provider_id=?,sent_at=?,updated_at=?,error=NULL WHERE id=? AND status='sending'").bind(payload.id || null,nowIso(),nowIso(),id).run();
    return "sent";
  } catch (error) {
    const message = error instanceof ApiError ? error.message : error instanceof Error && /^Email provider returned HTTP \d+\.$/.test(error.message) ? error.message : "Delivery could not be confirmed. Retry uses the same message ID.";
    await db.prepare("UPDATE waitlist_email_outbox SET status='failed',error=?,updated_at=? WHERE id=? AND status='sending'").bind(message,nowIso(),id).run();
    await db.prepare("INSERT INTO waitlist_rate_limits (key,hits,expires_at) VALUES ('email-provider-backoff',1,?) ON CONFLICT(key) DO UPDATE SET expires_at=excluded.expires_at").bind(new Date(Date.now()+60_000).toISOString()).run();
    return "failed";
  }
}
export async function emailStatus(signupId:string,env:WaitlistEnv) {
  const row = await database(env).prepare("SELECT status FROM waitlist_email_outbox WHERE signup_id=? AND kind='welcome' ORDER BY created_at DESC LIMIT 1").bind(signupId).first<{status:string}>();
  return row?.status || "pending";
}
export async function retryEmails(env:WaitlistEnv,ids?:string[],allFailed=false,fetcher:typeof fetch=fetch,budgetMs=22_000) {
  const db=database(env); let rows:{id:string}[];
  if (ids?.length) { const selected=ids.slice(0,50); rows=(await db.prepare(`SELECT id FROM waitlist_email_outbox WHERE id IN (${selected.map(()=>"?").join(",")}) AND status IN ('pending','failed')`).bind(...selected).all<{id:string}>()).results; }
  else rows=(await db.prepare(`SELECT id FROM waitlist_email_outbox WHERE status IN (${allFailed ? "'failed','pending'" : "'pending'"}) ORDER BY created_at LIMIT 25`).all<{id:string}>()).results;
  const deadline=Date.now()+Math.min(22_000,Math.max(1000,budgetMs));let sent=0,failed=0,processed=0;
  for(const row of rows) { if(deadline-Date.now()<12_500)break;const result=await sendOutbox(row.id,env,fetcher);if(result==="deferred")break;processed++;if(result==="sent")sent++;if(result==="failed"){failed++;break;}if(processed<rows.length)await new Promise(resolve=>setTimeout(resolve,550)); }
  return {processed,sent,failed,remaining:rows.length-processed};
}

export async function processEmailQueue(env:WaitlistEnv,options:{budgetMs?:number;fetcher?:typeof fetch}={}) {
  const db=database(env);const deadline=Date.now()+Math.min(22_000,Math.max(1000,options.budgetMs||22_000));
  const cutoff=new Date(Date.now()-60_000).toISOString();
  const rows=(await db.prepare("SELECT id FROM waitlist_email_outbox WHERE status='pending' OR (status='failed' AND attempts<5 AND updated_at<?) ORDER BY created_at LIMIT 25").bind(cutoff).all<{id:string}>()).results;
  let processed=0,sent=0,failed=0;
  for(const row of rows){if(deadline-Date.now()<12_500)break;const result=await sendOutbox(row.id,env,options.fetcher||fetch);if(result==="deferred")break;processed++;if(result==="sent")sent++;if(result==="failed")failed++;if(failed)break;await new Promise(resolve=>setTimeout(resolve,550));}
  return{processed,sent,failed,pending:rows.length-processed};
}
