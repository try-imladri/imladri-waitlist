import { ApiError, cleanText, nowIso, publicOrigin, type SignupRow, type WaitlistEnv } from "./config.js";
import { decrypt, encrypt } from "./crypto.js";
import { database, person } from "./data.js";
import { messageFor, retryEmails } from "./mail.js";
import { renderBrandedEmail } from "./email-template.js";
import { previewEmailText } from "./email-preview.js";
type CampaignInput={type:string;subject:string;body:string;city:string;idempotencyKey:string};
function campaignInput(body:Record<string,unknown>):CampaignInput{
  const type=cleanText(body.type);const subject=cleanText(body.subject,201);
  const content=typeof body.body==="string"?body.body.trim():"";
  if(!["monthly","launch"].includes(type))throw new ApiError(400,"Choose a monthly update or launch notice.");
  if(!subject||subject.length>200)throw new ApiError(400,"Enter a subject of up to 200 characters.");
  if(!content||content.length>10000)throw new ApiError(400,"Enter an email body of up to 10,000 characters.");
  return{type,subject,body:content,city:cleanText(body.city),idempotencyKey:cleanText(body.idempotencyKey,100)};
}
function personalize(text:string,firstName:string,city:string){return text.replace(/\{\{\s*firstName\s*\}\}/gi,firstName).replace(/\{\{\s*city\s*\}\}/gi,city);}
async function audienceCount(city:string,env:WaitlistEnv,cutoff?:string){const conditions=["status='active'","expires_at>?"];const values:string[]=[nowIso()];if(city){conditions.push("city_key=?");values.push(city.toLocaleLowerCase());}if(cutoff){conditions.push("created_at<=?");values.push(cutoff);}return(await database(env).prepare(`SELECT COUNT(*) count FROM waitlist_signups WHERE ${conditions.join(" AND ")}`).bind(...values).first<{count:number}>())?.count||0;}
export async function previewCampaign(body:Record<string,unknown>,env:WaitlistEnv){const input=campaignInput(body);const content=personalize(input.body,"Alex",input.city||"your city");const origin=publicOrigin(new Request(env.PUBLIC_APP_URL||env.SITE_BASE_URL||"https://imladri.com"),env);return{subject:input.subject,body:content,html:renderBrandedEmail({subject:input.subject,text:previewEmailText(content,origin),kind:input.type,origin,preview:true,postalAddress:env.EMAIL_POSTAL_ADDRESS?.trim()}),recipientCount:await audienceCount(input.city,env)};}
type CampaignRow={id:string;kind:string;city:string|null;subject:string;encrypted_body:string;recipient_count:number;created_at:string;queue_cursor:string;queue_complete:number};

export async function campaignSummary(id:string,env:WaitlistEnv){
  const db=database(env);const campaign=await db.prepare("SELECT * FROM waitlist_campaigns WHERE id=?").bind(id).first<CampaignRow>();
  if(!campaign)throw new ApiError(404,"This campaign was not found.");
  const states=(await db.prepare("SELECT status,COUNT(*) count FROM waitlist_email_outbox WHERE campaign_id=? GROUP BY status").bind(id).all<{status:string;count:number}>()).results;
  const count=(status:string)=>states.find(r=>r.status===status)?.count||0;const sent=count("sent"),failed=count("failed"),cancelled=count("cancelled");
  return{campaignId:id,total:campaign.recipient_count,queued:Math.max(0,campaign.recipient_count-sent-failed-cancelled),sent,failed,cancelled,queueComplete:!!campaign.queue_complete,subject:campaign.subject,type:campaign.kind,city:campaign.city,createdAt:campaign.created_at};
}

export async function processCampaignQueues(env:WaitlistEnv,options:{campaignId?:string;limit?:number}={}){
  const db=database(env);const limit=Math.max(1,Math.min(25,options.limit||25));
  const campaign=options.campaignId?await db.prepare("SELECT * FROM waitlist_campaigns WHERE id=?").bind(options.campaignId).first<CampaignRow>():await db.prepare("SELECT * FROM waitlist_campaigns WHERE queue_complete=0 ORDER BY created_at LIMIT 1").first<CampaignRow>();
  if(!campaign)return{processed:0,queued:0,queueComplete:true};
  if(campaign.queue_complete)return{processed:0,...await campaignSummary(campaign.id,env)};
  const conditions=["status='active'","expires_at>?","created_at<=?","id>?"];const values:(string|number)[]=[nowIso(),campaign.created_at,campaign.queue_cursor];
  if(campaign.city){conditions.push("city_key=?");values.push(campaign.city.toLocaleLowerCase());}
  const rows=(await db.prepare(`SELECT * FROM waitlist_signups WHERE ${conditions.join(" AND ")} ORDER BY id LIMIT ?`).bind(...values,limit).all<SignupRow>()).results;
  const content=await decrypt<{body:string}>(campaign.encrypted_body,env);const request=new Request(env.PUBLIC_APP_URL||env.SITE_BASE_URL||"https://imladri.com");const now=nowIso();const statements:D1PreparedStatement[]=[];
  for(const row of rows){const p=await person(row,env);const message=await messageFor(row,p,request,env,personalize(campaign.subject,p.firstName,row.city),personalize(content.body,p.firstName,row.city));statements.push(db.prepare("INSERT OR IGNORE INTO waitlist_email_outbox (id,signup_id,campaign_id,kind,encrypted_payload,idempotency_key,status,attempts,created_at,updated_at) VALUES (?,?,?,?,?,?,'pending',0,?,?)").bind(crypto.randomUUID(),row.id,campaign.id,campaign.kind,await encrypt(message,env),`campaign-${campaign.id}-${row.id}`,now,now));}
  const complete=rows.length<limit;const cursor=rows.at(-1)?.id||campaign.queue_cursor;
  // Cursor and its outbox rows commit together. A concurrent retry can only add
  // the same idempotent messages, never skip recipients or duplicate delivery.
  statements.push(db.prepare("UPDATE waitlist_campaigns SET queue_cursor=CASE WHEN queue_cursor<? THEN ? ELSE queue_cursor END,queue_complete=CASE WHEN ?=1 THEN 1 ELSE queue_complete END WHERE id=?").bind(cursor,cursor,complete?1:0,campaign.id));
  await db.batch(statements);
  if(complete)await db.prepare("UPDATE waitlist_campaigns SET recipient_count=(SELECT COUNT(*) FROM waitlist_email_outbox WHERE campaign_id=?) WHERE id=?").bind(campaign.id,campaign.id).run();
  return{processed:rows.length,...await campaignSummary(campaign.id,env)};
}

export async function processCampaign(id:string,env:WaitlistEnv,fetcher:typeof fetch=fetch){
  await processCampaignQueues(env,{campaignId:id});
  const ids=(await database(env).prepare("SELECT id FROM waitlist_email_outbox WHERE campaign_id=? AND status='pending' ORDER BY created_at LIMIT 10").bind(id).all<{id:string}>()).results.map(r=>r.id);
  const delivery=ids.length?await retryEmails(env,ids,false,fetcher):{processed:0,sent:0,failed:0};
  return{...await campaignSummary(id,env),idempotent:true,processed:delivery.processed};
}

export async function listCampaigns(env:WaitlistEnv){const rows=(await database(env).prepare("SELECT id FROM waitlist_campaigns ORDER BY created_at DESC LIMIT 25").all<{id:string}>()).results;return{items:await Promise.all(rows.map(row=>campaignSummary(row.id,env)))};}

export async function sendCampaign(body:Record<string,unknown>,_request:Request,env:WaitlistEnv,ownerId:string,fetcher:typeof fetch=fetch){
  const input=campaignInput(body);if(!/^[a-zA-Z0-9_-]{16,100}$/.test(input.idempotencyKey))throw new ApiError(400,"A unique send request ID is required.","invalid_idempotency_key");
  const db=database(env);let campaign=await db.prepare("SELECT id FROM waitlist_campaigns WHERE idempotency_key=?").bind(input.idempotencyKey).first<{id:string}>();const idempotent=!!campaign;
  if(!campaign){const now=nowIso();const id=crypto.randomUUID();const count=await audienceCount(input.city,env,now);await db.prepare("INSERT OR IGNORE INTO waitlist_campaigns (id,idempotency_key,kind,city,subject,encrypted_body,recipient_count,created_by,created_at,queue_cursor,queue_complete) VALUES (?,?,?,?,?,?,?,?,?,'',0)").bind(id,input.idempotencyKey,input.type,input.city||null,input.subject,await encrypt({body:input.body},env),count,ownerId,now).run();campaign=await db.prepare("SELECT id FROM waitlist_campaigns WHERE idempotency_key=?").bind(input.idempotencyKey).first<{id:string}>();}
  if(!campaign)throw new ApiError(503,"We couldn't queue this email. Please try again.");
  return{...await processCampaign(campaign.id,env,fetcher),idempotent};
}
