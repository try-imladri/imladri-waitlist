declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    WAITLIST_DATA_KEY?: string;
    WAITLIST_SIGNING_KEY?: string;
    RESEND_API_KEY?: string;
    EMAIL_FROM?: string;
    EMAIL_REPLY_TO?: string;
    ADMIN_EMAILS?: string;
    ADMIN_ALLOWED_IPS?: string;
    ADMIN_AUTH_MODE?: string;
    ADMIN_ACCESS_ISSUER?: string;
    ADMIN_ACCESS_AUD?: string;
    ADMIN_ACCESS_EMAIL?: string;
    ADMIN_ACCESS_EMAILS?: string;
    ADMIN_ACCESS_DIAGNOSTICS?: string;
    PUBLIC_APP_URL?: string;
    SITE_BASE_URL?: string;
  }
}
