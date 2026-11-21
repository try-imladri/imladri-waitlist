import { ApiError, RETENTION_DAYS, cleanText, normalizeEmail, nowIso, type WaitlistEnv } from "./config.js";
import { decrypt, encrypt, keyedHash, randomToken } from "./crypto.js";
import { database, rateLimit } from "./data.js";

export const CONTACT_CATEGORIES=["Privacy","Partnership","Suggestions","Support","Feedback","Other"] as const;
export const CONTACT_STATUSES=["new","read","resolved"] as const;
type ContactPersonal={name:string;email:string;subject:string;message:string};
type ContactRow={id:string;reference:string;request_hash:string;payload_hash:string;encrypted_data:string;category:string;status:string;created_at:string;updated_at:string;expires_at:string};

function messageText(value:unknown){return typeof value==="string"?value.normalize("NFKC").replace(/\r\n?/g,"\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,"").trim():"";}
function validCategory(value:string){return CONTACT_CATEGORIES.some(category=>category===value);}
function validStatus(value:string){return CONTACT_STATUSES.some(status=>status===value);}
function confirmation(reference:string){return{ok:true,reference,message:"Thanks for contacting us. Your message has been received."};}
function validateContact(body:Record<string,unknown>){
  if(cleanText(body.website))throw new ApiError(400,"We couldn't process this message.","invalid_contact_message");
  const name=cleanText(body.name,81);if(!name||name.length>80)throw new ApiError(400,"Enter your name (up to 80 characters).","invalid_contact_name");
  const email=normalizeEmail(body.email);
  const category=cleanText(body.category,30);if(!validCategory(category))throw new ApiError(400,"Choose a reason for contacting us.","invalid_contact_category");
  const subject=cleanText(body.subject,161);if(!subject||subject.length>160)throw new ApiError(400,"Enter a subject (up to 160 characters).","invalid_contact_subject");
  const message=messageText(body.message);if(!message||message.length>5000)throw new ApiError(400,"Enter a message (up to 5,000 characters).","invalid_contact_content");
  const requestId=typeof body.clientRequestId==="string"?body.clientRequestId:"";if(!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))throw new ApiError(400,"Refresh the form and try again.","invalid_contact_request");
  return{personal:{name,email,subject,message},category,requestId};
}

export async function createContactMessage(request:Request,body:Record<string,unknown>,env:WaitlistEnv){
  const{personal,category,requestId}=validateContact(body);const db=database(env);
  const requestHash=await keyedHash(`contact-request:${requestId}`,env);const payloadHash=await keyedHash(`contact-payload:${JSON.stringify({category,...personal})}`,env);
  const existing=await db.prepare("SELECT reference,payload_hash FROM contact_messages WHERE request_hash=?").bind(requestHash).first<Pick<ContactRow,"reference"|"payload_hash">>();
  if(existing){if(existing.payload_hash!==payloadHash)throw new ApiError(409,"This form request was already used. Start a new message.","contact_request_conflict");return confirmation(existing.reference);}
  await rateLimit(request,env,"contact-message",5);
  const id=crypto.randomUUID();const reference="IML-"+randomToken(18);const now=nowIso();const expires=new Date(Date.now()+RETENTION_DAYS*86400_000).toISOString();
  const encrypted=await encrypt(personal,env);
  // The unique request hash serializes concurrent double-clicks. Never overwrite
  // an earlier message or expose its personal data through a public receipt.
  await db.prepare("INSERT INTO contact_messages (id,reference,request_hash,payload_hash,encrypted_data,category,status,created_at,updated_at,expires_at) VALUES (?,?,?,?,?,?,'new',?,?,?) ON CONFLICT(request_hash) DO NOTHING").bind(id,reference,requestHash,payloadHash,encrypted,category,now,now,expires).run();
  const saved=await db.prepare("SELECT reference,payload_hash FROM contact_messages WHERE request_hash=?").bind(requestHash).first<Pick<ContactRow,"reference"|"payload_hash">>();
  if(!saved)throw new ApiError(503,"Your message could not be saved. Please try again.");
  if(saved.payload_hash!==payloadHash)throw new ApiError(409,"This form request was already used. Start a new message.","contact_request_conflict");
  return confirmation(saved.reference);
}

async function contactItem(row:ContactRow,env:WaitlistEnv){const p=await decrypt<ContactPersonal>(row.encrypted_data,env);return{id:row.id,reference:row.reference,...p,category:row.category,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at};}
function contactFilters(params:URLSearchParams){
  const clauses=["expires_at>?"];const values:string[]=[nowIso()];
  const category=cleanText(params.get("category"),30);if(category){if(!validCategory(category))throw new ApiError(400,"Invalid contact category.");clauses.push("category=?");values.push(category);}
  const status=cleanText(params.get("status"),20);if(status){if(!validStatus(status))throw new ApiError(400,"Invalid message status.");clauses.push("status=?");values.push(status);}
  const reference=cleanText(params.get("reference"),50);if(reference){if(!/^IML-[A-Za-z0-9_-]{24}$/.test(reference))throw new ApiError(400,"Invalid message reference.");clauses.push("reference=?");values.push(reference);}
  return{where:" WHERE "+clauses.join(" AND "),values};
}
function pageNumber(value:string|null,fallback:number,max:number){const number=Number(value);return Number.isFinite(number)&&number>0?Math.min(max,Math.max(1,Math.floor(number))):fallback;}

export async function listContactMessages(params:URLSearchParams,env:WaitlistEnv){
  const{where,values}=contactFilters(params);const page=pageNumber(params.get("page"),1,100000);const pageSize=pageNumber(params.get("pageSize"),25,100);const db=database(env);
  const total=await db.prepare(`SELECT COUNT(*) count FROM contact_messages${where}`).bind(...values).first<{count:number}>();
  const rows=(await db.prepare(`SELECT * FROM contact_messages${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).bind(...values,pageSize,(page-1)*pageSize).all<ContactRow>()).results;
  return{items:await Promise.all(rows.map(row=>contactItem(row,env))),total:total?.count||0,page,pageSize};
}
export async function contactSummary(env:WaitlistEnv){
  const rows=(await database(env).prepare("SELECT category,status,COUNT(*) count FROM contact_messages WHERE expires_at>? GROUP BY category,status").bind(nowIso()).all<{category:string;status:string;count:number}>()).results;
  const categories=CONTACT_CATEGORIES.map(category=>({category,total:0,unread:0}));let total=0,unread=0,resolved=0;
  for(const row of rows){const category=categories.find(item=>item.category===row.category);if(category){category.total+=row.count;if(row.status==="new")category.unread+=row.count;}total+=row.count;if(row.status==="new")unread+=row.count;if(row.status==="resolved")resolved+=row.count;}
  return{total,unread,resolved,categories};
}
export async function getContactMessage(id:string,env:WaitlistEnv){
  const row=await database(env).prepare("SELECT * FROM contact_messages WHERE id=? AND expires_at>?").bind(id,nowIso()).first<ContactRow>();
  if(!row)throw new ApiError(404,"This message was not found.","contact_message_not_found");return contactItem(row,env);
}
export async function updateContactStatus(id:string,body:Record<string,unknown>,env:WaitlistEnv){
  const status=cleanText(body.status,20);if(!validStatus(status))throw new ApiError(400,"Choose a valid message status.","invalid_contact_status");
  const result=await database(env).prepare("UPDATE contact_messages SET status=?,updated_at=? WHERE id=? AND expires_at>?").bind(status,nowIso(),id,nowIso()).run();
  if(!result.meta.changes)throw new ApiError(404,"This message was not found.","contact_message_not_found");return{ok:true,item:await getContactMessage(id,env)};
}
export async function deleteContactMessage(id:string,env:WaitlistEnv){await database(env).prepare("DELETE FROM contact_messages WHERE id=?").bind(id).run();return{ok:true};}
