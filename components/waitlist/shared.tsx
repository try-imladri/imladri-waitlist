"use client";

import { useEffect, useState, type ReactNode } from "react";

export function CheckIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>; }
export function CloseIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>; }

export function useSiteTheme() {
  const [theme, setTheme] = useState("light");
  useEffect(() => { setTheme(document.documentElement.dataset.theme || "light"); }, []);
  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("imladri-theme", next); } catch {}
    setTheme(next);
    window.dispatchEvent(new Event("imladri-theme-change"));
  }
  useEffect(() => {
    const sync = () => setTheme(document.documentElement.dataset.theme || "light");
    window.addEventListener("imladri-theme-change", sync);
    return () => window.removeEventListener("imladri-theme-change", sync);
  }, []);
  return { theme, toggle };
}

export function Brand({ note = false }: { note?: boolean }) {
  return <a className="brand" href="/" aria-label="Imladri home"><img src="/assets/brand/two-faces-v3/logo-512.png" alt="" width={48} height={48} /><span className="brand-name">Imladri</span>{note && <span className="brand-note">Dating, without the swiping.</span>}</a>;
}

export function SiteHeader({ admin = false }: { admin?: boolean }) {
  const { theme, toggle } = useSiteTheme();
  return <><a className="skip" href="#main">Skip to content</a><header className="site-header"><div className="site-header-inner"><Brand /><div className="header-end">{admin && <span className="overline">Owner dashboard</span>}<button type="button" className="theme-button" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg> : <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/></svg>}</button></div></div></header></>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div className="site-footer-inner"><span>© {new Date().getFullYear()} Imladri. A better reason to leave.</span><nav className="footer-links" aria-label="Footer"><a href="/privacy">Privacy policy</a><a href="/contact">Contact us</a><span>18+ only</span></nav></div></footer>;
}

export function PageShell({ children }: { children: ReactNode }) { return <div className="site-shell"><SiteHeader /><main id="main" className="site-main">{children}</main><SiteFooter /></div>; }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  // Access returns an authentication status for expired API sessions instead
  // of following an HTML sign-in redirect inside a dashboard data request.
  if (/^\/api\/admin(?:\/|$)/.test(path)) headers.set("X-Requested-With", "XMLHttpRequest");
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store", ...init, headers });
  if (typeof window !== "undefined" && response.redirected && response.url) {
    const requested = new URL(path, window.location.href);
    const destination = new URL(response.url, window.location.href);
    const adminRequest = requested.origin === window.location.origin && /^\/api\/admin(?:\/|$)/.test(requested.pathname);
    const redirectedHome = destination.origin === window.location.origin && destination.pathname === "/";
    if (adminRequest && redirectedHome && response.headers.get("content-type")?.toLowerCase().includes("text/html")) {
      window.location.replace("/");
      const error = new Error("Access is unavailable.") as Error & { status: number };
      error.status = 403;
      throw error;
    }
  }
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const message = typeof details.error === "string" ? details.error : typeof details.message === "string" ? details.message : "We couldn’t complete that request. Please try again.";
    const error = new Error(message) as Error & { status: number };
    error.status = response.status;
    throw error;
  }
  return data as T;
}

export function errorMessage(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Please try again."; }

export const DEFAULT_OPTIONS = {
  cities: ["Chicago", "New York", "Los Angeles", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego", "Dallas", "Jacksonville", "Fort Worth", "San Jose", "Austin", "Charlotte", "Columbus", "Indianapolis", "San Francisco", "Seattle", "Denver", "Oklahoma City", "Washington, DC"],
  ageRanges: ["18-24", "25-29", "30-34", "35-39", "40-49", "50+"],
  genders: ["Woman", "Man", "Non-binary", "Prefer to self-describe"],
  interestedIn: ["Women", "Men", "Non-binary people"],
  lookingFor: ["Long-term relationship", "Dating", "Not sure yet"],
  sources: ["TikTok", "Friend", "Other"],
};

export type PublicConfig = typeof DEFAULT_OPTIONS & { appName?: string; contactEmail?: string; price?: number; noLaunchRestrictions?: boolean };
export type Attribution = { sessionId: string; referralCode: string; utmSource: string; utmMedium: string; utmCampaign: string; utmContent: string; utmTerm: string; referrer: string };
export function readAttribution(): Attribution {
  const empty = { sessionId: "", referralCode: "", utmSource: "", utmMedium: "", utmCampaign: "", utmContent: "", utmTerm: "", referrer: "" };
  if (typeof window === "undefined") return empty;
  let previous: Partial<Attribution> = {};
  try { const saved = JSON.parse(sessionStorage.getItem("imladri-attribution") || "{}"); if (saved && typeof saved === "object" && !Array.isArray(saved)) previous = saved; } catch {}
  const query = new URLSearchParams(window.location.search);
  const field = (name: string, old?: string) => String(query.get(name) || old || "").slice(0, 200);
  let referrer = previous.referrer || "";
  if (!referrer && document.referrer) { try { const u = new URL(document.referrer); if (u.origin !== location.origin) referrer = u.origin; } catch {} }
  const value: Attribution = { sessionId: previous.sessionId || crypto.randomUUID(), referralCode: field("ref", previous.referralCode), utmSource: field("utm_source", previous.utmSource), utmMedium: field("utm_medium", previous.utmMedium), utmCampaign: field("utm_campaign", previous.utmCampaign), utmContent: field("utm_content", previous.utmContent), utmTerm: field("utm_term", previous.utmTerm), referrer };
  try { sessionStorage.setItem("imladri-attribution", JSON.stringify(value)); } catch {}
  return value;
}
