import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { api, resolveMediaUrl } from "@/lib/api";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { StatusBadge } from "@/components/tls/StatusBadge";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCanonicalSlugRedirect } from "@/hooks/useCanonicalSlugRedirect";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { seoTextPreview } from "@/lib/textPreview";
import { Award, BarChart3, CalendarDays, CheckCircle2, CircleGauge, Flag, Medal, MessageCircle, ShieldCheck, Star, Timer, Trophy, Users, Zap } from "lucide-react";

function rankColor(rank) {
  if (rank === 1) return "text-[#FFD700]";
  if (rank === 2) return "text-white/80";
  if (rank === 3) return "text-[#CD7F32]";
  return "text-[#29B6E8]";
}

function formatPoints(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Number.isInteger(number) ? number : number.toFixed(1);
}

const POINT_SOURCES = [
  {
    icon: Trophy,
    title: "Turniere",
    tone: "gold",
    text: "Teilnahme zählt, Platzierungen zählen mehr. Siege, Podium und größere Teilnehmerfelder bringen sichtbar mehr Punkte.",
  },
  {
    icon: Timer,
    title: "Fast Lap",
    tone: "blue",
    text: "Gültige Zeiten werden pro Strecke gewertet. Pole Positions, starke Ränge und veröffentlichte Challenges laufen in die Wertung.",
  },
  {
    icon: CheckCircle2,
    title: "Events",
    tone: "green",
    text: "Wenn Admins oder Moderatoren deine Teilnahme per Check-in bestätigen, wird daraus ein Jahreswertungs-Eintrag.",
  },
  {
    icon: Star,
    title: "Profilpunkte",
    tone: "violet",
    text: "Achievements sind eigene Profilpunkte. Sie erklären dein Account-Level, werden aber nicht still in die Jahreswertung gemischt.",
  },
  {
    icon: MessageCircle,
    title: "Community",
    tone: "white",
    text: "Community-Aktivität zählt für die Jahreswertung nur dann, wenn sie als Event, Challenge oder manuelle Admin-Wertung eingetragen ist.",
  },
];

const TONE = {
  gold: "border-[#FFD700]/35 bg-[#FFD700]/10 text-[#FFD700]",
  blue: "border-[#29B6E8]/35 bg-[#29B6E8]/10 text-[#29B6E8]",
  green: "border-[#10B981]/35 bg-[#10B981]/10 text-[#10B981]",
  violet: "border-[#A855F7]/35 bg-[#A855F7]/10 text-[#A855F7]",
  white: "border-white/15 bg-white/[0.04] text-white/70",
};

export default function SeasonPage() {
  const { slug } = useParams();
  const [data, setData] = useState(null);
  const season = data?.season;
  const seoDescription = seoTextPreview(season?.description, "Jahreswertung von THE LION SQUAD eSports mit Turnieren, Fast-Lap-Challenges und Community-Punkten.");
  useDocumentTitle(season?.name || "Jahreswertung", seoDescription, {
    image: season?.banner_url,
    canonical: season?.slug ? `${window.location.origin}/seasons/${season.slug}` : undefined,
  });
  useCanonicalSlugRedirect(slug, season?.slug, "/seasons");
  const load = useCallback(async () => {
    const { data: st } = await api.get(`/seasons/${slug}/standings`);
    setData(st);
  }, [slug]);
  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["seasons", "tournaments", "f1", "users"]);
  if (!data) return <PublicLayout><div className="p-20 text-center text-white/40 font-display tracking-widest">LADE …</div></PublicLayout>;
  const s = data.season;
  const standings = data.standings || [];
  const topThree = standings.slice(0, 3);
  const totalPoints = standings.reduce((sum, row) => sum + Number(row.points || 0), 0);
  const totalProfilePoints = standings.reduce((sum, row) => sum + Number(row.profile_points || row.achievement_points || 0), 0);
  const totalRatings = standings.reduce((sum, row) => sum + Number(row.events_count || 0), 0);
  const tournamentCount = s.tournament_ids?.length || 0;
  const fastLapCount = s.f1_challenge_ids?.length || 0;
  const sourceCount = tournamentCount + fastLapCount;
  const overviewItems = [
    { icon: Trophy, label: "Platzierung", value: "Rang entscheidet", text: "Top-Plätze starten mit höheren Basispunkten.", tone: "gold" },
    { icon: Users, label: "Teilnehmerfeld", value: `${standings.length || 0} Spieler`, text: "Große Felder erhöhen den Faktor der Wertung.", tone: "blue" },
    { icon: Zap, label: "Boni", value: "Extra Punkte", text: "Check-in, Fair Play, Siege und Fast-Lap-Boni können dazukommen.", tone: "green" },
    { icon: ShieldCheck, label: "Schutz", value: s.drop_worst ? `${s.drop_worst} Streichresultat(e)` : "Alles zählt", text: s.drop_worst ? "Die schwächsten Wertungen fallen aus der Gesamtwertung." : "Keine Wertung wird aktuell gestrichen.", tone: "violet" },
  ];
  return (
    <PublicLayout>
      <div className="relative border-b border-white/10 bg-grid-dense overflow-hidden">
        {s.banner_url && <img src={resolveMediaUrl(s.banner_url)} className="absolute inset-0 w-full h-full object-cover opacity-20" alt=""/>}
        <div className="absolute inset-0 bg-gradient-to-b from-[#0A0A0A]/70 to-[#0A0A0A]"/>
        <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_22rem] gap-8 items-end">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">{s.kind === "circuit" ? "Lions Circuit" : "TLS Jahreswertung"}</span>
              <h1 className="mt-2 font-heading text-4xl md:text-6xl font-black uppercase leading-tight">{s.name}</h1>
              {s.description && <p className="mt-3 text-white/70 max-w-2xl">{s.description}</p>}
              <div className="mt-6 flex flex-wrap gap-2">
                <StatusBadge status={s.status} size="lg"/>
                {s.start_date && <span className="inline-flex items-center gap-2 text-xs uppercase tracking-wider font-bold border border-white/10 bg-black/25 px-3 py-1 rounded-sm text-white/60"><CalendarDays className="w-3.5 h-3.5" /> {new Date(s.start_date).toLocaleDateString("de-DE")}{s.end_date ? ` - ${new Date(s.end_date).toLocaleDateString("de-DE")}` : ""}</span>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatCard icon={Users} label="Teilnehmer" value={standings.length} />
              <StatCard icon={BarChart3} label="Jahrespunkte" value={formatPoints(totalPoints)} />
              <StatCard icon={Star} label="Profilpunkte" value={formatPoints(totalProfilePoints)} />
              <StatCard icon={Flag} label="Wertungen" value={totalRatings} />
            </div>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <section className="mb-8">
          <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] font-bold text-[#29B6E8]">Übersicht</div>
              <h2 className="mt-1 font-heading text-2xl md:text-3xl font-black uppercase">So funktioniert diese Jahreswertung</h2>
            </div>
            <div className="inline-flex items-center gap-2 text-xs text-white/50 border border-white/10 bg-[#101010] rounded-sm px-3 py-2">
              <CircleGauge className="w-4 h-4 text-[#29B6E8]" />
              {sourceCount || "Alle"} Quellen in der Wertung
            </div>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
            {overviewItems.map((item) => <OverviewCard key={item.label} {...item} />)}
          </div>
        </section>

        {topThree.length > 0 && (
          <section className="mb-8">
            <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.3em] font-bold text-[#FFD700]">Rangliste</div>
                <h2 className="mt-1 font-heading text-2xl md:text-3xl font-black uppercase">Top Teilnehmer</h2>
              </div>
              <div className="text-xs text-white/45">{totalRatings} Wertungen</div>
            </div>
            <div className="grid md:grid-cols-3 gap-3">
              {topThree.map((row) => <PodiumCard key={row.user_id} row={row} />)}
            </div>
          </section>
        )}

        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#FFD700]"/><h2 className="font-heading font-bold uppercase">Gesamtwertung</h2>
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
                <tr><th className="text-left px-4 py-3 w-14">#</th><th className="text-left px-4 py-3">Teilnehmer</th><th className="text-left px-4 py-3">Quellen</th><th className="text-right px-4 py-3">Wertungen</th><th className="text-right px-4 py-3">Achievements</th><th className="text-right px-4 py-3">Siege</th><th className="text-right px-4 py-3 font-display">Jahrespunkte</th></tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {standings.map((r)=>(
                  <tr key={r.user_id} className={r.rank<=3 ? "bg-[#FFD700]/5" : ""}>
                    <td className={`px-4 py-3 font-display font-bold ${rankColor(r.rank)}`}>{r.rank}</td>
                    <td className="px-4 py-3">
                      <PlayerIdentity row={r} />
                    </td>
                    <td className="px-4 py-3">
                      <SourceBreakdown row={r} />
                    </td>
                    <td className="px-4 py-3 text-right text-white/70">{r.events_count}</td>
                    <td className="px-4 py-3 text-right text-white/70">
                      <div className="font-bold text-white/80">{r.achievement_count || 0}</div>
                      <div className="text-[10px] uppercase tracking-widest text-white/35">{formatPoints(r.profile_points || r.achievement_points || 0)} Profil</div>
                    </td>
                    <td className="px-4 py-3 text-right text-white/70">{r.wins}</td>
                    <td className="px-4 py-3 text-right font-display font-bold text-[#29B6E8] text-lg">{formatPoints(r.points)}</td>
                  </tr>
                ))}
                {standings.length === 0 && <tr><td colSpan="7" className="text-center py-10 text-white/40">Noch keine Ergebnisse</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="md:hidden divide-y divide-white/5">
            {standings.map((r) => (
              <div key={r.user_id} className="p-4 flex items-center gap-3">
                <div className={`font-display text-2xl font-black w-10 ${rankColor(r.rank)}`}>#{r.rank}</div>
                <PlayerIdentity row={r} />
                <div className="ml-auto text-right">
                  <div className="font-display text-2xl font-black text-[#29B6E8]">{formatPoints(r.points)}</div>
                  <div className="text-[10px] uppercase tracking-widest text-white/40">{r.events_count} Wertungen · {r.wins} Siege</div>
                  <div className="text-[10px] uppercase tracking-widest text-white/30">{r.achievement_count || 0} Achievements</div>
                </div>
              </div>
            ))}
            {standings.length === 0 && <div className="text-center py-10 text-white/40">Noch keine Ergebnisse</div>}
          </div>
        </div>
        <section className="mt-8">
          <div className="flex items-end justify-between gap-3 flex-wrap mb-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.3em] font-bold text-[#29B6E8]">Punkte</div>
              <h2 className="mt-1 font-heading text-2xl md:text-3xl font-black uppercase">Wie du Punkte sammelst</h2>
            </div>
            <div className="text-xs text-white/45">Jahreswertungspunkte und Profilpunkte bleiben getrennt nachvollziehbar.</div>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
            {POINT_SOURCES.map((item) => <PointSourceCard key={item.title} {...item} />)}
          </div>
        </section>

        <section className="mt-8 grid lg:grid-cols-[1.15fr_0.85fr] gap-4">
          <InfoPanel icon={Award} title="Punktewertung" text="Jahreswertungspunkte werden aus echten Wertungseinträgen berechnet: Turnier- und Fast-Lap-Ergebnisse, bestätigte Event-Teilnahme sowie manuelle Admin-Wertungen. Achievements bleiben als Profilpunkte sichtbar, damit die Rangliste nicht heimlich zwei Systeme vermischt." />
          <InfoPanel icon={Medal} title="Streichresultate" text={s.drop_worst ? `${s.drop_worst} schlechteste Resultat(e) werden nicht in die Gesamtpunkte gerechnet.` : "Alle gewerteten Resultate zählen in die Gesamtwertung."} />
        </section>
      </div>
    </PublicLayout>
  );
}

function StatCard({ icon: Icon, label, value }) {
  return (
    <div className="border border-white/10 bg-black/35 rounded-sm p-4">
      <Icon className="w-4 h-4 text-[#29B6E8]" />
      <div className="mt-2 font-display text-3xl font-black">{value}</div>
      <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
    </div>
  );
}

function OverviewCard({ icon: Icon, label, value, text, tone }) {
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4 min-h-[142px]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
          <div className="mt-2 font-heading text-xl font-black uppercase leading-tight">{value}</div>
        </div>
        <div className={`w-10 h-10 shrink-0 rounded-sm border flex items-center justify-center ${TONE[tone] || TONE.white}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      <p className="mt-3 text-sm text-white/55 leading-relaxed">{text}</p>
    </div>
  );
}

function PlayerIdentity({ row }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <div className="w-10 h-10 rounded-sm border border-white/10 bg-[#0A0A0A] overflow-hidden shrink-0 flex items-center justify-center">
        {row.avatar_url ? <img src={resolveMediaUrl(row.avatar_url)} alt="" className="w-full h-full object-cover" /> : <Users className="w-4 h-4 text-white/25" />}
      </div>
      <div className="min-w-0">
        <div className="font-bold truncate">{row.display_name}</div>
        {row.username && <div className="text-xs text-white/40 truncate">@{row.username}</div>}
      </div>
    </div>
  );
}

function SourceBreakdown({ row }) {
  const items = (row.source_breakdown || []).filter((item) => Number(item.total_points || 0) > 0).slice(0, 3);
  if (!items.length) return <span className="text-xs text-white/35">Keine Detaildaten</span>;
  return (
    <div className="flex flex-wrap gap-1.5 max-w-xs">
      {items.map((item) => (
        <span key={item.source_type} className="inline-flex items-center gap-1 rounded-sm border border-white/10 bg-black/25 px-2 py-1 text-[10px] uppercase tracking-wider text-white/60">
          <span className="text-white/80">{item.label}</span>
          <span className="font-display text-[#29B6E8]">{formatPoints(item.total_points)}</span>
        </span>
      ))}
      {row.dropped_events > 0 && (
        <span className="inline-flex items-center rounded-sm border border-[#FFD700]/20 bg-[#FFD700]/10 px-2 py-1 text-[10px] uppercase tracking-wider text-[#FFD700]">
          {row.dropped_events} gestrichen
        </span>
      )}
    </div>
  );
}

function PodiumCard({ row }) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-4">
        <div className={`font-display text-5xl font-black ${rankColor(row.rank)}`}>#{row.rank}</div>
        <Trophy className={`w-7 h-7 ${rankColor(row.rank)}`} />
      </div>
      <div className="mt-5">
        <PlayerIdentity row={row} />
      </div>
      <div className="mt-5 grid grid-cols-3 gap-2 text-center">
        <MiniStat label="Jahr" value={formatPoints(row.points)} />
        <MiniStat label="Wertungen" value={row.events_count} />
        <MiniStat label="Profil" value={formatPoints(row.profile_points || row.achievement_points || 0)} />
      </div>
    </>
  );
  const className = "group border border-white/10 hover:border-[#FFD700]/50 bg-[#121212] rounded-sm p-5 transition";
  if (!row.username) return <div className={className}>{content}</div>;
  return (
    <Link to={`/u/${row.username}`} className={className}>
      {content}
    </Link>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="border border-white/10 bg-black/25 rounded-sm p-2">
      <div className="font-display text-xl font-black text-white">{value}</div>
      <div className="text-[9px] uppercase tracking-widest text-white/40">{label}</div>
    </div>
  );
}

function PointSourceCard({ icon: Icon, title, text, tone }) {
  return (
    <div className="border border-white/10 hover:border-white/20 bg-[#101010] rounded-sm p-4 min-h-[168px] transition">
      <div className={`w-10 h-10 rounded-sm border flex items-center justify-center ${TONE[tone] || TONE.white}`}>
        <Icon className="w-5 h-5" />
      </div>
      <h3 className="mt-4 font-heading font-bold uppercase">{title}</h3>
      <p className="mt-2 text-sm text-white/55 leading-relaxed">{text}</p>
    </div>
  );
}

function InfoPanel({ icon: Icon, title, text }) {
  return (
    <div className="border border-white/10 bg-[#101010] rounded-sm p-5 flex items-start gap-4">
      <div className="w-11 h-11 rounded-sm border border-[#FFD700]/25 bg-[#FFD700]/10 flex items-center justify-center shrink-0">
        <Icon className="w-5 h-5 text-[#FFD700]" />
      </div>
      <div>
        <h3 className="font-heading font-bold uppercase">{title}</h3>
        <p className="mt-2 text-sm text-white/55 leading-relaxed">{text}</p>
      </div>
    </div>
  );
}
