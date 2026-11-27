import { formatPoints } from "@/lib/referenceResults";
import { AlertTriangle, ArrowDown, ArrowUp, Minus, OctagonAlert, Sparkles, UserPlus } from "lucide-react";
import { kindShows, kindWord } from "@/lib/seriesKinds";

// Vorschau eines Ergebnisblatts (#1744): was der Server beim Prüfen sagt – Fehler und Warnungen ohne Zeile, erkannte
// Vereinsmitglieder, unbekannte Namen und der neue Zwischenstand mit Bewegung und Finalgrenze. Die Meldungen je Zeile
// stehen direkt an der Zeile im Blatt. Vorschläge und Alias-Ziele kommen nur für den Vorstand vom Server; Captains
// sehen bei neuen Namen nur „neu“.

const SCOPE_LABELS = { drivers: "Fahrer", teams: "Teams", table: "Tabelle" };
const SCOPE_ORDER = ["drivers", "teams", "table"];

function Move({ change }) {
  if (change === null || change === undefined) return <span className="text-white/25" aria-label="neu in der Wertung">·</span>;
  if (change > 0) return <span className="inline-flex items-center text-ok" aria-label={`${change} Plätze nach oben`}><ArrowUp className="w-3 h-3" />{change}</span>;
  if (change < 0) return <span className="inline-flex items-center text-quiet" aria-label={`${-change} Plätze nach unten`}><ArrowDown className="w-3 h-3" />{-change}</span>;
  return <Minus className="w-3 h-3 text-white/30" aria-label="unverändert" />;
}

function ProblemList({ items, level, testId }) {
  if (!items.length) return null;
  const error = level === "error";
  const Icon = error ? OctagonAlert : AlertTriangle;
  return (
    <div className={`border rounded-sm p-3 tls-type-small space-y-1 ${error ? "border-warn/70 bg-warn/15 text-white/90" : "border-warn/40 bg-warn/[0.06] text-white/85"}`} data-testid={testId} role={error ? "alert" : "status"}>
      <div className="flex items-center gap-2 font-bold">
        <Icon className={`w-4 h-4 ${error ? "text-warn" : "text-white/70"}`} />
        {error ? "Fehler – so lässt sich nicht übernehmen" : "Hinweise"}
      </div>
      <ul className="space-y-0.5">
        {items.map((item, index) => (
          <li key={index}>{item.match !== undefined && item.match !== null ? `Spiel ${item.match + 1}: ` : ""}{item.message}</li>
        ))}
      </ul>
    </div>
  );
}

function StandingsScope({ scope, rows, final, profile = null }) {
  const topN = scope === "drivers" ? final?.top_n : null;
  const lastInside = topN ? rows.reduce((last, row, index) => (row.rank && row.rank <= topN ? index : last), -1) : -1;
  return (
    <div data-testid={`preview-standings-${scope}`}>
      <div className="tls-type-label text-white/45 mb-1">{(scope === "drivers" ? kindWord(profile, "person_many", "") : "") || SCOPE_LABELS[scope] || scope}</div>
      <div className="tls-swipe pb-0 max-h-80 overflow-y-auto border border-white/5 rounded-sm">
        <table className="w-full tls-type-small tabular-nums">
          <thead className="sticky top-0 bg-[#121212]">
            <tr className="text-left tls-type-label text-white/45">
              <th className="py-1.5 px-2 font-bold w-10">#</th>
              <th className="py-1.5 px-1 font-bold w-10"><span className="sr-only">Bewegung</span></th>
              <th className="py-1.5 px-2 font-bold">{scope === "drivers" ? "Name" : "Team"}</th>
              <th className="py-1.5 px-2 font-bold text-right">Pkt</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.participant_id || row.team || index} data-testid="preview-standing-row"
                className={`border-t align-top ${index === lastInside ? "border-b-2 border-b-[#29B6E8]/60" : ""} ${row.is_club_member ? "bg-[#29B6E8]/[0.06]" : ""} border-white/5`}>
                <td className="py-1.5 px-2 font-bold">{row.rank ?? "–"}</td>
                <td className="py-1.5 px-1 tls-type-small"><Move change={row.rank_change} /></td>
                <td className="py-1.5 px-2 min-w-0">
                  <span className="break-words">{row.name || row.team || "–"}</span>
                  {row.is_new && <span className="ml-1.5 tls-type-label text-warn">neu</span>}
                  {row.deviation ? (
                    <span className="block tls-type-small text-warn">laut Veranstalter {formatPoints(row.official_points)}, gerechnet {formatPoints(row.computed_points)}</span>
                  ) : null}
                </td>
                <td className="py-1.5 px-2 text-right font-bold">{formatPoints(row.points)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {topN && lastInside >= 0 && <div className="mt-1 tls-type-small text-[#29B6E8]">Linie: Finalgrenze (die besten {topN})</div>}
    </div>
  );
}

function FinalChanges({ final, rows }) {
  if (!final || (!final.entered?.length && !final.left?.length)) return null;
  const names = Object.fromEntries((rows || []).map((row) => [row.participant_id, row.name]));
  const list = (ids) => ids.map((id) => names[id] || "Unbekannt").join(", ");
  return (
    <div className="tls-type-small text-white/75 space-y-0.5" data-testid="preview-final">
      {final.entered?.length > 0 && <div><span className="text-ok font-bold">Neu im Finale:</span> {list(final.entered)}</div>}
      {final.left?.length > 0 && <div><span className="text-quiet font-bold">Aus dem Finale gefallen:</span> {list(final.left)}</div>}
    </div>
  );
}

function UnknownNames({ items, board }) {
  if (!items.length) return null;
  return (
    <div className="border border-white/10 rounded-sm p-3 space-y-2" data-testid="preview-unknown">
      <div className="flex items-center gap-2 tls-type-label text-warn">
        <UserPlus className="w-3.5 h-3.5" /> Unbekannte Namen ({items.length})
      </div>
      <p className="tls-type-small text-white/55">
        {board
          ? "Beim Übernehmen werden sie als offene Teilnehmer angelegt; danach öffnet sich „Unbekannte Namen“ zum Zuordnen."
          : "Beim Übernehmen werden sie als neue Teilnehmer angelegt. Zugeordnet werden sie vom Vorstand."}
      </p>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.participant_id} className="tls-type-small" data-testid="preview-unknown-name">
            <span className="font-bold text-white">{item.name}</span>
            <span className="ml-1.5 tls-type-label text-warn">neu</span>
            {board && item.alias && (
              <span className="block tls-type-small text-[#29B6E8]" data-testid="preview-unknown-alias">Bekannter Alias{item.alias.label ? `: ${item.alias.label}` : ""} – wird gleich zugeordnet</span>
            )}
            {board && !item.alias && item.suggestions?.length > 0 && (
              <span className="block tls-type-small text-white/55" data-testid="preview-unknown-suggestions">
                Vorschlag: {item.suggestions.slice(0, 3).map((entry) => `${entry.label} (${entry.reason})`).join(" · ")}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResultPreview({ preview, general, board, profile = null }) {
  const errors = general.filter((item) => item.level === "error");
  const warnings = general.filter((item) => item.level === "warning");
  const scopes = SCOPE_ORDER.filter((scope) => preview.standings?.scopes?.[scope]?.length);
  const club = preview.club_members || [];
  return (
    <section className="space-y-3" data-testid="result-preview" aria-label="Vorschau">
      <ProblemList items={errors} level="error" testId="preview-errors" />
      <ProblemList items={warnings} level="warning" testId="preview-warnings" />
      {club.length > 0 && (
        <div className="flex items-start gap-2 tls-type-small text-white/75" data-testid="preview-club">
          <Sparkles className="w-4 h-4 mt-0.5 text-[#29B6E8] shrink-0" />
          <span>Vereinsleute erkannt: {club.map((member) => member.profile_name && member.profile_name !== member.name ? `${member.name} (${member.profile_name})` : member.name).join(", ")}</span>
        </div>
      )}
      <UnknownNames items={preview.unknown_names || []} board={board} />
      {scopes.length > 0 && (
        <div className="space-y-3">
          <div className="tls-type-label text-[#29B6E8]">
            Stand nach diesem Termin{preview.standings?.round_seq ? ` (${kindShows(profile, "day_rounds", false) ? kindWord(profile, "round_one", "Runde") : "Runde"} ${preview.standings.round_seq})` : ""}
          </div>
          {preview.latest && <p className="tls-type-small text-white/50">Danach sind schon weitere Termine gewertet – auch deren Stand rechnet die Website neu.</p>}
          {scopes.map((scope) => <StandingsScope key={scope} scope={scope} rows={preview.standings.scopes[scope]} final={preview.final} profile={profile} />)}
          <FinalChanges final={preview.final} rows={preview.standings.scopes.drivers} />
        </div>
      )}
    </section>
  );
}
