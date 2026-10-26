import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { COUNT_MODE_OPTIONS, KIND_OPTIONS, STATUS_LABELS, TIEBREAKER_OPTIONS } from "@/lib/referenceSeries";
import { SeriesForm } from "./referenceSeries/SeriesForm";
import { SeriesCalendarSection } from "./referenceSeries/SeriesCalendarSection";
import { SeriesParticipantsSection } from "./referenceSeries/SeriesParticipantsSection";
import { SeriesResultsSection } from "./referenceSeries/SeriesResultsSection";
import { SeriesRosterSection } from "./referenceSeries/SeriesRosterSection";
import { SeriesStaffSection } from "./referenceSeries/SeriesStaffSection";
import { SeriesTeamColorsSection } from "./referenceSeries/SeriesTeamColorsSection";
import { SeriesAdjustmentsSection } from "./referenceSeries/SeriesAdjustmentsSection";
import { cancelledText, teamModeLabel } from "@/lib/seriesSpecialRules";
import { SeasonCloseSheet } from "./referenceSeries/SeasonCloseSheet";
import { SeriesMapPoolSection } from "./referenceSeries/SeriesMapPoolSection";
import { SeriesPartnerSourceSection } from "./referenceSeries/SeriesPartnerSourceSection";
import { SeasonTableSection } from "./referenceSeries/SeasonTableSection";
import { seasonLabel } from "./AdminReferenceSeriesPage";
import { dayLabel, publishText } from "@/lib/referenceSeriesStaff";
import { referenceLine, seasonName } from "@/lib/seasonClose";
import { bonusRulesLabel, dayRoundsLabel, doubleUpLabel } from "@/lib/referenceSeriesTable";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ArrowLeft, Flag, Pencil } from "lucide-react";

// Seite einer Saison (#1741): Kopf mit Spur, Saison, Status und Regeln; Bearbeiten im Seitenblatt, Archivieren statt
// Löschen. Kalender (#1742), Teilnehmer (#1743), Ergebnisse (#1744) und Captains (#1749) sind eigene Abschnitte, die
// ihre Pakete füllen.
// Captains (#1749) öffnen dieselbe Seite über „Mein Dienst“: der Server sagt in `access`, was die Person hier darf -
// Bearbeiten, Archivieren und die Captain-Verwaltung bleiben beim Vorstand.
// Saison abschließen (#1750, nur Vorstand, auch nachträglich): der Vorschlag mit den Endständen kommt im Seitenblatt,
// der Kopf zeigt danach „Referenz: Platz 6 von 8 · ansehen“.

const KIND_LABELS = Object.fromEntries(KIND_OPTIONS);
const COUNT_LABELS = Object.fromEntries(COUNT_MODE_OPTIONS);
const TIEBREAK_LABELS = Object.fromEntries(TIEBREAKER_OPTIONS);

function countText(rules) {
  if (rules.count_mode === "best_n") return `Beste ${rules.count_n}`;
  if (rules.count_mode === "drop_n") return `${rules.count_n} Streichergebnisse`;
  return COUNT_LABELS.all;
}

function RulesSummary({ series }) {
  const rules = series.rules || {};
  const points = rules.points_mode === "organizer" ? "Punkte laut Veranstalter" : `Punkte je Platz: ${(rules.points_by_place || []).join(", ") || "–"}`;
  const tiebreak = (rules.tiebreakers || []).map((key) => (key === "top_n" ? `Mehr Plätze unter den besten ${rules.tiebreak_top_n || 4}` : TIEBREAK_LABELS[key] || key)).join(", ");
  // Turniertage (#1961): Runden je Termin und Sonderboni, wenn die Saison welche führt.
  const days = dayRoundsLabel(rules);
  const bonuses = bonusRulesLabel(rules);
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4 text-sm text-white/70 space-y-1" data-testid="series-detail-rules">
      <div className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Regeln · Version {series.rules_version || 1}</div>
      <div>{points}</div>
      {days && <div data-testid="series-detail-days">{days}</div>}
      {doubleUpLabel(rules) && <div data-testid="series-detail-double-up">Double Up: {doubleUpLabel(rules)}</div>}
      {series.planned_rounds ? <div data-testid="series-detail-planned">Geplante Termine: {series.planned_rounds}</div> : null}
      {bonuses && <div data-testid="series-detail-bonuses">Sonderboni: {bonuses}</div>}
      <div>{countText(rules)}{rules.final_top_n ? ` · Finale: die besten ${rules.final_top_n}` : ""}</div>
      {tiebreak && <div>Vorrang: {tiebreak}</div>}
      {rules.team_scoring?.enabled && <div data-testid="series-detail-team-mode">Teamwertung: {teamModeLabel(rules.team_scoring)}</div>}
      {series.rules_note && <div className="text-white/50">Hinweis zur letzten Änderung: {series.rules_note}</div>}
    </div>
  );
}

export default function AdminReferenceSeriesDetailPage() {
  const { seriesId } = useParams();
  const [series, setSeries] = useState(null);
  const [missing, setMissing] = useState("");
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [preview, setPreview] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/reference-series/admin/series/${seriesId}`);
      setSeries(data);
      setMissing("");
    } catch (err) {
      setMissing(formatApiError(err.response?.data?.detail) || "Serie nicht gefunden.");
    }
  }, [seriesId]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series"]);

  const board = (series?.access?.role || "board") === "board";
  const loadPreview = useCallback(async () => {
    try {
      const { data } = await api.get(`/reference-series/admin/series/${seriesId}/close`);
      setPreview(data && Array.isArray(data.entries) ? data : null);
    } catch {
      setPreview(null);
    }
  }, [seriesId]);
  // Der Vorschlag kennt die Referenz der Saison - nur der Vorstand darf ihn sehen.
  useEffect(() => { if (series && board) loadPreview(); }, [series, board, loadPreview]);
  const openClose = () => {
    setPreview(null);
    setClosing(true);
    loadPreview();
  };

  const archived = series?.status === "archived";
  const toggleArchive = async () => {
    if (!archived && !await confirm({ title: "Saison archivieren?", description: "Gelöscht wird nichts – „Zurückholen“ macht es rückgängig.", confirmLabel: "Archivieren" })) return;
    try {
      await api.post(`/reference-series/admin/series/${seriesId}/${archived ? "restore" : "archive"}`);
      toast.success(archived ? "Saison zurückgeholt." : "Saison archiviert.");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const lineage = series?.lineage || {};
  const access = series?.access || { role: "board", can_publish: true };
  const current = preview?.current;
  return (
    <AdminLayout>
      <Link to={board ? "/admin/reference-series" : "/admin/dienst"} data-testid="series-detail-back" className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/50 hover:text-[#29B6E8]">
        <ArrowLeft className="w-3.5 h-3.5" /> {board ? "Serien" : "Mein Dienst"}
      </Link>
      {missing && <div className="mt-6 text-white/60" data-testid="series-detail-missing">{missing}</div>}
      {series && (
        <>
          <div className="mt-3 mb-6 flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8] flex-wrap" data-testid="series-detail-lineage">
                <span>{lineage.title}</span>
                <span className="text-white/45 tracking-widest">{KIND_LABELS[lineage.kind] || lineage.kind}</span>
              </div>
              <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">{seasonLabel(series)}</h1>
              <div className="mt-1 text-[10px] uppercase tracking-widest font-bold text-white/45">{STATUS_LABELS[series.status] || series.status}</div>
              {cancelledText(series) && <p className="mt-1 text-sm text-amber-200/90" data-testid="series-detail-cancelled">{cancelledText(series)}</p>}
              {board && current && (
                <p className="mt-2 text-sm text-white/70" data-testid="series-detail-reference">
                  Referenz: <span className="text-white font-semibold tabular-nums">{referenceLine(current)}</span> · <Link to={`/references/${current.id}`} className="text-[#29B6E8] hover:text-white underline-offset-2 hover:underline">ansehen</Link>
                </p>
              )}
            </div>
            {board && <div className="flex items-center gap-2 shrink-0 flex-wrap max-w-full">
              {!archived && (
                <button type="button" onClick={openClose} data-testid="series-detail-close" className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                  <Flag className="w-3.5 h-3.5" /> Saison abschließen
                </button>
              )}
              <button type="button" onClick={() => setEditing(true)} data-testid="series-detail-edit" className="tls-btn tls-btn--secondary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                <Pencil className="w-3.5 h-3.5" /> Bearbeiten
              </button>
              <button type="button" onClick={toggleArchive} data-testid="series-detail-archive" className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
                {archived ? <ArchiveRestore className="w-3.5 h-3.5" /> : <Archive className="w-3.5 h-3.5" />} {archived ? "Zurückholen" : "Archivieren"}
              </button>
            </div>}
          </div>
          {!board && (
            <p className="mb-4 border border-[#29B6E8]/30 bg-[#29B6E8]/5 rounded-sm px-4 py-3 text-sm text-white/75" data-testid="series-detail-captain">
              Du bist Captain dieser Saison{dayLabel(access.valid_until) ? ` bis ${dayLabel(access.valid_until)}` : ""} · {publishText(access.can_publish)}.
            </p>
          )}
          <div className="space-y-4">
            <RulesSummary series={series} />
            <SeriesCalendarSection series={series} onChanged={load} />
            {/* Zuordnung der Namen (Aliase, Verknüpfungen) bleibt beim Vorstand (#1743) - Captains sehen sie nicht. */}
            {board && <SeriesParticipantsSection series={series} onChanged={load} />}
            {/* Kader je eigenem Team (#1931) - nur Team-Liga, nur Vorstand. */}
            {board && lineage.kind === "team_league" && <SeriesRosterSection series={series} />}
            {/* Partner-Plattform (#1964): Turniertage samt Runden als Entwurf holen - Turnierserie, nur Vorstand. */}
            {board && lineage.kind === "series" && <SeriesPartnerSourceSection series={series} onChanged={load} />}
            <SeriesResultsSection series={series} onChanged={load} />
            {/* Saisontabelle einlesen (#1928): vergangene Runden als Entwürfe nachtragen - nur Vorstand, nicht Team-Liga. */}
            {board && lineage.kind !== "team_league" && <SeasonTableSection series={series} onChanged={load} />}
            {/* Teamfarben für die Ergebnistabelle je Runde (#1950) - nur Rennliga, nur Vorstand. */}
            {board && lineage.kind === "racing" && <SeriesTeamColorsSection series={series} />}
            {/* Map-Pool der Saison (#1616): mit Spiel der Spur, bei der Team-Liga auch ohne (Hinweis auf den Freitext). */}
            {board && (lineage.game_id || lineage.kind === "team_league") && <SeriesMapPoolSection series={series} />}
            {/* Anpassungen (#1960): ±Punkte ohne Rennergebnis - nur der Vorstand. */}
            {board && <SeriesAdjustmentsSection series={series} onChanged={load} />}
            {board && <SeriesStaffSection series={series} />}
          </div>
          {board && editing && <SeriesForm series={series} lineage={lineage} profile={series.profile} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
          {board && closing && (
            <SeasonCloseSheet key={preview ? "bereit" : "laedt"} series={series} label={seasonName(lineage, series)} preview={preview}
              onClose={() => setClosing(false)} onDone={() => { setClosing(false); load(); }} />
          )}
        </>
      )}
    </AdminLayout>
  );
}
