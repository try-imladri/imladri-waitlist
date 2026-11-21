"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage, PageShell } from "./shared";

type Receipt = { firstName: string; city: string; referralCode: string; referralUrl: string; referralCount: number; emailStatus: string };

export function ThankYou() {
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const link = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token");
    let active = true;
    api<Receipt>(`/api/waitlist/status${token ? `?token=${encodeURIComponent(token)}` : ""}`).then(data => { if (active) setReceipt(data); }).catch(() => { if (active) setError("We couldn’t open your confirmation in this browser. Your welcome email has your referral link to share. Use Contact us below if you need help with your signup."); });
    return () => { active = false; };
  }, []);
  async function copyLink() {
    if (!receipt) return;
    try { await navigator.clipboard.writeText(receipt.referralUrl); setCopied("Link copied."); } catch { link.current?.focus(); link.current?.select(); setCopied("Link selected. Copy it to share."); }
  }
  return <PageShell><section className="content-page"><div className="overline">You’re in good company.</div><h1 className="page-title">You’re on the list.</h1><p className="page-lead">We’ll email you with updates as we build, and let you know when Imladri is ready. In the meantime, you can invite friends who are ready for dating without the swiping.</p>
    {error ? <div className="notice" role="status">{error}</div> : !receipt ? <p className="quiet-state" role="status">Loading your confirmation…</p> : <>
      <div className="message-card"><span className="overline">A little less swiping, together.</span><h2 className="spacer-top">Your link to share.</h2><p>Send it to a friend. We’ll count the people who join through your link.</p><div className="referral-field"><label className="sr-only" htmlFor="referral-link">Your referral link</label><input ref={link} id="referral-link" readOnly value={receipt.referralUrl} onFocus={e => e.target.select()} /><button type="button" className="button small" onClick={copyLink}>Copy link</button></div><p className="quiet-state" aria-live="polite">{copied || "Your link contains no name or email address."}</p><div className="referral-number">{receipt.referralCount.toLocaleString()}</div><p className="quiet-state">{receipt.referralCount === 1 ? "friend has" : "friends have"} joined through your link.</p></div>
      <p className="notice">{receipt.emailStatus === "sent" ? "Your welcome email has been sent. If it’s not in your inbox, check your spam folder." : receipt.emailStatus === "failed" ? "Your signup is saved. We’re having trouble delivering the welcome email and will retry it." : "Your signup is saved and your welcome email is on its way."}</p>
    </>}
    <p><a href="/">Back to Imladri</a></p></section></PageShell>;
}

export function PreferenceAction({ kind }: { kind: "unsubscribe" | "delete" }) {
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const found = new URLSearchParams(location.search).get("token") || "";
    setToken(found);
    if (!found) { setChecking(false); return; }
    let active = true;
    api(`/api/waitlist/${kind === "delete" ? "delete" : "unsubscribe"}?token=${encodeURIComponent(found)}`).then(() => { if (active) setReady(true); }).catch(() => { if (active) setError("This link is invalid or has expired. Please request a new link or contact us."); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [kind]);
  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api(`/api/waitlist/${kind === "delete" ? "delete" : "unsubscribe"}`, { method: "POST", body: JSON.stringify({ token }) }); setDone(true); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function requestDeletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const email = String(new FormData(event.currentTarget).get("email") || "").trim();
    try { await api("/api/waitlist/delete-request", { method: "POST", body: JSON.stringify({ email }) }); setRequested(true); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const deleting = kind === "delete";
  return <PageShell><section className="content-page"><div className="overline">Your data. Your choice.</div><h1 className="page-title">{done ? deleting ? "Your data is deleted." : "You’re unsubscribed." : deleting ? "Delete your waitlist data." : "Unsubscribe."}</h1>
    {done ? <p className="page-lead">{deleting ? "Your waitlist signup and its personal details have been removed. You won’t receive further waitlist emails." : "You won’t receive further Imladri waitlist emails. Your request has taken effect immediately."}</p> : checking ? <p className="quiet-state" role="status">Checking your link…</p> : ready ? <form className="message-card" onSubmit={confirm}><p>{deleting ? "This permanently removes your waitlist signup and personal details, and stops future waitlist emails." : "Stop receiving Imladri waitlist emails. You can delete your waitlist data separately at any time."}</p>{deleting && <label className="consent"><input type="checkbox" required/><span>I understand this permanently deletes my waitlist data.</span></label>}<button type="submit" className="button spacer-top" disabled={busy}>{busy ? "Saving…" : deleting ? "Delete my waitlist data" : "Unsubscribe from emails"}</button></form> : deleting ? requested ? <p className="notice" role="status">If this email is on our waitlist, we’ll send a secure deletion link. Please check your inbox and spam folder.</p> : <form className="message-card" onSubmit={requestDeletion}><p>Enter the email address you used to join. We’ll email you a secure link so only you can confirm deletion.</p><div className="field"><label htmlFor="deletion-email">Email address</label><input id="deletion-email" type="email" name="email" autoComplete="email" maxLength={254} required /></div><button type="submit" className="button spacer-top" disabled={busy}>{busy ? "Requesting…" : "Email me a deletion link"}</button></form> : <p className="notice">Open the unsubscribe link in any Imladri waitlist email. If you can’t find it, <a href="/contact">Contact us</a>.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}<p><a href="/privacy">Read the privacy policy</a>{!deleting && <> · <a href="/delete-data">Delete my data</a></>}</p><p><a href="/">Back to Imladri</a></p></section></PageShell>;
}
