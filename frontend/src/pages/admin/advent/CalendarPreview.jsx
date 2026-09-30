import { useCallback, useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { api, formatApiError } from "@/lib/api";
import { AdventBoard } from "@/advent/AdventBoard";
import { DoorDialog } from "@/advent/DoorDialog";
import { doorVariant } from "@/advent/doors";
import { INPUT_CLASS } from "@/components/tls/FormFields";
import { defaultMoment, previewMoments } from "./form";

// Vorschau des Adventkalenders (#641): der Kalender, wie ihn Gäste zu einem gewählten Tag sähen. Alle bis dahin
// offenen Türchen zeigen ihren Inhalt; gezählt wird dabei nichts, und mitmachen kann hier niemand. Die Auflösung
// des Quiz kommt aus der Pflege - die Vorschau fragt den Server nicht nach Antworten.

export function CalendarPreview({ year, doors, onClose }) {
  const moments = useMemo(() => previewMoments(year), [year]);
  const [moment, setMoment] = useState(() => defaultMoment(year));
  const [calendar, setCalendar] = useState(null);
  const [problem, setProblem] = useState("");
  const [shownDay, setShownDay] = useState(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    setProblem("");
    api.get(`/seasonal/advent/admin/${year}/preview`, { params: { at: moment }, skipInvalidation: true })
      .then(({ data }) => {
        if (!cancelled) setCalendar(data);
      })
      .catch((failure) => {
        if (!cancelled) setProblem(formatApiError(failure?.response?.data?.detail) || "Die Vorschau lässt sich gerade nicht laden.");
      });
    return () => {
      cancelled = true;
    };
  }, [year, moment]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape" && shownDay === null) onClose();
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [onClose, shownDay]);

  const shown = shownDay === null ? null : (calendar?.doors || []).find((door) => door.day === shownDay && door.state === "opened") || null;
  const answer = useCallback(async (day, choice) => {
    const quiz = doors.find((item) => item.day === day)?.door?.quiz;
    if (!quiz) throw new Error("kein Quiz");
    return { day, correct: choice === quiz.correct, correct_index: quiz.correct, correct_answer: quiz.answers[quiz.correct], explanation: quiz.explanation || "", done: true };
  }, [doors]);
  const raffle = useCallback(async () => {
    const error = new Error("Vorschau");
    error.response = { data: { detail: "In der Vorschau nimmt niemand teil – sie zeigt nur, wie es aussieht." } };
    throw error;
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-[#060606]/95 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`Vorschau Adventkalender ${year}`} data-testid="advent-preview">
      <div className="flex flex-wrap items-end gap-3 border-b border-white/10 bg-[#0A0A0A] px-4 py-3 md:px-6">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#e9c46a]">Vorschau</div>
          <h2 className="font-heading text-xl font-black uppercase">Adventkalender {year}</h2>
        </div>
        <label className="ml-auto block min-w-[15rem] max-w-full flex-1 sm:flex-none">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-widest text-white/60">So sieht er aus am …</span>
          <select value={moment} onChange={(event) => { setShownDay(null); setNote(""); setMoment(event.target.value); }} className={INPUT_CLASS} data-testid="advent-preview-moment">
            {moments.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={onClose} aria-label="Vorschau schließen" data-testid="advent-preview-close" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-sm border border-white/10 text-white/60 transition hover:text-white">
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-6">
        <div className="tls-adv mx-auto w-full max-w-[1180px]">
          <p className="mb-4 text-sm text-white/55">Hier wird nichts gezählt. Geöffnet ist, was Gäste an diesem Tag schon öffnen dürfen – ein Klick zeigt den Inhalt.</p>
          {problem && <div className="rounded-sm border border-[#FF3B30]/40 bg-[#FF3B30]/10 px-4 py-3 text-sm text-[#ffb4ae]" role="alert" data-testid="advent-preview-problem">{problem}</div>}
          {calendar?.active === false && <div className="rounded-sm border border-white/10 bg-[#121212] p-8 text-center text-white/60" data-testid="advent-preview-empty">Für {year} ist noch kein Türchen angelegt – der Kalender erscheint erst mit dem ersten.</div>}
          {calendar?.active && (
            <>
              <AdventBoard calendar={calendar} onShow={(door) => { setNote(""); setShownDay(door.day); }} onOpen={() => {}} onLocked={(door) => setNote(`Türchen ${door.day} ist an diesem Tag noch verschlossen.`)} />
              <p className="mt-4 min-h-[1.5rem] text-center text-sm text-[#ffd98a]" role="status" aria-live="polite" data-testid="advent-preview-note">{note}</p>
            </>
          )}
        </div>
      </div>
      <DoorDialog door={shown} light={shown ? doorVariant(shown.seed).light : null} signedIn={false} onClose={() => setShownDay(null)} onAnswer={answer} onRaffle={raffle} />
    </div>
  );
}
