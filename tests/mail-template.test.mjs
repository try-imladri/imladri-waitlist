import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const root = path.resolve(import.meta.dirname, "..");
const previews = path.join(root, "outputs", "launch-readiness", "email-preview");
const runtime = path.join(previews, "runtime");
await mkdir(runtime, { recursive: true });
for (const name of await readdir(path.join(root, "lib", "waitlist"))) {
  if (!name.endsWith(".ts")) continue;
  const source = await readFile(path.join(root, "lib", "waitlist", name), "utf8");
  await writeFile(path.join(runtime, name.replace(/\.ts$/, ".js")), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText);
}
const { renderBrandedEmail, escapeEmailHtml } = await import(pathToFileURL(path.join(runtime, "email-template.js")).href);
const { welcomeBody, messageFor } = await import(pathToFileURL(path.join(runtime, "mail.js")).href);
const origin = "https://imladri.com";
const footer = `\n\n—\nYou're receiving this because you joined the Imladri waitlist and agreed to launch updates.\nUnsubscribe: ${origin}/unsubscribe?preview=email\nDelete your waitlist data: ${origin}/delete-data?preview=email\nPrivacy policy: ${origin}/privacy\nContact us: ${origin}/contact`;
const fixtures = [
  { kind: "welcome", subject: "You're on the list", text: welcomeBody("Alex", "Chicago", `${origin}/?ref=preview-referral`) + footer },
  { kind: "monthly", subject: "An honest update from Imladri", text: "Hi Alex,\n\nThis is sample copy for a monthly update: what we’ve built, what we’ve learned, and what comes next.\n\nThanks for being here while we build something more thoughtful.\n\nOsama" + footer },
  { kind: "launch", subject: "An Imladri launch update", text: "Hi Alex,\n\nThis is sample copy for a launch update. A real message will include only the details and dates we have committed to.\n\nWe’ll keep you posted.\n\nOsama" + footer },
  { kind: "delete-request", subject: "Delete your Imladri waitlist data", text: `Hi Alex,\n\nYou requested a link to delete your Imladri waitlist data. Open this link and confirm deletion:\n${origin}/delete-data?token=preview-not-a-real-token\n\nThis link expires in seven days. If you didn't request it, you can ignore this email.\n\nOsama` + footer },
].map(fixture => ({ ...fixture, origin, preview: true }));
for (const fixture of fixtures) {
  await writeFile(path.join(previews, fixture.kind + ".html"), renderBrandedEmail(fixture));
  await writeFile(path.join(previews, fixture.kind + ".txt"), "PREVIEW / TEST EMAIL — fictional recipient Alex. No signup was created.\n\n" + fixture.text + "\n");
}
await writeFile(path.join(previews, "render-data.json"), JSON.stringify({ fictional: true, noMessagesSent: true, recipient: "alex@example.com", fixtures }, null, 2) + "\n");
await writeFile(path.join(previews, "index.html"), `<!doctype html><html lang="en"><meta charset="utf-8"><title>Imladri email previews</title><body style="font-family:Arial,sans-serif;padding:30px"><h1>Imladri email previews</h1><p>Fictional examples only. No signup or email delivery occurs.</p><ul>${fixtures.map(f => `<li><a href="${f.kind}.html">${f.kind}</a> · <a href="${f.kind}.txt">plain text</a></li>`).join("")}</ul></body></html>`);

function hrefs(html) { return [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, "&")); }

test("existing welcome contract renders real referral and signed management links safely", async () => {
  const referral = `${origin}/?ref=fixture-referral&source=sample`;
  const env = { WAITLIST_SIGNING_KEY: "test-only-template-signing-key-long-enough", SITE_BASE_URL: origin };
  const row = { id: "fictional-signup-for-template-tests" };
  const person = { email: "alex@example.com" };
  const message = await messageFor(row, person, new Request(origin), env, "You're on the list", welcomeBody("Alex & Casey", "Chicago", referral));
  const plaintextBefore = message.text;
  const html = renderBrandedEmail({ ...message, kind: "welcome", origin });
  const links = hrefs(html);
  assert.ok(links.includes(referral));
  assert.ok(links.some(url => url.startsWith(origin + "/unsubscribe?token=")));
  assert.ok(links.some(url => url.startsWith(origin + "/delete-data?token=")));
  assert.ok(links.includes(origin + "/privacy") && links.includes(origin + "/contact"));
  assert.ok(html.includes('alt="Imladri"'));
  assert.ok(html.includes(origin + "/assets/brand/email/hotlink-ok/imladri-email-lockup-black-v2.png"));
  assert.ok(html.includes("Alex &amp; Casey") && html.includes("Open your invite link"));
  assert.equal(message.text, plaintextBefore);
  assert.ok(!html.includes("PREVIEW / TEST EMAIL"));
  assert.ok(!/\$19|minimum signups|enough people|signup cap/i.test(html));
});

test("all existing outbox kinds share an accessible600px table wrapper and plain-text previews", async () => {
  for (const fixture of fixtures) {
    const html = renderBrandedEmail(fixture);
    assert.ok(html.startsWith("<!doctype html>"));
    assert.ok(html.includes('<html lang="en">'));
    assert.ok(html.includes('role="presentation"') && html.includes("max-width:600px"));
    assert.ok(html.includes('<meta name="color-scheme" content="light only">'));
    assert.ok(html.includes('<meta name="supported-color-schemes" content="light">'));
    assert.ok(html.includes(':root{color-scheme:light only;supported-color-schemes:light}'));
    assert.ok(!/prefers-color-scheme:dark|\[data-ogsc\]/.test(html));
    assert.ok(html.includes('background-image:linear-gradient(#ffffff,#ffffff)'));
    assert.ok(html.includes('@media screen and (max-width:620px)'));
    assert.ok(html.includes("PREVIEW / TEST EMAIL"));
    assert.ok(html.includes("Contact us") && html.includes("Privacy policy"));
    assert.ok(Buffer.byteLength(html) < 50000, fixture.kind + " should remain small");
    assert.ok((await readFile(path.join(previews, fixture.kind + ".txt"), "utf8")).includes("No signup was created"));
  }
});

test("subject, names and arbitrary campaign markup are escaped; only valid HTTP links become anchors", () => {
  const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
  const html = renderBrandedEmail({ subject: hostile, text: `Hi ${hostile},\n\njavascript:alert(3)\n\nhttps://user:password@example.com/private\n\nhttps://example.com/?a=1&b=2` + footer, kind: "monthly", origin });
  assert.ok(!html.includes("<script>") && !html.includes("<img src=x"));
  assert.ok(html.includes("&lt;script&gt;") && html.includes("&lt;img"));
  assert.ok(hrefs(html).every(url => /^https?:\/\//.test(url)));
  assert.ok(!hrefs(html).some(url => url.includes("user:password")));
  assert.ok(hrefs(html).includes("https://example.com/?a=1&b=2"));
  assert.equal(escapeEmailHtml("<&\"'>"), "&lt;&amp;&quot;&#39;&gt;");
});

test("the appended real footer wins over lookalike body labels", () => {
  const body = "Hi Alex,\n\n—\nUnsubscribe: https://example.net/not-the-real-footer\n\nA note from the founder.";
  const html = renderBrandedEmail({ subject: "Update", text: body + footer, kind: "monthly", origin });
  assert.match(html, /href="https:\/\/imladri\.com\/unsubscribe\?preview=email"[^>]*>Unsubscribe<\/a>/);
  assert.match(html, /href="https:\/\/imladri\.com\/delete-data\?preview=email"[^>]*>Delete my waitlist data<\/a>/);
});

test("deletion CTA uses the actual request link and requires review on the existing page", () => {
  const fixture = fixtures.find(item => item.kind === "delete-request");
  const html = renderBrandedEmail(fixture);
  assert.match(html, /href="https:\/\/imladri\.com\/delete-data\?token=preview-not-a-real-token"[^>]*>Review deletion request<\/a>/);
  assert.ok(html.includes("Opening this link won’t delete anything."));
  assert.ok(html.includes("You’ll review and confirm on the website."));
  assert.ok(!html.includes("Open your invite link"));
});

test("legacy plaintext-only payloads render without new required fields or invented signed actions", () => {
  const html = renderBrandedEmail({ subject: "An update", text: "A legacy message.\n\nRead https://imladri.com/ for more.", origin });
  assert.ok(html.includes("A legacy message."));
  assert.ok(hrefs(html).includes(origin + "/privacy"));
  assert.ok(!html.includes("/unsubscribe?token="));
  assert.ok(!html.includes("/delete-data?token="));
});

test("brand artwork is a small email-safe PNG rather than external fonts or executable content", async () => {
  const filename = path.join(root, "public", "assets", "brand", "email", "hotlink-ok", "imladri-email-lockup-black-v2.png");
  const image = await readFile(filename);
  assert.equal(image.subarray(1, 4).toString(), "PNG");
  assert.equal(image.readUInt32BE(16), 432);
  assert.equal(image.readUInt32BE(20), 128);
  assert.ok((await stat(filename)).size < 50000);
  const html = renderBrandedEmail(fixtures[0]);
  assert.ok(!/@font-face|<script|<iframe|fonts\.googleapis/i.test(html));
});

test("optional mailing address is escaped and preserves lines, with no invented fallback", () => {
  const address = 'TEST ONLY & <script>alert("address")</script>\n<Example unit>';
  const input = { ...fixtures[0], preview: false, postalAddress: address };
  const html = renderBrandedEmail(input);
  assert.ok(html.includes("Business mailing address:<br>TEST ONLY &amp; &lt;script&gt;alert(&quot;address&quot;)&lt;/script&gt;<br>&lt;Example unit&gt;"));
  assert.ok(!html.includes('<script>alert("address")</script>'));
  assert.equal((html.match(/Business mailing address:/g) || []).length, 1);
  for (const postalAddress of [undefined, "", " \n "]) assert.ok(!renderBrandedEmail({ ...fixtures[0], postalAddress }).includes("Business mailing address:"));
  assert.equal(input.postalAddress, address);
});
