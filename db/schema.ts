import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const signups = sqliteTable("waitlist_signups", {
  id: text("id").primaryKey(), emailHash: text("email_hash").notNull(),
  encryptedData: text("encrypted_data").notNull(), city: text("city").notNull(),
  cityKey: text("city_key").notNull(), genderKey: text("gender_key").notNull(),
  ageKey: text("age_key").notNull(), source: text("source").notNull(),
  utmSource: text("utm_source").notNull().default(""), utmMedium: text("utm_medium").notNull().default(""),
  utmCampaign: text("utm_campaign").notNull().default(""), utmContent: text("utm_content").notNull().default(""),
  utmTerm: text("utm_term").notNull().default(""), referrerHost: text("referrer_host").notNull().default(""),
  referralCode: text("referral_code").notNull(), referredBy: text("referred_by"),
  receiptHash: text("receipt_hash").notNull(), visitId: text("visit_id"),
  status: text("status").notNull().default("active"), consentVersion: text("consent_version").notNull(),
  consentAt: text("consent_at").notNull(), createdAt: text("created_at").notNull(),
  createdDay: text("created_day").notNull().default(""),
  updatedAt: text("updated_at").notNull(), expiresAt: text("expires_at").notNull(),
}, (t) => [uniqueIndex("waitlist_email_unique").on(t.emailHash), uniqueIndex("waitlist_referral_unique").on(t.referralCode),
  uniqueIndex("waitlist_receipt_unique").on(t.receiptHash), index("waitlist_city_status").on(t.cityKey, t.status),
  index("waitlist_created").on(t.createdAt), index("waitlist_referred").on(t.referredBy), index("waitlist_expiry").on(t.expiresAt)]);

export const visits = sqliteTable("waitlist_visits", {
  id: text("id").primaryKey(), day: text("day").notNull(), source: text("source").notNull().default("Direct"),
  utmSource: text("utm_source").notNull().default(""), utmMedium: text("utm_medium").notNull().default(""),
  utmCampaign: text("utm_campaign").notNull().default(""), utmContent: text("utm_content").notNull().default(""),
  referralCode: text("referral_code").notNull().default(""), referrerHost: text("referrer_host").notNull().default(""),
  converted: integer("converted").notNull().default(0), createdAt: text("created_at").notNull(),
}, (t) => [index("waitlist_visits_day").on(t.day)]);

export const outbox = sqliteTable("waitlist_email_outbox", {
  id: text("id").primaryKey(), signupId: text("signup_id").notNull().references(() => signups.id, { onDelete: "cascade" }),
  campaignId: text("campaign_id"), kind: text("kind").notNull(), encryptedPayload: text("encrypted_payload").notNull(),
  idempotencyKey: text("idempotency_key").notNull(), status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0), providerId: text("provider_id"), error: text("error"),
  createdAt: text("created_at").notNull(), updatedAt: text("updated_at").notNull(), sentAt: text("sent_at"),
}, (t) => [uniqueIndex("waitlist_outbox_idempotency").on(t.idempotencyKey), index("waitlist_outbox_status").on(t.status, t.createdAt), index("waitlist_outbox_signup").on(t.signupId)]);

export const campaigns = sqliteTable("waitlist_campaigns", {
  id: text("id").primaryKey(), idempotencyKey: text("idempotency_key").notNull(), kind: text("kind").notNull(),
  city: text("city"), subject: text("subject").notNull(), encryptedBody: text("encrypted_body").notNull(),
  recipientCount: integer("recipient_count").notNull().default(0), createdBy: text("created_by").notNull(), createdAt: text("created_at").notNull(),
  queueCursor: text("queue_cursor").notNull().default(""), queueComplete: integer("queue_complete").notNull().default(0),
}, (t) => [uniqueIndex("waitlist_campaign_idempotency").on(t.idempotencyKey)]);

export const rateLimits = sqliteTable("waitlist_rate_limits", {
  key: text("key").primaryKey(), hits: integer("hits").notNull().default(1), expiresAt: text("expires_at").notNull(),
});

export const adminCodes = sqliteTable("waitlist_admin_codes", {
  emailHash: text("email_hash").primaryKey(),
  codeHash: text("code_hash").notNull(),
  encryptedCode: text("encrypted_code"),
  nonce: text("nonce").notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedBy: text("consumed_by"),
  deliveryStatus: text("delivery_status").notNull().default("pending"),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  providerId: text("provider_id"),
  error: text("error"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (t) => [index("waitlist_admin_codes_expiry").on(t.expiresAt)]);

export const adminSessions = sqliteTable("waitlist_admin_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  emailHash: text("email_hash").notNull(),
  createdAt: text("created_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (t) => [index("waitlist_admin_sessions_expiry").on(t.expiresAt), index("waitlist_admin_sessions_owner").on(t.emailHash)]);

export const contactMessages = sqliteTable("contact_messages", {
  id: text("id").primaryKey(),
  reference: text("reference").notNull(),
  requestHash: text("request_hash").notNull(),
  payloadHash: text("payload_hash").notNull(),
  encryptedData: text("encrypted_data").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull().default("new"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  expiresAt: text("expires_at").notNull(),
}, (t) => [uniqueIndex("contact_request_unique").on(t.requestHash), uniqueIndex("contact_reference_unique").on(t.reference), index("contact_category_status_created").on(t.category,t.status,t.createdAt), index("contact_created").on(t.createdAt), index("contact_expiry").on(t.expiresAt)]);
