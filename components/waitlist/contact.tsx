"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage, PageShell } from "./shared";

export const CONTACT_CATEGORIES = ["Privacy", "Partnership", "Suggestions", "Support", "Feedback", "Other"] as const;
type ContactReceipt = { ok: boolean; reference: string; message: string };

export function ContactUs() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requestConflict, setRequestConflict] = useState(false);
  const [receipt, setReceipt] = useState<ContactReceipt | null>(null);
  const [category, setCategory] = useState("");
  const requestId = useRef("");
  const requestPayload = useRef("");
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const result = useRef<HTMLDivElement>(null);
  useEffect(() => {
    mounted.current = true;
    const requested = new URLSearchParams(window.location.search).get("category");
    if (CONTACT_CATEGORIES.some(value => value === requested)) setCategory(requested!);
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { if (receipt) result.current?.focus(); }, [receipt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const values = new FormData(event.currentTarget);
    const payload = {
      name: String(values.get("name") || "").trim(),
      email: String(values.get("email") || "").trim(),
      category: String(values.get("category") || ""),
      subject: String(values.get("subject") || "").trim(),
      message: String(values.get("message") || "").trim(),
      website: String(values.get("website") || ""),
    };
    if (!payload.name || !payload.subject || !payload.message) { setError("Please complete your name, subject, and message."); return; }
    const signature = JSON.stringify(payload);
    if (!requestId.current || requestPayload.current !== signature) { requestId.current = crypto.randomUUID(); requestPayload.current = signature; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const response = await api<ContactReceipt>("/api/contact/messages", { method: "POST", body: JSON.stringify({ ...payload, clientRequestId: requestId.current }) });
      if (!response.ok || typeof response.reference !== "string" || !response.reference) throw new Error("We couldn’t confirm your message. Please try again.");
      if (mounted.current) { setReceipt(response); requestId.current = ""; requestPayload.current = ""; }
    } catch (e) { if (mounted.current) { setError(errorMessage(e)); setRequestConflict((e as { status?: number }).status === 409); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  }

  return <PageShell><section className="contact-page">
    <a href="/" className="join-back">Back to Imladri</a>
    <div className="contact-intro"><h1 className="page-title">Contact us.</h1><p>A question, an idea, or something we can help with? Send us a message.</p></div>
    <div className="contact-card">{receipt ? <div className="contact-receipt" ref={result} tabIndex={-1} role="status">
      <div className="overline">Message received</div><h2>Thanks for getting in touch.</h2><p>Your message is saved privately. We’ll use the email address you provided if we need to get back to you.</p>
      <p className="contact-reference">Your reference <strong>{receipt.reference}</strong></p>
      <button type="button" className="button secondary" onClick={() => { setReceipt(null); setError(""); setCategory(""); requestId.current = ""; requestPayload.current = ""; setRequestConflict(false); }}>Send another message</button>
    </div> : <form className="contact-form" onSubmit={submit} aria-busy={busy}>
      <fieldset disabled={busy} className="contact-fields"><legend className="sr-only">Your message to Imladri</legend>
        <div className="field"><label htmlFor="contact-name">Name</label><input id="contact-name" name="name" autoComplete="name" maxLength={80} required /></div>
        <div className="field"><label htmlFor="contact-email">Email address</label><input id="contact-email" name="email" type="email" autoComplete="email" maxLength={254} required /></div>
        <div className="field"><label htmlFor="contact-category">Category</label><select id="contact-category" name="category" value={category} onChange={event => setCategory(event.target.value)} required><option value="">Choose a category</option>{CONTACT_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></div>
        <div className="field contact-full"><label htmlFor="contact-subject">Subject</label><input id="contact-subject" name="subject" maxLength={160} required /></div>
        <div className="field contact-full"><label htmlFor="contact-message">Message</label><textarea id="contact-message" name="message" rows={5} maxLength={5000} required /></div>
        <div className="hp-field" aria-hidden="true"><label htmlFor="contact-website">Website</label><input id="contact-website" name="website" tabIndex={-1} autoComplete="off" /></div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      {requestConflict && <button type="button" className="text-button spacer-top" onClick={() => { requestId.current = ""; requestPayload.current = ""; setRequestConflict(false); setError(""); }}>Start a new message with these details</button>}
      <div className="contact-form-bottom"><p>We’ll use your details to handle your message. Sending a message doesn’t join the waitlist. <a href="/privacy">Read the privacy policy</a>.</p><button type="submit" className="button" disabled={busy}>{busy ? "Sending your message…" : "Send message"}</button></div>
    </form>}</div>
  </section></PageShell>;
}
