import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { Miniflare } from "miniflare";

const root=path.resolve(import.meta.dirname,"..");
const compiled=path.join(root,"outputs","access-test-runtime");
await mkdir(compiled,{recursive:true});
for(const name of await readdir(path.join(root,"lib","waitlist"))){if(!name.endsWith(".ts"))continue;const source=await readFile(path.join(root,"lib","waitlist",name),"utf8");await writeFile(path.join(compiled,name.replace(/\.ts$/,".js")),ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText);}
const {adminAccessResponse,adminAuthMode,getAccessIdentity,accessLogoutPath}=await import(pathToFileURL(path.join(compiled,"access.js")).href);
const {handleApi}=await import(pathToFileURL(path.join(compiled,"handlers.js")).href);
const {getAdminSession}=await import(pathToFileURL(path.join(compiled,"auth.js")).href);
const issuer="https://owner-tests.cloudflareaccess.com",audience="a".repeat(64),owner="owner@example.com";
const env={ADMIN_AUTH_MODE:"access",ADMIN_ACCESS_ISSUER:issuer,ADMIN_ACCESS_AUD:audience,ADMIN_ACCESS_EMAIL:owner,ADMIN_EMAILS:owner,ADMIN_ALLOWED_IPS:"192.0.2.10",WAITLIST_SIGNING_KEY:"test-only-owner-signing-key-at-least-32-bytes",WAITLIST_DATA_KEY:Buffer.alloc(32,9).toString("base64url"),SITE_BASE_URL:"https://waitlist.example.com"};
const pair=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",hash:"SHA-256",modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,["sign","verify"]);
const otherPair=await crypto.subtle.generateKey({name:"RSASSA-PKCS1-v1_5",hash:"SHA-256",modulusLength:2048,publicExponent:new Uint8Array([1,0,1])},true,["sign","verify"]);
const jwk={...await crypto.subtle.exportKey("jwk",pair.publicKey),kid:"owner-key",alg:"RS256",use:"sig"};
const otherJwk={...await crypto.subtle.exportKey("jwk",otherPair.publicKey),kid:"rotated-key",alg:"RS256",use:"sig"};
let mf,DB;
before(async()=>{mf=new Miniflare({modules:true,script:"export default {fetch(){return new Response('ok')}}",compatibilityDate:"2026-05-15",d1Databases:{DB:"access-security-tests-"+crypto.randomUUID()}});DB=await mf.getD1Database("DB");for(const file of(await readdir(path.join(root,"drizzle"))).filter(n=>n.endsWith(".sql")).sort())for(const sql of(await readFile(path.join(root,"drizzle",file),"utf8")).split("--> statement-breakpoint"))if(sql.trim())await DB.prepare(sql.trim()).run();});
after(async()=>{await mf?.dispose();});
const encode=value=>Buffer.from(typeof value==="string"?value:JSON.stringify(value)).toString("base64url");
async function token(claims={},header={},privateKey=pair.privateKey){const now=Math.floor(Date.now()/1000);const content=[encode({alg:"RS256",typ:"JWT",kid:jwk.kid,...header}),encode({iss:issuer,aud:[audience],type:"app",sub:"synthetic-owner-subject",email:owner,iat:now-10,nbf:now-10,exp:now+3600,...claims})].join(".");return content+"."+Buffer.from(await crypto.subtle.sign("RSASSA-PKCS1-v1_5",privateKey,new TextEncoder().encode(content))).toString("base64url");}
function certFetcher(keys=[jwk]){const calls=[];const fetcher=async(url,options)=>{calls.push({url,options});assert.equal(url,issuer+"/cdn-cgi/access/certs");assert.equal(options.redirect,"manual");assert.ok(options.signal);return new Response(JSON.stringify({keys}),{headers:{"content-type":"application/json"}});};return{fetcher,calls};}
function request(pathname="/admin",jwt,headers={},body){return new Request("https://waitlist.example.com"+pathname,{method:body===undefined?"GET":"POST",headers:{origin:"https://waitlist.example.com","CF-Connecting-IP":"198.51.100.20",...(jwt?{"Cf-Access-Jwt-Assertion":jwt}:{}),...(body!==undefined?{"content-type":"application/json"}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});}
function denied(response){assert.equal(response?.status,303);assert.equal(response.headers.get("location"),"/");assert.match(response.headers.get("cache-control"),/no-store/);assert.equal(response.headers.get("cloudflare-cdn-cache-control"),"no-store");assert.match(response.headers.get("vary"),/Cf-Access-Jwt-Assertion/);}

test("cutover modes default to existing IP behavior and reject unknown or empty settings",async()=>{
  assert.equal(adminAuthMode({}),"ip");for(const mode of["ip","access+ip","access"])assert.equal(adminAuthMode({ADMIN_AUTH_MODE:mode}),mode);
  for(const mode of["","ACCESS","allow"," "]){assert.equal(adminAuthMode({ADMIN_AUTH_MODE:mode}),null);denied(await adminAccessResponse(request(),{...env,ADMIN_AUTH_MODE:mode}));}
  assert.equal(await adminAccessResponse(request("/admin",undefined,{"CF-Connecting-IP":"192.0.2.10"}),{ADMIN_ALLOWED_IPS:"192.0.2.10"}),null);
  denied(await adminAccessResponse(request(),{ADMIN_ALLOWED_IPS:"192.0.2.10"}));
});

test("valid signed Access owner identity works from any IP without an application cookie or database",async()=>{
  const {fetcher,calls}=certFetcher();const jwt=await token();const req=request("/api/admin/me",jwt);
  const noDb=new Proxy({},{get(){throw Error("Owner identity must not access DB");}});
  const response=await handleApi(req,{...env,DB:noDb},false,fetcher);
  assert.equal(response.status,200);const identity=await response.json();assert.equal(identity.email,owner);assert.match(identity.userId,/^owner:/);assert.equal(calls.length,1);
  assert.equal((await getAdminSession(req,{...env,DB:noDb})).email,owner);
  assert.equal(response.headers.get("set-cookie"),null);
  assert.equal(await adminAccessResponse(request("/admin",jwt,{"CF-Connecting-IP":"203.0.113.200"}),{...env,ADMIN_ALLOWED_IPS:undefined},fetcher),null);
});

test("staged access+ip requires both proofs and never accepts either one alone",async()=>{
  const {fetcher,calls}=certFetcher();const jwt=await token();const staged={...env,ADMIN_AUTH_MODE:"access+ip"};
  denied(await adminAccessResponse(request("/admin",jwt),staged,fetcher));assert.equal(calls.length,0);
  denied(await adminAccessResponse(request("/admin",undefined,{"CF-Connecting-IP":"192.0.2.10"}),staged,fetcher));
  assert.equal(await adminAccessResponse(request("/admin",jwt,{"CF-Connecting-IP":"192.0.2.10"}),staged,fetcher),null);
});

test("missing malformed or partially configured Access settings fail closed without a key lookup",async()=>{
  const {fetcher,calls}=certFetcher();const jwt=await token();
  for(const settings of[{ADMIN_ACCESS_ISSUER:undefined},{ADMIN_ACCESS_ISSUER:"https://evil.example"},{ADMIN_ACCESS_ISSUER:issuer+"/"},{ADMIN_ACCESS_ISSUER:"https://owner-tests.cloudflareaccess.com@evil.example"},{ADMIN_ACCESS_AUD:undefined},{ADMIN_ACCESS_AUD:""},{ADMIN_ACCESS_AUD:audience+","+audience},{ADMIN_ACCESS_EMAIL:undefined},{ADMIN_ACCESS_EMAIL:"owner@example.com,other@example.com"},{ADMIN_ACCESS_EMAIL:" owner@example.com"},{ADMIN_EMAILS:"other@example.com"}])denied(await adminAccessResponse(request("/admin",jwt),{...env,...settings},fetcher));
  assert.equal(calls.length,0);
});

test("owner headers cookies and allowed IP cannot replace the signed assertion",async()=>{
  const {fetcher,calls}=certFetcher();
  for(const headers of[{"Cf-Access-Authenticated-User-Email":owner},{cookie:"CF_Authorization=forged; __Host-imladri_admin="+"a".repeat(43)},{"X-Forwarded-For":"192.0.2.10","X-Real-IP":"192.0.2.10","CF-Connecting-IP":"192.0.2.10"},{"oai-authenticated-user-email":owner}])denied(await adminAccessResponse(request("/admin",undefined,headers),env,fetcher));
  const jwt=await token();for(const marker of["","same-zone.example","other-zone.example"])denied(await adminAccessResponse(request("/admin",jwt,{"CF-Worker":marker}),env,fetcher));
  assert.equal(calls.length,0);
});

test("the plural Access allowlist admits each configured owner and returns their actual identity",async()=>{
  const {fetcher}=certFetcher();const second="second-owner@example.com",third="unapproved@example.com";
  const settings={...env,ADMIN_ACCESS_EMAILS:`${owner}, ${second}`,ADMIN_EMAILS:`${owner},${second},${third}`};
  for(const email of[owner,second]){const response=await handleApi(request("/api/admin/me",await token({email})),settings,false,fetcher);assert.equal(response.status,200);assert.equal((await response.json()).email,email);}
  denied(await adminAccessResponse(request("/admin",await token({email:third})),settings,fetcher));
  denied(await adminAccessResponse(request("/admin",await token({email:second})),{...settings,ADMIN_EMAILS:owner},fetcher));
  assert.equal(await adminAccessResponse(request("/admin",await token()),{...settings,ADMIN_EMAILS:owner},fetcher),null);
  for(const list of[""," ",owner+",",","+owner,owner+",invalid",owner+",OWNER@EXAMPLE.COM"]){denied(await adminAccessResponse(request("/admin",await token()),{...settings,ADMIN_ACCESS_EMAILS:list},fetcher));}
  // An explicitly configured plural list takes precedence over the old singular setting.
  denied(await adminAccessResponse(request("/admin",await token()),{...settings,ADMIN_ACCESS_EMAILS:second},fetcher));
});

test("signature algorithm confusion tampering unknown keys and malformed assertions are rejected",async()=>{
  const {fetcher}=certFetcher();const jwt=await token();
  const badTokens=["forged","a.b.c",jwt+".extra",jwt.replace(".",". "),"a".repeat(16385),await token({}, {alg:"none"}),await token({}, {alg:"HS256"}),await token({}, {typ:"other"}),await token({}, {crit:[]}),await token({}, {kid:"missing-key"}),await token({}, {},otherPair.privateKey)];
  const parts=jwt.split(".");badTokens.push(parts[0]+"."+encode({...JSON.parse(Buffer.from(parts[1],"base64url").toString()),sub:"tampered"})+"."+parts[2]);
  for(const candidate of badTokens)denied(await adminAccessResponse(request("/admin",candidate),env,fetcher));
});

test("issuer audience app subject exact owner and token lifetime claims are enforced",async()=>{
  const {fetcher,calls}=certFetcher();const now=Math.floor(Date.now()/1000);
  for(const claims of[{iss:"https://another-team.cloudflareaccess.com"},{aud:["b".repeat(64)]},{aud:[]},{aud:[audience,1]},{type:"org"},{type:"service"},{sub:""},{sub:null},{email:"other@example.com"},{email:"owner@example.com.evil.example"},{exp:now-1},{exp:String(now+3600)},{exp:now+0.5},{iat:now+60},{iat:undefined},{iat:now+4000},{nbf:now+60},{nbf:"invalid"},{nbf:undefined}])denied(await adminAccessResponse(request("/admin",await token(claims)),env,fetcher));
  assert.equal(calls.length,0);assert.equal(await adminAccessResponse(request("/admin",await token({email:"OWNER@EXAMPLE.COM",aud:audience})),env,fetcher),null);
});

test("JWKS lookup is pinned cached concurrent and fails closed on transport and invalid key material",async()=>{
  const jwt=await token();const {fetcher,calls}=certFetcher();await Promise.all(Array.from({length:8},()=>adminAccessResponse(request("/admin",jwt),env,fetcher)));assert.equal(calls.length,1);
  denied(await adminAccessResponse(request("/admin",await token({}, {kid:"new-unknown"})),env,fetcher));assert.equal(calls.length,1);
  for(const response of[new Response(null,{status:302,headers:{Location:"https://untrusted.example/certs"}}),new Response("failure",{status:503}),new Response("bad-json"),new Response(JSON.stringify({keys:[]})),new Response(JSON.stringify({keys:[{...jwk,alg:"HS256"}]})),new Response(JSON.stringify({keys:[{...jwk,n:"c21hbGw"}]})),new Response(JSON.stringify({keys:[jwk,jwk]})),new Response("x".repeat(65537))])denied(await adminAccessResponse(request("/admin",jwt),env,async()=>response));
  denied(await adminAccessResponse(request("/admin",jwt),env,async()=>{throw Error("offline");}));
});

test("Cloudflare's six-field RSA JWK shape works without optional ext or key_ops members",async()=>{
  const {kid,kty,alg,use,e,n}=jwk;const {fetcher}=certFetcher([{kid,kty,alg,use,e,n}]);
  assert.equal(await adminAccessResponse(request("/admin",await token()),env,fetcher),null);
});

test("a rotated signing key is refreshed after the bounded unknown-key cooldown",async()=>{
  const realNow=Date.now;let now=realNow();Date.now=()=>now;
  try{let requests=0;const fetcher=async()=>new Response(JSON.stringify({keys:++requests===1?[jwk]:[jwk,otherJwk]}));
    assert.equal(await adminAccessResponse(request("/admin",await token()),env,fetcher),null);
    const rotated=await token({}, {kid:otherJwk.kid},otherPair.privateKey);denied(await adminAccessResponse(request("/admin",rotated),env,fetcher));assert.equal(requests,1);
    now+=61000;assert.equal(await adminAccessResponse(request("/admin",rotated),env,fetcher),null);assert.equal(requests,2);
  }finally{Date.now=realNow;}
});

test("expired signing-key caches fail closed during an outage and recover through a fresh lookup",async()=>{
  const realNow=Date.now;let now=realNow();Date.now=()=>now;
  try{let requests=0;const fetcher=async()=>{requests++;if(requests===2)throw Error("synthetic JWKS outage");return new Response(JSON.stringify({keys:[jwk]}));};
    const jwt=await token();assert.equal(await adminAccessResponse(request("/admin",jwt),env,fetcher),null);assert.equal(requests,1);
    now+=301000;denied(await adminAccessResponse(request("/admin",jwt),env,fetcher));assert.equal(requests,2);
    denied(await adminAccessResponse(request("/admin",jwt),env,fetcher));assert.equal(requests,2);
    now+=61000;assert.equal(await adminAccessResponse(request("/admin",jwt),env,fetcher),null);assert.equal(requests,3);
  }finally{Date.now=realNow;}
});

test("all normalized admin API and RSC paths deny before DB provider and deferred work",async()=>{
  const effects=[];const noDb=new Proxy({},{get(){effects.push("db");throw Error("must not access DB");}});const fetcher=async()=>{effects.push("fetch");throw Error("must not fetch");};
  const paths=["/admin","/ADMIN","/admin/","/admin.rsc","/%61dmin","/%2561dmin","/%2fadmin","/%5cadmin","/x/%2e%2e/admin","/admin/settings.rsc","/api/admin","/api/admin/me","/api//admin/messages","/api%2fadmin%2fmessages","/API/ADMIN/auth/request","/api/admin/messages/summary","/a%64min/%FF"];
  for(const pathname of paths)for(const method of["GET","HEAD","POST"]){const req=new Request("https://waitlist.example.com"+pathname,{method,headers:{RSC:"1",cookie:"__Host-imladri_admin="+"a".repeat(43),"CF-Connecting-IP":"192.0.2.10"}});denied(await handleApi(req,{...env,DB:noDb},false,fetcher,()=>{effects.push("defer");return true;}));}
  assert.deepEqual(effects,[]);assert.equal(await adminAccessResponse(request("/contact"),{...env,ADMIN_AUTH_MODE:"unknown"},fetcher),null);
});

test("verified owner reads the private contact inbox and changes status while Origin controls remain required",async()=>{
  const {fetcher}=certFetcher();const settings={...env,DB};const message={name:"Synthetic Access QA",email:"contact-qa@example.com",category:"Privacy",subject:"Synthetic access inbox test",message:"Synthetic QA content\nPreserve the second line.",website:"",clientRequestId:crypto.randomUUID()};
  assert.equal((await handleApi(request("/api/contact/messages",undefined,{},message),settings,false,fetcher)).status,201);
  const jwt=await token();const listed=await handleApi(request("/api/admin/messages",jwt),settings,false,fetcher);assert.equal(listed.status,200);const result=await listed.json();assert.equal(result.total,1);const item=result.items[0];assert.equal(item.message,message.message);assert.equal(item.category,"Privacy");
  const action=`/api/admin/messages/${item.id}/status`;
  assert.equal((await handleApi(request(action,jwt,{origin:"https://evil.example"},{status:"resolved"}),settings,false,fetcher)).status,403);
  assert.equal((await handleApi(request(action,jwt,{}, {status:"resolved"}),settings,false,fetcher)).status,200);
  const summary=await handleApi(request("/api/admin/messages/summary",jwt),settings,false,fetcher);assert.equal((await summary.json()).resolved,1);
  assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_signups").first()).count,0);assert.equal((await DB.prepare("SELECT COUNT(*) count FROM waitlist_email_outbox").first()).count,0);
});

test("Access mode disables old OTP authentication and logout returns the Cloudflare session logout path",async()=>{
  const {fetcher,calls}=certFetcher();const jwt=await token();const noDb=new Proxy({},{get(){throw Error("must not access DB");}});const settings={...env,DB:noDb};
  for(const endpoint of["request","verify"]){const result=await handleApi(request(`/api/admin/auth/${endpoint}`,jwt,{}, {email:owner,code:"12345678"}),settings,false,fetcher);assert.equal(result.status,405);}
  const response=await handleApi(request("/api/admin/auth/logout",jwt,{},{}),settings,false,fetcher);assert.equal(response.status,200);assert.equal((await response.json()).redirectTo,accessLogoutPath(request(),env));assert.match(response.headers.get("set-cookie"),/Max-Age=0/);assert.equal(calls.length,1);
  assert.equal(accessLogoutPath(request(),{ADMIN_AUTH_MODE:"ip"}),null);
});

test("temporary diagnostics are disabled by default and emit only sampled fixed stage enums",async()=>{
  const warn=console.warn;const messages=[];console.warn=(...values)=>messages.push(values);
  try{
    const {fetcher}=certFetcher();const settings={...env,ADMIN_ACCESS_DIAGNOSTICS:"enabled"};
    denied(await adminAccessResponse(request("/admin"),env,fetcher));assert.deepEqual(messages,[]);
    for(let i=0;i<3;i++)denied(await adminAccessResponse(request("/admin",undefined,{"Cf-Access-Authenticated-User-Email":"do-not-log@example.com",cookie:"do-not-log=secret"}),settings,fetcher));
    assert.deepEqual(messages,[["imladri_admin_access:assertion_missing"]]);
    denied(await adminAccessResponse(request("/admin","do-not-log"),settings,fetcher));
    assert.equal(await adminAccessResponse(request("/admin",await token()),settings,fetcher),null);
    for(const values of messages){assert.equal(values.length,1);assert.match(values[0],/^imladri_admin_access:(assertion_missing|token_parts|verified)$/);}
    assert.equal(messages.length,3);
  }finally{console.warn=warn;}
});
