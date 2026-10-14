import { countOf } from "@/lib/schedulePlanText";
import { finderFor, sourceLabel } from "@/lib/slotSource";
import { formatScheduleGroupLabel } from "@/lib/tournamentLabels";
import { viennaDateTime, viennaTime } from "@/lib/vienna";

// Online und Liga (#1557): keine Stationen, keine Zeitleiste je Station. Online zählen Fristen je Spiel, in der Liga
// Spielwochen mit Frist. Die Fristen rechnet der Server (GET …/schedule/deadlines, …/matchdays) - hier wird nur gezeigt.

const hm = (value) => viennaTime(value, { hour: "2-digit", minute: "2-digit" }) || "–";
const dayTime = (value) => viennaDateTime(value, { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) || "–";
const day = (value) => viennaDateTime(value, { day: "2-digit", month: "2-digit" }) || "–";
const DONE = new Set(["completed", "forfeit", "archived", "bye", "no_show"]);
const RUNNING = new Set(["in_progress", "running", "waiting_result"]);

function namesOf(match, registrations, findIn) {
  const names = new Map((registrations || []).map((reg) => [reg.id, reg.display_name || reg.ingame_name || ""]));
  return (match.slots || []).map((slot) => names.get(slot.registration_id) || sourceLabel(slot.source, findIn(match)) || "noch offen");
}

function onlineState(match, deadline) {
  const status = String(match.status || "");
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
export function OnlineRounds({ tournament, matches, registrations, deadlines }) {
  const rows = (matches || []).filter((match) => !match.is_preview);
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

/** Liga: Spielwochen nebeneinander - Fenster, Frist, je Partie der geltende Termin und woher er kommt. */
export function LeagueWeeks({ tournament, matches, registrations, matchdays }) {
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const findIn = finderFor(matches || []);
  const weeks = matchdays?.matchdays || [];
  return (
    <section className="mp-card" data-testid="mp-league" aria-label="Spielwochen">
      <div className="mp-card__head">
        <h3 className="mp-card__title">Spielwochen</h3>
        <span className="mp-card__note">Ohne Einigung gilt die Standardzeit. „Ergebnis fehlt“ meldet sich erst nach der Frist der Woche. Der Planer überschreibt vereinbarte Termine nie.</span>
      </div>
      <div className="mp-weeks-scroll">
        <ol className="mp-weeks">
          {weeks.map((week) => (
            <li key={week.number} className="mp-week" data-testid={`mp-week-${week.number}`} data-current={matchdays?.current === week.number ? "true" : undefined}>
              <h4 className="mp-week__title">
                Spielwoche {week.number}
                <span>{day(week.starts_at)}–{day(week.ends_at)}{matchdays?.current === week.number ? " · läuft" : ""}</span>
              </h4>
              <p className="mp-week__deadline">Frist {dayTime(week.ends_at)}</p>
              <ul className="mp-week__list">
                {(week.matches || []).map((entry) => {
                  const match = byId.get(entry.match_id) || {};
                  const done = DONE.has(String(match.status || ""));
                  return (
                    <li key={entry.match_id} className="mp-remote" data-tone={done ? "done" : entry.schedule_source || "open"}>
                      <span className="mp-remote__names">{namesOf(match, registrations, findIn).join(" – ")}</span>
                      <span className="mp-remote__state">
                        {done ? "gespielt" : entry.scheduled_at ? `${SOURCE_TEXT[entry.schedule_source] || "Termin"} ${dayTime(entry.scheduled_at)}` : "noch kein Termin"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {!weeks.length && <li className="mp-week mp-week--empty">{tournament?.title ? "Noch keine Spielwochen - sie entstehen mit dem Spielplan." : ""}</li>}
        </ol>
      </div>
    </section>
  );
}
