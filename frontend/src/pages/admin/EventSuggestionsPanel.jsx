import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CalendarPlus, EyeOff, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";

// Öffentliche Events aus Dolibarr (#850): Vorschläge zum Übernehmen als Entwurf, und bei verknüpften Events, was sich in
// Dolibarr geändert hat - übernehmen oder ignorieren, nie still überschrieben. Ohne Dolibarr-Anbindung und ohne Vorschlag
// bleibt der Kasten weg.

const germanDay = (day) => (day ? day.split("-").reverse().join(".") : "");
const STATUS_WORDS = { planned: "geplant", done: "vorbei", cancelled: "abgesagt", draft: "Entwurf", scheduled: "geplant", live: "läuft", completed: "vorbei" };

export function daysText(row) {
  return row.end_day && row.end_day !== row.day ? `${germanDay(row.day)} – ${germanDay(row.end_day)}` : germanDay(row.day);
}

export function differenceText(diff) {
  const show = (value) => {
    if (diff.field === "day" || diff.field === "end_day") return germanDay(value) || "–";
    if (diff.field === "status") return STATUS_WORDS[value] || value || "–";
    return value || "–";
  };
  return `${diff.label}: in Dolibarr jetzt ${show(diff.dolibarr)} (vorher ${show(diff.before)}), auf der Website ${show(diff.website)}`;
}

export function EventSuggestionsPanel() {
  const navigate = useNavigate();
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/admin/event-suggestions");
      setView(data);
    } catch {
      setView(null);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (key, action, done) => {
    setBusy(key);
    try {
      const { data } = await action();
      if (done) done(data);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail) || "Das hat nicht geklappt.");
    } finally {
      setBusy("");
    }
  };

  if (!view?.live) return null;
  const suggestions = view.suggestions || [];
  const changed = view.changed || [];

  return (
    <section className="mb-4 rounded-sm border border-[#9F7AEA]/30 bg-[#121212] p-4 space-y-3" data-testid="event-suggestions">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-heading text-lg font-black uppercase">Aus Dolibarr</h2>
        <span className="text-xs text-white/45">
          {view.fetched_at ? `Stand ${new Date(view.fetched_at).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : "Noch nicht gelesen"}
          {view.error_text ? <span className="text-[#FF3B30]"> · Letzter Abruf fehlgeschlagen ({view.error_text}) – alter Stand bleibt.</span> : null}
        </span>
        <button type="button" onClick={() => act("refresh", () => api.post("/admin/event-suggestions/refresh"), (data) => setView(data.view))} disabled={!!busy}
          data-testid="event-suggestions-refresh" className="ml-auto inline-flex items-center gap-1 px-3 py-1 border border-white/20 text-white/80 rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
          <RefreshCw className={`w-3 h-3 ${busy === "refresh" ? "animate-spin" : ""}`} /> Jetzt nachlesen
        </button>
      </div>
      {!suggestions.length && !changed.length ? (
        <p className="text-sm text-white/45" data-testid="event-suggestions-empty">Keine neuen öffentlichen Events in Dolibarr, nichts geändert.</p>
      ) : null}
      {suggestions.length ? (
        <ul className="space-y-2" data-testid="event-suggestions-list">
          {suggestions.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border border-white/10 rounded-sm p-3 text-sm" data-testid={`event-suggestion-${row.id}`}>
              <div className="min-w-0">
                <div className="font-bold">{row.label}</div>
                <div className="text-xs text-white/55">{daysText(row)}{row.place ? ` · ${row.place}` : ""} · {row.registration_label}</div>
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <button type="button" disabled={!!busy} data-testid={`event-suggestion-adopt-${row.id}`}
                  onClick={() => act(`adopt-${row.id}`, () => api.post(`/admin/event-suggestions/${row.id}/adopt`), (data) => {
                    toast.success("Als Entwurf übernommen – bitte Uhrzeit und Text ergänzen.");
                    navigate(`/admin/events/${data.event_id}`);
                  })}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm bg-[#9F7AEA] text-black text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
                  <CalendarPlus className="w-3.5 h-3.5" /> Als Entwurf übernehmen
                </button>
                <button type="button" disabled={!!busy} data-testid={`event-suggestion-dismiss-${row.id}`}
                  onClick={() => act(`dismiss-${row.id}`, () => api.post(`/admin/event-suggestions/${row.id}/dismiss`), setView)}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm border border-white/15 text-white/60 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
                  <EyeOff className="w-3.5 h-3.5" /> Ausblenden
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
      {changed.length ? (
        <div className="space-y-2" data-testid="event-suggestions-changed">
          <div className="text-xs font-bold uppercase tracking-widest text-[#FFD700]">In Dolibarr geändert</div>
          {changed.map((item) => (
            <div key={item.event_id} className="border border-[#FFD700]/30 rounded-sm p-3 text-sm space-y-2" data-testid={`event-changed-${item.event_id}`}>
              <div className="font-bold">{item.event_name}</div>
              {item.differences.map((diff) => (
                <div key={diff.field} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-white/70">{differenceText(diff)}</span>
                  <span className="ml-auto flex gap-2">
                    <button type="button" disabled={!!busy} data-testid={`event-changed-take-${item.dolibarr.id}-${diff.field}`}
                      onClick={() => act(`take-${diff.field}`, () => api.post(`/admin/event-suggestions/${item.dolibarr.id}/settle`, { field: diff.field, take: true }), setView)}
                      className="px-3 py-1 rounded-sm border border-[#9F7AEA]/50 text-[#9F7AEA] text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Übernehmen</button>
                    <button type="button" disabled={!!busy} data-testid={`event-changed-ignore-${item.dolibarr.id}-${diff.field}`}
                      onClick={() => act(`ignore-${diff.field}`, () => api.post(`/admin/event-suggestions/${item.dolibarr.id}/settle`, { field: diff.field, take: false }), setView)}
                      className="px-3 py-1 rounded-sm border border-white/15 text-white/60 text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">Ignorieren</button>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
