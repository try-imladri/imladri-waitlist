"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "./shared";

type EmailPreview = { recipient: string; subject: string; text: string; html: string; postalAddressConfigured: boolean };

export function EmailPreviewFrame({ html, title }: { html: string; title: string }) {
  return <iframe title={title} srcDoc={html} sandbox="" referrerPolicy="no-referrer" style={{ display: "block", width: "100%", height: 840, border: "1px solid var(--line)", borderRadius: 12, background: "#f4f4f2" }} />;
}

export function EmailTemplatePreview({ onDenied }: { onDenied: () => void }) {
  const [preview, setPreview] = useState<EmailPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const requestId = useRef("");

  function denied(value: unknown) {
    const status = (value as { status?: number })?.status;
    if (status === 401 || status === 403) { onDenied(); return true; }
    return false;
  }

  async function load() {
    setLoading(true); setError("");
    try { setPreview(await api<EmailPreview>("/api/admin/emails/preview")); }
    catch (value) { if (!denied(value)) setError(errorMessage(value)); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void api<EmailPreview>("/api/admin/emails/preview").then(result => { if (active) setPreview(result); }).catch(value => {
      if (!active) return;
      const status = (value as { status?: number })?.status;
      if (status === 401 || status === 403) onDenied(); else setError(errorMessage(value));
    });
    return () => { active = false; };
  }, [onDenied]);

  async function sendTest() {
    setSending(true); setError(""); setFeedback("");
    requestId.current ||= crypto.randomUUID();
    try {
      const result = await api<{ recipient: string; emailId: string }>("/api/admin/emails/test", { method: "POST", body: JSON.stringify({ requestId: requestId.current }) });
      setFeedback(`Test email accepted for delivery to ${result.recipient}. Check your inbox. This sample does not create a signup.`);
      requestId.current = "";
    } catch (value) { if (!denied(value)) setError(errorMessage(value)); }
    finally { setSending(false); }
  }

  return <section className="admin-panel" aria-labelledby="signup-email-preview-title">
    <div className="panel-heading"><div><h2 id="signup-email-preview-title">Signup confirmation email</h2><p>The same branded template new signups receive, shown with sample details.</p></div><button type="button" className="button secondary small" onClick={load} disabled={loading || sending}>{loading ? "Loading…" : "Refresh preview"}</button></div>
    <div className="admin-panel-body">
      {preview && !preview.postalAddressConfigured && <p className="notice">Your business mailing address has not been set for email footers. Add it before sending promotional updates.</p>}
      {preview && <><p className="helper">Subject: <strong>{preview.subject}</strong><br/>Test recipient: {preview.recipient}</p><EmailPreviewFrame html={preview.html} title="Branded signup confirmation email preview" /><details className="spacer-top"><summary>Plain-text version</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: 14, lineHeight: 1.7 }}>{preview.text}</pre></details></>}
      {!preview && !error && <p className="helper" role="status">Loading the signup email preview…</p>}
      <button type="button" className="button small spacer-top" onClick={sendTest} disabled={!preview || loading || sending}>{sending ? "Sending test…" : "Send test to my inbox"}</button>
      <p className="helper">Only your signed-in owner address receives a test. No subscribers are contacted.</p>
      {feedback && <p className="form-success" role="status">{feedback}</p>}{error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </section>;
}
