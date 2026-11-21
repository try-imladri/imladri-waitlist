export const CITIES = ["Chicago", "New York", "Los Angeles", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "Jacksonville", "Fort Worth", "Austin", "San Jose", "Columbus", "Charlotte", "Indianapolis", "San Francisco", "Seattle", "Denver", "Oklahoma City", "Washington, DC"];
export const AGE_RANGES = ["18-24", "25-29", "30-34", "35-39", "40-49", "50+"];
export const GENDERS = ["Woman", "Man", "Non-binary", "Prefer to self-describe"];
export const INTERESTED_IN = ["Women", "Men", "Non-binary people"];
export const LOOKING_FOR = ["Long-term relationship", "Dating", "Not sure yet"];
export const SOURCES = ["TikTok", "Friend", "Other"];
export const CONSENT_VERSION = "2026-11-19-v1";
export const CONSENT_TEXT = "I agree to receive updates about the launch. I can unsubscribe at any time.";
export const RETENTION_DAYS = 365;
export type WaitlistEnv = { DB?: D1Database; WAITLIST_DATA_KEY?: string; WAITLIST_SIGNING_KEY?: string; RESEND_API_KEY?: string; EMAIL_FROM?: string; EMAIL_REPLY_TO?: string; EMAIL_POSTAL_ADDRESS?: string; ADMIN_EMAILS?: string; ADMIN_ALLOWED_IPS?: string; ADMIN_AUTH_MODE?: string; ADMIN_ACCESS_ISSUER?: string; ADMIN_ACCESS_AUD?: string; ADMIN_ACCESS_EMAIL?: string; ADMIN_ACCESS_EMAILS?: string; ADMIN_ACCESS_DIAGNOSTICS?: string; PUBLIC_APP_URL?: string; SITE_BASE_URL?: string; };
export type PersonalData = { firstName: string; email: string; ageRange: string; adultConfirmed: true; gender: string; genderDescription: string; interestedIn: string[]; lookingFor: string; emailConsent: true; };
export type SignupRow = { id: string; email_hash: string; encrypted_data: string; city: string; city_key: string; gender_key: string; age_key: string; source: string; utm_source: string; utm_medium: string; utm_campaign: string; utm_content: string; utm_term: string; referrer_host: string; referral_code: string; referred_by: string | null; receipt_hash: string; visit_id: string | null; status: string; consent_version: string; consent_at: string; created_at: string; created_day: string; updated_at: string; expires_at: string; };
export class ApiError extends Error { constructor(public status: number, message: string, public code = "request_error") { super(message); } }
export function config() { return { appName: "Imladri", contactEmail: "osama@imladri.com", cities: CITIES, ageRanges: AGE_RANGES, genders: GENDERS, interestedIn: INTERESTED_IN, lookingFor: LOOKING_FOR, sources: SOURCES, noLaunchRestrictions: true }; }
export function nowIso() { return new Date().toISOString(); }
export function reportingDay(value: string | Date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(typeof value === "string" ? new Date(value) : value);
  const part = (type:string) => parts.find(p => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function cleanText(value: unknown, max = 100) { return typeof value === "string" ? value.normalize("NFKC").replace(/[\u0000-\u001f\u007f]/g, " ").trim().replace(/\s+/g, " ").slice(0, max) : ""; }
export function normalizeEmail(value: unknown) { const email = cleanText(value, 255).toLowerCase(); if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "Enter a valid email address.", "invalid_email"); return email; }
export function cityName(value: unknown, other?: unknown) { const city = cleanText(value === "Other" ? other : value, 100); if (city.length < 2) throw new ApiError(400, "Enter your city.", "invalid_city"); return CITIES.find(c => c.toLocaleLowerCase() === city.toLocaleLowerCase()) || city; }
export function publicOrigin(request: Request, env: WaitlistEnv) { return new URL(env.PUBLIC_APP_URL || env.SITE_BASE_URL || new URL(request.url).origin).origin; }
export function safeReferrer(value: unknown) { try { const url = new URL(cleanText(value, 500)); return /^https?:$/.test(url.protocol) ? url.hostname.slice(0, 180) : ""; } catch { return ""; } }
export function sourceName(value: unknown, utm: unknown, referral: unknown) { const selected = cleanText(value, 50); if (SOURCES.includes(selected)) return selected; if (cleanText(referral)) return "Friend"; if (/tiktok/i.test(cleanText(utm))) return "TikTok"; return cleanText(utm) ? "Other" : "Direct"; }
