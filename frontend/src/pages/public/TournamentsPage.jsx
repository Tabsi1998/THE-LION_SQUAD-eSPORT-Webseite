import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { TournamentCard } from "@/components/tls/TournamentCard";

export default function TournamentsPage() {
  const [list, setList] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    const q = statusFilter !== "all" ? `?status=${statusFilter}` : "";
    const { data } = await api.get(`/tournaments${q}`);
    setList(data);
  }, [statusFilter]);

  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

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
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Tournaments</span>
          <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase">Alle Turniere</h1>
          <p className="mt-3 text-white/60 max-w-xl">Online und Offline. Einzelspieler, Teams und FFA. Vom kleinen Cup bis zur Saison-Liga.</p>
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {list.map((t, i) => <TournamentCard key={t.id} tournament={t} index={i} />)}
          {list.length === 0 && <div className="col-span-full text-white/40 text-center py-20 font-display tracking-widest">KEINE TURNIERE GEFUNDEN</div>}
        </div>
      </div>
    </PublicLayout>
  );
}
