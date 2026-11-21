import { AGE_RANGES, ApiError, CONSENT_VERSION, GENDERS, INTERESTED_IN, LOOKING_FOR, RETENTION_DAYS, SOURCES, cityName, cleanText, normalizeEmail, nowIso, reportingDay, safeReferrer, sourceName, type PersonalData, type SignupRow, type WaitlistEnv } from "./config.js";
import { decrypt, encrypt, hash, keyedHash, randomToken } from "./crypto.js";

export function database(env: WaitlistEnv) { if (!env.DB) throw new ApiError(503, "The waitlist is temporarily unavailable. Please try again shortly.", "database_unavailable"); return env.DB; }
export function validateSignup(body: Record<string, unknown>) {
  if (cleanText(body.website)) throw new ApiError(400, "We couldn't process this signup.", "invalid_signup");
  const firstName = cleanText(body.firstName, 81);
  if (!firstName || firstName.length > 80) throw new ApiError(400, "Enter your first name (up to 80 characters).", "invalid_name");
  const email = normalizeEmail(body.email);
  const city = cityName(body.city, body.otherCity);
  if (body.adultConfirmed !== true) throw new ApiError(400, "You must confirm that you are 18 or older.", "adult_confirmation_required");
  if (body.emailConsent !== true) throw new ApiError(400, "Please agree to receive waitlist updates to join.", "consent_required");
  const ageRange = cleanText(body.ageRange); const gender = cleanText(body.gender);
  if (!AGE_RANGES.includes(ageRange)) throw new ApiError(400, "Choose your age range.", "invalid_age_range");
  if (!GENDERS.includes(gender)) throw new ApiError(400, "Choose your gender.", "invalid_gender");
  const genderDescription = gender === "Prefer to self-describe" ? cleanText(body.genderDescription, 81) : "";
  if (gender === "Prefer to self-describe" && (!genderDescription || genderDescription.length > 80)) throw new ApiError(400, "Describe your gender in up to 80 characters.", "invalid_gender_description");
  const interestedIn = Array.isArray(body.interestedIn) ? [...new Set(body.interestedIn.filter((v): v is string => typeof v === "string"))] : [];
  if (!interestedIn.length || interestedIn.length > 3 || interestedIn.some(v => !INTERESTED_IN.includes(v))) throw new ApiError(400, "Choose who you're interested in meeting.", "invalid_interests");
  const lookingFor = cleanText(body.lookingFor);
  if (lookingFor && !LOOKING_FOR.includes(lookingFor)) throw new ApiError(400, "Choose a valid relationship preference.", "invalid_preference");
  const source = cleanText(body.source);
  if (source && !SOURCES.includes(source)) throw new ApiError(400, "Choose a valid source.", "invalid_source");
  const personal: PersonalData = { firstName, email, ageRange, adultConfirmed: true, gender, genderDescription, interestedIn, lookingFor, emailConsent: true };
  return { personal, city, source: sourceName(source, body.utmSource, body.referralCode) };
}

export function tracking(body: Record<string, unknown>) {
  return { utmSource: cleanText(body.utmSource, 100), utmMedium: cleanText(body.utmMedium, 100), utmCampaign: cleanText(body.utmCampaign, 100), utmContent: cleanText(body.utmContent, 100), utmTerm: cleanText(body.utmTerm, 100), referrerHost: safeReferrer(body.referrer) };
}
export async function recordVisit(body: Record<string, unknown>, env: WaitlistEnv) {
  const session = cleanText(body.sessionId, 100);
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(session)) return null;
  const now = nowIso(); const day = reportingDay(now); const id = await keyedHash(`visit:${day}:${session}`, env);
  const t = tracking(body); const referral = cleanText(body.referralCode, 30);
  await database(env).prepare("INSERT OR IGNORE INTO waitlist_visits (id,day,source,utm_source,utm_medium,utm_campaign,utm_content,referral_code,referrer_host,converted,created_at) VALUES (?,?,?,?,?,?,?,?,?,0,?)").bind(id, day, sourceName(body.source, body.utmSource, referral), t.utmSource, t.utmMedium, t.utmCampaign, t.utmContent, referral, t.referrerHost, now).run();
  return id;
}
export async function rateLimit(request: Request, env: WaitlistEnv, action: string, limit = 30) {
  const ip = request.headers.get("cf-connecting-ip"); if (!ip) return;
  const bucket = Math.floor(Date.now() / 600_000);
  const key = await keyedHash(`rate:${action}:${bucket}:${ip}`, env);
  const expiry = new Date((bucket + 2) * 600_000).toISOString();
  await database(env).prepare("INSERT INTO waitlist_rate_limits (key,hits,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET hits=hits+1").bind(key, expiry).run();
  const row = await database(env).prepare("SELECT hits FROM waitlist_rate_limits WHERE key=?").bind(key).first<{hits:number}>();
  if ((row?.hits || 0) > limit) throw new ApiError(429, "Too many attempts. Please wait a few minutes and try again.", "rate_limited");
}

type PreparedEmail = { id:string; payload:string; key:string };
export async function createSignup(body: Record<string, unknown>, env: WaitlistEnv, prepareEmail?: (row:SignupRow,personal:PersonalData)=>Promise<PreparedEmail>) {
  const { personal, city, source } = validateSignup(body);
  const db = database(env); const emailHash = await keyedHash(`email:${personal.email}`, env);
  if (await db.prepare("SELECT id FROM waitlist_signups WHERE email_hash=?").bind(emailHash).first()) throw new ApiError(409, "This email is already on the list. Please check your welcome email.", "duplicate_email");
  const referral = cleanText(body.referralCode, 30);
  const referrer = referral ? await db.prepare("SELECT id,email_hash FROM waitlist_signups WHERE referral_code=? AND status='active' AND expires_at>?").bind(referral,nowIso()).first<{id:string;email_hash:string}>() : null;
  const receipt = randomToken(); const id = crypto.randomUUID(); const referralCode = randomToken(12);
  const now = nowIso(); const expires = new Date(Date.now() + RETENTION_DAYS * 86400_000).toISOString(); const t = tracking(body);
  const visitId = await recordVisit(body, env);
  const row:SignupRow={id,email_hash:emailHash,encrypted_data:await encrypt(personal,env),city,city_key:city.toLocaleLowerCase(),gender_key:await keyedHash(`gender:${personal.gender}`,env),age_key:await keyedHash(`age:${personal.ageRange}`,env),source,utm_source:t.utmSource,utm_medium:t.utmMedium,utm_campaign:t.utmCampaign,utm_content:t.utmContent,utm_term:t.utmTerm,referrer_host:t.referrerHost,referral_code:referralCode,referred_by:referrer&&referrer.email_hash!==emailHash?referrer.id:null,receipt_hash:await hash(receipt),visit_id:visitId,status:"active",consent_version:CONSENT_VERSION,consent_at:now,created_at:now,created_day:reportingDay(now),updated_at:now,expires_at:expires};
  const values = [row.id,row.email_hash,row.encrypted_data,row.city,row.city_key,row.gender_key,row.age_key,row.source,row.utm_source,row.utm_medium,row.utm_campaign,row.utm_content,row.utm_term,row.referrer_host,row.referral_code,row.referred_by,row.receipt_hash,row.visit_id,row.status,row.consent_version,row.consent_at,row.created_at,row.created_day,row.updated_at,row.expires_at];
  const insert = db.prepare("INSERT INTO waitlist_signups (id,email_hash,encrypted_data,city,city_key,gender_key,age_key,source,utm_source,utm_medium,utm_campaign,utm_content,utm_term,referrer_host,referral_code,referred_by,receipt_hash,visit_id,status,consent_version,consent_at,created_at,created_day,updated_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(...values);
  const prepared=prepareEmail?await prepareEmail(row,personal):null;
  try {
    const statements = [insert];
    if(prepared)statements.push(db.prepare("INSERT INTO waitlist_email_outbox (id,signup_id,campaign_id,kind,encrypted_payload,idempotency_key,status,attempts,created_at,updated_at) VALUES (?,?,NULL,'welcome',?,?,'pending',0,?,?)").bind(prepared.id,row.id,prepared.payload,prepared.key,now,now));
    if (visitId) statements.push(db.prepare("UPDATE waitlist_visits SET converted=1 WHERE id=?").bind(visitId));
    await db.batch(statements);
  } catch (error) {
    if (String(error).includes("UNIQUE") || String(error).includes("unique")) throw new ApiError(409, "This email is already on the list. Please check your welcome email.", "duplicate_email");
    throw error;
  }
  return { row, personal, receipt, messageId:prepared?.id };
}
export async function getSignup(id: string, env: WaitlistEnv) { return database(env).prepare("SELECT * FROM waitlist_signups WHERE id=?").bind(id).first<SignupRow>(); }
export async function person(row: SignupRow, env: WaitlistEnv) { return decrypt<PersonalData>(row.encrypted_data, env); }
export async function unsubscribe(id: string, env: WaitlistEnv) {
  const db = database(env); const now = nowIso();
  await db.batch([
    db.prepare("UPDATE waitlist_signups SET status='unsubscribed',updated_at=? WHERE id=?").bind(now, id),
    db.prepare("UPDATE waitlist_email_outbox SET status='cancelled',updated_at=? WHERE signup_id=? AND kind!='delete-request' AND status IN ('pending','failed','sending')").bind(now, id),
  ]);
}
export async function deleteSignup(id: string, env: WaitlistEnv) {
  const db = database(env);
  await db.batch([db.prepare("UPDATE waitlist_signups SET referred_by=NULL WHERE referred_by=?").bind(id), db.prepare("DELETE FROM waitlist_email_outbox WHERE signup_id=?").bind(id), db.prepare("DELETE FROM waitlist_signups WHERE id=?").bind(id)]);
}
// Run bounded privacy housekeeping on active traffic and owner visits. No schema
// creation occurs in a request, and no unbounded record decryption is required.
export async function maintenance(env: WaitlistEnv) {
  const db = database(env); const now = nowIso();
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();
  await db.batch([
    db.prepare("UPDATE waitlist_signups SET referred_by=NULL WHERE referred_by IN (SELECT id FROM waitlist_signups WHERE expires_at<? LIMIT 100)").bind(now),
    db.prepare("DELETE FROM waitlist_signups WHERE id IN (SELECT id FROM waitlist_signups WHERE expires_at<? LIMIT 100)").bind(now),
    db.prepare("DELETE FROM waitlist_visits WHERE id IN (SELECT id FROM waitlist_visits WHERE created_at<? LIMIT 1000)").bind(cutoff),
    db.prepare("DELETE FROM waitlist_rate_limits WHERE key IN (SELECT key FROM waitlist_rate_limits WHERE expires_at<? LIMIT 1000)").bind(now),
    db.prepare("DELETE FROM contact_messages WHERE id IN (SELECT id FROM contact_messages WHERE expires_at<=? LIMIT 100)").bind(now),
    db.prepare("UPDATE waitlist_email_outbox SET status='failed',error='Delivery was interrupted; safe to retry.',updated_at=? WHERE status='sending' AND updated_at<?").bind(now, new Date(Date.now() - 180_000).toISOString()),
    db.prepare("DELETE FROM waitlist_admin_codes WHERE email_hash IN (SELECT email_hash FROM waitlist_admin_codes WHERE expires_at<=? LIMIT 100)").bind(now),
    db.prepare("DELETE FROM waitlist_admin_sessions WHERE token_hash IN (SELECT token_hash FROM waitlist_admin_sessions WHERE expires_at<=? OR last_seen_at<=? LIMIT 100)").bind(now,new Date(Date.now()-30*60_000).toISOString()),
  ]);
  const legacy=(await db.prepare("SELECT id,created_at FROM waitlist_signups WHERE created_day='' LIMIT 100").all<{id:string;created_at:string}>()).results;
  if(legacy.length)await db.batch(legacy.map(row=>db.prepare("UPDATE waitlist_signups SET created_day=? WHERE id=? AND created_day=''").bind(reportingDay(row.created_at),row.id)));
}
