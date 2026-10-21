import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { CheckField } from "@/components/tls/FormFields";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { KIND_OPTIONS, STATUS_LABELS, visibleLineages } from "@/lib/referenceSeries";
import { LineageForm } from "./referenceSeries/LineageForm";
import { SeriesForm } from "./referenceSeries/SeriesForm";
import { toast } from "sonner";
import { Archive, ArchiveRestore, ListOrdered, Pencil, Plus } from "lucide-react";

// Serien (#1741): externe Wettbewerbe mit Kalender und Tabelle - eine Spur (etwa eine Rennliga) als Klammer, darunter je
// Saison und Stufe eine Serie. Gelöscht wird nichts: Spur und Saison werden archiviert und lassen sich zurückholen.
// Termine, Teilnehmer, Ergebnisse und Captains kommen auf die Seite der Saison (#1742 ff.).

const KIND_LABELS = Object.fromEntries(KIND_OPTIONS);
const PUBLISH_LABELS = { review: "Freigabe durch den Vorstand", direct: "Captain direkt" };
const STATUS_TONE = { active: "text-ok", planned: "text-brand", archived: "text-quiet" };

export function seasonLabel(series) {
  return [series.season, series.tier].filter(Boolean).join(" · ");
}

export default function AdminReferenceSeriesPage() {
  const [overview, setOverview] = useState({ lineages: [], points_schemes: [], default_rules: {} });
  const [games, setGames] = useState([]);
  const [partners, setPartners] = useState([]);
  const [showArchived, setShowArchived] = useState(false);
  const [editingLineage, setEditingLineage] = useState(null);
  const [editingSeries, setEditingSeries] = useState(null);
  const confirm = useConfirm();

  const load = useCallback(async () => {
    const [{ data }, gameRows, partnerRows] = await Promise.all([
      api.get("/reference-series/admin"),
      api.get("/games").then((result) => (Array.isArray(result?.data) ? result.data : [])).catch(() => []),
      // #1934: aktive Partner für die Auswahl an Spur und Saison.
      api.get("/partners").then((result) => (Array.isArray(result?.data) ? result.data : [])).catch(() => []),
    ]);
    setOverview({ lineages: data?.lineages || [], points_schemes: data?.points_schemes || [], default_rules: data?.default_rules || {} });
    setGames(gameRows);
    setPartners(partnerRows);
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["reference-series", "games"]);

  const shown = useMemo(() => visibleLineages(overview.lineages, showArchived), [overview.lineages, showArchived]);
  const archivedCount = useMemo(() => overview.lineages.reduce(
    (sum, lineage) => sum + (lineage.is_archived ? 1 : 0) + (lineage.series || []).filter((series) => series.status === "archived").length, 0,
  ), [overview.lineages]);
  const gameName = (id) => games.find((game) => game.id === id)?.name;

  const act = async (url, message) => {
    try {
      await api.post(url);
      toast.success(message);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const archiveSeries = async (series) => {
    if (!await confirm({ title: "Saison archivieren?", description: "Gelöscht wird nichts – „Zurückholen“ macht es rückgängig.", confirmLabel: "Archivieren" })) return;
    act(`/reference-series/admin/series/${series.id}/archive`, "Saison archiviert.");
  };
  const archiveLineage = async (lineage) => {
    if (!await confirm({ title: "Spur archivieren?", description: "Die Saisons bleiben, wie sie sind. Gelöscht wird nichts – „Zurückholen“ macht es rückgängig.", confirmLabel: "Archivieren" })) return;
    act(`/reference-series/admin/lineages/${lineage.id}/archive`, "Spur archiviert.");
  };

  return (
    <AdminLayout>
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Serien</h1>
          <p className="mt-2 text-white/60 text-sm max-w-xl">Externe Wettbewerbe über eine ganze Saison: Turnierserien, Rennligen und Team-Ligen. Eine Spur ist die Klammer, darunter je Saison und Stufe eine Serie mit eigenen Regeln.</p>
        </div>
        <button type="button" onClick={() => setEditingLineage({})} data-testid="lineage-new" className="tls-btn tls-btn--primary px-5 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Neue Spur
        </button>
      </div>

      <CheckField label={`Archivierte zeigen (${archivedCount})`} checked={showArchived} onChange={setShowArchived} testId="series-show-archived" className="mb-4" />

      <div className="space-y-4">
        {shown.map((lineage) => (
          <section key={lineage.id} className="border border-white/10 rounded-sm bg-[#121212] p-4" data-testid={`lineage-${lineage.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45 font-bold flex-wrap">
                  <span className="text-[#29B6E8]">{KIND_LABELS[lineage.kind] || lineage.kind}</span>
                  {lineage.label && <span>{lineage.label}</span>}
                  {lineage.organizer && <span>{lineage.organizer}</span>}
                  {gameName(lineage.game_id) && <span>{gameName(lineage.game_id)}</span>}
                  {lineage.is_archived && <span className="text-quiet">Archiviert</span>}
                </div>
                <h2 className="mt-1 font-heading text-xl font-black uppercase leading-tight">{lineage.title}</h2>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button type="button" onClick={() => setEditingSeries({ lineage, series: null })} data-testid={`series-new-${lineage.id}`} className="tls-btn tls-btn--secondary px-3 py-1.5 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5">
                  <Plus className="w-3.5 h-3.5" /> Saison
                </button>
                <button type="button" onClick={() => setEditingLineage(lineage)} aria-label="Spur bearbeiten" title="Spur bearbeiten" data-testid={`lineage-edit-${lineage.id}`} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                {lineage.is_archived ? (
                  <button type="button" onClick={() => act(`/reference-series/admin/lineages/${lineage.id}/restore`, "Spur zurückgeholt.")} aria-label="Spur zurückholen" title="Zurückholen" data-testid={`lineage-restore-${lineage.id}`} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><ArchiveRestore className="w-4 h-4" /></button>
                ) : (
                  <button type="button" onClick={() => archiveLineage(lineage)} aria-label="Spur archivieren" title="Archivieren" data-testid={`lineage-archive-${lineage.id}`} className="p-1.5 text-white/40 hover:text-brand"><Archive className="w-4 h-4" /></button>
                )}
              </div>
            </div>
            <ul className="mt-3 divide-y divide-white/5">
              {lineage.series.map((series) => (
                <li key={series.id} className="py-2 flex items-center justify-between gap-3" data-testid={`series-row-${series.id}`}>
                  <div className="min-w-0">
                    <Link to={`/admin/reference-series/${series.id}`} className="font-bold text-white hover:text-[#29B6E8]">{seasonLabel(series)}</Link>
                    {series.title && <span className="ml-2 text-sm text-white/55">{series.title}</span>}
                    <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/45 font-bold flex-wrap">
                      <span className={STATUS_TONE[series.status] || ""}>{STATUS_LABELS[series.status] || series.status}</span>
                      <span>{PUBLISH_LABELS[series.publish_mode] || series.publish_mode}</span>
                      <span>Regeln v{series.rules_version || 1}</span>
                      {series.visibility && series.visibility !== "public" && <span className="text-[#29B6E8]">{series.visibility}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button type="button" onClick={() => setEditingSeries({ lineage, series })} aria-label="Saison bearbeiten" title="Saison bearbeiten" data-testid={`series-edit-${series.id}`} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><Pencil className="w-4 h-4" /></button>
                    {series.status === "archived" ? (
                      <button type="button" onClick={() => act(`/reference-series/admin/series/${series.id}/restore`, "Saison zurückgeholt.")} aria-label="Saison zurückholen" title="Zurückholen" data-testid={`series-restore-${series.id}`} className="p-1.5 text-white/40 hover:text-[#29B6E8]"><ArchiveRestore className="w-4 h-4" /></button>
                    ) : (
                      <button type="button" onClick={() => archiveSeries(series)} aria-label="Saison archivieren" title="Archivieren" data-testid={`series-archive-${series.id}`} className="p-1.5 text-white/40 hover:text-brand"><Archive className="w-4 h-4" /></button>
                    )}
                  </div>
                </li>
              ))}
              {lineage.series.length === 0 && <li className="py-2 text-sm text-white/40">Noch keine Saison.</li>}
            </ul>
          </section>
        ))}
        {shown.length === 0 && (
          <div className="text-center py-16 border border-dashed border-white/15 rounded-sm text-white/40 font-display tracking-widest inline-flex w-full flex-col items-center gap-3">
            <ListOrdered className="w-8 h-8" />
            NOCH KEINE SERIEN
          </div>
        )}
      </div>

      {editingLineage && <LineageForm lineage={editingLineage} games={games} partners={partners} onClose={() => setEditingLineage(null)} onSaved={() => { setEditingLineage(null); load(); }} />}
      {editingSeries && (
        <SeriesForm series={editingSeries.series} lineage={editingSeries.lineage} partners={partners} schemes={overview.points_schemes} defaultRules={overview.default_rules}
          onClose={() => setEditingSeries(null)} onSaved={() => { setEditingSeries(null); load(); }} />
      )}
    </AdminLayout>
  );
}
