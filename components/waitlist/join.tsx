"use client";

import { useEffect, useState } from "react";
import { api, DEFAULT_OPTIONS, PageShell, readAttribution, type PublicConfig } from "./shared";
import { SignupForm } from "./signup-form";

export function JoinWaitlist() {
  const [options, setOptions] = useState<PublicConfig>(DEFAULT_OPTIONS);
  useEffect(() => {
    let active = true;
    api<PublicConfig>("/api/public/config").then(data => { if (active) setOptions({ ...DEFAULT_OPTIONS, ...data }); }).catch(() => {});
    const attribution = readAttribution();
    void api("/api/analytics/visit", { method: "POST", body: JSON.stringify(attribution) }).catch(() => {});
    return () => { active = false; };
  }, []);
  return <PageShell><section className="join-page"><a href="/" className="join-back">Back to Imladri</a><div className="join-intro"><div className="overline">Less swiping. More possibility.</div><h1 className="page-title">Join the waitlist.</h1><p>Every city is welcome. Tell us a little about yourself, and we’ll keep you posted as we build.</p></div><div className="join-card"><SignupForm options={options}/></div></section></PageShell>;
}
