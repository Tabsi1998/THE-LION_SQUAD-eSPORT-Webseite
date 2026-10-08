import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Swords } from "lucide-react";
import { api } from "@/lib/api";
import { viennaDate } from "@/lib/vienna";
import { ResultShareButton } from "@/components/tls/ResultShareButton";

// Profil (#1193): „Dein Weg“ je Turnier in den Referenzen (aufklappen) und die Bilanz gegen Gegner als Karte in der
// Übersicht. Farben wie im Turnierbaum (#1340, Fabians Auswahl): Siege hell mit Zahl in Cyan, Niederlagen grau -
// kein Grün und Rot, Rot heißt nur „läuft gerade“. Im eigenen Profil steht alles; für andere nur Öffentliches,
// private Gegner ohne Namen (Weg) bzw. gar nicht (Bilanz).

const STEP_TONE = {
  win: { dot: "border-[#29B6E8]", result: "text-[#29B6E8]", word: "Sieg" },
  loss: { dot: "border-white/30", result: "text-white/45", word: "Niederlage" },
  draw: { dot: "border-white/70", result: "text-white", word: "Unentschieden" },
  placed: { dot: "border-white/70", result: "text-white", word: "" },
};

function viewParams(publicView) {
  return publicView ? { params: { view_as: "public" } } : undefined;
}

export function stepLine(step) {
  if (step.kind === "duel" && step.opponent === "Freilos") return `${step.result || "weiter"} · Freilos`;
  return step.kind === "duel" && step.opponent ? `${step.result} gegen ${step.opponent}` : step.result || "";
}

export function PathSteps({ path, testId }) {
  const steps = path?.steps || [];
  const final = path?.final || {};
  return (
    <ol className="relative" data-testid={testId}>
      {steps.map((step, index) => {
        const tone = STEP_TONE[step.outcome] || STEP_TONE.placed;
        return (
          <li key={`${step.label}-${index}`} className="relative pl-6 pb-3" data-testid="tournament-path-step">
            <span className="absolute left-[5px] top-4 bottom-0 w-0.5 bg-white/10" aria-hidden="true" />
            <span className={`absolute left-0 top-1 w-3 h-3 rounded-full border-2 bg-[#0A0A0A] ${tone.dot}`} aria-hidden="true" />
            <div className="font-bold text-sm">{step.label}</div>
            <div className="text-xs text-white/55">
              <span className={`font-bold tabular-nums ${tone.result}`}>{step.kind === "duel" && step.opponent === "Freilos" ? `${step.result || "weiter"} · Freilos` : step.result}</span>
              {step.kind === "duel" && step.opponent && step.opponent !== "Freilos" ? <span> gegen {step.opponent}</span> : null}
              {tone.word ? <span className="sr-only"> ({tone.word})</span> : null}
            </div>
          </li>
        );
      })}
      <li className="relative pl-6" data-testid="tournament-path-final">
        <span className="absolute left-0 top-1 w-3 h-3 rounded-full bg-white/80" aria-hidden="true" />
        <div className="font-bold text-sm">{final.rank ? `${final.rank}. Platz${final.participant_count ? ` von ${final.participant_count}` : ""}` : "Teilgenommen"}</div>
        <div className="text-xs text-white/45">{[path?.team_name, path?.date ? viennaDate(path.date) : null].filter(Boolean).join(" · ")}</div>
      </li>
    </ol>
  );
}

/** Eine Referenz mit „Weg“ zum Aufklappen - der Weg lädt erst beim Aufklappen. */
export function ReferenceWithPath({ item, username, own = false, publicView = false, children }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState(null);
  const [state, setState] = useState("idle");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const canExpand = (item.kind || "tournament") === "tournament" && Boolean(item.target_id) && Boolean(username);
  const toggle = () => {
    setOpen((value) => !value);
    if (state !== "idle") return;
    setState("loading");
    api.get(`/profile/${encodeURIComponent(username)}/tournaments/${encodeURIComponent(item.target_id)}/path`, viewParams(publicView))
      .then(({ data }) => { if (alive.current) { setPath(data); setState("ready"); } })
      .catch(() => { if (alive.current) setState("error"); });
  };

  if (!canExpand) return children;
  return (
    <div className="min-w-0">
      {children}
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-[#29B6E8] hover:text-white"
        data-testid={`reference-path-toggle-${item.id}`}
      >
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`} /> {open ? "Weg ausblenden" : own ? "Dein Weg" : "Weg ansehen"}
      </button>
      {open ? (
        <div className="mt-2 ml-1 border-l border-white/10 pl-4 py-2" data-testid={`tournament-path-${item.id}`}>
          {state === "loading" ? <div className="text-xs text-white/40">Lade den Weg …</div> : null}
          {state === "error" ? <div className="text-xs text-white/45">Für dieses Turnier gibt es keinen Weg zum Anzeigen.</div> : null}
          {state === "ready" && path ? (
            <>
              {path.steps?.length ? null : <p className="text-xs text-white/45 mb-2">Keine gewerteten Spiele – nur der Endplatz.</p>}
              <PathSteps path={path} testId={`tournament-path-steps-${item.id}`} />
              {own && path.share ? <div className="mt-3"><ResultShareButton options={path.share} testId={`reference-share-${item.id}`} /></div> : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** „PP“ für PixelPanther, „LR“ für Lions Rocket, sonst die ersten zwei Zeichen (wie auf den Teilen-Bildern). */
export function initials(name) {
  const text = String(name || "?");
  const words = text.replace(/[_-]/g, " ").split(/\s+/).filter(Boolean);
  if (words.length > 1) return (words[0][0] + words[1][0]).toUpperCase();
  const capitals = text.match(/[A-ZÄÖÜ]/g) || [];
  if (capitals.length >= 2) return (capitals[0] + capitals[1]).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

export function recordLabel(row) {
  const parts = [`${row.wins} ${row.wins === 1 ? "Sieg" : "Siege"}`];
  if (row.draws) parts.push(`${row.draws} Unentschieden`);
  parts.push(`${row.losses} ${row.losses === 1 ? "Niederlage" : "Niederlagen"}`);
  return `gegen ${row.name}: ${parts.join(", ")}`;
}

/** „Bilanz gegen“ - die fünf häufigsten Gegner. Ohne Gegner mit mindestens zwei Spielen steht hier nichts. */
export function RecordCard({ username, publicView = false }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    if (!username) return undefined;
    let alive = true;
    api.get(`/profile/${encodeURIComponent(username)}/record`, viewParams(publicView))
      .then(({ data }) => { if (alive) setRows(Array.isArray(data?.opponents) ? data.opponents : []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [username, publicView]);
  if (!rows.length) return null;
  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid="profile-record">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]"><Swords className="w-3.5 h-3.5" /> Bilanz gegen</div>
      <ul className="mt-3 space-y-3">
        {rows.map((row) => {
          const games = Math.max(1, row.games || row.wins + row.losses + (row.draws || 0));
          const to = row.kind === "team" ? (row.team_id ? `/teams/${row.team_id}` : null) : (row.username ? `/u/${row.username}` : null);
          const name = <span className="font-semibold text-sm truncate block">{row.name}</span>;
          return (
            <li key={row.key} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-3 items-center" aria-label={recordLabel(row)} data-testid={`profile-record-${row.key}`}>
              <span className={`w-8 h-8 ${row.kind === "team" ? "rounded-sm" : "rounded-full"} border border-white/15 bg-white/5 flex items-center justify-center text-[11px] font-bold text-white/70`}>{row.tag ? String(row.tag).slice(0, 3).toUpperCase() : initials(row.name)}</span>
              <div className="min-w-0">
                {to ? <Link to={to} className="hover:text-[#29B6E8]">{name}</Link> : name}
                <div className="mt-1 h-1.5 rounded-full overflow-hidden flex bg-white/15" aria-hidden="true">
                  <span className="bg-white/90" style={{ width: `${(row.wins / games) * 100}%` }} />
                  <span className="bg-white/40" style={{ width: `${((row.draws || 0) / games) * 100}%` }} />
                </div>
              </div>
              <span className="font-heading font-bold tabular-nums text-sm" aria-hidden="true">
                <span className="text-[#29B6E8]">{row.wins}</span><span className="text-white/35"> : </span><span className="text-white/45">{row.losses}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
