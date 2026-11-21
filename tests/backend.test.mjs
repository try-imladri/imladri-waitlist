import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { Miniflare } from "miniflare";

const root=path.resolve(import.meta.dirname,"..");
const compiled=path.join(root,"outputs","backend-test-runtime");
await mkdir(compiled,{recursive:true});
for(const name of await readdir(path.join(root,"lib","waitlist"))){if(!name.endsWith(".ts"))continue;const source=await readFile(path.join(root,"lib","waitlist",name),"utf8");await writeFile(path.join(compiled,name.replace(/\.ts$/,".js")),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);}
const {handleApi}=await import(pathToFileURL(path.join(compiled,"handlers.js")).href);
const {decrypt,signToken,hash,keyedHash}=await import(pathToFileURL(path.join(compiled,"crypto.js")).href);
const {csvCell}=await import(pathToFileURL(path.join(compiled,"admin.js")).href);
const {processEmailQueue,sendOutbox}=await import(pathToFileURL(path.join(compiled,"mail.js")).href);
const {reportingDay}=await import(pathToFileURL(path.join(compiled,"config.js")).href);
const {createSignup}=await import(pathToFileURL(path.join(compiled,"data.js")).href);
const {processAdminLoginEmails}=await import(pathToFileURL(path.join(compiled,"auth.js")).href);
const {normalizeAdminIp,adminNetworkResponse,adminNetworkAllowed,isAdminRequestPath}=await import(pathToFileURL(path.join(compiled,"network-access.js")).href);
let mf,DB;const sent=[];
const env={WAITLIST_DATA_KEY:Buffer.alloc(32,7).toString("base64"),WAITLIST_SIGNING_KEY:"test-only-signing-key-with-enough-entropy-length",RESEND_API_KEY:"test-provider-key",EMAIL_FROM:"Osama from Imladri <osama@imladri.com>",EMAIL_REPLY_TO:"osama@imladri.com",ADMIN_EMAILS:"owner@example.com",ADMIN_ALLOWED_IPS:"192.0.2.10",SITE_BASE_URL:"https://waitlist.example.com"};
const fetcher=async(url,options)=>{assert.equal(url,"https://api.resend.com/emails");sent.push({payload:JSON.parse(options.body),headers:options.headers});return new Response(JSON.stringify({id:crypto.randomUUID()}),{status:200,headers:{"content-type":"application/json"}});};
const admin={cookie:""};
function request(endpoint,body,headers={}){return new Request("https://waitlist.example.com"+endpoint,{method:body===undefined?"GET":"POST",headers:{origin:"https://waitlist.example.com","CF-Connecting-IP":"192.0.2.10",...(body===undefined?{}:{"content-type":"application/json"}),...headers},body:body===undefined?undefined:JSON.stringify(body)});}
function signup(extra={}){return{firstName:"Alex",email:"alex@example.com",city:"Chicago",ageRange:"25-29",adultConfirmed:true,gender:"Non-binary",genderDescription:"",interestedIn:["Women","Men","Non-binary people"],lookingFor:"Dating",source:"TikTok",emailConsent:true,website:"",sessionId:"anonymous_session_0000001",utmSource:"tiktok",utmCampaign:"first-video",utmContent:"link-in-bio",referrer:"https://www.tiktok.com/@imladri?private=not-stored",...extra};}
async function api(endpoint,body,headers={},fetchOverride=fetcher){return handleApi(request(endpoint,body,headers),{...env,DB},false,fetchOverride);}
before(async()=>{mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-05-15",d1Databases:{DB:"waitlist-integration-tests-"+crypto.randomUUID()},d1Persist:path.join(root,"outputs","test-d1")});DB=await mf.getD1Database("DB");const migrations=(await readdir(path.join(root,"drizzle"))).filter(n=>n.endsWith(".sql")).sort();for(const file of migrations){for(const sql of(await readFile(path.join(root,"drizzle",file),"utf8")).split("--> statement-breakpoint")){if(sql.trim())await DB.prepare(sql.trim()).run();}}});
beforeEach(async()=>{sent.length=0;await DB.batch([DB.prepare("DELETE FROM contact_messages"),DB.prepare("DELETE FROM waitlist_email_outbox"),DB.prepare("DELETE FROM waitlist_signups"),DB.prepare("DELETE FROM waitlist_campaigns"),DB.prepare("DELETE FROM waitlist_visits"),DB.prepare("DELETE FROM waitlist_rate_limits"),DB.prepare("DELETE FROM waitlist_admin_codes"),DB.prepare("DELETE FROM waitlist_admin_sessions")]);const token=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");const now=new Date().toISOString();await DB.prepare("INSERT INTO waitlist_admin_sessions (token_hash,email_hash,created_at,last_seen_at,expires_at) VALUES (?,?,?,?,?)").bind(await hash(token),await keyedHash("admin-owner:owner@example.com",env),now,now,new Date(Date.now()+8*3600_000).toISOString()).run();admin.cookie=`__Host-imladri_admin=${token}`;});
after(async()=>{await mf?.dispose();});

test("signup persists every requested field encrypted, sends welcome, and restores the receipt",async()=>{
  const response=await api("/api/waitlist/signup",signup());assert.equal(response.status,201);const result=await response.json();assert.equal(result.emailStatus,"sent");assert.ok(result.referralCode);assert.equal(sent.length,1);
  const rows=await DB.prepare("SELECT * FROM waitlist_signups").all();assert.equal(rows.results.length,1);const row=rows.results[0];assert.ok(!JSON.stringify(row).includes("alex@example.com"));assert.ok(!JSON.stringify(row).includes("Non-binary"));const personal=await decrypt(row.encrypted_data,env);assert.deepEqual(personal,{firstName:"Alex",email:"alex@example.com",ageRange:"25-29",adultConfirmed:true,gender:"Non-binary",genderDescription:"",interestedIn:["Women","Men","Non-binary people"],lookingFor:"Dating",emailConsent:true});assert.equal(row.city,"Chicago");assert.equal(row.source,"TikTok");assert.equal(row.utm_source,"tiktok");assert.equal(row.utm_campaign,"first-video");assert.equal(row.utm_content,"link-in-bio");assert.equal(row.referrer_host,"www.tiktok.com");assert.equal(row.consent_version,"2026-11-19-v1");assert.ok(row.consent_at);assert.equal(row.created_day,reportingDay(row.created_at));
  const cookie=response.headers.get("set-cookie");assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);const confirmation=await api("/api/waitlist/status",undefined,{cookie});assert.equal(confirmation.status,200);assert.equal((await confirmation.json()).firstName,"Alex");
  const listed=(await(await api("/api/admin/signups",undefined,admin)).json()).items[0];for(const[field,value]of Object.entries(personal))assert.deepEqual(listed[field],value,field);assert.equal(listed.city,row.city);assert.equal(listed.source,row.source);assert.equal(listed.utmSource,row.utm_source);assert.equal(listed.utmMedium,row.utm_medium);assert.equal(listed.utmCampaign,row.utm_campaign);assert.equal(listed.utmContent,row.utm_content);assert.equal(listed.utmTerm,row.utm_term);assert.equal(listed.referrer,row.referrer_host);assert.equal(listed.referralCode,row.referral_code);assert.equal(listed.consentAt,row.consent_at);
  const email=sent[0].payload;assert.equal(email.subject,"You're on the list");assert.ok(email.text.includes("Unsubscribe:"));assert.ok(email.text.includes("Delete your waitlist data:"));assert.ok(email.text.includes("Contact us: https://waitlist.example.com/contact"));assert.ok(!email.text.includes("Questions:"));assert.ok(email.text.includes("Privacy policy: https://waitlist.example.com/privacy"));assert.match(email.html,/<a href="https:\/\/waitlist\.example\.com\/privacy"/);assert.match(email.html,/<a href="https:\/\/waitlist\.example\.com\/unsubscribe\?token=/);assert.ok(email.text.includes(result.referralUrl));assert.ok(!email.text.includes("$19"));assert.equal(email.headers["List-Unsubscribe-Post"],"List-Unsubscribe=One-Click");
  const counts=await(await api("/api/public/stats")).json();assert.equal(counts.totalSignups,1);assert.deepEqual(counts.cities,[{city:"Chicago",count:1}]);
});
test("adult consent, email consent, valid options, and honeypot checks block invalid records",async()=>{
  for(const extra of[{adultConfirmed:false},{emailConsent:false},{email:"invalid"},{gender:"invalid"},{interestedIn:[]},{ageRange:"under18"},{gender:"Prefer to self-describe",genderDescription:""},{website:"bot-site"}]){const res=await api("/api/waitlist/signup",signup(extra));assert.equal(res.status,400,JSON.stringify(extra));}
  assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,0);assert.equal(sent.length,0);
});
test("arbitrary cities and all adult demographic options can join without limits or launch gates",async()=>{
  const res=await api("/api/waitlist/signup",signup({city:"Other",otherCity:"London, UK",ageRange:"50+",gender:"Prefer to self-describe",genderDescription:"Genderfluid",email:"other@example.com"}));assert.equal(res.status,201);
  const row=await DB.prepare("SELECT * FROM waitlist_signups").first();assert.equal(row.city,"London, UK");assert.equal((await decrypt(row.encrypted_data,env)).genderDescription,"Genderfluid");assert.equal((await(await api("/api/public/config")).json()).noLaunchRestrictions,true);
});
test("normalized duplicate emails and concurrent duplicate attempts create one signup and one welcome",async()=>{
  const results=await Promise.all([api("/api/waitlist/signup",signup({email:" ALEX@EXAMPLE.COM "})),api("/api/waitlist/signup",signup())]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,1);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_email_outbox").first()).count,1);assert.equal(sent.length,1);
});
test("referrals count unique active friends and duplicate attempts do not inflate totals",async()=>{
  const parent=await api("/api/waitlist/signup",signup());const parentCookie=parent.headers.get("set-cookie");const code=(await parent.json()).referralCode;
  assert.equal((await api("/api/waitlist/signup",signup({email:"friend@example.com",referralCode:code,sessionId:"anonymous_session_friend_01",source:"Friend"}))).status,201);
  assert.equal((await api("/api/waitlist/signup",signup({email:"friend@example.com",referralCode:code}))).status,409);
  const receipt=await(await api("/api/waitlist/status",undefined,{cookie:parentCookie})).json();assert.equal(receipt.referralCount,1);
  const friend=await DB.prepare("SELECT id FROM waitlist_signups WHERE referred_by IS NOT NULL").first();const token=await signToken(friend.id,"unsubscribe",env);assert.equal((await api("/api/waitlist/unsubscribe",{token})).status,200);assert.equal((await(await api("/api/waitlist/status",undefined,{cookie:parentCookie})).json()).referralCount,0);
});
test("unsubscribe GET is safe for email scanners, one-click POST immediately opts out",async()=>{
  await api("/api/waitlist/signup",signup());const row=await DB.prepare("SELECT id FROM waitlist_signups").first();const token=await signToken(row.id,"unsubscribe",env);
  assert.equal((await api("/api/waitlist/unsubscribe?token="+token)).status,200);assert.equal((await DB.prepare("SELECT status FROM waitlist_signups").first()).status,"active");
  const res=await handleApi(new Request("https://waitlist.example.com/api/waitlist/unsubscribe?token="+token,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:"List-Unsubscribe=One-Click"}),{...env,DB},false,fetcher);assert.equal(res.status,200);assert.equal((await DB.prepare("SELECT status FROM waitlist_signups").first()).status,"unsubscribed");assert.equal((await(await api("/api/public/stats")).json()).totalSignups,0);
  assert.equal((await api("/api/waitlist/unsubscribe",{token:token+"x"})).status,400);
});
test("deletion removes personal record, receipt, and encrypted email payloads",async()=>{
  const res=await api("/api/waitlist/signup",signup());const cookie=res.headers.get("set-cookie");const row=await DB.prepare("SELECT id FROM waitlist_signups").first();const token=await signToken(row.id,"delete",env);
  assert.equal((await api("/api/waitlist/delete?token="+token)).status,200);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,1);
  assert.equal((await api("/api/waitlist/delete",{token})).status,200);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_email_outbox").first()).count,0);assert.equal((await api("/api/waitlist/status",undefined,{cookie})).status,401);
});
test("admin data is owner-only and state changes reject cross-origin requests",async()=>{
  await api("/api/waitlist/signup",signup());assert.equal((await api("/api/admin/overview")).status,401);assert.equal((await api("/api/admin/signups",undefined,{"oai-authenticated-user-id":"forged-id","oai-authenticated-user-email":"owner@example.com"})).status,401);
  const res=await api("/api/admin/overview",undefined,admin);assert.equal(res.status,200);const stats=await res.json();assert.equal(stats.totals.active,1);assert.equal(stats.conversionRate,100);assert.equal(stats.cities[0].genderCounts["Non-binary"],1);assert.equal(stats.cities[0].ageCounts["25-29"],1);
  assert.equal((await api("/api/admin/emails/retry",{allFailed:true},{...admin,origin:"https://evil.example"})).status,403);
  assert.equal((await api("/api/waitlist/signup",signup({email:"evil@example.com"}),{origin:"https://evil.example"})).status,403);
  const listed=await(await api("/api/admin/signups?q=alex%40example.com",undefined,admin)).json();assert.equal(listed.total,1);assert.equal(listed.items[0].email,"alex@example.com");assert.equal(listed.items[0].interestedIn.length,3);
});
test("provider failures keep signup and outbox durable, retries use stable idempotency",async()=>{
  const failed=await api("/api/waitlist/signup",signup(),{},async()=>new Response("provider unavailable",{status:503}));assert.equal(failed.status,201);assert.equal((await failed.json()).emailStatus,"failed");assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,1);
  const row=await DB.prepare("SELECT id,idempotency_key FROM waitlist_email_outbox").first();const deferred=await(await api("/api/admin/emails/retry",{ids:[row.id]},admin)).json();assert.equal(deferred.sent,0);assert.equal(deferred.remaining,1);assert.equal(sent.length,0);await DB.prepare("UPDATE waitlist_rate_limits SET expires_at='2020-01-01' WHERE key='email-provider-backoff'").run();const retry=await api("/api/admin/emails/retry",{ids:[row.id]},admin);assert.equal(retry.status,200);assert.equal((await retry.json()).sent,1);assert.equal(sent[0].headers["Idempotency-Key"],row.idempotency_key);
  await api("/api/admin/emails/retry",{ids:[row.id]},admin);assert.equal(sent.length,1);
});
test("send-time postal configuration preserves queued payloads and remains optional",async()=>{
  const failed=await api("/api/waitlist/signup",signup(),{},async()=>new Response("synthetic outage",{status:503}));assert.equal(failed.status,201);assert.equal((await failed.json()).emailStatus,"failed");
  const row=await DB.prepare("SELECT id,idempotency_key,encrypted_payload FROM waitlist_email_outbox").first();const original=await decrypt(row.encrypted_payload,env);assert.ok(!original.text.includes("Business mailing address:"));
  await DB.prepare("UPDATE waitlist_rate_limits SET expires_at='2020-01-01' WHERE key='email-provider-backoff'").run();
  const postalAddress="TEST ONLY <Address> & Co.\n123 Example Street";assert.equal(await sendOutbox(row.id,{...env,DB,EMAIL_POSTAL_ADDRESS:postalAddress},fetcher),"sent");assert.equal(sent.length,1);
  const delivered=sent[0];assert.equal(delivered.payload.text,original.text+"\nBusiness mailing address: "+postalAddress);assert.ok(delivered.payload.html.includes("TEST ONLY &lt;Address&gt; &amp; Co.<br>123 Example Street"));assert.ok(!delivered.payload.html.includes("TEST ONLY <Address>"));assert.equal(delivered.headers["Idempotency-Key"],row.idempotency_key);assert.equal(delivered.payload.headers["List-Unsubscribe"],`<${original.unsubscribe}>`);assert.equal(delivered.payload.headers["List-Unsubscribe-Post"],"List-Unsubscribe=One-Click");
  const saved=await DB.prepare("SELECT encrypted_payload FROM waitlist_email_outbox WHERE id=?").bind(row.id).first();assert.equal(saved.encrypted_payload,row.encrypted_payload);assert.deepEqual(await decrypt(saved.encrypted_payload,env),original);
  const fallback=await api("/api/waitlist/signup",signup({email:"fallback@example.com"}));assert.equal(fallback.status,201);assert.equal((await fallback.json()).emailStatus,"sent");const fallbackRow=await DB.prepare("SELECT encrypted_payload FROM waitlist_email_outbox WHERE id!=?").bind(row.id).first();const fallbackMessage=await decrypt(fallbackRow.encrypted_payload,env);assert.equal(sent.at(-1).payload.text,fallbackMessage.text);assert.ok(!sent.at(-1).payload.html.includes("Business mailing address:"));
});

test("campaigns target consented active recipients and a repeated send does not duplicate emails",async()=>{
  await api("/api/waitlist/signup",signup());await api("/api/waitlist/signup",signup({email:"second@example.com",city:"Houston"}));const candidate=await DB.prepare("SELECT id FROM waitlist_signups WHERE city='Houston'").first();await api("/api/admin/signups/"+candidate.id+"/unsubscribe",{},admin);
  const input={type:"monthly",subject:"An honest update",body:"Hi {{firstName}}, an update for {{city}}.",idempotencyKey:"campaign_request_0000001"};const preview=await(await api("/api/admin/campaigns/preview",input,admin)).json();assert.equal(preview.recipientCount,1);
  const sentBefore=sent.length;const first=await(await api("/api/admin/campaigns/send",input,admin)).json();assert.equal(first.sent,1);const repeat=await(await api("/api/admin/campaigns/send",input,admin)).json();assert.equal(repeat.idempotent,true);assert.equal(sent.length,sentBefore+1);assert.ok(sent.at(-1).payload.text.includes("Hi Alex, an update for Chicago."));
});
test("CSV exports all fields and neutralizes spreadsheet formulas",async()=>{
  await api("/api/waitlist/signup",signup({firstName:"=HYPERLINK(\"https://evil.example\")"}));const res=await api("/api/admin/export",undefined,admin);assert.equal(res.status,200);const csv=await res.text();assert.ok(csv.includes("Interested in"));assert.ok(csv.includes("alex@example.com"));assert.ok(csv.includes("'=HYPERLINK"));assert.equal(csvCell("+SUM(A1)"),'"\'+SUM(A1)"');
});
test("admin signup pagination tolerates non-finite inputs without failing database reads",async()=>{
  await createSignup(signup(),{...env,DB});
  for(const query of["page=Infinity","page=1e309","page=NaN","page=invalid","page=-2","page=1.9","pageSize=Infinity","pageSize=1e309"]){
    const response=await api("/api/admin/signups?"+query,undefined,admin);assert.equal(response.status,200,query);const result=await response.json();assert.equal(result.page,1,query);assert.equal(result.total,1,query);assert.equal(result.items[0].email,"alex@example.com",query);assert.ok(Number.isFinite(result.pageSize)&&result.pageSize<=100,query);
  }
  const large=await api("/api/admin/signups?page=1e100&pageSize=1000",undefined,admin);assert.equal(large.status,200);const result=await large.json();assert.equal(result.page,100000);assert.equal(result.pageSize,100);assert.equal(result.total,1);assert.deepEqual(result.items,[]);
});

test("retention removes expired personal records and keeps public metrics accurate",async()=>{
  await api("/api/waitlist/signup",signup());await DB.prepare("UPDATE waitlist_signups SET expires_at=?").bind("2020-01-01T00:00:00.000Z").run();const counts=await(await api("/api/public/stats")).json();assert.equal(counts.totalSignups,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_email_outbox").first()).count,0);
});
test("deletion-link requests return before account lookup or provider work when a background context is available",async()=>{
  await api("/api/waitlist/signup",signup());const before=sent.length;const tasks=[];const defer=work=>{tasks.push(work);return true;};
  const existing=await handleApi(request("/api/waitlist/delete-request",{email:"alex@example.com"}),{...env,DB},false,fetcher,defer);const missing=await handleApi(request("/api/waitlist/delete-request",{email:"unknown@example.com"}),{...env,DB},false,fetcher,defer);assert.deepEqual(await existing.json(),await missing.json());assert.equal(sent.length,before);assert.equal(tasks.length,2);await tasks[0]();await tasks[1]();assert.equal(sent.length,before+1);assert.equal(sent.at(-1).payload.subject,"Delete your Imladri waitlist data");
});
test("city aggregation merges case variants and analytics use Chicago dates across DST",async()=>{
  await api("/api/waitlist/signup",signup({city:"Other",otherCity:"London",email:"one@example.com"}));await api("/api/waitlist/signup",signup({city:"Other",otherCity:"london",email:"two@example.com",gender:"Woman"}));
  const stats=await(await api("/api/admin/overview",undefined,admin)).json();assert.equal(stats.cities.length,1);assert.equal(stats.cities[0].count,2);assert.equal(stats.reportingTimezone,"America/Chicago");assert.equal(stats.daily[0].date,reportingDay());
  assert.equal(reportingDay("2026-01-01T05:30:00.000Z"),"2025-12-31");assert.equal(reportingDay("2026-07-01T05:30:00.000Z"),"2026-07-01");assert.equal(reportingDay("2026-03-08T07:30:00.000Z"),"2026-03-08");assert.equal(reportingDay("2026-03-08T08:30:00.000Z"),"2026-03-08");
});
test("expired active records cannot receive campaign mail even before retention cleanup",async()=>{
  await createSignup(signup(),{...env,DB});await DB.prepare("UPDATE waitlist_signups SET expires_at='2020-01-01T00:00:00.000Z'").run();const input={type:"monthly",subject:"Update",body:"Hello {{firstName}}",idempotencyKey:"expired_campaign_request01"};assert.equal((await(await api("/api/admin/campaigns/preview",input,admin)).json()).recipientCount,0);const result=await(await api("/api/admin/campaigns/send",input,admin)).json();assert.equal(result.sent,0);assert.equal(result.queueComplete,true);assert.equal(sent.length,0);
});
test("bulk retry stops on the first provider failure and returns remaining work",async()=>{
  for(let i=0;i<3;i++)await api("/api/waitlist/signup",signup({email:`retry${i}@example.com`}));await DB.prepare("UPDATE waitlist_email_outbox SET status='pending',sent_at=NULL").run();let calls=0;const result=await(await api("/api/admin/emails/retry",{allFailed:true},admin,async()=>{calls++;return new Response("limited",{status:429});})).json();assert.equal(calls,1);assert.equal(result.processed,1);assert.equal(result.failed,1);assert.equal(result.remaining,2);
});
test("foreground email retry respects its total time budget",async(t)=>{
  for(let i=0;i<3;i++)await api("/api/waitlist/signup",signup({email:`budget${i}@example.com`}));await DB.prepare("UPDATE waitlist_email_outbox SET status='pending',sent_at=NULL").run();t.mock.timers.enable({apis:["Date"],now:Date.now()});let calls=0;try{const result=await(await api("/api/admin/emails/retry",{allFailed:true},admin,async()=>{calls++;t.mock.timers.tick(11_000);return new Response('{"id":"budget-test"}',{status:200});})).json();assert.equal(calls,1);assert.equal(result.processed,1);assert.equal(result.remaining,2);}finally{t.mock.timers.reset();}
});
test("resumable keyset campaign queuing does not skip people after earlier recipients are deleted",async()=>{
  for(let i=0;i<31;i++)await createSignup(signup({email:`batch${i}@example.com`}),{...env,DB});const input={type:"monthly",subject:"Progress",body:"Hi {{firstName}}",idempotencyKey:"resumable_campaign_request01"};let state=await(await api("/api/admin/campaigns/send",input,admin)).json();assert.equal(state.total,31);assert.equal(state.queueComplete,false);
  const early=await DB.prepare("SELECT signup_id FROM waitlist_email_outbox WHERE campaign_id=? ORDER BY signup_id LIMIT 1").bind(state.campaignId).first();await api(`/api/admin/signups/${early.signup_id}/delete`,{},admin);
  for(let i=0;i<5&&(!state.queueComplete||state.queued);i++)state=await(await api("/api/admin/campaigns/process",{campaignId:state.campaignId},admin)).json();assert.equal(state.queueComplete,true);assert.equal(state.total,30);assert.equal(state.sent,30);assert.equal(state.queued,0);const delivered=await DB.prepare("SELECT COUNT(DISTINCT signup_id) count FROM waitlist_email_outbox WHERE campaign_id=? AND status='sent'").bind(state.campaignId).first();assert.equal(delivered.count,30);
});

async function issueCode(email="owner@example.com"){
  const tasks=[];const response=await handleApi(request("/api/admin/auth/request",{email}),{...env,DB},false,fetcher,work=>{tasks.push(work);return true;});
  for(const work of tasks)await work();
  const emailMessage=sent.findLast(row=>row.payload.subject==="Your Imladri admin sign-in code");
  return{response,code:emailMessage?.payload.text.match(/\b\d{8}\b/)?.[0],message:emailMessage};
}

test("admin code request is generic, owner-only, deferred, and stores no plaintext code or email",async()=>{
  const tasks=[];const defer=work=>{tasks.push(work);return true;};
  const known=await handleApi(request("/api/admin/auth/request",{email:"owner@example.com"}),{...env,DB},false,fetcher,defer);
  const unknown=await handleApi(request("/api/admin/auth/request",{email:"unknown@example.com"}),{...env,DB},false,fetcher,defer);
  assert.equal(known.status,202);assert.deepEqual(await known.json(),await unknown.json());assert.equal(sent.length,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_admin_codes").first()).count,0);
  for(const work of tasks)await work();assert.equal(sent.length,1);assert.deepEqual(sent[0].payload.to,["owner@example.com"]);assert.ok(sent[0].payload.text.includes("Contact us: https://waitlist.example.com/contact"));const code=sent[0].payload.text.match(/\b\d{8}\b/)[0];const row=await DB.prepare("SELECT * FROM waitlist_admin_codes").first();assert.ok(!JSON.stringify(row).includes(code));assert.ok(!JSON.stringify(row).includes("owner@example.com"));assert.equal(row.attempts,0);assert.equal(row.delivery_status,"sent");
});
test("verified owner code creates a secure hashed session, works without identity headers, and is single-use",async()=>{
  const{code}=await issueCode();assert.ok(code);const response=await api("/api/admin/auth/verify",{email:"owner@example.com",code});assert.equal(response.status,200);const body=await response.json();assert.equal(body.user.email,"owner@example.com");const cookie=response.headers.get("set-cookie");assert.match(cookie,/__Host-imladri_admin=/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Path=\//);const token=cookie.match(/^[^=]+=([^;]+)/)[1];assert.equal(token.length,43);const sessions=await DB.prepare("SELECT * FROM waitlist_admin_sessions").all();assert.ok(!JSON.stringify(sessions.results).includes(token));assert.ok(!JSON.stringify(sessions.results).includes("owner@example.com"));
  assert.equal((await api("/api/admin/me",undefined,{cookie})).status,200);assert.equal((await api("/api/admin/overview",undefined,{cookie,"oai-authenticated-user-id":"attacker","oai-authenticated-user-email":"attacker@example.com"})).status,200);assert.equal((await api("/api/admin/auth/verify",{email:"owner@example.com",code})).status,401);assert.equal((await DB.prepare("SELECT encrypted_code FROM waitlist_admin_codes").first()).encrypted_code,null);
});
test("a code cannot be redeemed twice concurrently",async()=>{
  const{code}=await issueCode();const results=await Promise.all([api("/api/admin/auth/verify",{email:"owner@example.com",code}),api("/api/admin/auth/verify",{email:"owner@example.com",code})]);assert.deepEqual(results.map(r=>r.status).sort(),[200,401]);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_admin_sessions").first()).count,2);
});
test("code guessing locks after five attempts and expired codes never create sessions",async()=>{
  const{code}=await issueCode();const wrong=code==="00000000"?"11111111":"00000000";for(let i=0;i<5;i++)assert.equal((await api("/api/admin/auth/verify",{email:"owner@example.com",code:wrong})).status,401);assert.equal((await api("/api/admin/auth/verify",{email:"owner@example.com",code})).status,401);assert.equal((await DB.prepare("SELECT attempts FROM waitlist_admin_codes").first()).attempts,5);
  await DB.prepare("UPDATE waitlist_admin_codes SET attempts=0,expires_at='2020-01-01T00:00:00.000Z'").run();assert.equal((await api("/api/admin/auth/verify",{email:"owner@example.com",code})).status,401);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_admin_sessions").first()).count,1);
});
test("request limits and resend cooldown protect both known and unknown email addresses",async()=>{
  const first=await issueCode();const firstRow=await DB.prepare("SELECT nonce FROM waitlist_admin_codes").first();const again=await issueCode();assert.equal(again.response.status,202);assert.equal(sent.length,1);assert.equal((await DB.prepare("SELECT nonce FROM waitlist_admin_codes").first()).nonce,firstRow.nonce);await issueCode();assert.equal((await issueCode()).response.status,429);
  for(let i=0;i<3;i++)assert.equal((await issueCode("not-owner@example.com")).response.status,202);assert.equal((await issueCode("not-owner@example.com")).response.status,429);assert.equal(sent.length,1);assert.ok(first.code);
});
test("auth request, verification and logout enforce same-origin CSRF guards",async()=>{
  for(const endpoint of["request","verify","logout"]){const body=endpoint==="verify"?{email:"owner@example.com",code:"12345678"}:{email:"owner@example.com"};assert.equal((await api(`/api/admin/auth/${endpoint}`,body,{origin:"https://evil.example",...admin})).status,403);const missing=new Request(`https://waitlist.example.com/api/admin/auth/${endpoint}`,{method:"POST",headers:{"content-type":"application/json","CF-Connecting-IP":"192.0.2.10",...admin},body:JSON.stringify(body)});assert.equal((await handleApi(missing,{...env,DB},false,fetcher)).status,403);}
  assert.equal((await api("/api/admin/me",undefined,admin)).status,200);const response=await api("/api/admin/auth/logout",{},admin);assert.equal(response.status,200);assert.match(response.headers.get("set-cookie"),/Max-Age=0/);assert.equal((await api("/api/admin/me",undefined,admin)).status,401);
});
test("sessions honor idle and absolute expiry and removed owners lose access immediately",async()=>{
  const now=new Date().toISOString();await DB.prepare("UPDATE waitlist_admin_sessions SET last_seen_at=?").bind(new Date(Date.now()-31*60_000).toISOString()).run();assert.equal((await api("/api/admin/me",undefined,admin)).status,401);await DB.prepare("UPDATE waitlist_admin_sessions SET last_seen_at=?,expires_at=?").bind(now,new Date(Date.now()-1000).toISOString()).run();assert.equal((await api("/api/admin/me",undefined,admin)).status,401);await DB.prepare("UPDATE waitlist_admin_sessions SET expires_at=?").bind(new Date(Date.now()+3600_000).toISOString()).run();const changed=await handleApi(request("/api/admin/me",undefined,admin),{...env,DB,ADMIN_EMAILS:"different-owner@example.com"},false,fetcher);assert.equal(changed.status,401);
});
test("durable admin-code delivery can drain after the generic response and drops expired pending codes",async()=>{
  const response=await api("/api/admin/auth/request",{email:"owner@example.com"});assert.equal(response.status,202);assert.equal(sent.length,0);const delivery=await processAdminLoginEmails({...env,DB},{fetcher});assert.equal(delivery.sent,1);assert.equal(sent.length,1);
  await DB.prepare("UPDATE waitlist_admin_codes SET delivery_status='pending',expires_at='2020-01-01T00:00:00.000Z'").run();assert.equal((await processAdminLoginEmails({...env,DB},{fetcher})).sent,0);assert.equal(sent.length,1);
});
test("local development cookies cannot authenticate a production request and local identity headers are ignored",async()=>{
  const{code}=await issueCode();const verify=new Request("http://127.0.0.1:5173/api/admin/auth/verify",{method:"POST",headers:{origin:"http://127.0.0.1:5173","content-type":"application/json","CF-Connecting-IP":"192.0.2.10"},body:JSON.stringify({email:"owner@example.com",code})});const response=await handleApi(verify,{...env,DB},true,fetcher);assert.equal(response.status,200);const cookie=response.headers.get("set-cookie");assert.match(cookie,/^imladri_admin_dev=/);assert.ok(!cookie.includes("; Secure"));const local=new Request("http://127.0.0.1:5173/api/admin/me",{headers:{cookie,"CF-Connecting-IP":"192.0.2.10"}});assert.equal((await handleApi(local,{...env,DB},true,fetcher)).status,200);assert.equal((await api("/api/admin/me",undefined,{cookie})).status,401);const forged=new Request("http://127.0.0.1:5173/api/admin/me",{headers:{"oai-authenticated-user-id":"local","oai-authenticated-user-email":"owner@example.com","CF-Connecting-IP":"192.0.2.10"}});assert.equal((await handleApi(forged,{...env,DB},true,fetcher)).status,401);
});

test("network allowlist compares exact IPv4 and canonical IPv6 including mapped addresses",()=>{
  assert.equal(normalizeAdminIp("192.0.2.10"),"v4:192.0.2.10");
  assert.equal(normalizeAdminIp("::ffff:192.0.2.10"),normalizeAdminIp("192.0.2.10"));
  assert.equal(normalizeAdminIp("0:0:0:0:0:FFFF:C000:020A"),normalizeAdminIp("192.0.2.10"));
  assert.equal(normalizeAdminIp("2001:DB8::A:1"),normalizeAdminIp("2001:0db8:0000:0000:0000:0000:000a:0001"));
  assert.notEqual(normalizeAdminIp("2001:db8::1"),normalizeAdminIp("2001:db8::2"));
  assert.notEqual(normalizeAdminIp("::192.0.2.10"),normalizeAdminIp("192.0.2.10"));
  for(const value of["","192.0.2.256","0192.0.2.10","192.0.2.10/32","192.0.2.10:443","192.0.2","2130706433","2001:db8::1::2","1:2:3:4:5:6:7:8:9","1:2:3:4:5:6:7","1:2:3:4:5:6:7::8","[::1]","fe80::1%eth0","::ffff:192.0.2.999","::ffff:192.0.2.01","localhost","192.0.2.10,198.51.100.1"," 192.0.2.10 "])assert.equal(normalizeAdminIp(value),null,value);
  assert.equal(adminNetworkAllowed(request("/admin",undefined,{"CF-Connecting-IP":"2001:db8::a:1"}),{ADMIN_ALLOWED_IPS:" 192.0.2.10 , 2001:0DB8:0:0:0:0:A:1 "}),true);
  assert.equal(adminNetworkAllowed(request("/admin",undefined,{"CF-Connecting-IP":"::FFFF:192.0.2.10"}),env),true);
  assert.equal(adminNetworkAllowed(request("/admin",undefined,{"CF-Connecting-IP":"192.0.2.11"}),env),false);
});

test("missing or partly malformed network configuration fails closed and forwarded identity is ignored",()=>{
  for(const setting of[undefined,""," ","192.0.2.10,","192.0.2.10,,2001:db8::1","192.0.2.10,invalid","192.0.2.10/32"]){const denied=adminNetworkResponse(request("/admin"),{ADMIN_ALLOWED_IPS:setting});assert.equal(denied?.status,303,String(setting));assert.equal(denied.headers.get("location"),"/");assert.match(denied.headers.get("cache-control"),/no-store/);assert.equal(denied.headers.get("cloudflare-cdn-cache-control"),"no-store");}
  for(const connecting of[undefined,"","198.51.100.9","192.0.2.10,198.51.100.9","not-an-ip"]){const headers={"X-Forwarded-For":"192.0.2.10","X-Real-IP":"192.0.2.10","CF-Connecting-IPv6":"2001:db8::1","oai-authenticated-user-email":"owner@example.com"};if(connecting!==undefined)headers["CF-Connecting-IP"]=connecting;const denied=adminNetworkResponse(new Request("https://waitlist.example.com/admin?ip=192.0.2.10&CF-Connecting-IP=192.0.2.10",{headers}),env);assert.equal(denied?.status,303);}
  for(const marker of["same-zone.example","cross-zone.example",""]){assert.equal(adminNetworkResponse(request("/admin",undefined,{"CF-Worker":marker}),env)?.status,303);}
});

test("admin network paths include encoded slash, dot, backslash, repeated slash and RSC variants",()=>{
  const protectedPaths=["/ADMIN","/API/ADMIN","/AdMiN.RSC","/%41DMIN.RSC","/API/%41DMIN/auth/request","/admin","/admin/","//admin///","/%61dmin","/%2561dmin","/x/../admin","/x/%2e%2e/admin","/%2fadmin","/%5cadmin","/admin.rsc","/%61dmin%2Ersc","/admin/settings.rsc","/api/admin","/api//admin/auth/request","/%61pi/%61dmin/auth/request","/api%2fadmin%2fauth%2fverify","/x/%2e%2e/api/admin/overview","/api/admin/overview.rsc","/a%64min/%FF"];
  for(const pathname of protectedPaths){assert.equal(isAdminRequestPath(pathname),true,pathname);const url="https://waitlist.example.com"+pathname+"?_rsc=private-test";for(const method of["GET","HEAD","POST"]){const response=adminNetworkResponse(new Request(url,{method,headers:{RSC:"1","CF-Connecting-IP":"198.51.100.9"}}),env);assert.equal(response?.status,303,`${method} ${pathname}`);}}
  for(const pathname of["/","/join","/privacy","/api/public/stats","/api/waitlist/signup","/administrator","/api/administer","/admin/../join"]){assert.equal(isAdminRequestPath(pathname),false,pathname);assert.equal(adminNetworkResponse(request(pathname),{}),null);}
});

test("allowed network still requires owner login and wrong network denies valid sessions before any side effect",async()=>{
  assert.equal((await api("/api/admin/me")).status,401);assert.equal((await api("/api/admin/me",undefined,admin)).status,200);
  const sideEffects=[];const noDatabase=new Proxy({},{get(){sideEffects.push("database");throw Error("must not touch DB");}});const blockedEnv={...env,DB:noDatabase};
  const blockedFetcher=async()=>{sideEffects.push("provider");throw Error("must not send mail");};const defer=()=>{sideEffects.push("background");return true;};
  for(const endpoint of["/api/admin/me","/api/admin/overview","/api/admin/export","/api/admin/auth/request","/api/admin/auth/verify","/api/admin/auth/logout","/api/admin/signups/fixture/delete","/api%2fadmin%2fauth%2frequest","/%61dmin.rsc"]){const response=await handleApi(request(endpoint,{email:"owner@example.com",code:"12345678"},{...admin,"CF-Connecting-IP":"198.51.100.9","X-Forwarded-For":"192.0.2.10","X-Real-IP":"192.0.2.10"}),blockedEnv,false,blockedFetcher,defer);assert.equal(response.status,303,endpoint);assert.equal(response.headers.get("location"),"/");}
  const worker=await handleApi(request("/api/admin/auth/request",{email:"owner@example.com"},{"CF-Worker":"worker.example"}),blockedEnv,false,blockedFetcher,defer);assert.equal(worker.status,303);
  assert.deepEqual(sideEffects,[]);assert.equal(sent.length,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_admin_codes").first()).count,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_admin_sessions").first()).count,1);
});

test("public signup remains functional outside the admin network and with no admin allowlist",async()=>{
  const response=await handleApi(request("/api/waitlist/signup",signup({email:"public-network@example.com"}),{"CF-Connecting-IP":"198.51.100.9"}),{...env,DB,ADMIN_ALLOWED_IPS:""},false,fetcher);assert.equal(response.status,201);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,1);assert.equal(sent.length,1);
  const adminDenied=await handleApi(request("/api/admin/signups",undefined,admin),{...env,DB,ADMIN_ALLOWED_IPS:""},false,fetcher);assert.equal(adminDenied.status,303);
});

function contact(extra={}){return{name:"Contact QA",email:"contact@example.com",category:"Privacy",subject:"A private subject",message:"First line of a private message.\nSecond line: <script>alert('stored text')</script>",website:"",clientRequestId:crypto.randomUUID(),...extra};}

test("contact form encrypts every personal field and projects the complete record only in the owner inbox",async()=>{
  const input=contact();const response=await api("/api/contact/messages",input,{"CF-Connecting-IP":"198.51.100.20"});assert.equal(response.status,201);const receipt=await response.json();assert.equal(receipt.ok,true);assert.match(receipt.reference,/^IML-[A-Za-z0-9_-]{24}$/);assert.ok(!JSON.stringify(receipt).includes(input.email));
  const row=await DB.prepare("SELECT * FROM contact_messages").first();for(const field of["name","email","subject","message"]){assert.ok(!JSON.stringify(row).includes(input[field]),field);}assert.ok(!JSON.stringify(row).includes(input.clientRequestId));assert.ok(!JSON.stringify(row).includes("198.51.100.20"));assert.deepEqual(await decrypt(row.encrypted_data,env),{name:input.name,email:input.email,subject:input.subject,message:input.message});assert.equal(row.category,"Privacy");assert.equal(row.status,"new");assert.equal(row.reference,receipt.reference);assert.equal(row.created_at,row.updated_at);assert.equal(Date.parse(row.expires_at)-Date.parse(row.created_at),365*86400_000);
  const listed=await(await api("/api/admin/messages?reference="+encodeURIComponent(receipt.reference),undefined,admin)).json();assert.equal(listed.total,1);const item=listed.items[0];for(const field of["name","email","subject","message","category"])assert.deepEqual(item[field],input[field]);assert.equal(item.reference,receipt.reference);assert.equal(item.createdAt,row.created_at);assert.equal(item.updatedAt,row.updated_at);assert.equal(item.status,"new");assert.ok(!("encrypted_data"in item));
  const detail=await api("/api/admin/messages/"+row.id,undefined,admin);assert.equal(detail.status,200);assert.deepEqual((await detail.json()).item,item);assert.match(detail.headers.get("content-type"),/^application\/json/);assert.equal(detail.headers.get("x-content-type-options"),"nosniff");assert.match(detail.headers.get("cache-control"),/no-store/);
  for(const table of["waitlist_signups","waitlist_visits","waitlist_email_outbox","waitlist_campaigns"])assert.equal((await DB.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count,0);assert.equal(sent.length,0);
});

test("contact categories, pagination and new/read/resolved transitions stay organized in inbox summaries",async()=>{
  const categories=["Privacy","Partnership","Suggestions","Support","Feedback","Other"];assert.deepEqual((await(await api("/api/contact/config")).json()).categories,categories);
  for(let i=0;i<categories.length;i++)assert.equal((await api("/api/contact/messages",contact({category:categories[i]}),{"CF-Connecting-IP":`198.51.100.${i+30}`})).status,201);
  let summary=await(await api("/api/admin/messages/summary",undefined,admin)).json();assert.equal(summary.total,6);assert.equal(summary.unread,6);assert.equal(summary.resolved,0);assert.deepEqual(summary.categories,categories.map(category=>({category,total:1,unread:1})));
  const privacy=(await(await api("/api/admin/messages?category=Privacy&status=new&page=1&pageSize=1",undefined,admin)).json()).items[0];let result=await api(`/api/admin/messages/${privacy.id}/status`,{status:"read"},admin);assert.equal(result.status,200);assert.equal((await result.json()).item.status,"read");assert.equal((await(await api("/api/admin/messages?category=Privacy&status=new",undefined,admin)).json()).total,0);
  result=await api(`/api/admin/messages/${privacy.id}/status`,{status:"resolved"},admin);assert.equal(result.status,200);assert.equal((await result.json()).item.message,privacy.message);summary=await(await api("/api/admin/messages/summary",undefined,admin)).json();assert.equal(summary.unread,5);assert.equal(summary.resolved,1);assert.deepEqual(summary.categories[0],{category:"Privacy",total:1,unread:0});
  const paged=await(await api("/api/admin/messages?page=2&pageSize=2",undefined,admin)).json();assert.equal(paged.total,6);assert.equal(paged.items.length,2);assert.equal(paged.page,2);assert.equal(paged.pageSize,2);
  for(const endpoint of["/api/admin/messages?category=Invalid","/api/admin/messages?status=Invalid","/api/admin/messages?reference=invalid"])assert.equal((await api(endpoint,undefined,admin)).status,400);
  assert.equal((await api(`/api/admin/messages/${privacy.id}/status`,{status:"sent"},admin)).status,400);assert.equal((await api(`/api/admin/messages/${privacy.id}/status`,{status:"new"},admin)).status,200);
});

test("contact validation, honeypot, Origin, content type and size checks cannot create messages",async()=>{
  for(const extra of[{name:""},{name:"x".repeat(81)},{email:"invalid"},{category:"Sales"},{subject:""},{subject:"s".repeat(161)},{message:" \n "},{message:"m".repeat(5001)},{clientRequestId:"short"},{website:"spam bot"}])assert.equal((await api("/api/contact/messages",contact(extra))).status,400,JSON.stringify(Object.keys(extra)));
  assert.equal((await api("/api/contact/messages",contact(),{origin:"https://evil.example"})).status,403);
  const missingOrigin=new Request("https://waitlist.example.com/api/contact/messages",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(contact())});assert.equal((await handleApi(missingOrigin,{...env,DB},false,fetcher)).status,403);
  assert.equal((await api("/api/contact/messages",contact(),{"content-type":"text/plain"})).status,415);assert.equal((await api("/api/contact/messages",contact({message:"x".repeat(20000)}))).status,413);
  assert.equal((await DB.prepare("SELECT COUNT(*) count FROM contact_messages").first()).count,0);assert.equal(sent.length,0);
});

test("concurrent contact retries share one reference and changed payloads cannot overwrite that request",async()=>{
  const input=contact();const responses=await Promise.all([api("/api/contact/messages",input),api("/api/contact/messages",input)]);assert.deepEqual(responses.map(response=>response.status),[201,201]);const receipts=await Promise.all(responses.map(response=>response.json()));assert.equal(receipts[0].reference,receipts[1].reference);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM contact_messages").first()).count,1);
  for(let i=0;i<8;i++){const repeated=await api("/api/contact/messages",input);assert.equal(repeated.status,201);assert.equal((await repeated.json()).reference,receipts[0].reference);}
  assert.equal((await api("/api/contact/messages",{...input,message:"Changed message"})).status,409);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM contact_messages").first()).count,1);const saved=await DB.prepare("SELECT encrypted_data FROM contact_messages").first();assert.equal((await decrypt(saved.encrypted_data,env)).message,input.message);assert.equal(sent.length,0);
});

test("contact rate limits store only short-lived keyed IP counters and leave waitlist enrollment alone",async()=>{
  for(let i=0;i<5;i++)assert.equal((await api("/api/contact/messages",contact())).status,201);assert.equal((await api("/api/contact/messages",contact())).status,429);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM contact_messages").first()).count,5);
  const rateRows=(await DB.prepare("SELECT * FROM waitlist_rate_limits").all()).results;assert.ok(rateRows.length>0);assert.ok(!JSON.stringify(rateRows).includes("192.0.2.10"));assert.ok(rateRows.every(row=>Date.parse(row.expires_at)<Date.now()+21*60_000));assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,0);assert.equal(sent.length,0);
});

test("contact inbox access, status and deletion require both owner session and allowed network plus mutation Origin",async()=>{
  const receipt=await(await api("/api/contact/messages",contact())).json();const row=await DB.prepare("SELECT id FROM contact_messages WHERE reference=?").bind(receipt.reference).first();
  for(const endpoint of["/api/admin/messages","/api/admin/messages/summary",`/api/admin/messages/${row.id}`]){assert.equal((await api(endpoint)).status,401);assert.equal((await api(endpoint,undefined,{...admin,"CF-Connecting-IP":"198.51.100.9"})).status,303);}
  for(const action of["status","delete"]){const endpoint=`/api/admin/messages/${row.id}/${action}`;assert.equal((await api(endpoint,{status:"resolved"})).status,401);assert.equal((await api(endpoint,{status:"resolved"},{...admin,"CF-Connecting-IP":"198.51.100.9"})).status,303);assert.equal((await api(endpoint,{status:"resolved"},{...admin,origin:"https://evil.example"})).status,403);const noOrigin=new Request("https://waitlist.example.com"+endpoint,{method:"POST",headers:{...admin,"CF-Connecting-IP":"192.0.2.10","content-type":"application/json"},body:'{"status":"resolved"}'});assert.equal((await handleApi(noOrigin,{...env,DB},false,fetcher)).status,403);}
  assert.equal((await DB.prepare("SELECT status FROM contact_messages").first()).status,"new");assert.equal((await api(`/api/admin/messages/${row.id}/delete`,{},admin)).status,200);assert.equal((await api(`/api/admin/messages/${row.id}`,undefined,admin)).status,404);assert.equal((await(await api("/api/admin/messages/summary",undefined,admin)).json()).total,0);
});

test("owner email preview is private, uses harmless sample links and never enrolls or sends",async()=>{
  assert.equal((await api("/api/admin/emails/preview")).status,401);
  const response=await api("/api/admin/emails/preview",undefined,admin);assert.equal(response.status,200);const preview=await response.json();assert.equal(preview.recipient,"owner@example.com");assert.match(preview.subject,/^TEST/);assert.equal(typeof preview.html,"string");assert.ok(preview.html.length>200);assert.match(preview.text,/sample email/i);assert.ok(preview.text.includes("https://waitlist.example.com/#email-preview-unsubscribe"));assert.ok(preview.text.includes("https://waitlist.example.com/#email-preview-delete"));assert.doesNotMatch(preview.text+preview.html,/(?:\/unsubscribe|\/delete-data|\/api\/waitlist\/(?:unsubscribe|delete))\?token=/);
  for(const table of["waitlist_signups","waitlist_email_outbox","waitlist_campaigns"])assert.equal((await DB.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count,0);assert.equal(sent.length,0);
});

test("owner test email targets the signed-in owner and retries retain the provider idempotency key",async()=>{
  const input={requestId:crypto.randomUUID()};
  for(let i=0;i<2;i++){const response=await api("/api/admin/emails/test",input,admin);assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.recipient,"owner@example.com");assert.equal(result.status,"accepted");assert.ok(result.emailId);}
  assert.equal(sent.length,2);assert.deepEqual(sent.map(item=>item.payload.to),[["owner@example.com"],["owner@example.com"]]);assert.equal(sent[0].headers["Idempotency-Key"],sent[1].headers["Idempotency-Key"]);assert.match(sent[0].headers["Idempotency-Key"],/^owner-email-test-/);assert.match(sent[0].payload.subject,/^TEST/);assert.match(sent[0].payload.text,/sample email/i);assert.equal(typeof sent[0].payload.html,"string");assert.equal(sent[0].payload.headers?.["List-Unsubscribe-Post"],undefined);
  for(const table of["waitlist_signups","waitlist_email_outbox","waitlist_campaigns"])assert.equal((await DB.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count,0);
});

test("owner test endpoint rejects recipient injection and malformed test request IDs before sending",async()=>{
  for(const input of[{}, {requestId:"short"},{requestId:123},{requestId:crypto.randomUUID(),to:"outside@example.com"},{requestId:crypto.randomUUID(),recipient:"outside@example.com"},{requestId:crypto.randomUUID(),subject:"Injected subject"}]){const response=await api("/api/admin/emails/test",input,admin);assert.equal(response.status,400);assert.equal((await response.json()).code,"invalid_test_request");}
  assert.equal(sent.length,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_rate_limits").first()).count,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,0);
});

test("owner email test enforces authentication, exact authorized identity and mutation Origin",async()=>{
  const input={requestId:crypto.randomUUID()};assert.equal((await api("/api/admin/emails/test",input)).status,401);assert.equal((await api("/api/admin/emails/test",input,{...admin,origin:"https://evil.example"})).status,403);assert.equal((await api("/api/admin/emails/test",input,{...admin,"CF-Connecting-IP":"198.51.100.9"})).status,303);
  const noOrigin=new Request("https://waitlist.example.com/api/admin/emails/test",{method:"POST",headers:{...admin,"CF-Connecting-IP":"192.0.2.10","content-type":"application/json"},body:JSON.stringify(input)});assert.equal((await handleApi(noOrigin,{...env,DB},false,fetcher)).status,403);
  assert.equal((await handleApi(request("/api/admin/emails/test",input,admin),{...env,DB,ADMIN_EMAILS:"different-owner@example.com"},false,fetcher)).status,401);assert.equal(sent.length,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_rate_limits").first()).count,0);
});

test("owner email test sends at most three requests per abuse window",async()=>{
  for(let i=0;i<3;i++)assert.equal((await api("/api/admin/emails/test",{requestId:crypto.randomUUID()},admin)).status,200);
  const response=await api("/api/admin/emails/test",{requestId:crypto.randomUUID()},admin);assert.equal(response.status,429);assert.equal(response.headers.get("retry-after"),"600");assert.equal(sent.length,3);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_email_outbox").first()).count,0);
});

test("owner email test failures are sanitized and leave registration data untouched",async()=>{
  const marker="synthetic-provider-detail-must-not-leak";
  for(const transport of[async()=>new Response(marker,{status:503}),async()=>{throw Error(marker);},async()=>new Response(JSON.stringify({detail:marker}),{headers:{"content-type":"application/json"}})]){const response=await api("/api/admin/emails/test",{requestId:crypto.randomUUID()},admin,transport);assert.equal(response.status,503);const result=await response.json();assert.equal(result.code,"test_email_unconfirmed");assert.ok(!JSON.stringify(result).includes(marker));}
  for(const table of["waitlist_signups","waitlist_email_outbox","waitlist_campaigns"])assert.equal((await DB.prepare(`SELECT COUNT(*) count FROM ${table}`).first()).count,0);assert.equal(sent.length,0);
});

test("expired contact messages disappear from inbox queries and bounded retention removes encrypted content",async()=>{
  const receipt=await(await api("/api/contact/messages",contact())).json();const row=await DB.prepare("SELECT id FROM contact_messages WHERE reference=?").bind(receipt.reference).first();await DB.prepare("UPDATE contact_messages SET expires_at='2020-01-01T00:00:00.000Z'").run();
  assert.equal((await(await api("/api/admin/messages",undefined,admin)).json()).total,0);assert.equal((await(await api("/api/admin/messages/summary",undefined,admin)).json()).total,0);assert.equal((await api(`/api/admin/messages/${row.id}`,undefined,admin)).status,404);assert.equal((await api(`/api/admin/messages/${row.id}/status`,{status:"read"},admin)).status,404);
  await api("/api/admin/maintenance",{},admin);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM contact_messages").first()).count,0);assert.equal(sent.length,0);
});
