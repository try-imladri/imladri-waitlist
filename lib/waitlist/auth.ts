import { ApiError, normalizeEmail, nowIso, publicOrigin, type WaitlistEnv } from "./config.js";
import { decrypt, encrypt, hash, keyedHash, randomToken } from "./crypto.js";
import { database, rateLimit } from "./data.js";
import { adminAccessResponse, adminAuthMode, getAccessIdentity } from "./access.js";

const CODE_LIFETIME_MS = 10 * 60_000;
const SESSION_LIFETIME_MS = 8 * 60 * 60_000;
const SESSION_IDLE_MS = 30 * 60_000;
const COOKIE_NAME = "__Host-imladri_admin";
const DEV_COOKIE_NAME = "imladri_admin_dev";
const GENERIC_REQUEST = "If this email is authorized, a sign-in code is on its way.";

export type AdminUser = { userId: string; email: string };
type CodeRow = { email_hash:string;code_hash:string;encrypted_code:string|null;nonce:string;attempts:number;consumed_by:string|null;delivery_status:string;delivery_attempts:number;created_at:string;updated_at:string;expires_at:string };
type SessionRow = {token_hash:string;email_hash:string;created_at:string;last_seen_at:string;expires_at:string};

function owners(env:WaitlistEnv) { return [...new Set((env.ADMIN_EMAILS||"").split(",").map(v=>v.trim().toLowerCase()).filter(v=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)))]; }
function allowedOwner(email:string,env:WaitlistEnv) { return owners(env).includes(email); }
async function ownerHash(email:string,env:WaitlistEnv) { return keyedHash(`admin-owner:${email}`,env); }
async function ownerForHash(value:string,env:WaitlistEnv) { for(const email of owners(env))if(await ownerHash(email,env)===value)return email;return null; }
function localRequest(request:Request,isDev:boolean) { return isDev&&["localhost","127.0.0.1","[::1]"].includes(new URL(request.url).hostname); }
function readCookie(request:Request,name:string) { const value=request.headers.get("cookie")?.split(";").map(v=>v.trim()).find(v=>v.startsWith(name+"="))?.slice(name.length+1);try{return value?decodeURIComponent(value):"";}catch{return"";} }
function cookieName(request:Request,isDev:boolean) { return localRequest(request,isDev)&&new URL(request.url).protocol==="http:"?DEV_COOKIE_NAME:COOKIE_NAME; }
function sessionToken(request:Request,isDev:boolean) { const token=readCookie(request,cookieName(request,isDev));return /^[A-Za-z0-9_-]{43}$/.test(token)?token:""; }
export function adminCookie(token:string,request:Request,isDev=false,clear=false) { const secure=new URL(request.url).protocol==="https:"||!localRequest(request,isDev);return`${cookieName(request,isDev)}=${clear?"":encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${clear?0:SESSION_LIFETIME_MS/1000}${secure?"; Secure":""}`; }
function invalidCode() { return new ApiError(401,"This code is invalid or has expired.","invalid_code"); }
function equalSecret(a:string,b:string) { if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0; }
function createCode() { const values=new Uint32Array(1);do{crypto.getRandomValues(values);}while(values[0]>=4_200_000_000);return(values[0]%100_000_000).toString().padStart(8,"0"); }

async function emailRateLimit(email:string,env:WaitlistEnv,action:string,limit:number) {
  const window=Math.floor(Date.now()/600_000);const key=await keyedHash(`rate:admin:${action}:${window}:${email}`,env);const db=database(env);
  await db.prepare("INSERT INTO waitlist_rate_limits (key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1").bind(key,new Date((window+2)*600_000).toISOString()).run();
  const row=await db.prepare("SELECT hits FROM waitlist_rate_limits WHERE key=?").bind(key).first<{hits:number}>();
  if((row?.hits||0)>limit)throw new ApiError(429,"Too many sign-in attempts. Please wait a few minutes and try again.","rate_limited");
}

export async function queueAdminCode(email:string,env:WaitlistEnv) {
  if(!allowedOwner(email,env))return null;
  const db=database(env);const emailHash=await ownerHash(email,env);const now=nowIso();
  const existing=await db.prepare("SELECT created_at FROM waitlist_admin_codes WHERE email_hash=?").bind(emailHash).first<{created_at:string}>();
  if(existing&&Date.now()-Date.parse(existing.created_at)<60_000)return null;
  const code=createCode();const nonce=randomToken(18);const codeHash=await keyedHash(`admin-code:${emailHash}:${nonce}:${code}`,env);
  const saved=await db.prepare("INSERT INTO waitlist_admin_codes (email_hash,code_hash,encrypted_code,nonce,attempts,consumed_by,delivery_status,delivery_attempts,created_at,updated_at,expires_at) VALUES (?,?,?,?,0,NULL,'pending',0,?,?,?) ON CONFLICT(email_hash) DO UPDATE SET code_hash=excluded.code_hash,encrypted_code=excluded.encrypted_code,nonce=excluded.nonce,attempts=0,consumed_by=NULL,delivery_status='pending',delivery_attempts=0,provider_id=NULL,error=NULL,created_at=excluded.created_at,updated_at=excluded.updated_at,expires_at=excluded.expires_at WHERE waitlist_admin_codes.created_at<=?")
    .bind(emailHash,codeHash,await encrypt({code},env),nonce,now,now,new Date(Date.now()+CODE_LIFETIME_MS).toISOString(),new Date(Date.now()-60_000).toISOString()).run();
  return saved.meta.changes?emailHash:null;
}

export async function requestAdminCode(request:Request,body:Record<string,unknown>,env:WaitlistEnv,defer?: (work:()=>Promise<void>)=>boolean,fetcher:typeof fetch=fetch) {
  const email=normalizeEmail(body.email);
  await rateLimit(request,env,"admin-code-request",10);
  await emailRateLimit(email,env,"request",3);
  const work=async()=>{const emailHash=await queueAdminCode(email,env);if(emailHash)await deliverAdminCode(emailHash,env,request,fetcher);};
  if(!defer?.(work)){
    // Local/test adapters can queue without a platform execution context. The
    // normal Worker drains this durable row after the response, never inline.
    await queueAdminCode(email,env);
  }
  return{ok:true,message:GENERIC_REQUEST,expiresIn:CODE_LIFETIME_MS/1000,resendAfter:60};
}

export async function deliverAdminCode(emailHash:string,env:WaitlistEnv,request:Request,fetcher:typeof fetch=fetch) {
  const db=database(env);const now=nowIso();
  const row=await db.prepare("SELECT * FROM waitlist_admin_codes WHERE email_hash=? AND consumed_by IS NULL AND expires_at>? AND encrypted_code IS NOT NULL").bind(emailHash,now).first<CodeRow>();
  if(!row||row.delivery_status==="sent"||row.delivery_status==="sending")return false;
  const email=await ownerForHash(emailHash,env);if(!email)return false;
  if(row.delivery_attempts>=3)return false;
  if(row.delivery_status==="failed"&&Date.now()-Date.parse(row.updated_at)<60_000)return false;
  const claim=await db.prepare("UPDATE waitlist_admin_codes SET delivery_status='sending',delivery_attempts=delivery_attempts+1,updated_at=?,error=NULL WHERE email_hash=? AND nonce=? AND delivery_status IN ('pending','failed') AND consumed_by IS NULL AND expires_at>?").bind(now,emailHash,row.nonce,now).run();
  if(!claim.meta.changes)return false;
  try{
    if(!env.RESEND_API_KEY||!env.EMAIL_FROM)throw new Error("configuration");
    const {code}=await decrypt<{code:string}>(row.encrypted_code!,env);const origin=publicOrigin(request,env);
    const text=`Your Imladri admin sign-in code is:\n\n${code}\n\nIt expires in 10 minutes and can be used only once. Never share this code. If you did not request it, you can ignore this email.\n\nPrivacy policy: ${origin}/privacy\nContact us: ${origin}/contact`;
    const response=await fetcher("https://api.resend.com/emails",{method:"POST",signal:AbortSignal.timeout(12_000),headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,"Content-Type":"application/json","Idempotency-Key":`admin-login-${row.nonce}`},body:JSON.stringify({from:env.EMAIL_FROM,to:[email],reply_to:env.EMAIL_REPLY_TO||"osama@imladri.com",subject:"Your Imladri admin sign-in code",text})});
    if(!response.ok)throw new Error(`provider-${response.status}`);
    const result=await response.json()as{id?:string};
    await db.prepare("UPDATE waitlist_admin_codes SET delivery_status='sent',provider_id=?,updated_at=?,error=NULL WHERE email_hash=? AND nonce=? AND consumed_by IS NULL").bind(result.id||null,nowIso(),emailHash,row.nonce).run();
    return true;
  }catch(error){const reason=error instanceof Error&&/^provider-\d+$/.test(error.message)?`Email provider returned HTTP ${error.message.slice(9)}.`:"Sign-in email could not be delivered. Request a new code shortly.";await db.prepare("UPDATE waitlist_admin_codes SET delivery_status='failed',updated_at=?,error=? WHERE email_hash=? AND nonce=? AND consumed_by IS NULL").bind(nowIso(),reason,emailHash,row.nonce).run();return false;}
}

export async function processAdminLoginEmails(env:WaitlistEnv,options:{fetcher?:typeof fetch;limit?:number}={}) {
  const now=nowIso();const stale=new Date(Date.now()-180_000).toISOString();const db=database(env);
  await db.prepare("UPDATE waitlist_admin_codes SET delivery_status='failed',updated_at=? WHERE delivery_status='sending' AND updated_at<? AND consumed_by IS NULL").bind(new Date(Date.now()-60_000).toISOString(),stale).run();
  const rows=(await db.prepare("SELECT email_hash FROM waitlist_admin_codes WHERE consumed_by IS NULL AND expires_at>? AND encrypted_code IS NOT NULL AND delivery_status IN ('pending','failed') AND delivery_attempts<3 ORDER BY created_at LIMIT ?").bind(now,Math.min(2,Math.max(1,options.limit||2))).all<{email_hash:string}>()).results;
  const request=new Request(env.PUBLIC_APP_URL||env.SITE_BASE_URL||"https://imladri.com");let sent=0;
  for(const row of rows)if(await deliverAdminCode(row.email_hash,env,request,options.fetcher||fetch))sent++;
  return{processed:rows.length,sent};
}

export async function verifyAdminCode(request:Request,body:Record<string,unknown>,env:WaitlistEnv,isDev=false) {
  let email:string;try{email=normalizeEmail(body.email);}catch{throw invalidCode();}
  const code=typeof body.code==="string"?body.code.trim():"";
  await rateLimit(request,env,"admin-code-verify",30);
  await emailRateLimit(email,env,"verify",15);
  if(!/^\d{8}$/.test(code))throw invalidCode();
  const db=database(env);const emailHash=await ownerHash(email,env);const now=nowIso();
  const row=await db.prepare("SELECT * FROM waitlist_admin_codes WHERE email_hash=?").bind(emailHash).first<CodeRow>();
  const calculated=await keyedHash(`admin-code:${emailHash}:${row?.nonce||"unavailable"}:${code}`,env);
  const matches=equalSecret(calculated,row?.code_hash||"0".repeat(calculated.length));
  if(!row||!allowedOwner(email,env)||row.consumed_by||row.expires_at<=now||row.attempts>=5)throw invalidCode();
  const attempt=await db.prepare("UPDATE waitlist_admin_codes SET attempts=attempts+1 WHERE email_hash=? AND nonce=? AND attempts<5 AND consumed_by IS NULL AND expires_at>?").bind(emailHash,row.nonce,now).run();
  if(!attempt.meta.changes||!matches)throw invalidCode();
  const claim=randomToken(18);const token=randomToken();const expiresAt=new Date(Date.now()+SESSION_LIFETIME_MS).toISOString();
  const result=await db.batch([
    db.prepare("UPDATE waitlist_admin_codes SET consumed_by=?,encrypted_code=NULL,updated_at=? WHERE email_hash=? AND nonce=? AND consumed_by IS NULL AND attempts<=5 AND expires_at>?").bind(claim,now,emailHash,row.nonce,now),
    db.prepare("INSERT INTO waitlist_admin_sessions (token_hash,email_hash,created_at,last_seen_at,expires_at) SELECT ?,?,?,?,? FROM waitlist_admin_codes WHERE email_hash=? AND nonce=? AND consumed_by=?").bind(await hash(token),emailHash,now,now,expiresAt,emailHash,row.nonce,claim),
  ]);
  if(!result[1].meta.changes)throw invalidCode();
  return{body:{ok:true,user:{userId:`owner:${emailHash}`,email},expiresAt},cookie:adminCookie(token,request,isDev)};
}

export async function getAdminSession(request:Request,env:WaitlistEnv,isDev=false):Promise<AdminUser|null> {
  if(await adminAccessResponse(request,env))return null;
  const mode=adminAuthMode(env);
  if(mode!=="ip"){
    if(mode!=="access"&&mode!=="access+ip")return null;
    const identity=await getAccessIdentity(request,env);if(!identity)return null;
    return{userId:`owner:${await ownerHash(identity.email,env)}`,email:identity.email};
  }
  const token=sessionToken(request,isDev);if(!token)return null;
  const tokenHash=await hash(token);const now=nowIso();const idleCutoff=new Date(Date.now()-SESSION_IDLE_MS).toISOString();
  const row=await database(env).prepare("SELECT * FROM waitlist_admin_sessions WHERE token_hash=? AND expires_at>? AND last_seen_at>?").bind(tokenHash,now,idleCutoff).first<SessionRow>();
  if(!row)return null;const email=await ownerForHash(row.email_hash,env);if(!email)return null;
  if(Date.now()-Date.parse(row.last_seen_at)>60_000)await database(env).prepare("UPDATE waitlist_admin_sessions SET last_seen_at=? WHERE token_hash=? AND expires_at>?").bind(now,tokenHash,now).run();
  return{userId:`owner:${row.email_hash}`,email};
}

export async function logoutAdmin(request:Request,env:WaitlistEnv,isDev=false) {
  const token=sessionToken(request,isDev);if(token)await database(env).prepare("DELETE FROM waitlist_admin_sessions WHERE token_hash=?").bind(await hash(token)).run();
  return{ok:true,cookie:adminCookie("",request,isDev,true)};
}

export async function cleanupAdminAuth(env:WaitlistEnv) {
  const now=nowIso();const db=database(env);
  await db.batch([
    db.prepare("DELETE FROM waitlist_admin_codes WHERE email_hash IN (SELECT email_hash FROM waitlist_admin_codes WHERE expires_at<=? LIMIT 100)").bind(now),
    db.prepare("DELETE FROM waitlist_admin_sessions WHERE token_hash IN (SELECT token_hash FROM waitlist_admin_sessions WHERE expires_at<=? OR last_seen_at<=? LIMIT 100)").bind(now,new Date(Date.now()-SESSION_IDLE_MS).toISOString()),
  ]);
}
