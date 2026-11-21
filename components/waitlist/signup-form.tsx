"use client";

import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage, readAttribution, type PublicConfig } from "./shared";

export function SignupForm({ options }: { options: PublicConfig }) {
  const [city, setCity] = useState("");
  const [gender, setGender] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const interestedGroup = useRef<HTMLFieldSetElement>(null);
  const detailCount = 3 + Number(city === "Other") + Number(gender === "Prefer to self-describe");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const values = new FormData(event.currentTarget);
    const interestedIn = values.getAll("interestedIn").map(String);
    if (!interestedIn.length) { setError("Choose at least one option for who you’re interested in meeting."); interestedGroup.current?.focus(); return; }
    setBusy(true);
    try {
      await api("/api/waitlist/signup", { method: "POST", body: JSON.stringify({
        firstName: String(values.get("firstName") || "").trim(), email: String(values.get("email") || "").trim(),
        city, otherCity: String(values.get("otherCity") || "").trim(), ageRange: String(values.get("ageRange") || ""),
        adultConfirmed: values.get("adultConfirmed") === "on", gender, genderDescription: String(values.get("genderDescription") || "").trim(),
        interestedIn, lookingFor: String(values.get("lookingFor") || ""), source: String(values.get("source") || ""),
        emailConsent: values.get("emailConsent") === "on", website: String(values.get("website") || ""), ...readAttribution(),
      }) });
      window.location.assign("/thanks");
    } catch (e) { setError(errorMessage(e)); setBusy(false); }
  }
  return <form className="signup-form" onSubmit={submit}>
    <div className="form-grid">
      <div className="field"><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" autoComplete="given-name" maxLength={80} required /></div>
      <div className="field"><label htmlFor="email">Email address</label><input id="email" name="email" type="email" autoComplete="email" maxLength={254} required /></div>
      <div className="field"><label htmlFor="city">City</label><select id="city" name="city" value={city} onChange={e => setCity(e.target.value)} required><option value="">Choose your city</option>{options.cities.map(value => <option key={value}>{value}</option>)}<option value="Other">Other city</option></select></div>
      <div className="field"><label htmlFor="ageRange">Age range</label><select id="ageRange" name="ageRange" required defaultValue=""><option value="">Choose your age range</option>{options.ageRanges.map(value => <option key={value}>{value}</option>)}</select></div>
    </div>
    <div className={`signup-details-grid signup-details-${detailCount}`}>
      {city === "Other" && <div className="field"><label htmlFor="otherCity">Your city</label><input id="otherCity" name="otherCity" maxLength={100} autoComplete="address-level2" placeholder="City, state or country" required /></div>}
      <div className="field"><label htmlFor="gender">My gender</label><select id="gender" name="gender" value={gender} onChange={e => setGender(e.target.value)} required><option value="">Choose an option</option>{options.genders.map(value => <option key={value}>{value}</option>)}</select></div>
      {gender === "Prefer to self-describe" && <div className="field"><label htmlFor="genderDescription">How you describe your gender</label><input id="genderDescription" name="genderDescription" maxLength={80} required /></div>}
      <div className="field"><label htmlFor="lookingFor">Looking for <span className="helper">(optional)</span></label><select id="lookingFor" name="lookingFor" defaultValue=""><option value="">Choose an option</option>{options.lookingFor.map(value => <option key={value}>{value}</option>)}</select></div>
      <div className="field"><label htmlFor="source">Heard about us <span className="helper">(optional)</span></label><select id="source" name="source" defaultValue=""><option value="">Choose an option</option>{options.sources.map(value => <option key={value}>{value}</option>)}</select></div>
      <fieldset className="field signup-interests" ref={interestedGroup} tabIndex={-1}><legend>Interested in meeting <span className="helper">— choose all that apply</span></legend><div className="choice-row">{options.interestedIn.map(value => <label className="choice" key={value}><input type="checkbox" name="interestedIn" value={value} />{value}</label>)}</div></fieldset>
    </div>
    <div className="hp-field" aria-hidden="true"><label htmlFor="website">Website</label><input id="website" name="website" tabIndex={-1} autoComplete="off" /></div>
    <div className="signup-consents"><label className="consent"><input type="checkbox" name="adultConfirmed" required/><span>I confirm I am 18 or older.</span></label>
    <label className="consent"><input type="checkbox" name="emailConsent" required/><span>I agree to receive updates about the launch. I can unsubscribe at any time.</span></label></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="signup-bottom-row"><p className="privacy-note">We never sell your data or show your answers to anyone. Gender and meeting preferences help us understand our community. <a href="/privacy" target="_blank" rel="noopener noreferrer">Read the privacy policy</a>.</p>
    <button className="button form-submit" type="submit" disabled={busy}>{busy ? "Joining the list…" : "Join the waitlist"}</button></div>
  </form>;
}

