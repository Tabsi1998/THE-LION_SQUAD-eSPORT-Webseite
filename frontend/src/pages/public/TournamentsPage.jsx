import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentCard } from "@/components/tls/TournamentCard";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

export default function TournamentsPage() {
  useDocumentTitle(
    "eSports Turniere",
    "Aktuelle eSports Turniere von THE LION SQUAD: Anmeldung, Check-in, Brackets, Spielpläne und Ranglisten für Gaming Events in Tirol."
  );

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    try {
      const q = statusFilter !== "all" ? `?status=${statusFilter}` : "";
      const { data } = await api.get(`/tournaments${q}`);
      setList(data);
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
              onClick={() => setStatusFilter(f.v)}
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="border border-white/10 rounded-sm bg-[#121212] overflow-hidden animate-pulse">
                <div className="aspect-video bg-white/5" />
                <div className="p-5 space-y-3">
                  <div className="h-3 bg-white/10 rounded-sm w-1/3" />
                  <div className="h-5 bg-white/10 rounded-sm w-3/4" />
                  <div className="h-3 bg-white/5 rounded-sm w-1/2" />
                </div>
              </div>
            ))}
          </div>
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
              <div className="col-span-full text-center py-20">
                <div className="text-white/20 font-display tracking-widest text-sm mb-2">KEINE TURNIERE GEFUNDEN</div>
                <p className="text-white/40 text-sm">Für diesen Filter gibt es aktuell keine Turniere.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </PublicLayout>
  );
}
