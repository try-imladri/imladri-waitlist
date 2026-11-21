import type { WaitlistEnv } from "./config.js";
import { adminNetworkAllowed, isAdminRequestPath } from "./network-access.js";

export type AdminAuthMode = "ip" | "access+ip" | "access";
export type AccessIdentity = { email: string; subject: string; expiresAt: number };
type AccessConfig = { issuer: string; audience: string; emails: string[] };
type JsonObject = Record<string, unknown>;
type SigningKey = { kid: string; key: CryptoKey };
type KeyCache = { expiresAt: number; refreshedAt: number; keys: SigningKey[]; pending?: Promise<SigningKey[]> };
const KEY_TTL_MS = 5 * 60_000;
const KEY_REFRESH_COOLDOWN_MS = 60_000;
const MAX_TOKEN_BYTES = 16_384;
const CLOCK_SKEW_SECONDS = 30;
const keyCaches = new WeakMap<typeof fetch, Map<string, KeyCache>>();
const identities = new WeakMap<Request, { binding: string; identity: AccessIdentity }>();
type DiagnosticStage = "auth_mode" | "worker_subrequest" | "network" | "configuration" | "assertion_missing" | "assertion_size" | "token_parts" | "token_json" | "header" | "issuer" | "token_type" | "subject" | "audience" | "owner" | "expiry" | "issued_at" | "not_before" | "key_lookup" | "key_fetch" | "key_http" | "key_body" | "key_json" | "key_shape" | "key_import" | "key_missing" | "signature" | "verified";
class KeyLookupError extends Error {
  constructor(public stage: DiagnosticStage) { super(stage); }
}
const diagnosticTimes = new Map<DiagnosticStage, number>();
function diagnostic(env: WaitlistEnv, stage: DiagnosticStage): null {
  if (env.ADMIN_ACCESS_DIAGNOSTICS === "enabled") {
    const now = Date.now(); const previous = diagnosticTimes.get(stage);
    if (previous === undefined || now - previous >= 60_000) {
      diagnosticTimes.set(stage, now);
      // This enum is the entire log. Never add request data, claims or errors.
      console.warn(`imladri_admin_access:${stage}`);
    }
  }
  return null;
}

/** The existing deployment stays IP-only until an explicit, verified cutover. */
export function adminAuthMode(env: Pick<WaitlistEnv, "ADMIN_AUTH_MODE">): AdminAuthMode | null {
  if (env.ADMIN_AUTH_MODE === undefined) return "ip";
  return env.ADMIN_AUTH_MODE === "ip" || env.ADMIN_AUTH_MODE === "access+ip" || env.ADMIN_AUTH_MODE === "access" ? env.ADMIN_AUTH_MODE : null;
}

function accessConfig(env: WaitlistEnv): AccessConfig | null {
  const issuer = env.ADMIN_ACCESS_ISSUER;
  const audience = env.ADMIN_ACCESS_AUD;
  const setting = env.ADMIN_ACCESS_EMAILS === undefined ? env.ADMIN_ACCESS_EMAIL : env.ADMIN_ACCESS_EMAILS;
  if (typeof issuer !== "string" || !/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$/.test(issuer)) return null;
  if (typeof audience !== "string" || !/^[a-f0-9]{64}$/.test(audience)) return null;
  if (typeof setting !== "string" || !setting || setting.length > 4096) return null;
  if (env.ADMIN_ACCESS_EMAILS === undefined && setting !== setting.trim()) return null;
  const requested = setting.split(",").map(value => value.trim());
  if (requested.length > 16 || requested.some(email => !email || email.length > 254 || email !== email.toLowerCase() || !/^[^\s,@]+@[^\s,@]+\.[^\s,@]+$/.test(email))) return null;
  // The legacy singular setting remains a single identity, never a CSV list.
  if (env.ADMIN_ACCESS_EMAILS === undefined && requested.length !== 1) return null;
  const owners = (env.ADMIN_EMAILS || "").split(",").map(value => value.trim().toLowerCase());
  const emails = [...new Set(requested)].filter(email => owners.includes(email));
  return emails.length ? { issuer, audience, emails } : null;
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid token encoding");
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
function object(value: unknown): value is JsonObject { return !!value && typeof value === "object" && !Array.isArray(value); }
function jwtObject(value: string): JsonObject {
  const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes(value)));
  if (!object(parsed)) throw new Error("Invalid token object");
  return parsed;
}

async function fetchKeys(issuer: string, fetcher: typeof fetch): Promise<SigningKey[]> {
  let response: Response;
  try { response = await fetcher(`${issuer}/cdn-cgi/access/certs`, { redirect: "manual", signal: AbortSignal.timeout(5_000), headers: { Accept: "application/json" } }); }
  catch { throw new KeyLookupError("key_fetch"); }
  if (!response.ok) throw new KeyLookupError("key_http");
  if (Number(response.headers.get("content-length")) > 65_536) throw new KeyLookupError("key_body");
  const reader = response.body?.getReader();
  if (!reader) throw new KeyLookupError("key_body");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 65_536) { await reader.cancel(); throw new KeyLookupError("key_body"); }
      chunks.push(value);
    }
  } catch { throw new KeyLookupError("key_body"); }
  const data = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
  catch { throw new KeyLookupError("key_json"); }
  if (!object(result) || !Array.isArray(result.keys) || result.keys.length < 1 || result.keys.length > 16) throw new KeyLookupError("key_shape");
  const keys: SigningKey[] = [];
  for (const candidate of result.keys) {
    if (!object(candidate) || candidate.kty !== "RSA" || typeof candidate.kid !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(candidate.kid) || typeof candidate.n !== "string" || typeof candidate.e !== "string") continue;
    if (candidate.alg !== undefined && candidate.alg !== "RS256" || candidate.use !== undefined && candidate.use !== "sig") continue;
    if (candidate.key_ops !== undefined && (!Array.isArray(candidate.key_ops) || !candidate.key_ops.includes("verify"))) continue;
    let modulus: Uint8Array;
    try { modulus = bytes(candidate.n); } catch { throw new KeyLookupError("key_shape"); }
    if (modulus.length < 256 || modulus.length > 1024) continue;
    if (keys.some(key => key.kid === candidate.kid)) throw new KeyLookupError("key_shape");
    let key: CryptoKey;
    try { key = await crypto.subtle.importKey("jwk", { kty: "RSA", n: candidate.n, e: candidate.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]); }
    catch { throw new KeyLookupError("key_import"); }
    keys.push({ kid: candidate.kid, key });
  }
  if (!keys.length) throw new KeyLookupError("key_shape");
  return keys;
}

async function signingKey(config: AccessConfig, kid: string, fetcher: typeof fetch): Promise<CryptoKey | null> {
  let cache = keyCaches.get(fetcher);
  if (!cache) { cache = new Map(); keyCaches.set(fetcher, cache); }
  // The issuer is deployment configuration, never a token-controlled URL.
  let entry = cache.get(config.issuer);
  const now = Date.now();
  if (entry && entry.expiresAt > now) {
    const existing = entry.keys.find(key => key.kid === kid);
    if (existing) return existing.key;
    if (!entry.pending && now - entry.refreshedAt < KEY_REFRESH_COOLDOWN_MS) return null;
  }
  if (entry && !entry.pending && now - entry.refreshedAt < KEY_REFRESH_COOLDOWN_MS) return null;
  if (!entry) {
    if (cache.size >= 4) cache.delete(cache.keys().next().value!);
    entry = { expiresAt: 0, refreshedAt: 0, keys: [] }; cache.set(config.issuer, entry);
  }
  if (!entry.pending) {
    const target = entry;
    target.refreshedAt = now;
    target.pending = fetchKeys(config.issuer, fetcher).then(keys => {
      target.keys = keys; target.expiresAt = Date.now() + KEY_TTL_MS; return keys;
    }).finally(() => { target.pending = undefined; });
  }
  const keys = await entry.pending!;
  return keys.find(key => key.kid === kid)?.key || null;
}

/** Verify the application JWT itself; neither cookies nor identity headers suffice. */
export async function getAccessIdentity(request: Request, env: WaitlistEnv, fetcher: typeof fetch = fetch): Promise<AccessIdentity | null> {
  let stage: DiagnosticStage = "configuration";
  try {
    const config = accessConfig(env); if (!config) return diagnostic(env, "configuration");
    if (request.headers.has("CF-Worker")) return diagnostic(env, "worker_subrequest");
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) return diagnostic(env, "assertion_missing");
    if (token.length > MAX_TOKEN_BYTES) return diagnostic(env, "assertion_size");
    const binding = `${config.issuer}|${config.audience}|${config.emails.join(",")}|${token}`;
    const cached = identities.get(request);
    if (cached?.binding === binding && cached.identity.expiresAt > Date.now() / 1000) return cached.identity;
    const parts = token.split("."); if (parts.length !== 3) return diagnostic(env, "token_parts");
    stage = "token_json";
    const header = jwtObject(parts[0]); const claims = jwtObject(parts[1]);
    if (header.alg !== "RS256" || header.typ !== undefined && header.typ !== "JWT" || header.crit !== undefined || typeof header.kid !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(header.kid)) return diagnostic(env, "header");
    const now = Date.now() / 1000;
    if (claims.iss !== config.issuer) return diagnostic(env, "issuer");
    if (claims.type !== "app") return diagnostic(env, "token_type");
    if (typeof claims.sub !== "string" || !claims.sub || claims.sub.length > 255) return diagnostic(env, "subject");
    const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (!Array.isArray(audience) || audience.length < 1 || audience.length > 16 || !audience.every(value => typeof value === "string") || !audience.includes(config.audience)) return diagnostic(env, "audience");
    if (typeof claims.email !== "string" || !config.emails.includes(claims.email.toLowerCase())) return diagnostic(env, "owner");
    if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= now) return diagnostic(env, "expiry");
    if (typeof claims.iat !== "number" || !Number.isSafeInteger(claims.iat) || claims.iat > now + CLOCK_SKEW_SECONDS || claims.iat >= claims.exp) return diagnostic(env, "issued_at");
    if (typeof claims.nbf !== "number" || !Number.isSafeInteger(claims.nbf) || claims.nbf > now + CLOCK_SKEW_SECONDS || claims.nbf >= claims.exp) return diagnostic(env, "not_before");
    stage = "key_lookup";
    const key = await signingKey(config, header.kid, fetcher); if (!key) return diagnostic(env, "key_missing");
    stage = "signature";
    const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid) return diagnostic(env, "signature");
    const identity = { email: claims.email.toLowerCase(), subject: claims.sub, expiresAt: claims.exp };
    identities.set(request, { binding, identity });
    diagnostic(env, "verified");
    return identity;
  } catch (error) { return diagnostic(env, error instanceof KeyLookupError ? error.stage : stage); }
}

export function adminDeniedResponse(): Response {
  return new Response(null, { status: 303, headers: { Location: "/", "Cache-Control": "private, no-store, max-age=0", "CDN-Cache-Control": "no-store", "Cloudflare-CDN-Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", Vary: "CF-Connecting-IP, Cf-Access-Jwt-Assertion, Cookie" } });
}

/** Runs before application routing, rendering, database access, or background work. */
export async function adminAccessResponse(request: Request, env: WaitlistEnv, fetcher: typeof fetch = fetch): Promise<Response | null> {
  if (!isAdminRequestPath(new URL(request.url).pathname)) return null;
  const mode = adminAuthMode(env);
  if (!mode) { diagnostic(env, "auth_mode"); return adminDeniedResponse(); }
  if (request.headers.has("CF-Worker")) { diagnostic(env, "worker_subrequest"); return adminDeniedResponse(); }
  if ((mode === "ip" || mode === "access+ip") && !adminNetworkAllowed(request, env)) { diagnostic(env, "network"); return adminDeniedResponse(); }
  if ((mode === "access" || mode === "access+ip") && !await getAccessIdentity(request, env, fetcher)) return adminDeniedResponse();
  return null;
}

export function accessLogoutPath(request: Request, env: WaitlistEnv): string | null {
  const mode = adminAuthMode(env);
  if (mode !== "access" && mode !== "access+ip") return null;
  return `/cdn-cgi/access/logout?returnTo=${encodeURIComponent(new URL("/", request.url).href)}`;
}
