import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { PublicEmptyState } from "@/components/tls/PublicEmptyState";
import { PublicLoadingState } from "@/components/tls/PublicLoadingState";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { sortByNearestDate } from "@/lib/contentSort";
import { Trophy } from "lucide-react";

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

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ compact: "true", limit: "60" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const { data } = await api.get(`/tournaments?${params.toString()}`);
      setList(sortByNearestDate(Array.isArray(data) ? data : data?.items || []));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    setLoading(true);
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  useApiInvalidation(load, ["tournaments"]);

  useEffect(() => {
    const nextStatus = searchParams.get("status") || "all";
    if (nextStatus !== statusFilter) setStatusFilter(nextStatus);
  }, [searchParams, statusFilter]);

  const selectStatusFilter = (value) => {
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
            <button onClick={load} className="mt-4 px-4 py-2 border border-[#29B6E8]/40 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider hover:bg-[#29B6E8]/10 transition">
              Erneut versuchen
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {list.map((t, i) => <TournamentCard key={t.id} tournament={t} index={i} />)}
            {list.length === 0 && (
              <PublicEmptyState
                icon={Trophy}
                eyebrow="Turniere"
                title={statusFilter === "all" ? "Noch keine Turniere sichtbar" : "Keine Turniere in diesem Filter"}
                description={statusFilter === "all" ? "Sobald neue Cups, Ligen oder Community-Turniere angelegt sind, erscheinen sie hier automatisch." : "Wechsle auf alle Turniere oder schau später wieder rein, wenn sich der Status ändert."}
                primaryAction={statusFilter === "all" ? { to: "/events", label: "Events ansehen" } : { to: "/tournaments", label: "Alle Turniere" }}
                secondaryAction={{ to: "/fastlap", label: "Fast Lap" }}
                className="col-span-full"
              />
            )}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
