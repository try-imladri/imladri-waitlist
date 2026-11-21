"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { api, DEFAULT_OPTIONS, errorMessage, SiteHeader } from "./shared";
import { useAdminResource } from "./admin-resource";
import { AdminMessagesPanel } from "./admin-contact-panel";
import { EmailTemplatePreview, EmailPreviewFrame } from "./admin-email-preview";

type Counts = Record<string, number>;
type City = { city: string; count: number; genderCounts: Counts; ageCounts: Counts; sourceCounts: Counts };
type Overview = { totals: { visitors: number; signups: number; active: number; unsubscribed: number }; conversionRate: number; cities: City[]; sources: { source: string; count: number }[]; utmCampaigns: { campaign: string; content: string; source: string; count: number }[]; referrals: { referralCode: string; city: string; count: number }[]; daily: { date: string; visitors: number; signups: number }[]; email: { pending: number; sent: number; failed: number } };
type Signup = { id: string; firstName: string; email: string; city: string; ageRange: string; gender: string; genderDescription?: string; interestedIn: string[]; lookingFor?: string; source?: string; status: string; emailStatus: string; createdAt: string; consentAt: string; referralCode: string; referredBy?: string; referralCount?: number; utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string; referrer?: string; emailConsent?: boolean; adultConfirmed?: boolean };
type SignupPage = { items: Signup[]; total: number; page: number; pageSize: number };
type EmailItem = { id: string; type?: string; kind?: string; email?: string; to?: string; recipient?: string; subject?: string; status: string; attempts: number; error?: string; createdAt: string; sentAt?: string };
type EmailPage = { items: EmailItem[]; total?: number };
type Campaign = { type: "monthly" | "launch"; subject: string; body: string; city: string };
type CampaignPreview = { subject: string; body: string; html: string; recipientCount: number };
type CampaignProgress = { campaignId: string; total: number; queued: number; sent: number; failed: number; cancelled: number; queueComplete: boolean; idempotent: boolean; processed: number };
type CampaignRecord = CampaignProgress & { subject: string; type: string; city: string; createdAt: string };
type Filters = { q: string; city: string; gender: string; age: string; source: string; status: string };
const EMPTY_FILTERS: Filters = { q: "", city: "", gender: "", age: "", source: "", status: "" };
const number = (value: unknown) => Number(value || 0).toLocaleString();
const date = (value?: string) => value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
const countText = (counts?: Counts) => counts && Object.entries(counts).length ? Object.entries(counts).map(([label, count]) => `${label}: ${number(count)}`).join(" · ") : "—";
function queryFor(filters: Filters, page = 1) { const q = new URLSearchParams({ page: String(page), pageSize: "25" }); Object.entries(filters).forEach(([key, value]) => { if (value) q.set(key, value); }); return q.toString(); }

function Panel({ title, description, children, action }: { title: string; description?: string; children: ReactNode; action?: ReactNode }) { return <section className="admin-panel"><div className="panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>{children}</section>; }
function Status({ status }: { status: string }) { return <span className="status-tag" data-status={status}>{status}</span>; }
function Breakdown({ rows, empty = "No data yet." }: { rows: { label: string; count: number }[]; empty?: string }) {
  const max = Math.max(1, ...rows.map(row => row.count));
  return <div className="breakdown-list">{!rows.length ? <p className="quiet-state spacer-top">{empty}</p> : rows.map((row, i) => <div className="breakdown-item" key={`${row.label}-${i}`}><div className="breakdown-label"><span>{row.label || "Unspecified"}</span><strong>{number(row.count)}</strong></div><div className="breakdown-track"><div className="breakdown-fill" style={{ width: `${row.count / max * 100}%` }}/></div></div>)}</div>;
}

function ownerDenied(error: unknown) {
  const status = (error as { status?: number })?.status;
  return status === 401 || status === 403;
}

export function AdminDashboard({ ownerEmail }: { ownerEmail: string }) {
  const [tab, setTab] = useState("overview");
  const [openedTabs, setOpenedTabs] = useState(["overview"]);
  const [denied, setDenied] = useState(false);
  const [updated, setUpdated] = useState("");
  const [refreshRevision, setRefreshRevision] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [actionError, setActionError] = useState("");
  const accessDenied = useCallback(() => setDenied(true), []);
  const overviewLoaded = useCallback(() => {
    setUpdated(new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
    setRefreshRevision(value => value + 1);
  }, []);
  const { data: overview, loading, fetching, error, refresh: load } = useAdminResource<Overview>("/api/admin/overview", 0, accessDenied, overviewLoaded, !denied);
  useEffect(() => {
    if (denied) return;
    const refreshVisible = () => { if (document.visibilityState === "visible") void load(); };
    const interval = window.setInterval(refreshVisible, 30000);
    window.addEventListener("focus", refreshVisible);
    window.addEventListener("online", refreshVisible);
    document.addEventListener("visibilitychange", refreshVisible);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", refreshVisible); window.removeEventListener("online", refreshVisible); document.removeEventListener("visibilitychange", refreshVisible); };
  }, [denied, load]);
  async function manualRefresh() { setManualRefreshing(true); try { await load(); } finally { setManualRefreshing(false); } }
  async function logout() {
    setLoggingOut(true); setActionError("");
    try { const result = await api<{ redirectTo?: string }>("/api/admin/auth/logout", { method: "POST", body: "{}" }); window.location.assign(result.redirectTo?.startsWith("/cdn-cgi/access/logout?") ? result.redirectTo : "/admin"); }
    catch (e) { if (ownerDenied(e)) accessDenied(); else setActionError(errorMessage(e)); setLoggingOut(false); }
  }
  return <div className="site-shell"><SiteHeader admin/><main id="main" className="site-main admin-page">{denied ? <div className="access-card"><h1>Owner access required.</h1><p>This dashboard contains private waitlist information. Sign in with an authorized owner account to continue.</p><a className="button" href="/admin">Sign in again</a></div> : <><div className="admin-title-row"><div><div className="overline">Imladri waitlist</div><h1>The people behind the numbers.</h1></div><div className="admin-actions"><span className="admin-identity">{ownerEmail}</span><button className="button secondary small" type="button" onClick={manualRefresh} disabled={fetching || loggingOut}>{manualRefreshing ? "Refreshing…" : "Refresh data"}</button><button className="text-button admin-identity" type="button" onClick={logout} disabled={loggingOut}>{loggingOut ? "Signing out…" : "Sign out"}</button></div></div>
      {(error || actionError) && <p className="form-error" role="alert">{actionError || error}</p>}{!overview ? <div className="load-state" role="status">{loading ? "Loading your waitlist data…" : "Data is unavailable. Use Refresh data to try again."}</div> : <>
        <div className="metric-grid"><Metric label="Visitor sessions" value={number(overview.totals.visitors)} note="First-party sessions, not cross-site tracking"/><Metric label="Waitlist signups" value={number(overview.totals.signups)} note={`${number(overview.cities.length)} cities represented`}/><Metric label="Visitor to signup" value={`${Number(overview.conversionRate || 0).toFixed(1)}%`} note="Visitor sessions that led to a signup"/><Metric label="Active subscribers" value={number(overview.totals.active)} note={`${number(overview.totals.unsubscribed)} unsubscribed`}/></div>
        <div className="admin-tabs" role="tablist" aria-label="Dashboard sections">{[ ["overview", "Overview"], ["signups", "Signups"], ["emails", "Emails"], ["messages", "Messages"] ].map(([id, label]) => <button role="tab" key={id} id={`tab-${id}`} aria-controls={`panel-${id}`} aria-selected={tab === id} className="admin-tab" onClick={() => { setTab(id); setOpenedTabs(current => current.includes(id) ? current : [...current, id]); }}>{label}</button>)}</div>
        <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" hidden={tab !== "overview"}><OverviewPanel data={overview}/></div>
        <div role="tabpanel" id="panel-signups" aria-labelledby="tab-signups" hidden={tab !== "signups"}>{openedTabs.includes("signups") && <SignupsPanel cities={overview.cities} refreshRevision={refreshRevision} onDenied={accessDenied}/>}</div>
        <div role="tabpanel" id="panel-emails" aria-labelledby="tab-emails" hidden={tab !== "emails"}>{openedTabs.includes("emails") && <EmailsPanel cities={overview.cities} totals={overview.email} refreshRevision={refreshRevision} onChanged={load} onDenied={accessDenied}/>}</div>
        <div role="tabpanel" id="panel-messages" aria-labelledby="tab-messages" hidden={tab !== "messages"}>{openedTabs.includes("messages") && <AdminMessagesPanel refreshRevision={refreshRevision} onDenied={accessDenied}/>}</div><p className="quiet-state">Updated {updated}. All counts come from stored records. Joining is open to every city and every eligible adult; there are no signup caps or demographic thresholds.</p>
      </>}
    </>}</main></div>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) { return <div className="metric"><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-footnote">{note}</div></div>; }

function OverviewPanel({ data }: { data: Overview }) {
  return <><Panel title="Signups by city" description="Private breakdowns of the people joining each city."><div className="table-scroll"><table><thead><tr><th>City</th><th>Joined</th><th>Gender</th><th>Age range</th><th>Source</th></tr></thead><tbody>{!data.cities.length ? <tr><td colSpan={5} className="empty-cell">No signups yet. Your first signup will appear here.</td></tr> : data.cities.map(city => <tr key={city.city}><td><strong>{city.city}</strong></td><td>{number(city.count)}</td><td>{countText(city.genderCounts)}</td><td>{countText(city.ageCounts)}</td><td>{countText(city.sourceCounts)}</td></tr>)}</tbody></table></div></Panel><div className="admin-grid"><Panel title="How people found Imladri"><Breakdown rows={(data.sources || []).map(row => ({ label: row.source, count: row.count }))}/></Panel><Panel title="Campaign links" description="UTM campaign labels from your shared links."><Breakdown rows={(data.utmCampaigns || []).map(row => ({ label: [row.source, row.campaign, row.content].filter(Boolean).join(" · ") || "Unspecified", count: row.count }))}/></Panel><Panel title="Signups over time"><Breakdown rows={(data.daily || []).map(row => ({ label: row.date, count: row.signups }))}/></Panel><Panel title="Friends bringing friends" description="Successful signups attributed to unique referral links."><Breakdown rows={(data.referrals || []).map(row => ({ label: `${row.referralCode}${row.city ? ` · ${row.city}` : ""}`, count: row.count }))}/></Panel></div></>;
}

function SignupsPanel({ cities, refreshRevision, onDenied }: { cities: City[]; refreshRevision: number; onDenied: () => void }) {
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, loading, fetching, error } = useAdminResource<SignupPage>(`/api/admin/signups?${queryFor(filters, page)}`, refreshRevision, onDenied);
  function change(key: keyof Filters, value: string) { setDraft(current => ({ ...current, [key]: value })); }
  function apply(event: FormEvent) { event.preventDefault(); setFilters({ ...draft }); setPage(1); }
  const maxPage = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return <><form className="admin-filter-row" onSubmit={apply}><div className="field search-field"><label htmlFor="admin-search">City or exact email</label><input id="admin-search" value={draft.q} onChange={e => change("q", e.target.value)} placeholder="City or exact email" /></div><Filter id="filter-city" label="City" value={draft.city} values={cities.map(c => c.city)} onChange={value => change("city", value)}/><Filter id="filter-gender" label="Gender" value={draft.gender} values={DEFAULT_OPTIONS.genders} onChange={value => change("gender", value)}/><Filter id="filter-age" label="Age range" value={draft.age} values={DEFAULT_OPTIONS.ageRanges} onChange={value => change("age", value)}/><Filter id="filter-source" label="Source" value={draft.source} values={DEFAULT_OPTIONS.sources} onChange={value => change("source", value)}/><Filter id="filter-status" label="Status" value={draft.status} values={["active", "unsubscribed"]} onChange={value => change("status", value)}/><button className="button small" type="submit">Apply filters</button></form>
    {error && <p className="form-error" role="alert">{error}</p>}<Panel title="All signup records" description={data ? `${number(data.total)} matching records. Only authorized owners can access these details.` : "Loading records…"} action={<a className="button secondary small" href={`/api/admin/export?${queryFor(filters)}`} download>Export CSV</a>}><div className="table-scroll"><table aria-busy={fetching}><thead><tr><th>Person</th><th>City</th><th>Age</th><th>Gender</th><th>Interested in</th><th>Source</th><th>Status</th><th>Joined</th><th>Details</th></tr></thead><tbody>{loading && !data ? <tr><td colSpan={9} className="empty-cell">Loading signup records…</td></tr> : !data?.items.length ? <tr><td colSpan={9} className="empty-cell">{error && !data ? "Records are unavailable. Use Refresh data to try again." : "No signups match these filters."}</td></tr> : data.items.map(item => <Fragment key={item.id}><tr><td><strong>{item.firstName}</strong><br/>{item.email}</td><td>{item.city}</td><td>{item.ageRange}</td><td>{item.gender === "Prefer to self-describe" && item.genderDescription ? item.genderDescription : item.gender}</td><td>{item.interestedIn.join(", ")}</td><td>{item.source || "Unspecified"}</td><td><Status status={item.status}/></td><td>{date(item.createdAt)}</td><td><button type="button" className="text-button" aria-expanded={expanded === item.id} onClick={() => setExpanded(expanded === item.id ? null : item.id)}>{expanded === item.id ? "Hide" : "View"}</button></td></tr>{expanded === item.id && <tr><td colSpan={9}><div className="admin-grid"><div><strong>Preferences & consent</strong><br/>Looking for: {item.lookingFor || "Not provided"}<br/>18+ confirmed: {item.adultConfirmed ? "Yes" : "Not recorded"}<br/>Signup email consent: {item.emailConsent ? "Yes" : "Not active"}<br/>Consent recorded: {date(item.consentAt)}<br/>Welcome email: {item.emailStatus}<br/>Referral code: {item.referralCode || "—"}<br/>Referred by: {item.referredBy || "—"}{typeof item.referralCount === "number" && <><br/>Friends referred: {item.referralCount}</>}</div><div><strong>Attribution</strong><br/>Source: {item.utmSource || "—"}<br/>Medium: {item.utmMedium || "—"}<br/>Campaign: {item.utmCampaign || "—"}<br/>Content: {item.utmContent || "—"}<br/>Term: {item.utmTerm || "—"}<br/>Referring website: {item.referrer || "—"}</div></div></td></tr>}</Fragment>)}</tbody></table></div><div className="pagination"><span>Page {page} of {maxPage}</span><div className="inline-actions"><button className="button secondary small" type="button" disabled={fetching || page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><button className="button secondary small" type="button" disabled={fetching || page >= maxPage} onClick={() => setPage(p => p + 1)}>Next</button></div></div></Panel>
  </>;
}

function Filter({ id, label, value, values, onChange }: { id: string; label: string; value: string; values: string[]; onChange: (value: string) => void }) { return <div className="field"><label htmlFor={id}>{label}</label><select id={id} value={value} onChange={e => onChange(e.target.value)}><option value="">All</option>{values.map(item => <option key={item}>{item}</option>)}</select></div>; }

function EmailsPanel({ cities, totals, refreshRevision, onChanged, onDenied }: { cities: City[]; totals: Overview["email"]; refreshRevision: number; onChanged: () => void; onDenied: () => void }) {
  const { data, loading, fetching, error: loadError, refresh: loadEmails } = useAdminResource<EmailPage>("/api/admin/emails", refreshRevision, onDenied);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  async function retry(id?: string) {
    setBusyId(id || "all"); setError(""); setFeedback("");
    try { await api("/api/admin/emails/retry", { method: "POST", body: JSON.stringify(id ? { ids: [id] } : { allFailed: true }) }); setFeedback("Retry requested. Delivery status is shown below."); onChanged(); } catch (e) { if (ownerDenied(e)) onDenied(); else setError(errorMessage(e)); } finally { setBusyId(""); }
  }
  return <><EmailTemplatePreview onDenied={onDenied}/><div className="admin-grid"><Panel title="Email delivery" description="Osama from Imladri · osama@imladri.com"><div className="admin-panel-body"><div className="choice-row"><span className="status-tag">{number(totals.sent)} sent</span><span className="status-tag">{number(totals.pending)} pending</span><span className="status-tag" data-status="failed">{number(totals.failed)} failed</span></div><p className="helper spacer-top">Welcome emails are queued with each saved signup. Unsubscribed or deleted people are excluded from future messages.</p><button type="button" className="button secondary small" onClick={() => retry()} disabled={!!busyId}>{busyId === "all" ? "Retrying…" : "Retry failed emails"}</button>{feedback && <p className="form-success" role="status">{feedback}</p>}{(error || loadError) && <p className="form-error" role="alert">{error || loadError}</p>}</div></Panel><CampaignComposer cities={cities} onSent={onChanged} onDenied={onDenied}/></div><Panel title="Email outbox" description="Recent welcome, account-choice, and campaign email deliveries." action={<button type="button" className="button secondary small" onClick={() => { void loadEmails(); }} disabled={fetching}>Refresh outbox</button>}><div className="table-scroll"><table aria-busy={fetching}><thead><tr><th>Recipient</th><th>Subject / type</th><th>Status</th><th>Attempts</th><th>Created</th><th>Last error</th><th>Action</th></tr></thead><tbody>{loading && !data ? <tr><td colSpan={7} className="empty-cell">Loading email delivery records…</td></tr> : !data?.items.length ? <tr><td colSpan={7} className="empty-cell">{loadError && !data ? "Delivery records are unavailable. Use Refresh outbox to try again." : "No emails have been queued yet."}</td></tr> : data.items.map(item => <tr key={item.id}><td>{item.email || item.to || item.recipient || "—"}</td><td>{item.subject || item.type || item.kind || "—"}</td><td><Status status={item.status}/></td><td>{number(item.attempts)}</td><td>{date(item.createdAt)}</td><td>{item.error || "—"}</td><td>{item.status === "failed" && <button type="button" className="text-button" onClick={() => retry(item.id)} disabled={!!busyId}>{busyId === item.id ? "Retrying…" : "Retry"}</button>}</td></tr>)}</tbody></table></div></Panel></>;
}

function CampaignComposer({ cities, onSent, onDenied }: { cities: City[]; onSent: () => void; onDenied: () => void }) {
  const [draft, setDraft] = useState<Campaign>({ type: "monthly", subject: "", body: "", city: "" });
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState("");
  const [processing, setProcessing] = useState(false);
  const [delivery, setDelivery] = useState<CampaignProgress | null>(null);
  const [history, setHistory] = useState<CampaignRecord[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const sendKey = useRef("");
  const mounted = useRef(true);
  const inFlight = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;
  const loadHistory = useCallback(async () => {
    const result = await api<{ items: CampaignRecord[] }>("/api/admin/campaigns");
    if (mounted.current) setHistory(result.items);
    return result.items;
  }, []);
  useEffect(() => {
    mounted.current = true;
    loadHistory().then(items => {
      const pending = items.find(item => !item.queueComplete || item.queued > 0);
      if (pending && mounted.current) { setDelivery(pending); setMessage("A previous campaign is waiting to finish. Use Continue sending below."); }
    }).catch(e => { if (mounted.current) { if (ownerDenied(e)) onDenied(); else setError(errorMessage(e)); } });
    return () => { mounted.current = false; activeRequest.current?.abort(); };
  }, [loadHistory, onDenied]);
  function change(key: keyof Campaign, value: string) { setDraft(current => ({ ...current, [key]: value })); setPreview(null); setConfirmed(false); }
  async function getPreview(event: FormEvent) {
    event.preventDefault(); setBusy("preview"); setError("");
    try { setPreview(await api<CampaignPreview>("/api/admin/campaigns/preview", { method: "POST", body: JSON.stringify(draft) })); setConfirmed(false); sendKey.current = crypto.randomUUID(); }
    catch (e) { if (ownerDenied(e)) onDenied(); else setError(errorMessage(e)); } finally { setBusy(""); }
  }
  async function continueSending(initial: CampaignProgress) {
    if (inFlight.current) return;
    inFlight.current = true; setProcessing(true); setError(""); setDelivery(initial);
    let progress = initial;
    let pausedForFailure = false;
    try {
      while (mounted.current && document.visibilityState === "visible" && (!progress.queueComplete || progress.queued > 0) && !(progress.failed > 0 && progress.queued === 0)) {
        const previous = progress;
        const controller = new AbortController(); activeRequest.current = controller;
        progress = await api<CampaignProgress>("/api/admin/campaigns/process", { method: "POST", body: JSON.stringify({ campaignId: progress.campaignId }), signal: controller.signal });
        if (!mounted.current) return;
        setDelivery(progress);
        if (progress.failed > previous.failed) { pausedForFailure = true; break; }
        if (progress.processed === 0 && progress.sent === previous.sent && progress.failed === previous.failed && progress.queued === previous.queued && progress.queueComplete === previous.queueComplete) break;
      }
      if (mounted.current) {
        const complete = progress.queueComplete && progress.queued === 0;
        setMessage(complete ? progress.failed > 0 ? "Sending finished with failed emails. Review the outbox and retry failures." : "Sending complete. The outbox shows each email’s status." : pausedForFailure ? "Sending paused after a delivery error. Wait at least one minute before continuing, and review the outbox for details." : "Sending is paused. Return to this tab and use Continue sending to finish.");
        await loadHistory(); onSentRef.current();
      }
    } catch (e) {
      if (mounted.current) { if (ownerDenied(e)) onDenied(); else { setError(`${errorMessage(e)} Your campaign is saved. Continue sending to resume without creating a duplicate.`); void loadHistory().catch(() => {}); } }
    } finally { inFlight.current = false; activeRequest.current = null; if (mounted.current) setProcessing(false); }
  }
  async function send() {
    if (!preview || !confirmed || !sendKey.current) return;
    setBusy("send"); setError("");
    try {
      const progress = await api<CampaignProgress>("/api/admin/campaigns/send", { method: "POST", body: JSON.stringify({ ...draft, idempotencyKey: sendKey.current }) });
      setDelivery(progress); setMessage("Your campaign is saved. Keep this tab open while the remaining emails are sent."); setPreview(null); setConfirmed(false); setBusy("");
      await loadHistory(); await continueSending(progress);
    } catch (e) { if (ownerDenied(e)) onDenied(); else setError(errorMessage(e)); } finally { setBusy(""); }
  }
  return <Panel title="Send an honest update" description="Preview the message and audience before sending."><form className="admin-panel-body" onSubmit={getPreview}>
    <div className="form-grid"><div className="field"><label htmlFor="campaign-type">Email type</label><select id="campaign-type" value={draft.type} onChange={e => change("type", e.target.value)}><option value="monthly">Monthly update</option><option value="launch">Launch notice</option></select></div><div className="field"><label htmlFor="campaign-city">Audience</label><select id="campaign-city" value={draft.city} onChange={e => change("city", e.target.value)}><option value="">All active subscribers</option>{cities.map(city => <option key={city.city} value={city.city}>{city.city}</option>)}</select></div><div className="field full"><label htmlFor="campaign-subject">Subject</label><input id="campaign-subject" value={draft.subject} onChange={e => change("subject", e.target.value)} required maxLength={150}/></div><div className="field full"><label htmlFor="campaign-body">Message</label><textarea id="campaign-body" rows={7} value={draft.body} onChange={e => change("body", e.target.value)} placeholder="What you built, what you learned, and what comes next." required maxLength={10000}/><small>An unsubscribe link is added automatically to every email. Only include a launch date you have committed to.</small></div></div>
    <button className="button secondary small spacer-top" type="submit" disabled={!!busy || processing}>{busy === "preview" ? "Preparing preview…" : "Preview email and audience"}</button>
    {preview && <div><p className="helper spacer-top"><strong>{preview.subject}</strong></p><EmailPreviewFrame html={preview.html} title="Branded campaign email preview" /><p className="helper">This will go to {number(preview.recipientCount)} active, consented {preview.recipientCount === 1 ? "subscriber" : "subscribers"}{draft.city ? ` in ${draft.city}` : ""}.</p><label className="consent"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}/><span>I have reviewed the message and want to send it to this audience.</span></label><button type="button" className="button small spacer-top" onClick={send} disabled={!confirmed || !!busy || processing || preview.recipientCount < 1}>{busy === "send" ? "Saving campaign…" : "Send this email"}</button></div>}
    {delivery && <section className="notice spacer-top" aria-live="polite" aria-label="Campaign delivery progress"><strong>{processing ? "Sending your update…" : delivery.queueComplete && delivery.queued === 0 ? "Campaign delivery results" : "Campaign ready to continue"}</strong><p>{number(delivery.sent)} sent · {number(delivery.queued)} remaining · {number(delivery.failed)} failed{delivery.cancelled > 0 ? ` · ${number(delivery.cancelled)} cancelled` : ""}</p>{processing ? <p className="helper">Keep this tab open. You can safely resume later if you leave.</p> : (!delivery.queueComplete || delivery.queued > 0) && <button type="button" className="button small" onClick={() => continueSending(delivery)} disabled={!!busy}>Continue sending</button>}</section>}
    {error && <p className="form-error" role="alert">{error}</p>}{message && <p className="admin-feedback" role="status">{message}</p>}
    {!!history.length && <section className="spacer-top" aria-label="Recent campaigns"><h3 style={{ fontSize: 14 }}>Recent campaigns</h3>{history.slice(0, 5).map(item => <div className="notice" style={{ marginTop: 8 }} key={item.campaignId}><strong>{item.subject}</strong><p className="helper">{item.city || "All active subscribers"} · {date(item.createdAt)}<br/>{number(item.sent)} sent · {number(item.queued)} remaining · {number(item.failed)} failed</p>{(!item.queueComplete || item.queued > 0) && <button className="text-button" type="button" disabled={processing || !!busy} onClick={() => continueSending(item)}>Continue this campaign</button>}</div>)}</section>}
  </form></Panel>;
}
