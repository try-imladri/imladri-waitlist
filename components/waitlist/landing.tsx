"use client";

import { useEffect, useState } from "react";
import { api, CheckIcon, readAttribution, SiteFooter, SiteHeader } from "./shared";

function WalkingCouple() {
  const [motion, setMotion] = useState(false);
  useEffect(() => {
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setMotion(!preference.matches && document.visibilityState !== "hidden");
    update(); preference.addEventListener("change", update); document.addEventListener("visibilitychange", update);
    return () => { preference.removeEventListener("change", update); document.removeEventListener("visibilitychange", update); };
  }, []);
  const file = `couple-walk${motion ? "" : "-still"}.${motion ? "webp" : "png"}`;
  return <div className="hero-art" aria-hidden="true"><img src={`/assets/img/${file}`} width={411} height={454} alt="" className="hero-people" fetchPriority="high"/><span className="hero-shadow"/></div>;
}


export function Landing() {
  useEffect(() => {
    const attribution = readAttribution();
    void api("/api/analytics/visit", { method: "POST", body: JSON.stringify(attribution) }).catch(() => {});
  }, []);
  return <div className="site-shell landing-shell"><SiteHeader /><main id="main" className="site-main landing-main">
    <section className="hero" aria-labelledby="hero-title"><WalkingCouple /><div className="hero-copy"><div className="overline">A better reason to leave.</div><h1 id="hero-title" className="hero-title">Dating without the swiping.</h1><p className="hero-subline">A few compatible matches a week, picked from your answers. We want you to leave.</p><ul className="hero-points"><li><CheckIcon/><span>No swiping. You answer questions and we match you on compatibility.</span></li><li><CheckIcon/><span>Every match comes with a reason, so you know why you were matched.</span></li><li><CheckIcon/><span>No paywalls on who likes you, and no pay-to-be-seen tricks.</span></li></ul><a className="button hero-button" href="/join" onClick={() => { readAttribution(); }}>Join the waitlist</a><p className="cta-note">Join from any city. We’ll keep you posted as we build.</p></div></section>
  </main><SiteFooter/></div>;
}
