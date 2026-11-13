import { useRef } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ChevronRight, CircleCheck, ClipboardX, MessagesSquare, Scale, Shuffle, Timer, UserX, Wrench } from "lucide-react";
import { EASE_MOVE, MICRO, MOTION, motionAllowed } from "@/lib/motion";
import { problemCountText } from "@/lib/tournamentCockpit";
import { StationQueueBoard } from "@/components/tls/live/StationQueueBoard";
import "./cockpit.css";

// Turnier-Cockpit (#1653): der Einstieg der Turnierleitung am Turniertag vor Ort. Oben bzw. am Tablet quer links die
// „Probleme“ - dringendstes zuerst, jede Zeile ein Tipp zum Fall (lib/tournamentCockpit). Darunter bzw. rechts die
// Stationen mit „läuft“ (Spielzeit-Uhr, #1167) und „Als Nächstes“ - dieselbe Warteschlange und dieselben Knöpfe wie im
// Reiter „Stationen“ (Aufrufen, Starten, Freigeben mit Rückfrage, Defekt), also dieselben Rechte und Wege.
// Bewegung (nur transform und opacity): neue Probleme blenden gestaffelt ein und heben sich einmal leicht an, ihr Rahmen
// leuchtet kurz auf; erledigte gleiten nach rechts hinaus, die übrigen rücken weich nach. Beim Nachladen bleiben die
// Zeilen stehen (Schlüssel je Fall) - nichts baut sich neu auf. Mit „Bewegung reduzieren“ springen die Zustände.

const ICONS = {
  dispute: Scale,
  procedure: Scale,
  no_show: UserX,
  station_broken: Wrench,
  result_missing: ClipboardX,
  report_conflict: MessagesSquare,
  delay: Timer,
  draw: Shuffle,
};

const TONE_CLASS = {
  warn: "border-warn/35 text-warn",
  honor: "border-honor/30 text-honor",
  brand: "border-brand/35 text-brand",
};

const seconds = (ms) => ms / 1000;

/**
 * Wann eine neue Zeile einsteigt: die Zeilen, die beim selben Laden dazukommen, nacheinander (je `MICRO.stagger`, höchstens
 * `MICRO.staggerMax`) - Zeilen, die schon standen, behalten ihren Platz und bewegen sich nicht.
 */
export function useStaggerOrder(ids) {
  const seen = useRef(new Map());
  const current = new Set(ids);
  // Ein erledigter Fall, der später wiederkommt, steigt neu ein.
  for (const id of [...seen.current.keys()]) if (!current.has(id)) seen.current.delete(id);
  ids.filter((id) => !seen.current.has(id)).forEach((id, index) => seen.current.set(id, Math.min(index, MICRO.staggerMax)));
  return (id) => seen.current.get(id) ?? 0;
}

function ProblemRow({ problem, onOpen }) {
  const Icon = ICONS[problem.kind] || AlertTriangle;
  const tone = TONE_CLASS[problem.tone] ? problem.tone : "honor";
  return (
    <Link
      to={{ search: problem.search }}
      replace
      onClick={() => onOpen?.(problem)}
      className="tls-cockpit-row group relative flex min-h-[64px] items-center gap-3 rounded-sm border border-white/10 bg-surface-1 py-2.5 pl-3.5 pr-2.5 text-left transition-colors hover:border-white/25 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
      data-tone={tone}
      data-kind={problem.kind}
      data-testid={`cockpit-problem-${problem.id}`}
    >
      <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-sm border bg-white/[0.02] ${TONE_CLASS[tone]}`} aria-hidden="true">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`flex flex-wrap items-center gap-x-2 text-[10px] font-bold uppercase tracking-[0.18em] ${TONE_CLASS[tone].split(" ")[1]}`}>
          <span data-testid={`cockpit-problem-chip-${problem.id}`}>{problem.chip}</span>
          {problem.where ? <span className="text-white/45 tracking-[0.12em] [overflow-wrap:anywhere]">{problem.where}</span> : null}
        </span>
        <span className="mt-0.5 block text-sm font-bold text-white [overflow-wrap:anywhere]">{problem.title}</span>
        {problem.what ? <span className="block text-xs text-white/55 [overflow-wrap:anywhere]">{problem.what}</span> : null}
        {problem.detail ? <span className="mt-0.5 block text-[11px] text-white/70 [overflow-wrap:anywhere]">{problem.detail}</span> : null}
      </span>
      <ChevronRight className="tls-cockpit-chevron h-5 w-5 shrink-0 text-white/35 group-hover:text-white/70" aria-hidden="true" />
    </Link>
  );
}

/** Die Liste „Probleme“ - mit Bewegung über framer-motion, ohne als schlichte Liste. */
export function ProblemList({ problems, onOpen }) {
  const moving = motionAllowed();
  const orderOf = useStaggerOrder(problems.map((problem) => problem.id));
  if (!moving) {
    return (
      <ul className="space-y-2" data-testid="cockpit-problems-list" data-motion="off">
        {problems.map((problem) => <li key={problem.id}><ProblemRow problem={problem} onOpen={onOpen} /></li>)}
      </ul>
    );
  }
  return (
    <ul className="relative space-y-2" data-testid="cockpit-problems-list" data-motion="on">
      <AnimatePresence initial mode="popLayout">
        {problems.map((problem) => {
          const delay = seconds(orderOf(problem.id) * MICRO.stagger);
          return (
            <motion.li
              key={problem.id}
              layout="position"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: [10, -3, 0] }}
              exit={{ opacity: 0, x: 28, transition: { duration: seconds(MOTION.slow), ease: [...MOTION.ease] } }}
              transition={{
                opacity: { duration: seconds(MOTION.mid), ease: [...MOTION.ease], delay },
                y: { duration: seconds(MOTION.slow), times: [0, 0.6, 1], ease: [...MOTION.ease], delay },
                layout: { duration: seconds(MOTION.slow), ease: [...EASE_MOVE] },
              }}
              style={{ "--tls-cockpit-delay": `${Math.round(delay * 1000)}ms` }}
              data-testid={`cockpit-problem-item-${problem.id}`}
            >
              <ProblemRow problem={problem} onOpen={onOpen} />
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ul>
  );
}

export function TournamentCockpit({ problems = [], loaded = false, queue, board = {}, highlightStation = "", onOpen }) {
  const count = problems.length;
  return (
    <div className="mt-5 grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start" data-testid="lead-cockpit">
      <section aria-labelledby="cockpit-problems-title" data-testid="cockpit-problems">
        <header className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 id="cockpit-problems-title" className="font-heading text-lg font-black uppercase tracking-wide text-white">Probleme</h2>
            <p className="text-xs text-white/45">Dringendes zuerst – ein Tipp führt zum Fall.</p>
          </div>
          <span className={`tls-cockpit-count shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider ${count ? "border-honor/40 text-honor" : "border-ok/40 text-ok"}`} role="status" aria-live="polite" data-testid="cockpit-problems-count">
            {problemCountText(count)}
          </span>
        </header>
        <div className="mt-3">
          {loaded && !count ? (
            <div className="tls-live-reveal flex items-center gap-3 rounded-sm border border-ok/25 bg-ok/5 p-4" data-testid="cockpit-problems-empty">
              <CircleCheck className="h-6 w-6 shrink-0 text-ok" aria-hidden="true" />
              <div className="min-w-0">
                <div className="text-sm font-bold text-white">Alles im Plan</div>
                <div className="text-xs text-white/55">Gerade hängt nichts. Neue Fälle erscheinen hier von selbst.</div>
              </div>
            </div>
          ) : null}
          <ProblemList problems={problems} onOpen={onOpen} />
        </div>
      </section>

      <section aria-labelledby="cockpit-stations-title" data-testid="cockpit-stations">
        <header>
          <h2 id="cockpit-stations-title" className="font-heading text-lg font-black uppercase tracking-wide text-white">Stationen</h2>
          <p className="text-xs text-white/45">Was läuft, was als Nächstes kommt – mit einem Tipp aufrufen und starten.</p>
        </header>
        <div className="mt-3">
          {queue ? (
            <StationQueueBoard queue={queue} gridClassName="md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2" highlightId={highlightStation} {...board} />
          ) : <div className="py-10 text-center text-white/40">Wird geladen …</div>}
        </div>
      </section>
    </div>
  );
}
