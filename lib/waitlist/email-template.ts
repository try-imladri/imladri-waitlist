/** Shared HTML wrapper for existing waitlist messages and owner-only previews. */
export type BrandedEmailInput = {
  subject: string;
  text: string;
  kind?: string;
  origin?: string;
  preview?: boolean;
  postalAddress?: string;
};

type FooterLinks = { unsubscribe?: string; deletion?: string; privacy?: string; contact?: string };
const BRAND_IMAGE = "/assets/brand/email/hotlink-ok/imladri-email-lockup-black-v2.png";
const FONT = "Arial, Helvetica, sans-serif";

export function escapeEmailHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));
}

function httpUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return undefined;
    return url.href;
  } catch { return undefined; }
}

function visibleUrl(url: string): string {
  // Soft breaks affect only the label, never the signed href.
  return Array.from(url, character => escapeEmailHtml(character) + (/[/?#=&_-]/.test(character) ? "<wbr>" : "")).join("");
}

function linkedText(text: string): string {
  let html = "", cursor = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const index = match.index!;
    html += escapeEmailHtml(text.slice(cursor, index));
    const url = httpUrl(match[0]);
    html += url ? `<a href="${escapeEmailHtml(url)}" class="text-link" style="color:#171717;text-decoration:underline;text-underline-offset:3px;overflow-wrap:anywhere;word-break:break-word;">${visibleUrl(match[0])}</a>` : escapeEmailHtml(match[0]);
    cursor = index + match[0].length;
  }
  return (html + escapeEmailHtml(text.slice(cursor))).replace(/\n/g, "<br>");
}

function messageParts(text: string): { body: string; footer: string; links: FooterLinks } {
  const divider = text.lastIndexOf("\n\n—\n");
  const body = divider >= 0 ? text.slice(0, divider) : text;
  const footer = divider >= 0 ? text.slice(divider + 4) : "";
  const labels: [keyof FooterLinks, string][] = [["unsubscribe", "Unsubscribe:"], ["deletion", "Delete your waitlist data:"], ["privacy", "Privacy policy:"], ["contact", "Contact us:"]];
  const links: FooterLinks = {};
  for (const line of footer.split("\n")) {
    for (const [key, label] of labels) if (line.startsWith(label)) {
      const url = httpUrl(line.slice(label.length));
      if (url) links[key] = url;
    }
  }
  return { body, footer, links };
}

function originFor(input: BrandedEmailInput, links: FooterLinks): string {
  const candidate = httpUrl(input.origin || "") || links.privacy || links.unsubscribe || links.contact;
  return candidate ? new URL(candidate).origin : "https://imladri.com";
}

function standaloneAction(body: string, origin: string, kind: string): string | undefined {
  const lines = body.split("\n").map(value => value.trim());
  for (let index = lines.length - 1; index >= 0; index--) {
    const candidate = httpUrl(lines[index]);
    if (!candidate) continue;
    const url = new URL(candidate);
    if (url.origin !== origin) continue;
    if (kind === "welcome" && url.pathname === "/" && url.searchParams.has("ref")) return candidate;
    if (kind === "delete-request" && url.pathname === "/delete-data" && url.searchParams.has("token")) return candidate;
  }
  return undefined;
}

function actionPanel(kind: string, url: string): string {
  const deletion = kind === "delete-request";
  const title = deletion ? "Review your deletion request" : "A little less swiping, together.";
  const description = deletion ? "Opening this link won’t delete anything. You’ll review and confirm on the website." : "Send your personal invite link to a friend who’s ready for dating without the swiping.";
  const button = deletion ? "Review deletion request" : "Open your invite link";
  return `<table class="action-panel" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f5f5f2" style="width:100%;background-color:#f5f5f2;border:1px solid #e0e0dc;border-radius:14px;margin:24px 0;"><tr><td class="action-content" style="padding:24px;">
    <p class="main-text" style="margin:0 0 10px;font-family:${FONT};font-size:19px;line-height:27px;font-weight:700;color:#111111;">${title}</p>
    <p class="muted-text" style="margin:0 0 20px;font-family:${FONT};font-size:15px;line-height:24px;color:#555555;">${description}</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td class="button-cell" bgcolor="#111111" style="background-color:#111111;border-radius:999px;text-align:center;padding:14px 22px;"><a href="${escapeEmailHtml(url)}" class="button-link" style="display:inline-block;font-family:${FONT};font-size:16px;line-height:22px;font-weight:700;color:#ffffff;text-decoration:none;">${button}</a></td></tr></table>
    <p class="muted-text" style="margin:18px 0 0;font-family:${FONT};font-size:13px;line-height:21px;color:#666666;overflow-wrap:anywhere;word-break:break-word;">Or copy this link:<br><a href="${escapeEmailHtml(url)}" class="text-link" style="color:#171717;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word;">${visibleUrl(url)}</a></p>
  </td></tr></table>`;
}

function footerLink(label: string, url: string | undefined): string {
  return url ? `<a href="${escapeEmailHtml(url)}" class="footer-link" style="display:inline-block;padding:8px 10px;color:#555555;text-decoration:underline;font-family:${FONT};font-size:13px;line-height:21px;">${label}</a>` : "";
}

/** Consistent light email palette on mobile and desktop; no delivery side effects. */
export function renderBrandedEmail(input: BrandedEmailInput): string {
  const kind = input.kind || "update";
  const { body, links } = messageParts(input.text);
  const origin = originFor(input, links);
  const privacy = links.privacy || `${origin}/privacy`;
  const contact = links.contact || `${origin}/contact`;
  const action = standaloneAction(body, origin, kind);
  const labels: Record<string, { eyebrow: string; heading?: string; preheader: string }> = {
    welcome: { eyebrow: "WAITLIST CONFIRMED", heading: "You’re on the list.", preheader: "Welcome to Imladri. Your invite link and waitlist preferences are inside." },
    monthly: { eyebrow: "AN HONEST UPDATE", preheader: "A note from Imladri about what we’re building and what comes next." },
    launch: { eyebrow: "LAUNCH UPDATE", preheader: "The latest launch update from Imladri. Read the details inside." },
    "delete-request": { eyebrow: "YOUR DATA. YOUR CHOICE.", heading: "Your deletion link.", preheader: "Review and confirm your waitlist deletion request. Ignore this email if you didn’t request it." },
  };
  const label = labels[kind] || { eyebrow: "A NOTE FROM IMLADRI", preheader: input.subject };
  const paragraphHtml = (value: string) => value ? `<p class="main-text" style="margin:0 0 21px;font-family:${FONT};font-size:16px;line-height:27px;color:#252525;overflow-wrap:anywhere;word-break:break-word;">${linkedText(value)}</p>` : "";
  const content = body.split(/\n\s*\n/).filter(Boolean).map(paragraph => {
    const lines = paragraph.split("\n");
    const actionLine = action ? lines.findIndex(line => httpUrl(line.trim()) === action) : -1;
    if (action && actionLine >= 0) return paragraphHtml(lines.slice(0, actionLine).join("\n")) + actionPanel(kind, action) + paragraphHtml(lines.slice(actionLine + 1).join("\n"));
    return paragraphHtml(paragraph);
  }).join("\n");
  const reason = kind === "delete-request" ? "You’re receiving this because a deletion link was requested for your Imladri waitlist email." : "You’re receiving this because you joined the Imladri waitlist and agreed to launch updates.";
  const preview = input.preview ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px;"><tr><td class="action-panel" style="padding:14px 16px;background-color:#f5f5f2;border:1px dashed #888888;border-radius:10px;font-family:${FONT};font-size:13px;line-height:21px;color:#555555;"><strong>PREVIEW / TEST EMAIL</strong><br>This is a sample. It does not create a waitlist signup. Action links use sample destinations.</td></tr></table>` : "";
  const postalAddress = input.postalAddress?.trim();
  const postalFooter = postalAddress ? `<p class="footer-note" style="margin:18px 0 0;font-family:${FONT};font-size:13px;line-height:21px;color:#666666;">Business mailing address:<br>${escapeEmailHtml(postalAddress).replace(/\r\n?|\n/g, "<br>")}</p>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><meta name="x-apple-disable-message-reformatting"><title>${escapeEmailHtml(input.subject)}</title>
<style>
:root{color-scheme:light only;supported-color-schemes:light}body{margin:0!important;padding:0!important;width:100%!important}table{border-spacing:0}img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important}
@media screen and (max-width:620px){.outer-pad{padding:20px 10px!important}.email-content{padding:30px 22px 24px!important}.email-footer{padding:24px 18px!important}.email-heading{font-size:30px!important;line-height:35px!important}.header-pad{padding:22px!important}.action-content{padding:20px!important}.button-cell{padding:14px 20px!important}.footer-link{font-size:14px!important;padding:10px!important}}
</style></head>
<body class="email-canvas" bgcolor="#f2f2ef" style="margin:0;padding:0;background-color:#f2f2ef;font-family:${FONT};color:#252525;">
<div style="display:none;visibility:hidden;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;">${escapeEmailHtml(label.preheader)}</div>
<table class="email-canvas" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f2ef" style="width:100%;background-color:#f2f2ef;"><tr><td class="outer-pad" align="center" style="padding:36px 16px;">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table class="email-card" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e0e0dc;border-radius:20px;">
<tr><td class="header-pad" align="center" bgcolor="#ffffff" style="padding:25px 32px;background-color:#ffffff;background-image:linear-gradient(#ffffff,#ffffff);border-radius:19px 19px 0 0;line-height:0;"><a href="${escapeEmailHtml(origin)}/" aria-label="Imladri home" style="display:inline-block;text-decoration:none;"><img src="${escapeEmailHtml(origin + BRAND_IMAGE)}" width="216" height="64" alt="Imladri" style="display:block;width:216px;max-width:100%;height:auto;color:#111111;font-family:${FONT};font-size:30px;font-weight:700;"></a></td></tr>
<tr><td class="email-content" bgcolor="#ffffff" style="padding:38px 36px 26px;background-color:#ffffff;">
${preview}<p class="muted-text" style="margin:0 0 12px;font-family:${FONT};font-size:11px;line-height:18px;font-weight:700;letter-spacing:1.5px;color:#666666;">${label.eyebrow}</p>
<h1 class="email-heading" style="margin:0 0 28px;font-family:${FONT};font-size:34px;line-height:40px;font-weight:700;letter-spacing:-1px;color:#111111;overflow-wrap:anywhere;word-break:break-word;">${escapeEmailHtml(label.heading || input.subject)}</h1>
${content}</td></tr>
<tr><td class="email-footer" align="center" bgcolor="#ffffff" style="padding:26px 28px;background-color:#ffffff;border-top:1px solid #e0e0dc;border-radius:0 0 19px 19px;">
<p class="footer-note" style="margin:0 0 12px;font-family:${FONT};font-size:13px;line-height:21px;color:#666666;">${reason}</p>
<p class="footer-note" style="margin:0 0 3px;font-family:${FONT};font-size:13px;line-height:21px;font-weight:700;color:#555555;">Manage your waitlist</p>
<p style="margin:0;">${footerLink("Unsubscribe", links.unsubscribe)}${footerLink("Delete my waitlist data", links.deletion)}<br>${footerLink("Privacy policy", privacy)}${footerLink("Contact us", contact)}</p>
${postalFooter}
</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
<p class="footer-note" style="margin:22px 0 0;font-family:${FONT};font-size:12px;line-height:20px;color:#777777;">Imladri · A better reason to leave.</p>
</td></tr></table></body></html>`;
}
