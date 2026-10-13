import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Megaphone, Minus, Plus, Printer, Search, Undo2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Breadcrumbs } from "@/components/tls/Breadcrumbs";
import { api, formatApiError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { viennaDate, viennaDateTime } from "@/lib/vienna";
import {
  LEAD_FILTERS, MESSAGE_MAX, MESSAGE_TEMPLATES, STATUS_LABELS,
  changeText, companionsText, counterText, filterRows, leadCounts, messagePreview, seatsText,
} from "@/lib/eventLead";

// Anmeldungen & Einlass (#1372): /events/<slug>/leitung - nur für die Turnierleitung. An der Tür (Handy): Suchfeld und
// Zähler fest oben, große „Da“-Knöpfe, danach 10 Sekunden „Rückgängig“. Tablet quer und PC: Liste links, Details der
// Person rechts. Nachrücken von der Warteliste prüft der Server (Plätze). „Nachricht an alle“ geht an die Angemeldeten,
// erst nach Bestätigung der Empfängerzahl. „Drucken“ gibt eine schlichte Liste mit Kästchen aus.

const UNDO_SECONDS = 10;
const STATUS_ORDER = ["registered", "checked_in", "waitlist", "no_show", "cancelled"];

export default function EventLeadPage() {
  const { slug } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [rows, setRows] = useState([]);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("open");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busyId, setBusyId] = useState("");
  const [undo, setUndo] = useState(null);
  const [messageOpen, setMessageOpen] = useState(false);
  const searchRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const { data: view } = await api.get(`/events/${encodeURIComponent(slug)}/lead`, { params: { filter: "all" } });
      setData(view);
      setRows(view.registrations || []);
      setError(null);
    } catch (err) {
      setError({ status: err.response?.status || 0, detail: formatApiError(err.response?.data?.detail) });
    }
  }, [slug]);

  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["events"], { fallbackMs: 15000 });
  useDocumentTitle(data?.event?.name ? `Anmeldungen & Einlass · ${data.event.name}` : "Anmeldungen & Einlass", "Anmeldungen und Einlass für die Turnierleitung.", { robots: "noindex, nofollow" });

  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_SECONDS * 1000);
    return () => clearTimeout(timer);
  }, [undo]);

  const counts = useMemo(() => leadCounts(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, filter, query), [rows, filter, query]);
  const selected = rows.find((row) => row.id === selectedId) || null;
  const event = data?.event || {};

  // Jede Änderung über den vorhandenen Weg der Anmeldungen: der Server prüft Plätze, Preis und Belohnung.
  const change = async (row, payload, { offerUndo = false } = {}) => {
    const before = rows;
    setBusyId(row.id);
    setRows((list) => list.map((item) => (item.id === row.id ? { ...item, ...payload } : item)));
    try {
      await api.patch(`/events/${event.id}/registrations/${row.id}`, payload);
      if (payload.status) {
        const sentence = changeText(row, payload.status);
        if (offerUndo) setUndo({ row: { ...row, ...payload }, previous: row.status, sentence });
        else toast.success(sentence);
      }
      await load();
    } catch (err) {
      setRows(before);
      toast.error(formatApiError(err.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusyId("");
    }
  };

  const checkIn = async (row) => {
    await change(row, { status: "checked_in" }, { offerUndo: true });
    // An der Tür geht es mit dem nächsten Namen weiter.
    setQuery("");
    searchRef.current?.focus?.();
  };
  const undoLast = async () => {
    if (!undo) return;
    const { row, previous } = undo;
    setUndo(null);
    await change(row, { status: previous });
  };

  if (error) {
    const eventUrl = `/events/${slug}`;
    return (
      <PublicLayout>
        <section className="max-w-3xl mx-auto px-4 py-16 text-center" data-testid="event-lead-denied">
          <h1 className="font-heading text-2xl font-black uppercase">Anmeldungen & Einlass</h1>
          <p className="mt-3 text-white/60">{error.status === 401 || !user ? "Bitte melde dich an – diese Ansicht ist für die Turnierleitung." : error.detail || "Diese Ansicht ist nur für die Turnierleitung."}</p>
          {!user ? <Link to={`/login?next=/events/${slug}/leitung`} className="tls-btn tls-btn--primary mt-6 inline-flex px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">Anmelden</Link> : <Link to={eventUrl} className="tls-btn tls-btn--secondary mt-6 inline-flex px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">Zum Event</Link>}
        </section>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-28 print:hidden" data-testid="event-lead-page">
        <Breadcrumbs items={[{ label: "Events", to: "/events" }, { label: event.name || "Event", to: `/events/${event.slug || slug}` }, { label: "Anmeldungen & Einlass" }]} className="mb-4" />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.3em] text-[#29B6E8] font-bold">Anmeldungen & Einlass</div>
            <h1 className="mt-1 font-heading text-2xl md:text-4xl font-black uppercase [overflow-wrap:anywhere]">{event.name || "…"}</h1>
            {event.start_date ? <div className="mt-1 text-sm text-white/50">{viennaDateTime(event.start_date, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</div> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {data?.can_message ? (
              <button type="button" onClick={() => setMessageOpen(true)} className="tls-btn tls-btn--secondary inline-flex min-h-[44px] items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="event-lead-message-open">
                <Megaphone className="w-4 h-4" /> Nachricht an alle
              </button>
            ) : null}
            <button type="button" onClick={() => window.print()} className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center gap-2 px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="event-lead-print">
              <Printer className="w-4 h-4" /> Drucken
            </button>
          </div>
        </div>

        {/* Fest oben (Handy an der Tür): Zähler, Suche, Filter. */}
        <div className="sticky top-16 md:top-20 z-30 -mx-4 sm:-mx-6 mt-4 border-b border-white/10 bg-[#0A0A0A]/95 px-4 sm:px-6 py-3 backdrop-blur-sm" data-testid="event-lead-bar">
          <div className="flex items-baseline justify-between gap-3">
            <div className="font-heading text-2xl md:text-3xl font-black" data-testid="event-lead-counter" aria-live="polite">{counterText(counts)}</div>
            <div className="text-right text-xs text-white/50">
              {seatsText(counts) ? <div data-testid="event-lead-seats">{seatsText(counts)}</div> : null}
              {event.max_participants ? <div>{counts.expected_seats} von {event.max_participants} Plätzen vergeben</div> : null}
            </div>
          </div>
          <label className="mt-3 flex items-center gap-2 rounded-sm border border-white/15 bg-[#121212] px-3 focus-within:border-[#29B6E8]">
            <Search className="w-4 h-4 shrink-0 text-white/40" aria-hidden="true" />
            <span className="sr-only">Name suchen</span>
            <input ref={searchRef} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name suchen …" autoComplete="off" className="min-h-[48px] w-full bg-transparent text-base text-white outline-none placeholder:text-white/35" data-testid="event-lead-search" />
          </label>
          <div className="mt-3 grid grid-cols-4 gap-1 rounded-sm border border-white/10 bg-white/5 p-1" role="group" aria-label="Filter" data-testid="event-lead-filters">
            {LEAD_FILTERS.map(([key, label]) => (
              <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={`min-h-[40px] rounded-sm px-1 text-[11px] sm:text-xs font-bold uppercase tracking-wider ${filter === key ? "bg-[#29B6E8] text-black" : "text-white/60"}`} data-testid={`event-lead-filter-${key}`}>
                {label} ({counts[key] ?? 0})
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
          <div>
            <div className="space-y-2" data-testid="event-lead-list">
              {!data ? <div className="py-10 text-center text-white/40">Wird geladen …</div> : null}
              {data && shown.length === 0 ? (
                <div className="rounded-sm border border-white/10 bg-[#121212] p-6 text-center text-white/50" data-testid="event-lead-empty">
                  {query ? `Niemand mit „${query}“ in dieser Liste.` : filter === "open" && counts.expected ? "Alle sind da." : "Hier steht gerade niemand."}
                </div>
              ) : null}
              {shown.map((row) => (
                <div key={row.id}>
                  <RegistrationRow row={row} busy={busyId === row.id} selected={selectedId === row.id} showStatus={filter === "all"}
                    onSelect={() => setSelectedId(selectedId === row.id ? "" : row.id)} onCheckIn={() => checkIn(row)}
                    onUndo={() => change(row, { status: "registered" })} onMoveUp={() => change(row, { status: "registered" })} />
                  {selectedId === row.id ? (
                    <div className="lg:hidden mt-1"><Details row={row} event={event} busy={busyId === row.id} onChange={(payload) => change(row, payload)} /></div>
                  ) : null}
                </div>
              ))}
            </div>
            <MessageLog messages={data?.messages || []} />
          </div>
          <aside className="hidden lg:block" data-testid="event-lead-aside">
            <div className="sticky top-[19rem]">
              {selected ? <Details row={selected} event={event} busy={busyId === selected.id} onChange={(payload) => change(selected, payload)} onClose={() => setSelectedId("")} /> : (
                <div className="rounded-sm border border-dashed border-white/10 p-6 text-sm text-white/45">Tippe auf einen Namen für Details: Begleitpersonen, Notiz und Status.</div>
              )}
            </div>
          </aside>
        </div>
        <p className="mt-6 text-xs text-white/40">Jede Änderung steht im Protokoll (wer, wann, was). Mail-Adressen stehen hier nur gekürzt.</p>
      </section>

      <PrintSheet event={event} rows={rows} counts={counts} />
      {undo ? <UndoBar undo={undo} onUndo={undoLast} /> : null}
      {messageOpen ? <MessageDialog event={event} recipients={data?.message_recipients || 0} onClose={() => setMessageOpen(false)} onSent={load} /> : null}
    </PublicLayout>
  );
}

function RegistrationRow({ row, busy, selected, showStatus, onSelect, onCheckIn, onUndo, onMoveUp }) {
  const here = row.status === "checked_in";
  const sub = [companionsText(row), showStatus ? STATUS_LABELS[row.status] || row.status : ""].filter(Boolean).join(" · ");
  return (
    <div className={`flex items-center gap-3 rounded-sm border p-3 ${selected ? "border-[#29B6E8]/60 bg-[#29B6E8]/5" : "border-white/10 bg-[#121212]"}`} data-testid={`event-lead-row-${row.id}`} data-status={row.status}>
      <button type="button" onClick={onSelect} aria-expanded={selected} className="min-w-0 flex-1 text-left" data-testid={`event-lead-name-${row.id}`}>
        <span className="flex items-center gap-2">
          {here ? <Check className="w-4 h-4 shrink-0 text-[color:var(--tls-success)]" aria-label="da" /> : null}
          <span className="block truncate text-base font-bold text-white">{row.display_name}</span>
        </span>
        {sub ? <span className="mt-0.5 block truncate text-xs text-white/55">{sub}</span> : null}
      </button>
      {row.status === "registered" ? (
        <button type="button" disabled={busy} onClick={onCheckIn} className="tls-btn tls-btn--primary shrink-0 min-h-[48px] min-w-[84px] px-5 py-2 rounded-sm text-sm uppercase tracking-wider font-black" data-testid={`event-lead-checkin-${row.id}`}>Da</button>
      ) : here ? (
        <button type="button" disabled={busy} onClick={onUndo} className="tls-btn tls-btn--quiet shrink-0 min-h-[44px] px-3 py-2 rounded-sm text-[11px] uppercase tracking-wider font-bold" data-testid={`event-lead-undo-${row.id}`}>Rückgängig</button>
      ) : row.status === "waitlist" ? (
        <button type="button" disabled={busy} onClick={onMoveUp} className="tls-btn tls-btn--secondary shrink-0 min-h-[44px] px-3 py-2 rounded-sm text-[11px] uppercase tracking-wider font-bold" data-testid={`event-lead-moveup-${row.id}`}>Nachrücken</button>
      ) : (
        <span className="shrink-0 text-[11px] font-bold uppercase tracking-wider text-white/40">{STATUS_LABELS[row.status] || row.status}</span>
      )}
    </div>
  );
}

function Details({ row, event, busy, onChange, onClose }) {
  const maxCompanions = event.allow_companions ? event.max_companions_per_registration || 0 : 0;
  return (
    <div className="rounded-sm border border-white/10 bg-[#121212] p-4" data-testid="event-lead-details">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-lg font-bold text-white [overflow-wrap:anywhere]">{row.display_name}</div>
          {row.email_masked ? <div className="text-xs text-white/45" data-testid="event-lead-mail">{row.email_masked}</div> : null}
        </div>
        {onClose ? (
          <button type="button" onClick={onClose} aria-label="Details schließen" className="tls-btn tls-btn--quiet shrink-0 p-2 rounded-sm"><X className="w-4 h-4" /></button>
        ) : null}
      </div>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/50">Plätze</dt>
          <dd className="font-bold text-white">{row.seat_count}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-white/50">Begleitpersonen</dt>
          <dd className="flex items-center gap-2">
            {maxCompanions ? (
              <button type="button" aria-label="Eine Begleitperson weniger" disabled={busy || row.companion_count <= 0} onClick={() => onChange({ companion_count: row.companion_count - 1 })} className="tls-btn tls-btn--quiet p-2 rounded-sm" data-testid="event-lead-companions-minus"><Minus className="w-4 h-4" /></button>
            ) : null}
            <span className="min-w-[2ch] text-center font-bold text-white" data-testid="event-lead-companions">{row.companion_count}</span>
            {maxCompanions ? (
              <button type="button" aria-label="Eine Begleitperson mehr" disabled={busy || row.companion_count >= maxCompanions} onClick={() => onChange({ companion_count: row.companion_count + 1 })} className="tls-btn tls-btn--quiet p-2 rounded-sm" data-testid="event-lead-companions-plus"><Plus className="w-4 h-4" /></button>
            ) : null}
          </dd>
        </div>
        {row.note ? (
          <div>
            <dt className="text-white/50">Notiz der Person</dt>
            <dd className="mt-0.5 whitespace-pre-line text-white/80 [overflow-wrap:anywhere]">{row.note}</dd>
          </div>
        ) : null}
        {row.internal_note ? (
          <div>
            <dt className="text-white/50">Interne Notiz</dt>
            <dd className="mt-0.5 whitespace-pre-line text-white/80 [overflow-wrap:anywhere]">{row.internal_note}</dd>
          </div>
        ) : null}
      </dl>
      <label className="mt-4 block text-[11px] font-bold uppercase tracking-widest text-white/50">
        Status
        <select value={row.status || "registered"} disabled={busy} onChange={(e) => onChange({ status: e.target.value })} className="mt-1 block w-full min-h-[44px] rounded-sm border border-white/10 bg-[#0A0A0A] px-2 text-sm normal-case tracking-normal text-white" data-testid="event-lead-status">
          {STATUS_ORDER.map((status) => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
        </select>
      </label>
      {row.created_at ? <div className="mt-3 text-xs text-white/40">Angemeldet am {viennaDateTime(row.created_at, { dateStyle: "medium", timeStyle: "short" })}</div> : null}
    </div>
  );
}

function UndoBar({ undo, onUndo }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 pointer-events-none print:hidden" data-testid="event-lead-undo-bar">
      <div className="pointer-events-auto mx-auto flex max-w-xl items-center gap-3 rounded-lg border border-[#29B6E8]/40 bg-[#0F1D23] px-4 py-3 shadow-2xl shadow-black/60" role="status" aria-live="polite">
        <div className="min-w-0 flex-1 text-sm text-white/85 truncate">{undo.sentence}</div>
        <button type="button" onClick={onUndo} className="tls-btn tls-btn--secondary shrink-0 inline-flex min-h-[44px] items-center gap-2 px-3 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="event-lead-undo-last">
          <Undo2 className="w-4 h-4" /> Rückgängig
        </button>
      </div>
    </div>
  );
}

function MessageDialog({ event, recipients, onClose, onSent }) {
  const [text, setText] = useState("");
  const [step, setStep] = useState("write");
  const [sending, setSending] = useState(false);
  const trimmed = text.trim();

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    setSending(true);
    try {
      const { data } = await api.post(`/events/${event.id}/lead/message`, { text: trimmed, confirm_count: recipients });
      toast.success(`Gesendet an ${data.recipient_count} ${data.recipient_count === 1 ? "Person" : "Personen"}.`);
      await onSent();
      onClose();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Die Nachricht ging nicht hinaus.");
      // Hat sich die Zahl geändert, zeigt die Vorschau nach dem Neuladen die neue - und es braucht eine neue Bestätigung.
      setStep("write");
      await onSent();
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/70 p-0 sm:p-4 print:hidden" role="dialog" aria-modal="true" aria-labelledby="event-lead-message-title" data-testid="event-lead-message">
      <div className="w-full max-w-lg rounded-t-lg sm:rounded-sm border border-white/10 bg-[#121212] p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Nachricht an alle Angemeldeten</div>
            <h2 id="event-lead-message-title" className="mt-1 font-heading text-lg font-black uppercase [overflow-wrap:anywhere]">{event.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Schließen" className="tls-btn tls-btn--quiet shrink-0 p-2 rounded-sm"><X className="w-4 h-4" /></button>
        </div>
        {step === "write" ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2" data-testid="event-lead-templates">
              {MESSAGE_TEMPLATES.map((template) => (
                <button key={template} type="button" onClick={() => setText(template)} className="tls-btn tls-btn--quiet px-2 py-1 rounded-sm text-xs text-left">{template}</button>
              ))}
            </div>
            <label className="mt-4 block text-[11px] font-bold uppercase tracking-widest text-white/50">
              Text
              <textarea value={text} onChange={(e) => setText(e.target.value.slice(0, MESSAGE_MAX))} rows={4} className="mt-1 block w-full rounded-sm border border-white/10 bg-[#0A0A0A] p-3 text-sm normal-case tracking-normal text-white" data-testid="event-lead-message-text" />
            </label>
            <div className="mt-1 text-right text-[11px] text-white/40">{text.length} / {MESSAGE_MAX}</div>
            <p className="mt-2 flex items-start gap-2 text-sm text-white/70" data-testid="event-lead-message-preview"><Users className="mt-0.5 w-4 h-4 shrink-0 text-[#29B6E8]" /> {messagePreview(recipients)}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="tls-btn tls-btn--quiet min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">Abbrechen</button>
              <button type="button" disabled={!trimmed || !recipients} onClick={() => setStep("confirm")} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="event-lead-message-next">Weiter</button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm text-white/80" data-testid="event-lead-message-confirm">Wirklich an <strong>{recipients} {recipients === 1 ? "Person" : "Personen"}</strong> senden? Das lässt sich nicht zurückholen.</p>
            <blockquote className="mt-3 whitespace-pre-line border-l-2 border-[#29B6E8] pl-3 text-sm text-white/70 [overflow-wrap:anywhere]">{trimmed}</blockquote>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" disabled={sending} onClick={() => setStep("write")} className="tls-btn tls-btn--quiet min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold">Zurück</button>
              <button type="button" disabled={sending} onClick={send} className="tls-btn tls-btn--primary min-h-[44px] px-4 py-2 rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="event-lead-message-send">{sending ? "Wird gesendet …" : `An ${recipients} senden`}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function MessageLog({ messages }) {
  if (!messages.length) return null;
  return (
    <div className="mt-8" data-testid="event-lead-log">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/40">Nachrichten an alle</div>
      <ul className="mt-2 space-y-2">
        {messages.map((message) => (
          <li key={message.id} className="rounded-sm border border-white/10 bg-[#121212] p-3">
            <div className="text-xs text-white/45">{viennaDateTime(message.created_at, { dateStyle: "short", timeStyle: "short" })} · {message.actor_name || "Turnierleitung"} · an {message.recipient_count}</div>
            <div className="mt-1 whitespace-pre-line text-sm text-white/80 [overflow-wrap:anywhere]">{message.text}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Drucken: eine schlichte Liste mit Kästchen - die Angemeldeten nach Namen. Die Druckansichten aus #1283 übernehmen sie.
function PrintSheet({ event, rows, counts }) {
  const expected = rows.filter((row) => row.status === "registered" || row.status === "checked_in");
  return (
    <div className="tls-print-sheet hidden print:block bg-white p-6 text-black" data-testid="event-lead-print-sheet">
      <h1 className="text-xl font-bold">{event.name} – Anmeldungen</h1>
      <p className="text-sm">{event.start_date ? viennaDate(event.start_date) : ""} · {counts.expected} Anmeldungen · {counts.expected_seats} Plätze</p>
      <table className="mt-4 w-full border-collapse text-sm">
        <thead>
          <tr><th className="w-10 border-b border-black py-1 text-left">Da</th><th className="border-b border-black py-1 text-left">Name</th><th className="border-b border-black py-1 text-left">Begleitpersonen</th></tr>
        </thead>
        <tbody>
          {expected.map((row) => (
            <tr key={row.id}>
              <td className="border-b border-black/30 py-2"><span className="inline-block h-4 w-4 border border-black" aria-hidden="true" /></td>
              <td className="border-b border-black/30 py-2">{row.display_name}</td>
              <td className="border-b border-black/30 py-2">{row.companion_count || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
