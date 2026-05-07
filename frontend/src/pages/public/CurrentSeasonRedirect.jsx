import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { ArrowRight, CalendarDays, Trophy } from "lucide-react";

export default function CurrentSeasonRedirect() {
  const nav = useNavigate();
  const [loading, setLoading] = useState(true);
  const [seasons, setSeasons] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/seasons/active/featured");
      const season = data?.season;
      if (season?.slug) {
        nav(`/seasons/${season.slug}`, { replace: true });
        return;
      }
      const list = await api.get("/seasons");
      setSeasons((list.data || []).filter((item) => item.status !== "archived").slice(0, 6));
    } catch {
      setSeasons([]);
    } finally {
      setLoading(false);
    }
  }, [nav]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["seasons", "tournaments", "f1"]);

  if (loading) {
    return (
      <PublicLayout>
        <div className="p-20 text-center text-white/40 font-display tracking-widest">LADE AKTUELLE SEASON …</div>
      </PublicLayout>
    );
  }

  return (
    <PublicLayout>
      <section className="border-b border-white/10 bg-grid-dense">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Season Pass</span>
          <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase leading-tight">Season Pass</h1>
          <p className="mt-4 text-white/65 max-w-2xl">
            Hier landen die saisonübergreifenden Ranglisten aus Turnieren und Fast-Lap-Challenges. Sobald eine Season aktiv ist, öffnet dieser Bereich automatisch die aktuelle Wertung.
          </p>
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {seasons.length > 0 ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {seasons.map((season) => (
              <Link key={season.id} to={`/seasons/${season.slug || season.id}`} className="group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] overflow-hidden transition">
                <div className="aspect-video bg-[#0A0A0A] overflow-hidden">
                  {season.banner_url ? (
                    <img src={resolveMediaUrl(season.banner_url)} alt="" className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#29B6E8]/15 to-black">
                      <Trophy className="w-10 h-10 text-[#29B6E8]/35" />
                    </div>
                  )}
                </div>
                <div className="p-5">
                  <div className="flex items-center justify-between gap-3">
                    <StatusBadge status={season.status} />
                    <ArrowRight className="w-4 h-4 text-white/35 group-hover:text-[#29B6E8]" />
                  </div>
                  <h2 className="mt-3 font-heading text-xl font-black uppercase group-hover:text-[#29B6E8] transition">{season.name}</h2>
                  {(season.start_date || season.end_date) && (
                    <div className="mt-2 inline-flex items-center gap-2 text-xs text-white/45">
                      <CalendarDays className="w-3.5 h-3.5" />
                      {season.start_date ? new Date(season.start_date).toLocaleDateString("de-DE") : "Start offen"}
                      {season.end_date ? ` - ${new Date(season.end_date).toLocaleDateString("de-DE")}` : ""}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="border border-dashed border-white/15 bg-[#121212] rounded-sm p-12 text-center">
            <Trophy className="w-10 h-10 mx-auto text-white/20 mb-4" />
            <h2 className="font-heading text-2xl font-black uppercase">Noch keine Season aktiv</h2>
            <p className="mt-3 text-white/55 max-w-xl mx-auto">
              Lege im Admin-Bereich eine Season an und setze sie auf aktiv. Danach zeigt der Season Pass automatisch Leaderboard, Punkte und Top-Spieler.
            </p>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}
