import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarHeart, LogIn, RefreshCw } from "lucide-react";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { AdventBoard } from "@/advent/AdventBoard";
import { DoorDialog } from "@/advent/DoorDialog";
import { DOORS, doorVariant, opensLabel } from "@/advent/doors";
import { sceneUrl } from "@/advent/scene";
import { errorText, useAdventCalendar } from "@/advent/useAdventCalendar";
import "@/advent/advent-calendar.css";

// Adventkalender (#641): die Seite mit den 24 Türchen. Der Server sagt, was offen ist; ein Klick öffnet, der
// Flügel schwingt auf, danach erscheint der Inhalt im Fenster. Geöffnete Türchen bleiben offen und lassen sich
// jederzeit wieder ansehen. Gäste öffnen mit - gesammelt wird mit Konto.

export const SHOW_AFTER_MS = 260;

function daysUntil(iso, now = new Date()) {
  const start = new Date(iso || "");
  if (Number.isNaN(start.getTime())) return null;
  return Math.max(0, Math.ceil((start.getTime() - now.getTime()) / 86400000));
}

/** Der Kalender ist gerade zu: vor dem Advent, danach oder ein Jahr ohne Türchen. */
export function Closed({ calendar, now = new Date() }) {
  const start = new Date(calendar?.next_start || "");
  const known = !Number.isNaN(start.getTime());
  const year = known ? start.getFullYear() : now.getFullYear();
  const days = known ? daysUntil(calendar.next_start, now) : null;
  const paused = calendar?.reason === "empty";
  const scene = useMemo(() => sceneUrl(year), [year]);
  let title = "Der Adventkalender ist zu";
  let text = "Bis zum nächsten Advent!";
  if (paused) {
    title = "Der Adventkalender macht Pause";
    text = "Heuer sind keine Türchen vorbereitet. Schau im nächsten Advent wieder vorbei.";
  } else if (days !== null) {
    title = days <= 45 ? "Bald ist es so weit" : "Der Adventkalender ist zu";
    const when = opensLabel(new Date(start.getTime() + 6 * 3600000).toISOString());
    text = days === 0 ? `Heute um 6 Uhr geht das erste Türchen auf.` : days === 1 ? `Morgen geht das erste Türchen auf – am ${when}.` : `Noch ${days} Tage: Das erste Türchen geht am ${when} auf.`;
  }
  return (
    <div className="tls-adv__frame" data-testid="advent-closed" data-reason={paused ? "empty" : "closed"}>
      <div className="relative overflow-hidden rounded-[9px] min-h-[340px] sm:min-h-[420px] flex items-end" style={{ backgroundImage: scene, backgroundSize: "cover", backgroundPosition: "50% 100%" }}>
        <div className="relative w-full p-6 sm:p-10 bg-gradient-to-t from-[#03060f]/95 via-[#03060f]/70 to-transparent">
          <h2 className="font-serif text-3xl sm:text-4xl font-semibold text-[#fff6e0]" style={{ fontFamily: 'Georgia, "Noto Serif", "Times New Roman", serif' }}>{title}</h2>
          <p className="mt-3 max-w-xl text-white/75" data-testid="advent-closed-text">{text}</p>
        </div>
      </div>
    </div>
  );
}

export default function AdventCalendarPage() {
  useDocumentTitle("Adventkalender", "24 Türchen bis Weihnachten: jeden Tag um 6 Uhr ein neues Türchen von THE LION SQUAD eSports.");
  const { calendar, loading, error, signedIn, reload, open, answer, raffle } = useAdventCalendar();
  const reducedMotion = useReducedMotion();
  const [busyDay, setBusyDay] = useState(null);
  const [dialogDay, setDialogDay] = useState(null);
  const [note, setNote] = useState("");
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const doors = calendar?.doors || [];
  const shown = dialogDay === null ? null : doors.find((door) => door.day === dialogDay && door.state === "opened") || null;
  const light = useMemo(() => (shown ? doorVariant(shown.seed).light : null), [shown]);

  const onOpen = useCallback(async (door) => {
    setBusyDay(door.day);
    setNote("");
    try {
      await open(door.day);
      const wait = reducedMotion ? 0 : doorVariant(door.seed).swing + SHOW_AFTER_MS;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setDialogDay(door.day), wait);
    } catch (failure) {
      setNote(errorText(failure, `Türchen ${door.day} lässt sich gerade nicht öffnen. Versuch es noch einmal.`));
      // Der Server sieht es anders als die Seite (zum Beispiel ist der Kalender inzwischen zu): neu laden.
      if ([404, 409].includes(failure?.response?.status)) reload();
    } finally {
      setBusyDay(null);
    }
  }, [open, reducedMotion, reload]);

  const onLocked = useCallback((door) => setNote(`Türchen ${door.day} öffnet sich am ${opensLabel(door.opens_at)}.`), []);
  const onShow = useCallback((door) => {
    setNote("");
    setDialogDay(door.day);
  }, []);

  const opened = calendar?.opened || 0;
  const complete = opened >= DOORS;
  return (
    <PublicLayout>
      <div className="tls-adv mx-auto w-full max-w-[1180px] px-4 sm:px-6 lg:px-8 py-10 sm:py-14" data-testid="advent-page">
        <header className="mb-7 sm:mb-9 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,340px)] lg:items-end">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#e9c46a]"><CalendarHeart className="w-4 h-4" /> Advent</span>
            <h1 className="mt-2 text-4xl sm:text-5xl font-semibold text-[#fff6e0]" style={{ fontFamily: 'Georgia, "Noto Serif", "Times New Roman", serif' }} data-testid="advent-title">
              Adventkalender{calendar?.active ? ` ${calendar.year}` : ""}
            </h1>
            <p className="mt-3 max-w-2xl text-white/65">
              {calendar?.active && calendar.catch_up
                ? "Alle 24 Türchen sind offen. Nachholen kannst du noch bis 6. Jänner."
                : "Jeden Tag um 6 Uhr geht ein neues Türchen auf. Was du verpasst hast, holst du bis 6. Jänner nach."}
            </p>
          </div>
          {calendar?.active && (
            <div className="rounded-lg border border-[#e9c46a]/25 bg-white/[0.03] p-4" data-testid="advent-progress">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/50">{signedIn ? "Gesammelt" : "Geöffnet"}</span>
                <span className="font-semibold text-[#fff6e0] tabular-nums" data-testid="advent-count">{opened} von {DOORS}</span>
              </div>
              <div className="tls-adv__progress mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={DOORS} aria-valuenow={opened} aria-label="Geöffnete Türchen">
                <div className="tls-adv__progress-bar" style={{ width: `${Math.min(100, (opened / DOORS) * 100)}%` }} />
              </div>
              {complete && <p className="mt-3 text-sm text-[#e9c46a]" data-testid="advent-complete">Alle Türchen geöffnet – frohe Weihnachten!</p>}
              {!signedIn && !complete && (
                <p className="mt-3 text-sm text-white/60" data-testid="advent-guest">
                  Du schaust als Gast. Gesammelt wird mit Konto – dann zählt jedes Türchen für den Erfolg „Alle Türchen“.{" "}
                  <Link to="/login" className="inline-flex items-center gap-1 font-semibold text-[#e9c46a] hover:text-[#fff1b8]"><LogIn className="w-3.5 h-3.5" /> Anmelden</Link>
                </p>
              )}
            </div>
          )}
        </header>

        {loading && !calendar && <PublicLoadingState label="Lade Adventkalender" />}
        {!loading && error && !calendar && (
          <div className="rounded-lg border border-white/10 bg-[#121212] p-10 text-center" data-testid="advent-error">
            <p className="text-white/70">{error}</p>
            <button type="button" className="tls-adv-button tls-adv-button--quiet mt-5" onClick={reload}><RefreshCw className="w-4 h-4" /> Noch einmal versuchen</button>
          </div>
        )}
        {calendar && !calendar.active && <Closed calendar={calendar} />}
        {calendar?.active && (
          <>
            <AdventBoard calendar={calendar} busyDay={busyDay} onOpen={onOpen} onShow={onShow} onLocked={onLocked} />
            <p className="mt-4 min-h-[1.5rem] text-center text-sm text-[#ffd98a]" role="status" aria-live="polite" data-testid="advent-note">{note}</p>
          </>
        )}
        <DoorDialog door={shown} light={light} signedIn={signedIn} onClose={() => setDialogDay(null)} onAnswer={answer} onRaffle={raffle} />
      </div>
    </PublicLayout>
  );
}
