import { ApiError, cleanText, config, normalizeEmail, nowIso, publicOrigin, type SignupRow, type WaitlistEnv } from "./config.js";
import { encrypt, hash, keyedHash, signToken, verifyToken } from "./crypto.js";
import { createSignup, database, deleteSignup, getSignup, maintenance, person, rateLimit, recordVisit, unsubscribe } from "./data.js";
import { authorizeAdmin, exportCsv, listEmails, listSignups, overview } from "./admin.js";
import { emailStatus, messageFor, queueMessage, retryEmails, sendOutbox, welcomeBody } from "./mail.js";
import { listCampaigns, previewCampaign, processCampaign, sendCampaign } from "./campaigns.js";
import { logoutAdmin, requestAdminCode, verifyAdminCode } from "./auth.js";
import { accessLogoutPath, adminAccessResponse, adminAuthMode } from "./access.js";
import { CONTACT_CATEGORIES, contactSummary, createContactMessage, deleteContactMessage, getContactMessage, listContactMessages, updateContactStatus } from "./contact.js";
import { signupEmailPreview, sendSignupEmailTest } from "./email-preview.js";

const responseHeaders={"Cache-Control":"private, no-store, max-age=0","Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"};
export function json(value:unknown,status=200,extra:Record<string,string>={}){return new Response(JSON.stringify(value),{status,headers:{...responseHeaders,"Content-Type":"application/json; charset=utf-8",...extra}});}
async function readText(request:Request,max=16_384){if(Number(request.headers.get("content-length"))>max)throw new ApiError(413,"The request is too large.");if(!request.body)return"";const reader=request.body.getReader();const chunks:Uint8Array[]=[];let size=0;while(true){const{done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw new ApiError(413,"The request is too large.");}chunks.push(value);}const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder().decode(bytes);}
async function bodyOf(request:Request){if(!request.headers.get("content-type")?.toLowerCase().startsWith("application/json"))throw new ApiError(415,"Send a JSON request.","unsupported_content_type");try{const body=JSON.parse(await readText(request));if(!body||typeof body!=="object"||Array.isArray(body))throw new Error();return body as Record<string,unknown>;}catch(error){if(error instanceof ApiError)throw error;throw new ApiError(400,"The request is not valid JSON.","invalid_json");}}
function sameOrigin(request:Request,required=false){const origin=request.headers.get("origin");if((required&&!origin)||(origin&&origin!==new URL(request.url).origin))throw new ApiError(403,"This request must come from this website.","origin_required");}
function cookie(request:Request,name:string){const value=request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith(name+"="))?.slice(name.length+1);try{return value?decodeURIComponent(value):"";}catch{return"";}}
function receiptCookie(token:string,request:Request){return`imladri_receipt=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000${new URL(request.url).protocol==="https:"?"; Secure":""}`;}
async function actionToken(request:Request){const url=new URL(request.url);if(request.method==="GET")return url.searchParams.get("token")||"";const type=request.headers.get("content-type")||"";if(type.startsWith("application/x-www-form-urlencoded")){await readText(request);return url.searchParams.get("token")||"";}const body=await bodyOf(request);return cleanText(body.token,700)||url.searchParams.get("token")||"";}
async function publicStats(env:WaitlistEnv){await maintenance(env);const cities=(await database(env).prepare("SELECT city,COUNT(*) count FROM waitlist_signups WHERE status='active' AND expires_at>? GROUP BY city_key ORDER BY count DESC,city ASC").bind(nowIso()).all<{city:string;count:number}>()).results;return{totalSignups:cities.reduce((a,c)=>a+c.count,0),totalCities:cities.length,cities,updatedAt:nowIso()};}
export async function handleApi(request:Request,env:WaitlistEnv,isDev=false,fetcher:typeof fetch=fetch,defer?: (work:()=>Promise<void>)=>boolean):Promise<Response>{
  const denied=await adminAccessResponse(request,env,fetcher);if(denied)return denied;
  const url=new URL(request.url);const path=url.pathname.replace(/\/$/,"");const method=request.method;
  try{
    if(method==="GET"&&path==="/api/public/config")return json(config());
    if(method==="GET"&&path==="/api/contact/config")return json({categories:CONTACT_CATEGORIES});
    if(method==="POST"&&path==="/api/contact/messages"){sameOrigin(request,true);return json(await createContactMessage(request,await bodyOf(request),env),201);}
    if(method==="GET"&&path==="/api/public/stats")return json(await publicStats(env));
    if(method==="POST"&&path==="/api/analytics/visit"){sameOrigin(request);await rateLimit(request,env,"visit",120);await recordVisit(await bodyOf(request),env);return json({ok:true});}
    if(method==="POST"&&path==="/api/waitlist/signup"){
      sameOrigin(request);await rateLimit(request,env,"signup");const body=await bodyOf(request);await maintenance(env);
      const{row,receipt,messageId}=await createSignup(body,env,async (candidate,p)=>{
        const referralUrl=`${publicOrigin(request,env)}/?ref=${candidate.referral_code}`;
        const message=await messageFor(candidate,p,request,env,"You're on the list",welcomeBody(p.firstName,candidate.city,referralUrl));
        return{id:crypto.randomUUID(),payload:await encrypt(message,env),key:`welcome-${candidate.id}`};
      });
      const referralUrl=`${publicOrigin(request,env)}/?ref=${row.referral_code}`;
      const status=await sendOutbox(messageId!,env,fetcher);
      return json({ok:true,referralCode:row.referral_code,referralUrl,emailStatus:status==="deferred"?"pending":status},201,{"Set-Cookie":receiptCookie(receipt,request)});
    }
    if(method==="GET"&&path==="/api/waitlist/status"){
      const token=url.searchParams.get("token")||cookie(request,"imladri_receipt");if(!token||token.length>150)throw new ApiError(401,"Your confirmation session is no longer available. Check your welcome email or contact us.","receipt_required");
      const row=await database(env).prepare("SELECT * FROM waitlist_signups WHERE receipt_hash=? AND expires_at>?").bind(await hash(token),nowIso()).first<SignupRow>();if(!row)throw new ApiError(401,"Your confirmation session is no longer available. Check your welcome email or contact us.","receipt_required");
      const p=await person(row,env);const count=await database(env).prepare("SELECT COUNT(*) count FROM waitlist_signups WHERE referred_by=? AND status='active' AND expires_at>?").bind(row.id,nowIso()).first<{count:number}>();
      return json({firstName:p.firstName,city:row.city,referralCode:row.referral_code,referralUrl:`${publicOrigin(request,env)}/?ref=${row.referral_code}`,referralCount:count?.count||0,emailStatus:await emailStatus(row.id,env)});
    }
    if(["GET","POST"].includes(method)&&path==="/api/waitlist/unsubscribe"){
      sameOrigin(request);const id=await verifyToken(await actionToken(request),"unsubscribe",env);const row=await getSignup(id,env);
      if(method==="POST")await unsubscribe(id,env);
      return json({ok:true,alreadyUnsubscribed:!row||row.status!=="active",unsubscribed:method==="POST"||!row||row.status!=="active"});
    }
    if(method==="POST"&&path==="/api/waitlist/delete-request"){
      sameOrigin(request);await rateLimit(request,env,"delete-request",10);const body=await bodyOf(request);const email=normalizeEmail(body.email);
      const work=async()=>{const row=await database(env).prepare("SELECT * FROM waitlist_signups WHERE email_hash=?").bind(await keyedHash(`email:${email}`,env)).first<SignupRow>();
      if(row){const p=await person(row,env);const link=`${publicOrigin(request,env)}/delete-data?token=${await signToken(row.id,"delete",env,7)}`;const message=await messageFor(row,p,request,env,"Delete your Imladri waitlist data",`Hi ${p.firstName},\n\nYou requested a link to delete your Imladri waitlist data. Open this link and confirm deletion:\n${link}\n\nThis link expires in seven days. If you didn't request it, you can ignore this email.\n\nOsama`);const id=await queueMessage(row,message,env,"delete-request",`delete-request-${row.id}-${nowIso().slice(0,10)}`);await sendOutbox(id,env,fetcher);}};
      if(!defer?.(work))await work();
      return json({ok:true,message:"If this email is on the waitlist, we'll send a deletion link."});
    }
    if(["GET","POST"].includes(method)&&path==="/api/waitlist/delete"){
      sameOrigin(request);const id=await verifyToken(await actionToken(request),"delete",env);if(method==="POST")await deleteSignup(id,env);return json({ok:true,deleted:method==="POST"});
    }
    if(method==="POST"&&path==="/api/admin/auth/request"){
      if(adminAuthMode(env)!=="ip")return json({error:"Use your protected owner sign-in.",code:"access_sign_in_required"},405);
      sameOrigin(request,true);return json(await requestAdminCode(request,await bodyOf(request),env,defer,fetcher),202);
    }
    if(method==="POST"&&path==="/api/admin/auth/verify"){
      if(adminAuthMode(env)!=="ip")return json({error:"Use your protected owner sign-in.",code:"access_sign_in_required"},405);
      sameOrigin(request,true);const result=await verifyAdminCode(request,await bodyOf(request),env,isDev);return json(result.body,200,{"Set-Cookie":result.cookie});
    }
    if(method==="POST"&&path==="/api/admin/auth/logout"){
      sameOrigin(request,true);const result=await logoutAdmin(request,env,isDev);return json({ok:true,redirectTo:accessLogoutPath(request,env)||"/admin"},200,{"Set-Cookie":result.cookie});
    }
    if(path.startsWith("/api/admin/")){
      const owner=await authorizeAdmin(request,env,isDev);if(method!=="GET")sameOrigin(request,true);
      if(method==="GET"&&path==="/api/admin/me")return json(owner);
      if(method==="GET"&&path==="/api/admin/messages")return json(await listContactMessages(url.searchParams,env));
      if(method==="GET"&&path==="/api/admin/messages/summary")return json(await contactSummary(env));
      const contactAction=path.match(/^\/api\/admin\/messages\/([a-f0-9-]{36})(?:\/(status|delete))?$/i);
      if(contactAction){if(method==="GET"&&!contactAction[2])return json({item:await getContactMessage(contactAction[1],env)});if(method==="POST"&&contactAction[2]==="status")return json(await updateContactStatus(contactAction[1],await bodyOf(request),env));if(method==="POST"&&contactAction[2]==="delete")return json(await deleteContactMessage(contactAction[1],env));}
      if(method==="GET"&&path==="/api/admin/overview"){await maintenance(env);return json(await overview(env));}
      if(method==="GET"&&path==="/api/admin/signups")return json(await listSignups(url.searchParams,env));
      if(method==="GET"&&path==="/api/admin/export")return new Response(await exportCsv(url.searchParams,env),{headers:{...responseHeaders,"Content-Type":"text/csv; charset=utf-8","Content-Disposition":`attachment; filename="imladri-waitlist-${nowIso().slice(0,10)}.csv"`}});
      if(method==="GET"&&path==="/api/admin/emails")return json(await listEmails(env));
      if(method==="GET"&&path==="/api/admin/emails/preview")return json(signupEmailPreview(request,env,owner.email));
      if(method==="POST"&&path==="/api/admin/emails/test")return json(await sendSignupEmailTest(request,await bodyOf(request),env,owner.email,fetcher));
      if(method==="POST"&&path==="/api/admin/emails/retry"){const body=await bodyOf(request);const ids=Array.isArray(body.ids)?body.ids.filter((v):v is string=>typeof v==="string"&&v.length<=100).slice(0,50):undefined;return json(await retryEmails(env,ids,body.allFailed===true,fetcher));}
      if(method==="POST"&&path==="/api/admin/campaigns/preview")return json(await previewCampaign(await bodyOf(request),env));
      if(method==="POST"&&path==="/api/admin/campaigns/send")return json(await sendCampaign(await bodyOf(request),request,env,owner.userId,fetcher));
      if(method==="GET"&&path==="/api/admin/campaigns")return json(await listCampaigns(env));
      if(method==="POST"&&path==="/api/admin/campaigns/process"){const body=await bodyOf(request);const id=cleanText(body.campaignId,100);if(!id)throw new ApiError(400,"Choose a campaign to continue.");return json(await processCampaign(id,env,fetcher));}
      if(method==="POST"&&path==="/api/admin/maintenance"){await maintenance(env);return json({ok:true});}
      const action=path.match(/^\/api\/admin\/signups\/([a-zA-Z0-9-]{1,60})\/(unsubscribe|delete)$/);
      if(method==="POST"&&action){if(action[2]==="unsubscribe")await unsubscribe(action[1],env);else await deleteSignup(action[1],env);return json({ok:true});}
    }
    return json({error:"This endpoint was not found.",code:"not_found"},404);
  }catch(error){if(error instanceof ApiError)return json({error:error.message,code:error.code},error.status,error.status===429?{"Retry-After":"600"}:{});return json({error:"We couldn't complete this request. Please try again shortly.",code:"service_unavailable"},503);}
}
