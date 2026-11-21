"use client";

import { useEffect, useRef, useState } from "react";
import { useAdminResource } from "./admin-resource";
import { CONTACT_CATEGORIES } from "./contact";
import { api, errorMessage } from "./shared";

type MessageStatus = "new" | "read" | "resolved";
type ContactMessage = { id: string; reference: string; name: string; email: string; category: string; subject: string; message: string; status: MessageStatus; createdAt: string; updatedAt: string };
type MessagePage = { items: ContactMessage[]; total: number; page: number; pageSize: number };
type MessageSummary = { total: number; unread: number; resolved: number; categories: { category: string; total: number; unread: number }[] };
const number = (value: number) => value.toLocaleString();
const received = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const statusName = (status: MessageStatus) => status === "new" ? "Unread" : status === "read" ? "Read" : "Resolved";

export function AdminMessagesPanel({ refreshRevision, onDenied }: { refreshRevision: number; onDenied: () => void }) {
  const [category, setCategory] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [localRevision, setLocalRevision] = useState(0);
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [feedback, setFeedback] = useState("");
  const mounted = useRef(true);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; mutation.current?.abort(); }; }, []);
  const revision = refreshRevision + localRevision;
  const query = new URLSearchParams({ page: String(page), pageSize: "15" });
  if (category) query.set("category", category);
  if (status) query.set("status", status);
  const summary = useAdminResource<MessageSummary>("/api/admin/messages/summary", revision, onDenied);
  const messages = useAdminResource<MessagePage>(`/api/admin/messages?${query}`, revision, onDenied);
  const maxPage = messages.data ? Math.max(1, Math.ceil(messages.data.total / messages.data.pageSize)) : 1;
  function chooseCategory(value: string) { setCategory(value); setPage(1); }

  async function changeStatus(item: ContactMessage, nextStatus: MessageStatus) {
    if (mutation.current) return;
    const controller = new AbortController(); mutation.current = controller;
    setBusyId(item.id); setActionError(""); setFeedback("");
    try {
      await api<{ ok: true; item: ContactMessage }>(`/api/admin/messages/${encodeURIComponent(item.id)}/status`, { method: "POST", body: JSON.stringify({ status: nextStatus }), signal: controller.signal });
      if (mounted.current) { setFeedback(`${item.reference} marked ${nextStatus === "new" ? "unread" : nextStatus}.`); setLocalRevision(value => value + 1); }
    } catch (e) {
      if (mounted.current && !controller.signal.aborted) {
        const statusCode = (e as { status?: number }).status;
        if (statusCode === 401 || statusCode === 403) onDenied(); else setActionError(errorMessage(e));
      }
    } finally { mutation.current = null; if (mounted.current) setBusyId(""); }
  }

  return <section className="contact-inbox" aria-label="Private contact messages">
    <div className="contact-inbox-heading"><div><h2>Messages</h2><p>Private messages from Contact us. Choose a category to find what needs your attention.</p></div>
      {summary.data ? <p className="contact-inbox-totals"><strong>{number(summary.data.total)}</strong> total <span>·</span> <strong>{number(summary.data.unread)}</strong> unread <span>·</span> <strong>{number(summary.data.resolved)}</strong> resolved</p> : <p className="quiet-state" role="status">{summary.loading ? "Loading message totals…" : "Message totals are unavailable."}</p>}
    </div>
    {summary.error && <p className="form-error" role="alert">{summary.error}</p>}
    {summary.data && <div className="contact-category-grid" aria-label="Message categories">{CONTACT_CATEGORIES.map(value => {
      const counts = summary.data!.categories.find(item => item.category === value);
      return <button key={value} type="button" className="contact-category" aria-pressed={category === value} onClick={() => chooseCategory(category === value ? "" : value)}><span>{value}</span><strong>{number(counts?.total || 0)}</strong><small>{number(counts?.unread || 0)} unread</small></button>;
    })}</div>}
    <div className="contact-inbox-filters"><div className="field"><label htmlFor="message-category-filter">Category</label><select id="message-category-filter" value={category} onChange={event => chooseCategory(event.target.value)}><option value="">All categories</option>{CONTACT_CATEGORIES.map(value => <option key={value}>{value}</option>)}</select></div>
      <div className="field"><label htmlFor="message-status-filter">Status</label><select id="message-status-filter" value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option><option value="new">Unread</option><option value="read">Read</option><option value="resolved">Resolved</option></select></div>
      {(category || status) && <button type="button" className="text-button" onClick={() => { chooseCategory(""); setStatus(""); }}>Clear filters</button>}
      {messages.data && <p className="quiet-state">{number(messages.data.total)} matching {messages.data.total === 1 ? "message" : "messages"}</p>}
    </div>
    {(messages.error || actionError) && <p className="form-error" role="alert">{actionError || messages.error}</p>}
    {feedback && <p className="form-success" role="status">{feedback}</p>}
    <div className="contact-message-list" aria-busy={messages.fetching}>
      {messages.loading && !messages.data ? <p className="contact-inbox-empty" role="status">Loading messages…</p> : !messages.data ? <p className="contact-inbox-empty">Messages are unavailable. Use Refresh data to try again.</p> : !messages.data.items.length ? <p className="contact-inbox-empty">{category || status ? "No messages match these filters." : "Your contact inbox is empty. Messages sent through Contact us will appear here."}</p> : messages.data.items.map(item => <article className="contact-message-card" key={item.id}>
        <div className="contact-message-top"><div><div className="contact-message-tags"><span className="contact-message-category">{item.category}</span><span className="status-tag" data-status={item.status}>{statusName(item.status)}</span></div><h3>{item.subject}</h3><p className="contact-message-sender"><strong>{item.name}</strong><span>{item.email}</span></p></div><time dateTime={item.createdAt}>{received(item.createdAt)}</time></div>
        {expanded === item.id ? <div id={`message-${item.id}`} className="contact-message-body"><p>{item.message}</p><p className="contact-message-reference">Reference: {item.reference}</p></div> : <p className="contact-message-preview">{item.message.length > 180 ? `${item.message.slice(0, 180)}…` : item.message}</p>}
        <div className="contact-message-actions"><button type="button" className="text-button" aria-expanded={expanded === item.id} aria-controls={expanded === item.id ? `message-${item.id}` : undefined} onClick={() => setExpanded(current => current === item.id ? null : item.id)}>{expanded === item.id ? "Close message" : "Open full message"}</button><div className="inline-actions">
          {item.status === "new" && <button type="button" className="button secondary small" disabled={!!busyId} onClick={() => changeStatus(item, "read")}>{busyId === item.id ? "Saving…" : "Mark read"}</button>}
          {item.status !== "resolved" ? <button type="button" className="button secondary small" disabled={!!busyId} onClick={() => changeStatus(item, "resolved")}>{busyId === item.id ? "Saving…" : "Resolve"}</button> : <button type="button" className="button secondary small" disabled={!!busyId} onClick={() => changeStatus(item, "new")}>{busyId === item.id ? "Saving…" : "Reopen"}</button>}
        </div></div>
      </article>)}
    </div>
    {messages.data && <div className="pagination"><span>Page {page} of {Math.max(page, maxPage)}</span><div className="inline-actions"><button type="button" className="button secondary small" disabled={messages.fetching || page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" className="button secondary small" disabled={messages.fetching || page >= maxPage} onClick={() => setPage(value => value + 1)}>Next</button></div></div>}
  </section>;
}
