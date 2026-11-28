import { useState } from "react";
import { countOf } from "@/lib/schedulePlanText";
import { finderFor, sourceLabel } from "@/lib/slotSource";
import { formatScheduleGroupLabel } from "@/lib/tournamentLabels";
import { formatClock, formatWhen } from "@/lib/datetime";
import "./matchplan.css";

// Online und Liga (#1557): keine Stationen, keine Zeitleiste je Station. Online zählen Fristen je Spiel, in der Liga
// Spielwochen mit Frist. Die Fristen rechnet der Server (GET …/schedule/deadlines, …/matchdays) - hier wird nur gezeigt.

const hm = (value) => formatClock(value) || "–";
const dayTime = (value) => formatWhen(value) || "–";
const day = (value) => formatWhen(value, { time: false }) || "–";
const DONE = new Set(["completed", "forfeit", "archived", "bye", "no_show"]);
const RUNNING = new Set(["in_progress", "running", "waiting_result"]);

function namesOf(match, registrations, findIn) {
  const names = new Map((registrations || []).map((reg) => [reg.id, reg.display_name || reg.ingame_name || ""]));
  return (match.slots || []).map((slot) => names.get(slot.registration_id) || sourceLabel(slot.source, findIn(match)) || "noch offen");
}

function onlineState(match, deadline) {
  const status = String(match.status || "");
  if (match.is_preview) return { tone: "waiting", text: "Vorschau - der Baum steht erst mit dem Ende des Check-ins fest" };
  if (DONE.has(status)) return { tone: "done", text: status === "bye" ? "Freilos" : "gespielt" };
  if (RUNNING.has(status)) return { tone: "running", text: "läuft" };
  if (deadline?.result_due_at) return { tone: "open", text: `Meldung liegt vor · gilt ab ${hm(deadline.result_due_at)}, wenn niemand widerspricht` };
  if (deadline?.opened_at) {
    const parts = [`offen seit ${hm(deadline.opened_at)}`];
    if (deadline.no_show_due_at) parts.push(`nicht erschienen ab ${hm(deadline.no_show_due_at)}`);
    return { tone: "open", text: parts.join(" · ") };
  }
  return { tone: "waiting", text: "wartet auf die Vorspiele - öffnet, sobald die Gegner feststehen" };
}

/** Online: Runden untereinander, je Spiel der Stand und die nächste Frist. */
/** „ändern“ an einer Partie (Start und Dauer) - nur mit Recht auf Termine und nicht für Vorschau oder Gespieltes. */
function EditToggle({ match, canEdit, editor, open, setOpen, touch = false }) {
  if (!editor || !canEdit?.(match) || DONE.has(String(match.status || ""))) return null;
  const key = match.match_key || "Spiel";
  return (
    <>
      <button type="button" className={`tls-btn tls-btn--quiet mp-btn mp-remote__action ${touch ? "mp-btn--touch" : "mp-btn--small"}`} aria-label={`${key} ändern`}
        aria-expanded={open === match.id} onClick={() => setOpen(open === match.id ? null : match.id)}>ändern</button>
      {open === match.id ? editor(match, () => setOpen(null)) : null}
    </>
  );
}

export function OnlineRounds({ tournament, matches, registrations, deadlines, error = "", canEdit = null, editor = null }) {
  const [open, setOpen] = useState(null);
  // Wie der Planer: echte Spiele, sonst die Vorschau (als solche gekennzeichnet) - nie eine leere Fläche.
  const all = (matches || []).filter(Boolean);
  const real = all.filter((match) => !match.is_preview);
  const rows = real.length ? real : all;
  const findIn = finderFor(rows);
  const byId = new Map((deadlines?.matches || []).map((row) => [row.match_id, row]));
  const rounds = new Map();
  for (const match of [...rows].sort((a, b) => (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0))) {
    const label = formatScheduleGroupLabel(match, tournament);
    rounds.set(label, [...(rounds.get(label) || []), match]);
  }
  return (
    <section className="mp-card" data-testid="mp-online" aria-label="Runden und Fristen">
      <div className="mp-card__head">
        <h3 className="mp-card__title">Runden und Fristen</h3>
        <span className="mp-card__note">Ein Spiel öffnet, sobald die Gegner feststehen. „Nicht erschienen“ und „Ergebnis gilt“ kommen erst nach der Frist.</span>
      </div>
      {error && <p className="mp-notice" data-tone="error" role="alert" data-testid="mp-remote-error">Fristen konnten nicht geladen werden: {error}</p>}
      {!rows.length && <p className="mp-empty">Noch keine Spiele.</p>}
      <div className="mp-rounds">
        {[...rounds.entries()].map(([label, list]) => (
          <div key={label} className="mp-round">
            <h4 className="mp-round__title">{label} <span>{countOf(list.length, "Spiel", "Spiele")}</span></h4>
            <ul className="mp-round__list">
              {list.map((match) => {
                const state = onlineState(match, byId.get(match.id));
                return (
                  <li key={match.id} className="mp-remote" data-tone={state.tone}>
                    <strong>{match.match_key || "Spiel"}</strong>
                    <span className="mp-remote__names">{namesOf(match, registrations, findIn).join(" – ")}</span>
                    <span className="mp-remote__state">{state.text}</span>
                    <EditToggle match={match} canEdit={canEdit} editor={editor} open={open} setOpen={setOpen} />
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const SOURCE_TEXT = {
  accepted: "vereinbart",
  home: "Heimrecht",
  default: "Standardzeit",
  manual: "von der Turnierleitung",
};
// Staffel-Seite der Liga-Verwaltung (#2262): dort setzt die Liga-Leitung den Termin.
const STAFFEL_SOURCE_TEXT = { ...SOURCE_TEXT, manual: "von der Liga-Leitung" };

/** Liga: Spielwochen nebeneinander - Fenster, Frist, je Partie der geltende Termin und woher er kommt. ``variant="staffel"`` (Staffel-Seite
 * der Liga-Verwaltung, #2262): Wochen umbrechen statt seitlich zu wischen, Tippflächen ab 44 px, Liga-Wörter. */
export function LeagueWeeks({ tournament, matches, registrations, matchdays, error = "", canEdit = null, editor = null, variant = "" }) {
  const [open, setOpen] = useState(null);
  const staffel = variant === "staffel";
  const sources = staffel ? STAFFEL_SOURCE_TEXT : SOURCE_TEXT;
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const findIn = finderFor(matches || []);
  const weeks = matchdays?.matchdays || [];
  return (
    <section className="mp-card" data-testid="mp-league" aria-label="Spielwochen">
      <div className="mp-card__head">
        <h3 className="mp-card__title">Spielwochen</h3>
        <span className="mp-card__note">Ohne Einigung gilt die Standardzeit. „Ergebnis fehlt“ meldet sich erst nach der Frist der Woche. Der Planer überschreibt vereinbarte Termine nie.</span>
      </div>
      {error && <p className="mp-notice" data-tone="error" role="alert" data-testid="mp-remote-error">Spielwochen konnten nicht geladen werden: {error}</p>}
      <div className={staffel ? "" : "mp-weeks-scroll tls-swipe"}>
        <ol className={staffel ? "mp-weeks mp-weeks--stack" : "mp-weeks"}>
          {weeks.map((week) => {
            const current = matchdays?.current === week.number;
            const title = (
              <>
                Spielwoche {week.number}
                <span>{day(week.starts_at)}–{day(week.ends_at)}{current ? " · läuft" : ""}</span>
              </>
            );
            const body = (
              <>
                <p className="mp-week__deadline">Frist {dayTime(week.ends_at)}</p>
                <ul className="mp-week__list">
                  {(week.matches || []).map((entry) => {
                    const match = byId.get(entry.match_id) || {};
                    const done = DONE.has(String(match.status || ""));
                    return (
                      <li key={entry.match_id} className="mp-remote" data-tone={done ? "done" : entry.schedule_source || "open"}>
                        <span className="mp-remote__names">{namesOf(match, registrations, findIn).join(" – ")}</span>
                        <span className="mp-remote__state">
                          {done ? "gespielt" : entry.scheduled_at ? `${sources[entry.schedule_source] || "Termin"} ${dayTime(entry.scheduled_at)}` : entry.schedule_hint || "noch kein Termin"}
                        </span>
                        {match.id ? <EditToggle match={match} canEdit={canEdit} editor={editor} open={open} setOpen={setOpen} touch={staffel} /> : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            );
            // Staffel-Seite: Eine ganz gespielte Woche klappt zu - offen bleibt, was noch einen Termin braucht.
            const played = staffel && !current && (week.matches || []).length > 0
              && week.matches.every((entry) => DONE.has(String(byId.get(entry.match_id)?.status || "")));
            return (
              <li key={week.number} className="mp-week" data-testid={`mp-week-${week.number}`} data-current={current ? "true" : undefined} data-played={played ? "true" : undefined}>
                {played ? (
                  <details className="mp-week__fold">
                    <summary className="mp-week__title mp-week__summary">{title}<span className="mp-week__done">alle gespielt</span></summary>
                    {body}
                  </details>
                ) : (
                  <>
                    <h4 className="mp-week__title">{title}</h4>
                    {body}
                  </>
                )}
              </li>
            );
          })}
          {!weeks.length && <li className="mp-week mp-week--empty">{tournament?.title ? "Noch keine Spielwochen - sie entstehen mit dem Spielplan." : ""}</li>}
        </ol>
      </div>
    </section>
  );
}
