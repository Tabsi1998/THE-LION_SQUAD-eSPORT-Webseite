import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { Trophy, ArrowRight, CheckCircle2, BarChart3, Timer } from "lucide-react";

import { ROLE_COLORS } from "@/lib/categoryColors";
/**
 * SeasonPassWidget — Animierter Jahreswertungs-Ticker.
 * Zeigt Top 5 der aktuellen Wertung mit rotierendem Spotlight-Player.
 */
export function SeasonPassWidget() {
  const [data, setData] = useState(null);
  const [spotlightIdx, setSpotlightIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      const { data: d } = await api.get("/seasons/active/featured");
      setData(d);
    } catch { setData({ season: null, standings: [] }); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["seasons", "tournaments", "f1", "users"]);

  useEffect(() => {
    if (!data?.standings?.length) return;
    const iv = setInterval(() => {
      setSpotlightIdx((i) => (i + 1) % Math.min(data.standings.length, 3));
    }, 4200);
    return () => clearInterval(iv);
  }, [data]);

  if (!data || !data.season) return null;
  const s = data.season;
  const standings = data.standings || [];
  const top3 = standings.slice(0, 3);
  const spotlight = top3[spotlightIdx];
  const rest = standings.slice(3, 5);
  const pointHints = [
    { icon: Trophy, label: "Turniere" },
    { icon: Timer, label: "Fast Lap" },
    { icon: CheckCircle2, label: "Event-Check-in" },
    { icon: BarChart3, label: "Profilpunkte separat" },
  ];

  return (
    <section data-testid="season-pass-widget" className="relative overflow-hidden border-y border-white/10 bg-[#0A0A0A]">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-20 -left-20 w-96 h-96 rounded-full bg-honor blur-[140px] opacity-10" />
        <div className="absolute -bottom-20 -right-20 w-96 h-96 rounded-full bg-[#29B6E8] blur-[140px] opacity-10" />
      </div>
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-20">
        <div className="grid lg:grid-cols-12 gap-8 items-center">
          {/* Left: season meta */}
          <div className="lg:col-span-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-honor/10 border border-honor/30 rounded-sm mb-4">
              <span className="w-2 h-2 rounded-full bg-honor animate-pulse" />
              <span className="tls-type-label text-honor">
                {/* Nur die aktive Wertung kommt hierher (#2123, ER11) - der Status steht nicht roh daneben. */}
                {s.kind === "circuit" ? "Lions Circuit" : "TLS Jahreswertung"} · läuft
              </span>
            </div>
            <h2 className="tls-type-section leading-[0.95]">
              <span className="text-white">{s.name}</span>
            </h2>
            <p className="mt-4 text-white/70 tls-type-body max-w-md">
              {s.description || "Die Vereinswertung bündelt Jahrespunkte aus Turnieren, Fast-Lap-Challenges und bestätigten Event-Teilnahmen."}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 max-w-md">
              {pointHints.map(({ icon: Icon, label }) => (
                <div key={label} className="inline-flex items-center gap-2 border border-white/10 bg-white/[0.03] px-3 py-2 rounded-sm tls-type-label text-white/65">
                  <Icon className="w-3.5 h-3.5 text-honor" /> {label}
                </div>
              ))}
            </div>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                to={`/seasons/${s.slug || s.id}`}
                data-testid="season-pass-cta"
                className="tls-btn tls-btn--primary inline-flex items-center gap-2 px-5 py-2.5 font-bold uppercase tracking-wider rounded-sm"
              >
                Gesamtwertung <ArrowRight className="w-4 h-4" />
              </Link>
              <div className="px-4 py-2.5 border border-white/15 rounded-sm tls-type-label text-white/60">
                {standings.length} Teilnehmer in der Wertung
              </div>
            </div>
          </div>

          {/* Right: spotlight + mini-table */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-5 gap-4 items-stretch">
            {/* Spotlight Card */}
            <div className="sm:col-span-3 relative border border-honor/30 bg-gradient-to-br from-honor/5 via-transparent to-[#29B6E8]/5 rounded-sm p-6 min-h-[220px] flex flex-col justify-between overflow-hidden">
              <div className="absolute -top-6 -right-6 opacity-5">
                <Trophy className="w-40 h-40 text-honor" />
              </div>
              {spotlight ? (
                <div key={spotlight.user_id} className="tls-spotlight-enter">
                    <div className="tls-type-label" style={{ color: [ROLE_COLORS.honor, "#C0C0C0", "#CD7F32"][spotlightIdx] }}>
                      Position {spotlight.rank}
                    </div>
                    <div className="tls-wrap tls-wrap--name mt-2 tls-type-section leading-tight">
                      {spotlight.display_name}
                    </div>
                    <div className="mt-4 flex items-end gap-4">
                      <div>
                        <div className="tls-type-label text-quiet">Punkte</div>
                        <div className="tls-type-hero tls-type-num text-[#29B6E8]">{spotlight.points}</div>
                      </div>
                      <div className="pb-2">
                        <div className="tls-type-label text-quiet">Erfolge / Wertungen</div>
                        <div className="tls-type-card tls-type-num text-white">{spotlight.wins} <span className="text-white/40">/</span> {spotlight.events_count}</div>
                      </div>
                    </div>
                </div>
              ) : null}
              {/* Progress dots */}
              <div className="flex gap-1.5 mt-6">
                {top3.map((_, i) => (
                  <button key={i} onClick={() => setSpotlightIdx(i)} data-testid={`season-pass-dot-${i}`}
                    className={`h-1 rounded-full transition-all ${i === spotlightIdx ? "w-8 bg-honor" : "w-3 bg-white/20"}`} />
                ))}
              </div>
            </div>
            {/* Mini standings */}
            <div className="sm:col-span-2 space-y-2">
              {top3.concat(rest).slice(0, 5).map((r) => (
                <div
                  key={r.user_id}
                  data-testid={`season-pass-row-${r.rank}`}
                  className={`flex items-center justify-between px-3 py-2 border rounded-sm tls-type-small ${r.rank === 1 ? "border-honor/40 bg-honor/5" : r.rank <= 3 ? "border-white/20 bg-white/5" : "border-white/10 bg-[#121212]"}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`tls-type-num w-6 ${r.rank === 1 ? "text-honor" : r.rank === 2 ? "text-white/80" : r.rank === 3 ? "text-[#CD7F32]" : "text-[#29B6E8]"}`}>{r.rank}</span>
                    <span className="tls-wrap text-white/90">{r.display_name}</span>
                  </div>
                  <span className="tls-type-num text-[#29B6E8]">{r.points}</span>
                </div>
              ))}
              {standings.length === 0 && (
                <div className="text-quiet text-center tls-type-label py-10">NOCH KEINE PUNKTE</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
