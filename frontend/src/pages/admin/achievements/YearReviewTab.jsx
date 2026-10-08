import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Eye, Sparkles } from "lucide-react";
import { api } from "@/lib/api";
import { Panel, errorText } from "./shared";

/**
 * Jahresrückblick (#1195): wann „Dein Jahr bei LION“ zu sehen ist - Start (Standard 15.12.) und Ende (Standard
 * 31.01.). Am Starttag kommt einmal die Meldung „Dein Jahr ist da“ an alle mit Aktivität im Jahr (Thema „Erfolge“).
 * Die Vorschau zeigt den eigenen Rückblick schon vor dem Start.
 */
export function YearReviewTab() {
  const [view, setView] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);

  const apply = (data) => {
    setView(data);
    setStart(data?.start_label || "15.12.");
    setEnd(data?.end_label || "31.1.");
  };
  useEffect(() => {
    api.get("/admin/year-review").then(({ data }) => apply(data)).catch((err) => toast.error(errorText(err)));
  }, []);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      const { data } = await api.put("/admin/year-review", { start, end });
      apply(data);
      toast.success("Zeitraum gespeichert.");
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="year-review-tab">
      <Panel title="Jahresrückblick" icon={Sparkles} hint="„Dein Jahr bei LION“ zum Durchtippen in App und Website – für alle, die im Jahr gespielt, ein Event besucht oder eine Fast Lap gefahren haben. Wer nichts gemacht hat, bekommt nichts.">
        <div className="space-y-4">
          {view ? (
            <p className="text-sm text-white/75" data-testid="year-review-window">
              {view.open ? "Läuft gerade" : "Nächster Rückblick"}: {view.year} – zu sehen vom {view.from_label} bis {view.until_label}.
              {" "}{view.notified ? `„Dein Jahr ist da“ ging an ${view.notified} ${view.notified === 1 ? "Person" : "Personen"}.` : "Die Meldung geht am Starttag raus."}
            </p>
          ) : null}
          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/55">
              Start (Tag.Monat)
              <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="15.12." inputMode="numeric" className="mt-1 block w-28 bg-[#0A0A0A] border border-white/15 rounded-sm px-3 py-2 text-sm text-white normal-case tracking-normal" data-testid="year-review-start" />
            </label>
            <label className="text-[11px] font-bold uppercase tracking-widest text-white/55">
              Ende (Tag.Monat)
              <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder="31.1." inputMode="numeric" className="mt-1 block w-28 bg-[#0A0A0A] border border-white/15 rounded-sm px-3 py-2 text-sm text-white normal-case tracking-normal" data-testid="year-review-end" />
            </label>
            <button type="submit" disabled={busy} className="tls-btn tls-btn--primary px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-sm disabled:opacity-50" data-testid="year-review-save">Speichern</button>
          </form>
          <p className="text-xs text-white/45">Start zwischen Oktober und Dezember, Ende zwischen Jänner und März. Standard: 15.12. bis 31.1.</p>
          <Link to="/dein-jahr?vorschau=1" className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 text-xs font-bold uppercase tracking-widest rounded-sm" data-testid="year-review-preview">
            <Eye className="w-3.5 h-3.5" /> Vorschau mit deinen Zahlen
          </Link>
        </div>
      </Panel>
    </div>
  );
}

export default YearReviewTab;
