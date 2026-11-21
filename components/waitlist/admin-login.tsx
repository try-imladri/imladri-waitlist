"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage, SiteHeader } from "./shared";

type CodeRequest = { ok: boolean; message: string; expiresIn: number; resendAfter: number };

export function AdminLogin() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState<"request" | "verify" | "">("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [expiresIn, setExpiresIn] = useState(600);
  const [resendAt, setResendAt] = useState(0);
  const [remaining, setRemaining] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const update = () => setRemaining(Math.max(0, Math.ceil((resendAt - Date.now()) / 1000)));
    update(); const timer = window.setInterval(update, 1000); document.addEventListener("visibilitychange", update);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", update); };
  }, [resendAt]);
  useEffect(() => { if (step === "code") codeInput.current?.focus({ preventScroll: true }); }, [step]);
  async function requestCode(event?: FormEvent) {
    event?.preventDefault(); setBusy("request"); setError("");
    try {
      const result = await api<CodeRequest>("/api/admin/auth/request", { method: "POST", body: JSON.stringify({ email: email.trim() }) });
      setEmail(email.trim()); setMessage(result.message || "If this email is authorized, a sign-in code is on its way."); setExpiresIn(result.expiresIn || 600); setResendAt(Date.now() + (result.resendAfter || 60) * 1000); setCode(""); setStep("code");
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(""); }
  }
  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("verify"); setError("");
    try { await api("/api/admin/auth/verify", { method: "POST", body: JSON.stringify({ email, code }) }); window.location.assign("/admin"); }
    catch (e) { setError(errorMessage(e)); setBusy(""); }
  }
  function changeEmail() { setStep("email"); setCode(""); setError(""); setMessage(""); setResendAt(0); }
  return <div className="site-shell"><SiteHeader admin/><main id="main" className="site-main admin-page"><section className="access-card" aria-labelledby="owner-signin-title"><div className="overline">Private owner dashboard</div><h1 id="owner-signin-title" style={{ marginTop: 12 }}>Owner sign in.</h1>
    {step === "email" ? <><p>Enter your owner email address to receive a one-time sign-in code.</p><form onSubmit={requestCode}><div className="field"><label htmlFor="owner-email">Email address</label><input id="owner-email" name="email" type="email" autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} required /></div><button type="submit" className="button spacer-top" disabled={!!busy}>{busy === "request" ? "Requesting code…" : "Email me a sign-in code"}</button></form></> : <><p className="notice" role="status">{message}</p><form onSubmit={verifyCode}><div className="field"><label htmlFor="owner-code">8-digit sign-in code</label><input ref={codeInput} id="owner-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))} style={{ letterSpacing: ".22em", fontSize: 20 }} required aria-describedby="code-help"/><small id="code-help">Codes expire after {Math.ceil(expiresIn / 60)} minutes. Use the latest code sent to {email}.</small></div><button type="submit" className="button spacer-top" disabled={!!busy}>{busy === "verify" ? "Signing in…" : "Sign in"}</button></form><div style={{ display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap", marginTop: 20 }}><button type="button" className="text-button" style={{ fontSize: 14 }} onClick={() => requestCode()} disabled={!!busy || remaining > 0}>{busy === "request" ? "Requesting…" : remaining > 0 ? `Resend code in ${remaining}s` : "Resend code"}</button><button type="button" className="text-button" style={{ fontSize: 14 }} onClick={changeEmail} disabled={!!busy}>Use a different email</button></div></>}
    {error && <p className="form-error" role="alert">{error}</p>}<p style={{ marginTop: 26, marginBottom: 0 }}><a href="/">Back to Imladri</a></p>
  </section></main></div>;
}
