import { ApiError, normalizeEmail, publicOrigin, type WaitlistEnv } from "./config.js";
import { keyedHash } from "./crypto.js";
import { rateLimit } from "./data.js";
import { renderBrandedEmail } from "./email-template.js";
import { welcomeBody } from "./mail.js";

export function previewEmailText(body: string, origin: string) {
  return `${body}\n\n—\nThis is a sample email. It does not add you to the waitlist or change subscription data.\nUnsubscribe: ${origin}/#email-preview-unsubscribe\nDelete your waitlist data: ${origin}/#email-preview-delete\nPrivacy policy: ${origin}/privacy\nContact us: ${origin}/contact`;
}

export function signupEmailPreview(request: Request, env: WaitlistEnv, ownerEmail: string) {
  const origin = publicOrigin(request, env);
  const recipient = normalizeEmail(ownerEmail);
  const subject = "TEST — You're on the Imladri list";
  const postalAddress = env.EMAIL_POSTAL_ADDRESS?.trim() || "";
  const text = previewEmailText(welcomeBody("Osama", "Chicago", `${origin}/?ref=email-preview`), origin) + (postalAddress ? `\nBusiness mailing address: ${postalAddress}` : "");
  return { recipient, subject, text, postalAddressConfigured: !!postalAddress, html: renderBrandedEmail({ subject, text, kind: "welcome", origin, preview: true, postalAddress }) };
}

export async function sendSignupEmailTest(request: Request, body: Record<string, unknown>, env: WaitlistEnv, ownerEmail: string, fetcher: typeof fetch = fetch) {
  if (Object.keys(body).some(key => key !== "requestId") || typeof body.requestId !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.requestId)) {
    throw new ApiError(400, "A unique test request ID is required. Test emails can only go to your signed-in owner address.", "invalid_test_request");
  }
  await rateLimit(request, env, "admin-email-test", 3);
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new ApiError(503, "Email delivery is not configured.", "email_not_configured");
  const preview = signupEmailPreview(request, env, ownerEmail);
  const idempotencyKey = `owner-email-test-${await keyedHash(`${preview.recipient}:${body.requestId}`, env)}`;
  try {
    const response = await fetcher("https://api.resend.com/emails", {
      method: "POST", signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [preview.recipient], reply_to: env.EMAIL_REPLY_TO || preview.recipient, subject: preview.subject, text: preview.text, html: preview.html }),
    });
    if (!response.ok) throw new Error("provider_rejected");
    const result = await response.json() as { id?: string };
    if (typeof result.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(result.id)) throw new Error("invalid_provider_receipt");
    return { ok: true, status: "accepted", recipient: preview.recipient, emailId: result.id };
  } catch {
    throw new ApiError(503, "The email provider could not confirm delivery. You can retry this test safely using the same request.", "test_email_unconfirmed");
  }
}
