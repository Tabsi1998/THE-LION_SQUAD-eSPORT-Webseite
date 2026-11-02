import { useCallback, useEffect, useRef, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { toast } from "sonner";
import { Inbox, MailOpen, Trash2, ArrowLeft, AlertCircle, ShieldCheck, Search, Send } from "lucide-react";
import { viennaDate, viennaDateTime } from "@/lib/vienna";

const STATUS_LABEL = {
  new: { l: "Neu", c: "text-[#29B6E8] bg-[#29B6E8]/10 border-[#29B6E8]/30" },
  in_progress: { l: "In Bearbeitung", c: "text-[#FFD700] bg-[#FFD700]/10 border-[#FFD700]/30" },
  answered: { l: "Beantwortet", c: "text-[#00FF88] bg-[#00FF88]/10 border-[#00FF88]/30" },
  closed: { l: "Geschlossen", c: "text-white/50 bg-white/5 border-white/10" },
  spam: { l: "Spam", c: "text-[#FF3B30] bg-[#FF3B30]/10 border-[#FF3B30]/30" },
};

const PAGE_SIZE = 50;
const REPLY_MAX = 4000;
const DEFAULT_VIEW = "open";
// Die zwei Sammelansichten neben den Status-Kacheln (#2131): Standard ist, was noch jemanden braucht.
const VIEWS = [["open", "Offen"], ["all", "Alle ohne Spam"]];
const ASSIGNED_FILTERS = [["", "Alle Zuständigen"], ["me", "Mir zugewiesen"], ["none", "Ohne Zuständige"]];

// Kennung eines Absendens: kommt es noch einmal an, geht keine zweite Mail hinaus. Jede Änderung am Text ist ein neues.
const newRequestId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

// Spamschutz (#2067): Gründe, die der Server liefert, falls die Zähler-Antwort keine Beschriftung mitbringt.
const REASON_FALLBACK = {
  honeypot: "Verstecktes Feld", token_missing: "Ohne Token", token_too_fast: "Zu schnell", token_expired: "Token abgelaufen",
  token_forged: "Token gefälscht", random_text: "Zufallszeichen", gmail_dots: "Gmail mit Punkt-Trick", links: "Viele Links",
  spam_words: "Spam-Wörter", word_filter: "Wortfilter", word_filter_hold: "Wortfilter (zurückhalten)", token_reused: "Token aufgebraucht",
  turnstile_missing: "Turnstile nicht gelöst", turnstile_invalid: "Turnstile abgelehnt",
};

function SpamCounter({ stats }) {
  if (!stats) return null;
  const labels = { ...REASON_FALLBACK, ...(stats.labels || {}) };
  const reasons = Object.entries(stats.week?.by_reason || {}).sort((a, b) => b[1] - a[1]);
  return (
    <div className="mb-6 border border-white/10 bg-[#121212] rounded-sm p-4 flex flex-wrap items-start gap-x-8 gap-y-3" data-testid="contact-spam-counter">
      <div className="flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-ok shrink-0" />
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-white/50">Spamschutz – abgefangen</div>
          <div className="text-sm text-white/85">
            <strong className="text-lg font-black" data-testid="contact-spam-today">{stats.today?.caught || 0}</strong> heute ·{" "}
            <strong className="text-lg font-black" data-testid="contact-spam-week">{stats.week?.caught || 0}</strong> in 7 Tagen
            {stats.quote_week != null && <span className="text-white/50"> · Quote {String(stats.quote_week).replace(".", ",")} %</span>}
          </div>
        </div>
      </div>
      {reasons.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-xs" aria-label="Gründe der letzten 7 Tage" data-testid="contact-spam-reasons">
          {reasons.map(([reason, count]) => (
            <li key={reason} className="px-2 py-1 rounded-sm border border-white/10 text-white/70">{labels[reason] || reason}: {count}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Der Verlauf einer Anfrage (#2131): wer wann geantwortet hat und mit welchem Wortlaut.
function ReplyHistory({ message }) {
  const replies = message.replies || [];
  const answeredByHand = message.answered_at && !replies.length;
  if (!replies.length && !answeredByHand) return null;
  return (
    <div className="mt-5 border-t border-white/10 pt-4" data-testid="contact-history">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-3">Verlauf</div>
      {answeredByHand && (
        <p className="text-sm text-white/70" data-testid="contact-answered-by">Als beantwortet markiert von {message.answered_by_name || "der Verwaltung"} · {viennaDateTime(message.answered_at)}</p>
      )}
      <ol className="space-y-3">
        {replies.map((reply) => (
          <li key={reply.id} className="border-l-2 border-ok/40 pl-3" data-testid={`contact-reply-${reply.id}`}>
            <div className="text-xs text-white/50">Antwort von {reply.by_name || "der Verwaltung"} · {viennaDateTime(reply.at)}</div>
            <pre className="mt-1 whitespace-pre-wrap text-sm text-white/85 font-sans leading-relaxed">{reply.text}</pre>
          </li>
        ))}
      </ol>
    </div>
  );
}

// Was „Fehler melden“ mitbringt (#2131): Seite, Gerät, Version.
function ReportContext({ context }) {
  if (!context) return null;
  const rows = [["Seite", context.page], ["Gerät", context.device], ["Version", context.version]].filter(([, value]) => value);
  if (!rows.length) return null;
  return (
    <dl className="mt-4 border border-white/10 rounded-sm p-3 text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-1" data-testid="contact-context">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-white/45 uppercase tracking-wider font-bold">{label}</dt>
          <dd className="text-white/75 break-all">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function AdminContactPage() {
  const [inbox, setInbox] = useState(null);
  const [view, setView] = useState(DEFAULT_VIEW);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [assigned, setAssigned] = useState("");
  const [page, setPage] = useState(1);
  const [loadError, setLoadError] = useState("");
  const [topics, setTopics] = useState({});
  const [assignees, setAssignees] = useState([]);
  const [active, setActive] = useState(null);
  const [spamStats, setSpamStats] = useState(null);
  const [releasing, setReleasing] = useState(false);
  const [sending, setSending] = useState(false);
  const [reply, setReply] = useState({ text: "", request_id: newRequestId() });
  const confirm = useConfirm();
  const latest = useRef(0);

  // Die Suche läuft auf dem Server - kurz warten, bis zu Ende getippt ist.
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const params = { status: view, page, limit: PAGE_SIZE };
      if (query) params.q = query;
      if (assigned) params.assigned = assigned;
      const { data } = await api.get("/contact", { params });
      if (ticket !== latest.current) return;
      setInbox(data);
      setLoadError("");
    } catch (e) {
      if (ticket === latest.current) setLoadError(formatApiError(e.response?.data?.detail) || "Die Inbox ließ sich nicht laden.");
    }
    api.get("/spam-guard/stats").then(({ data: stats }) => setSpamStats(stats)).catch(() => {});
  }, [view, page, query, assigned]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["contact"]);
  // Bezeichnungen vom Server (#2131): dieselben Themen wie im Formular, und wer zuständig sein kann.
  useEffect(() => {
    api.get("/contact/topics").then(({ data }) => setTopics(Object.fromEntries((Array.isArray(data) ? data : []).map((row) => [row.value, row.label])))).catch(() => {});
    api.get("/contact/assignees").then(({ data }) => setAssignees(Array.isArray(data) ? data : [])).catch(() => {});
  }, []);

  const pick = (next) => {
    setView((current) => (current === next ? DEFAULT_VIEW : next));
    setPage(1);
  };

  const openMessage = (message) => {
    setActive(message);
    setReply({ text: "", request_id: newRequestId() });
  };

  const items = inbox?.items || [];
  const counts = inbox?.counts || {};
  const total = inbox?.total || 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // Vom Spamschutz markiert und noch nicht geprüft - der Hinweis steht auch ohne Filter da, damit nichts still liegen bleibt.
  const suspicious = inbox?.suspicious || 0;

  const notSpam = async (id) => {
    if (releasing) return;
    setReleasing(true);
    try {
      const { data } = await api.post(`/contact/${id}/not-spam`);
      toast.success("Als „kein Spam“ eingeordnet – die Mails gehen jetzt hinaus.");
      setActive(data);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
    finally { setReleasing(false); }
  };

  const patch = async (id, changes, message) => {
    try {
      const { data } = await api.patch(`/contact/${id}`, changes);
      toast.success(message);
      setActive(data);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  const setStatus = (id, status) => patch(id, { status }, `Status: ${STATUS_LABEL[status]?.l || status}`);
  // Die Notiz speichert nur, wenn sie sich geändert hat, und meldet sich als Notiz - nicht als Status (#2131).
  const saveNote = (message, note) => {
    if (note === (message.internal_note || "")) return;
    patch(message.id, { internal_note: note }, "Notiz gespeichert.");
  };
  const assign = (id, userId) => patch(id, { assigned_to: userId }, userId ? "Zuständig gesetzt." : "Niemand mehr zuständig.");

  const sendReply = async () => {
    const text = reply.text.trim();
    if (sending || text.length < 2 || !active) return;
    const ok = await confirm({
      title: "Antwort senden?",
      description: `Die Mail geht an ${active.email}. Der Wortlaut steht danach im Verlauf, der Status ist „Beantwortet“.`,
      confirmLabel: "Senden", tone: "info",
    });
    if (!ok) return;
    setSending(true);
    try {
      const { data } = await api.post(`/contact/${active.id}/reply`, { text, request_id: reply.request_id });
      toast.success("Antwort ist unterwegs.");
      setActive(data);
      setReply({ text: "", request_id: newRequestId() });
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Die Antwort ging nicht hinaus."); }
    finally { setSending(false); }
  };

  const remove = async (id) => {
    if (!await confirm({
      title: "Nachricht löschen?",
      description: "Diese Nachricht wird unwiderruflich aus der Inbox entfernt, samt Kopien der Mails.",
      confirmLabel: "Löschen",
    })) return;
    try { await api.delete(`/contact/${id}`); toast.success("Gelöscht."); setActive(null); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail) || "Fehler"); }
  };

  if (active) {
    const s = STATUS_LABEL[active.status] || STATUS_LABEL.new;
    const flagged = active.status === "spam" && active.spam?.reasons && !active.spam?.cleared_at;
    const reasonLabels = { ...REASON_FALLBACK, ...(spamStats?.labels || {}) };
    const canReply = active.status !== "spam" && !!active.email;
    const assigneeOptions = active.assigned_to && !assignees.some((row) => row.id === active.assigned_to)
      ? [...assignees, { id: active.assigned_to, name: active.assigned_to_name || "Nicht mehr in der Vereinsverwaltung" }] : assignees;
    return (
      <AdminLayout>
        <button onClick={() => setActive(null)} className="inline-flex items-center gap-2 text-xs uppercase tracking-wider text-white/50 hover:text-[#29B6E8] mb-4">
          <ArrowLeft className="w-3.5 h-3.5" /> Inbox
        </button>
        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 min-w-0 border border-white/10 bg-[#121212] rounded-sm p-4 sm:p-6">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border ${s.c}`} data-testid="contact-detail-status">{s.l}</span>
              <span className="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded-sm border border-white/10 text-white/60" data-testid="contact-detail-topic">{topics[active.topic] || active.topic}</span>
            </div>
            <h1 className="font-heading text-2xl font-black uppercase mb-3 break-words">{active.subject}</h1>
            <div className="text-sm text-white/60 mb-4 break-words">
              <strong>{active.name}</strong> &lt;<a href={`mailto:${active.email}`} className="text-[#29B6E8] hover:underline">{active.email}</a>&gt; · {viennaDateTime(active.created_at)}
            </div>
            <div className="border-t border-white/10 pt-4">
              <pre className="whitespace-pre-wrap break-words text-sm text-white/85 font-sans leading-relaxed">{active.message}</pre>
            </div>
            <ReportContext context={active.context} />
            <ReplyHistory message={active} />
            {canReply ? (
              <div className="mt-5 border-t border-white/10 pt-4" data-testid="contact-reply-form">
                <label htmlFor="contact-reply-text" className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Antwort an {active.email}</label>
                <textarea id="contact-reply-text" value={reply.text} maxLength={REPLY_MAX} rows={5} data-testid="contact-reply-text"
                  onChange={(e) => setReply({ text: e.target.value, request_id: newRequestId() })}
                  className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
                <button type="button" onClick={sendReply} disabled={sending || reply.text.trim().length < 2} data-testid="contact-reply-send"
                  className="mt-2 inline-flex items-center gap-2 px-4 py-2.5 bg-[#29B6E8] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#1E95C2] disabled:opacity-50">
                  <Send className="w-3.5 h-3.5" /> {sending ? "Wird gesendet …" : "Antwort senden"}
                </button>
              </div>
            ) : (
              <p className="mt-5 border-t border-white/10 pt-4 text-xs text-white/50" data-testid="contact-reply-blocked">
                {active.status === "spam" ? "Spam bekommt keine Antwort. Ist es eine echte Anfrage? Dann zuerst „Kein Spam“." : "Zu dieser Nachricht gibt es keine Adresse mehr."}
              </p>
            )}
          </div>
          <div className="space-y-3 min-w-0">
            {flagged && (
              <div className="border border-warn/30 bg-warn/5 rounded-sm p-4" data-testid="contact-spam-box">
                <div className="text-[11px] font-bold uppercase tracking-widest text-warn mb-2">Vom Spamschutz markiert</div>
                <p className="text-xs text-white/70 mb-2">Gründe: {active.spam.reasons.map((r) => reasonLabels[r] || r).join(", ")}. Bisher ging keine Mail hinaus – weder an den Absender noch an den Vorstand.</p>
                <button type="button" onClick={() => notSpam(active.id)} disabled={releasing} data-testid="contact-not-spam"
                  className="w-full px-4 py-2 border border-ok/40 text-ok font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-ok/10 disabled:opacity-50">
                  Kein Spam – einordnen und Mails nachholen
                </button>
              </div>
            )}
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Status setzen</div>
              <div className="flex flex-wrap gap-2">
                {Object.keys(STATUS_LABEL).map((k) => (
                  <button key={k} onClick={() => setStatus(active.id, k)}
                    data-testid={`contact-status-${k}`}
                    className={`px-3 py-1.5 text-xs font-bold uppercase tracking-wider rounded-sm border ${active.status === k ? STATUS_LABEL[k].c : "border-white/10 text-white/60 hover:border-white/30"}`}>
                    {STATUS_LABEL[k].l}
                  </button>
                ))}
              </div>
            </div>
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <label htmlFor="contact-assignee" className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Zuständig</label>
              <select id="contact-assignee" value={active.assigned_to || ""} onChange={(e) => assign(active.id, e.target.value)} data-testid="contact-assignee"
                className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">
                <option value="">Niemand</option>
                {assigneeOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </div>
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
              <label htmlFor="contact-note" className="block text-[11px] font-bold uppercase tracking-widest text-white/60 mb-2">Interne Notiz</label>
              <textarea id="contact-note" key={active.id} defaultValue={active.internal_note || ""} maxLength={4000} onBlur={(e) => saveNote(active, e.target.value)} data-testid="contact-note"
                className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" rows={4} />
              <p className="mt-1 text-[11px] text-white/40">Geht nie an die Person.</p>
            </div>
            <button onClick={() => remove(active.id)} className="w-full px-4 py-2 border border-[#FF3B30]/30 text-[#FF3B30] font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#FF3B30]/10 inline-flex items-center justify-center gap-2"><Trash2 className="w-3.5 h-3.5" /> Löschen</button>
          </div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-4">Kontakt-Inbox</h1>
      <SpamCounter stats={spamStats} />
      {suspicious > 0 && view !== "spam" && (
        <button type="button" onClick={() => pick("spam")} data-testid="contact-suspicious-hint"
          className="mb-6 w-full text-left border border-warn/40 bg-warn/5 rounded-sm px-4 py-3 text-sm text-white/85 hover:bg-warn/10 inline-flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-warn shrink-0" />
          <span><strong>{suspicious === 1 ? "1 verdächtige Nachricht" : `${suspicious} verdächtige Nachrichten`}</strong> im Spam-Ordner – bitte kurz prüfen. Echte Anfragen holt „Kein Spam“ zurück.</span>
        </button>
      )}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {Object.entries(STATUS_LABEL).map(([k, v]) => (
          <button key={k} onClick={() => pick(k)} aria-pressed={view === k} data-testid={`contact-stat-${k}`}
            className={`border rounded-sm p-3 text-left ${view === k ? v.c : "border-white/10 bg-[#121212] text-white/70 hover:border-white/20"}`}>
            <Inbox className="w-4 h-4 mb-1" />
            <div className="text-2xl font-black">{counts[k] || 0}</div>
            <div className="text-[10px] uppercase tracking-widest">{v.l}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4" data-testid="contact-filters">
        <div className="flex gap-1" role="group" aria-label="Ansicht">
          {VIEWS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={view === key} onClick={() => { setView(key); setPage(1); }} data-testid={`contact-view-${key}`}
              className={`px-3 py-2 border rounded-sm text-[11px] font-bold uppercase tracking-wider ${view === key ? "border-[#29B6E8] text-[#29B6E8] bg-[#29B6E8]/10" : "border-white/15 text-white/55 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
        <label className="relative flex-1 min-w-[min(14rem,100%)]">
          <span className="sr-only">Suche in Name, Adresse, Betreff und Text</span>
          <Search className="w-3.5 h-3.5 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input type="search" value={search} maxLength={120} onChange={(e) => setSearch(e.target.value)} placeholder="Name, Adresse, Betreff oder Text" data-testid="contact-search"
            className="w-full bg-[#0A0A0A] border border-white/10 pl-9 pr-3 py-2 rounded-sm text-sm" />
        </label>
        <select value={assigned} onChange={(e) => { setAssigned(e.target.value); setPage(1); }} aria-label="Zuständig" data-testid="contact-assigned-filter"
          className="bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm max-w-full">
          {ASSIGNED_FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {loadError && <div className="mb-4 border border-live/40 bg-live/10 rounded-sm p-3 text-sm" data-testid="contact-load-error">{loadError}</div>}

      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
        <div className="tls-swipe pb-0">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr>
                <th className="text-left px-4 py-3">Datum</th>
                <th className="text-left px-4 py-3">Von</th>
                <th className="text-left px-4 py-3">Thema</th>
                <th className="text-left px-4 py-3">Betreff</th>
                <th className="text-left px-4 py-3">Zuständig</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {items.length === 0 ? (
                <tr><td colSpan="6" className="text-center py-12">
                  <MailOpen className="w-10 h-10 text-white/20 mx-auto mb-2" />
                  <p className="text-white/50" data-testid="contact-empty">{query ? "Nichts gefunden." : view === "open" ? "Nichts offen." : "Keine Nachrichten."}</p>
                </td></tr>
              ) : items.map((m) => {
                const s = STATUS_LABEL[m.status] || STATUS_LABEL.new;
                return (
                  <tr key={m.id} onClick={() => openMessage(m)} data-testid={`contact-row-${m.id}`} className="cursor-pointer hover:bg-white/5">
                    <td className="px-4 py-3 text-white/50 text-xs whitespace-nowrap">{viennaDate(m.created_at)}</td>
                    <td className="px-4 py-3"><div className="text-white/85">{m.name}</div><div className="text-xs text-white/40">{m.email}</div></td>
                    <td className="px-4 py-3 text-xs text-[#29B6E8]" data-testid={`contact-topic-${m.id}`}>{topics[m.topic] || m.topic}</td>
                    <td className="px-4 py-3"><div className="font-semibold truncate max-w-md">{m.subject}</div></td>
                    <td className="px-4 py-3 text-xs text-white/60">{m.assigned_to_name || "–"}</td>
                    <td className="px-4 py-3"><span className={`inline-flex text-xs font-bold uppercase tracking-wider px-2 py-1 rounded-sm border ${s.c}`}>{s.l}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-white/50" data-testid="contact-paging">
        <span data-testid="contact-total">{total === 1 ? "1 Nachricht" : `${total} Nachrichten`} in dieser Ansicht</span>
        {pages > 1 && (
          <div className="flex items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)} data-testid="contact-page-prev" className="px-3 py-1.5 border border-white/15 rounded-sm disabled:opacity-40">Zurück</button>
            <span>Seite {page} von {pages}</span>
            <button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)} data-testid="contact-page-next" className="px-3 py-1.5 border border-white/15 rounded-sm disabled:opacity-40">Weiter</button>
          </div>
        )}
      </div>

      <div className="mt-6 border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-4 flex items-start gap-3">
        <AlertCircle className="w-5 h-5 text-[#29B6E8] shrink-0 mt-0.5" />
        <div className="text-sm text-white/80" data-testid="contact-note-hint">
          <strong>Hinweis:</strong> Jede Nachricht löst automatisch eine Bestätigungsmail an den Absender und eine Benachrichtigung an die Vereins-E-Mail aus (über die Mail-Queue). Ausnahme: Nachrichten, die der Spamschutz als „Spam“ markiert – sie stehen unter dem Filter „Spam“, und „Kein Spam“ holt die Mails nach. Sicher erkannte Bots werden gar nicht gespeichert, nur gezählt.
          {inbox?.retention && <> Erledigte Anfragen werden {inbox.retention.done_days} Tage nach dem letzten Statuswechsel gelöscht, Spam nach {inbox.retention.spam_days} Tagen – einstellbar unter Betrieb → Alarme.</>}
        </div>
      </div>
    </AdminLayout>
  );
}
