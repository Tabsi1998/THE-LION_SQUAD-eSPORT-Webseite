// Liga-Staffel (#2109): eine Staffel ist ein Turnier mit `league_context`; bedient wird sie seit Paket D (#2262) nur auf der Staffel-Seite
// der Liga-Verwaltung. Was die Season vorgibt, steht hier nur zum Lesen - mit dem Hinweis „kommt aus der Season“ und dem Weg dorthin. Der Server lehnt
// Änderungen daran ohnehin ab (`services/staffel_guard.py`), sonst würde das nächste „Übertragen“ sie still überschreiben.
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { staffelNeeds, staffelStand } from "@/lib/seasonTabs";
import { viennaDateTime } from "@/lib/vienna";
import { gameOptionLabel } from "@/lib/gameLabels";
import { VISIBILITY_OPTIONS, WEEKDAY_OPTIONS } from "./shared";

export const isStaffel = (tournament) => Boolean(tournament?.league_context);

// Liga-Stand statt Turnier-Status (#2453): dieselben Farb-Rollen wie StatusBadge - grün offen, Cyan Marke, Rot läuft gerade, Grau wartet
// oder ist vorbei.
const STAND_TONE = {
  vorbereitung: "bg-white/5 text-white/60 border-white/10",
  anmeldung: "bg-ok/15 text-ok border-ok/50",
  einteilung: "bg-brand/15 text-brand border-brand/50",
  spielbetrieb: "bg-white/10 text-white/80 border-white/20",
  abschluss: "bg-white/10 text-white/70 border-white/20",
};

/** Der Stand einer Staffel aus ihrer Season („Anmeldung offen bis …“), sonst der Turnier-Status wie bisher. */
export function StaffelStandBadge({ tournament, season, now, testId }) {
  const stand = staffelStand(tournament, { season: season || undefined, now });
  if (!stand) return <StatusBadge status={tournament?.status} />;
  // Offen, aber verborgen: Achtung statt Grün - Teams können sich so nicht anmelden.
  const tone = stand.live ? "bg-live/20 text-live border-live/50" : stand.hidden ? "bg-warn/15 text-warn border-warn/50" : STAND_TONE[stand.key];
  return (
    <span data-testid={testId} title={stand.note}
      className={`inline-flex items-center gap-1 rounded-sm border px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider ${tone}`}>
      {stand.live ? <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" aria-hidden="true" /> : null}
      {stand.label}
    </span>
  );
}

/** Was der Staffel noch fehlt („Teams zuteilen · 1 von 8“), jeweils mit dem Weg an die Stelle. ``manageUrl``: wie bei `staffelNeeds`. */
export function StaffelNeedsHint({ tournament, season, now, testId, className = "", manageUrl }) {
  const needs = staffelNeeds(tournament, { season: season || undefined, now, manageUrl });
  if (!needs.length) return null;
  return (
    <ul data-testid={testId} className={`space-y-0.5 ${className}`}>
      {needs.map((need) => (
        <li key={need.code}>
          <Link to={need.to} data-testid={testId ? `${testId}-${need.code}` : undefined}
            className="inline-flex items-center gap-1 text-[11px] font-semibold leading-snug text-warn hover:text-white">
            {need.text} <ArrowRight className="h-3 w-3 shrink-0" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

// Vor dem Start ist der Spielplan eine Vorschau, die bei jeder Zuteilung neu gemischt wird (Handbuch liga.md 2.5).
const PRE_START = new Set(["draft", "scheduled", "registration_open", "registration_closed", "check_in"]);
export const staffelBeforeStart = (tournament) => PRE_START.has(tournament?.status || "draft");

/** „Liga 1 · Staffel A“ - ohne Angaben vom Server die Kennzeichnung „Liga · Staffel A“. */
export function staffelLabel(tournament) {
  const links = tournament?.league_links || {};
  const staffel = links.staffel || tournament?.league_context?.staffel;
  const head = links.division_label || "Liga";
  return staffel ? `${head} · Staffel ${staffel}` : head;
}

/** „kommt aus der Season“ mit dem Weg zur Season. */
function SeasonSourceNote({ tournament, children = "Kommt aus der Season – dort ändern und übertragen.", testId }) {
  const seasonPath = tournament?.league_links?.season_admin_path
    || (tournament?.league_context?.season_id ? `/admin/leagues/seasons/${tournament.league_context.season_id}` : null);
  return (
    <p className="text-xs text-white/50" data-testid={testId}>
      {children}{" "}
      {seasonPath && <Link to={seasonPath} className="-my-3 inline-flex min-h-[44px] items-center text-[#29B6E8] font-bold hover:text-white">Season öffnen</Link>}
    </p>
  );
}

function ReadOnlyValue({ label, value, testId, wide = false }) {
  return (
    <div className={`min-w-0 ${wide ? "md:col-span-2" : ""}`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <div className="rounded-sm border border-white/5 bg-[#0A0A0A]/60 px-3 py-2 text-sm text-white/80 break-words" data-testid={testId}>
        {value === null || value === undefined || value === "" ? "—" : value}
      </div>
    </div>
  );
}

const optionLabel = (options, value) => options.find(([key]) => String(key) === String(value))?.[1] || value;
const when = (value) => (value ? viennaDateTime(value, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

/** Die Werte, die die Season der Staffel gibt - nur lesend (S3–S9, S13). Die Seitenleiste des Formulars. */
export function StaffelSeasonValues({ tournament, games = [] }) {
  const game = games.find((row) => row.id === tournament.game_id) || tournament.game;
  return (
    <FormSection title="Aus der Season" hint="Diese Werte gibt die Season der Staffel vor. Ändern in der Season, dann „Vorgaben übertragen“." testId="tr-edit-season-values">
      <FormGrid cols={2}>
        <ReadOnlyValue label="Spiel" value={game ? gameOptionLabel(game) : ""} testId="tr-edit-season-game" wide />
        <ReadOnlyValue label="Start" value={when(tournament.start_date)} testId="tr-edit-season-start" />
        <ReadOnlyValue label="Ende" value={when(tournament.end_date)} testId="tr-edit-season-end" />
        <ReadOnlyValue label="Spieltag dauert" value={tournament.matchday_days ? `${tournament.matchday_days} Tage` : ""} testId="tr-edit-season-matchday-days" />
        <ReadOnlyValue label="Standardtermin" value={[optionLabel(WEEKDAY_OPTIONS, tournament.default_match_weekday ?? 6), tournament.default_match_time].filter(Boolean).join(" · ")} testId="tr-edit-season-default-match" />
        <ReadOnlyValue label="Spieler pro Team" value={tournament.team_size} testId="tr-edit-season-team-size" />
        <ReadOnlyValue label="Max Teams" value={tournament.max_participants} testId="tr-edit-season-max" />
        <ReadOnlyValue label="Best of" value={tournament.best_of ? `Best of ${tournament.best_of}` : ""} testId="tr-edit-season-bo" />
        <ReadOnlyValue label="Ergebnis gilt nach" value={tournament.result_confirm_hours_league ? `${tournament.result_confirm_hours_league} Std.` : "48 Std."} testId="tr-edit-season-confirm" />
        {/* Seit #2106 (F3) ein Season-Wert, je Liga N überschreibbar. */}
        <ReadOnlyValue label="Antwort auf Terminvorschlag" value={`${tournament.match_schedule_response_hours ?? 72} Std.`} testId="tr-edit-season-response" />
        <ReadOnlyValue label="Sichtbarkeit" value={optionLabel(VISIBILITY_OPTIONS, tournament.visibility || "internal")} testId="tr-edit-season-visibility" wide />
      </FormGrid>
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Regeltext</div>
        <div className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-sm border border-white/5 bg-[#0A0A0A]/60 px-3 py-2 text-xs text-white/70" data-testid="tr-edit-season-rules">
          {tournament.rules || "Noch kein Regeltext."}
        </div>
      </div>
      <SeasonSourceNote tournament={tournament} testId="tr-edit-season-link" />
    </FormSection>
  );
}
