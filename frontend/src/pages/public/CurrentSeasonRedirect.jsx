import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useAuth } from "@/context/AuthContext";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { hasArea } from "@/lib/permissions";
import { ArrowRight, CalendarDays, Settings, Trophy } from "lucide-react";
import { asInstant, viennaDate } from "@/lib/vienna";

// Jahreswertung (#1222): /seasons/current öffnet die laufende Saison. Läuft keine, steht hier der Endstand der zuletzt
// beendeten Wertung (auch archiviert) mit den ersten zehn Plätzen - und darüber, wann die nächste beginnt, wenn sie
// schon angelegt ist. Gibt es gar keine, steht ein Satz für alle; die Anleitung für die Verwaltung sehen nur Konten mit
// dem Bereich Turniere.

const ENDED = new Set(["completed", "archived"]);

function seasonTime(season, field) {
  const value = season?.[field];
  return value ? asInstant(value).getTime() : 0;
}

/** Was die Seite ohne laufende Saison zeigt: die zuletzt beendete Wertung, die nächste angelegte, die früheren. */
export function seasonOverview(seasons = [], now = new Date()) {
  const ended = seasons
    .filter((season) => ENDED.has(season.status))
    .sort((a, b) => (seasonTime(b, "end_date") || seasonTime(b, "start_date")) - (seasonTime(a, "end_date") || seasonTime(a, "start_date")));
  const next = seasons
    .filter((season) => season.status === "draft" && seasonTime(season, "start_date") > now.getTime())
    .sort((a, b) => seasonTime(a, "start_date") - seasonTime(b, "start_date"))[0] || null;
  return { latest: ended[0] || null, earlier: ended.slice(1, 7), next };
}

/** „Endstand 2025“ - das Jahr aus dem Ende (sonst dem Beginn), ohne Datum der Name der Saison. */
export function finalTitle(season) {
  const when = season?.end_date || season?.start_date;
  return when ? `Endstand ${viennaDate(when, { year: "numeric" })}` : `Endstand ${season?.name || ""}`.trim();
}

export default function CurrentSeasonRedirect() {
  const nav = useNavigate();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState({ latest: null, earlier: [], next: null });
  const [standings, setStandings] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: featured }, list] = await Promise.all([
        api.get("/seasons/active/featured").catch(() => ({ data: null })),
        api.get("/seasons").catch(() => ({ data: [] })),
      ]);
      const seasons = Array.isArray(list.data) ? list.data : [];
      const active = featured?.season?.status === "active" ? featured.season : seasons.find((season) => season.status === "active");
      if (active?.slug || active?.id) {
        nav(`/seasons/${active.slug || active.id}`, { replace: true });
        return;
      }
      const next = seasonOverview(seasons);
      setOverview(next);
      if (next.latest) {
        const { data } = await api.get(`/seasons/${next.latest.slug || next.latest.id}/standings`).catch(() => ({ data: null }));
        setStandings((data?.standings || []).slice(0, 10));
      } else {
        setStandings([]);
      }
    } finally {
      setLoading(false);
    }
  }, [nav]);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["seasons", "tournaments", "f1"]);

  if (loading) {
    return (
      <PublicLayout>
        <div className="p-20 text-center text-white/40 font-display tracking-widest">LADE AKTUELLE JAHRESWERTUNG …</div>
      </PublicLayout>
    );
  }

  const { latest, earlier, next } = overview;
  const canSetUp = hasArea(user, "tournaments");

  return (
    <PublicLayout>
      <section className="border-b border-white/10 bg-grid-dense">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">TLS Jahreswertung</span>
          <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase leading-tight" data-testid="season-current-title">{latest ? finalTitle(latest) : "Jahreswertung"}</h1>
          {next?.start_date && (
            <p className="mt-4 text-white/75" data-testid="season-next">Die nächste Wertung beginnt am {viennaDate(next.start_date, { day: "numeric", month: "long", year: "numeric" })}.</p>
          )}
          {!latest && !next && (
            <p className="mt-4 text-white/75 max-w-2xl" data-testid="season-none">Die Jahreswertung startet mit dem nächsten Turnier.</p>
          )}
        </div>
      </section>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
        {latest && (
          <div data-testid="season-final">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">{latest.name}</div>
                <h2 className="mt-1 font-heading text-2xl font-black uppercase">Die ersten zehn</h2>
              </div>
              <Link to={`/seasons/${latest.slug || latest.id}`} className="tls-btn tls-btn--secondary inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
                Ganze Tabelle <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
            {standings.length ? (
              <ol className="mt-5 grid gap-2 md:grid-cols-2 md:grid-flow-col md:grid-rows-5" data-testid="season-final-rows">
                {standings.map((row) => <FinalRow key={`${row.rank}-${row.user_id || row.display_name}`} row={row} />)}
              </ol>
            ) : (
              <p className="mt-5 text-sm text-white/55">In dieser Wertung stehen keine Punkte.</p>
            )}
          </div>
        )}

        {canSetUp && (
          <div className="border border-dashed border-[#29B6E8]/40 bg-[#29B6E8]/5 rounded-sm p-5" data-testid="season-admin-guide">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]"><Settings className="w-3.5 h-3.5" /> Für die Turnierleitung</div>
            <p className="mt-2 text-sm text-white/75">Gerade läuft keine Saison. Lege in der Verwaltung eine Saison an und setze sie auf aktiv – dann öffnet diese Seite automatisch Rangliste, Punkte und Top-Spieler.</p>
            <Link to="/admin/seasons" className="tls-btn tls-btn--secondary mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider">
              Zu den Saisons <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        )}

        {earlier.length > 0 && (
          <div>
            <h2 className="font-heading text-xl font-black uppercase">Frühere Wertungen</h2>
            <div className="mt-4 grid md:grid-cols-2 xl:grid-cols-3 gap-4">
              {earlier.map((season) => <SeasonTile key={season.id} season={season} />)}
            </div>
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

function FinalRow({ row }) {
  const rank = Number(row.rank) || 0;
  const medal = rank === 1 ? "text-[#FFD700]" : rank === 2 ? "text-white/80" : rank === 3 ? "text-[#CD7F32]" : "text-white/45";
  const content = (
    <>
      <span className={`font-display font-black text-lg w-8 shrink-0 ${medal}`}>#{rank}</span>
      <span className="min-w-0 flex-1 truncate font-bold text-white">{row.display_name || row.username || "—"}</span>
      <span className="shrink-0 text-sm text-white/60 tabular-nums">{row.points ?? 0} Punkte</span>
    </>
  );
  const cls = "flex items-center gap-3 border border-white/10 bg-[#121212] rounded-sm px-4 py-3 min-w-0";
  return (
    <li>
      {row.username ? <Link to={`/u/${row.username}`} className={`tls-card ${cls}`}>{content}</Link> : <div className={cls}>{content}</div>}
    </li>
  );
}

function SeasonTile({ season }) {
  return (
    <Link to={`/seasons/${season.slug || season.id}`} className="tls-card group border border-white/10 hover:border-[#29B6E8]/50 rounded-sm bg-[#121212] overflow-hidden transition">
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
        <h3 className="mt-3 font-heading text-xl font-black uppercase group-hover:text-[#29B6E8] transition">{season.name}</h3>
        {(season.start_date || season.end_date) && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-white/45">
            <CalendarDays className="w-3.5 h-3.5" />
            {season.start_date ? viennaDate(season.start_date) : "Start offen"}
            {season.end_date ? ` - ${viennaDate(season.end_date)}` : ""}
          </div>
        )}
      </div>
    </Link>
  );
}
