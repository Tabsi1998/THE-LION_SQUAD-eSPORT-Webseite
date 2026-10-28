import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { Reveal } from "@/components/tls/Reveal";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { PublicEmptyState } from "@/components/tls/PublicEmptyState";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { sortByNearestDate } from "@/lib/contentSort";

const PAGE_SIZE = 24;
// Der Server gibt höchstens 200 je Abruf zurück (_page_items) - so weit lädt „Mehr laden“ nach.
const MAX_SHOWN = 200;
// Status-Gruppen (#2124, TP12): „Beendet“ sind auch veröffentlichte und archivierte Turniere, „Live“ auch pausierte. Die
// Adresse behält die bisherigen Werte (?status=completed, ?status=live) - Links von früher bleiben gültig.
const FILTER_QUERY = { completed: "finished", live: "running" };

export default function TournamentsPage() {
  useDocumentTitle(
    "eSports Turniere",
    "Aktuelle eSports Turniere von THE LION SQUAD: Anmeldung, Check-in, Brackets, Spielpläne und Ranglisten für Gaming Events in Tirol."
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  // „Mehr laden“ (#2124, TP13): Seiten zu 24 - die Live-Aktualisierung lädt so viele, wie schon zu sehen sind.
  const [shown, setShown] = useState(PAGE_SIZE);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = useCallback(async (count) => {
    // Liga-Staffeln haben ihre eigene Seite (docs/LIGA.md) - die Turnierliste fragt ohne sie.
    const params = new URLSearchParams({ compact: "true", paged: "true", limit: String(count), offset: "0", league: "exclude" });
    if (statusFilter !== "all") params.set("status", FILTER_QUERY[statusFilter] || statusFilter);
    const { data } = await api.get(`/tournaments?${params.toString()}`);
    const items = Array.isArray(data) ? data : data?.items || [];
    setList(sortByNearestDate(items));
    setTotal(Array.isArray(data) ? items.length : Number(data?.total ?? items.length));
  }, [statusFilter]);

  const load = useCallback(async () => {
    try {
      await fetchPage(shown);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [fetchPage, shown]);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = () => {
    setLoadingMore(true);
    setShown((value) => Math.min(value + PAGE_SIZE, MAX_SHOWN));
  };
  const hasMore = total > list.length && shown < MAX_SHOWN;

  useLiveRefresh(load, ["tournaments"], { fallbackMs: 15000 });

  useEffect(() => {
    const nextStatus = searchParams.get("status") || "all";
    if (nextStatus !== statusFilter) setStatusFilter(nextStatus);
  }, [searchParams, statusFilter]);

  const selectStatusFilter = (value) => {
    if (value !== statusFilter) {
      setLoading(true);
      setShown(PAGE_SIZE);
    }
    setStatusFilter(value);
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (value && value !== "all") params.set("status", value);
      else params.delete("status");
      return params;
    }, { replace: true });
  };

  const filters = [
    { v: "all", label: "Alle" },
    { v: "registration_open", label: "Anmeldung" },
    { v: "check_in", label: "Check-in" },
    { v: "live", label: "Live" },
    { v: "completed", label: "Beendet" },
  ];

  return (
    <PublicLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
        <div className="mb-10">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Turniere</span>
          <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Alle Turniere</h1>
          <p className="mt-3 text-white/60 max-w-xl">Online und vor Ort. Einzelspieler, Teams und Mehrspieler. Vom kleinen Pokal bis zur Saison-Liga.</p>
        </div>
        <div className="flex flex-wrap gap-2 mb-8">
          {filters.map((f) => (
            <button
              key={f.v}
              data-testid={`tournament-filter-${f.v}`}
              onClick={() => selectStatusFilter(f.v)}
              className={`px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-sm border transition ${
                statusFilter === f.v
                  ? "bg-[#29B6E8] text-black border-[#29B6E8]"
                  : "bg-transparent text-white/70 border-white/10 hover:border-[#29B6E8]/40"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {loading ? (
          <PublicLoadingState cards={6} />
        ) : error ? (
          <div className="col-span-full text-center py-20">
            <div className="text-[#FF3B30] font-display tracking-widest text-sm">FEHLER BEIM LADEN</div>
            <p className="mt-2 text-white/40 text-sm">Turniere konnten nicht geladen werden. Bitte Seite neu laden.</p>
            <button onClick={load} className="tls-btn tls-btn--secondary mt-4 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
              Erneut versuchen
            </button>
          </div>
        ) : (
          <Reveal className="tls-reveal-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-6">
            {list.map((t, i) => <TournamentCard key={t.id} tournament={t} index={i} />)}
            {list.length === 0 && (
              <PublicEmptyState
                title={statusFilter === "all" ? "Noch keine Turniere sichtbar" : "Keine Turniere in diesem Filter"}
                description={statusFilter === "all" ? "Sobald neue Cups, Ligen oder Community-Turniere angelegt sind, erscheinen sie hier automatisch." : "Wechsle auf alle Turniere oder schau später wieder rein, wenn sich der Status ändert."}
                primaryAction={statusFilter === "all" ? { to: "/events", label: "Events ansehen" } : { to: "/tournaments", label: "Alle Turniere" }}
                secondaryAction={{ to: "/fastlap", label: "Fast Lap" }}
                className="col-span-full"
              />
            )}
          </Reveal>
        )}
        {!loading && !error && hasMore ? (
          <div className="mt-10 flex justify-center">
            <button type="button" onClick={loadMore} disabled={loadingMore} data-testid="tournaments-load-more"
              className="tls-btn tls-btn--secondary min-h-11 px-6 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
              {loadingMore ? "Lädt …" : "Mehr laden"}
            </button>
          </div>
        ) : null}
      </div>
    </PublicLayout>
  );
}
