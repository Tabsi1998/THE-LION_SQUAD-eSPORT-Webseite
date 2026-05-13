import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { gameLabel } from "@/lib/gameLabels";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Award, ExternalLink, Medal, Trophy, Users } from "lucide-react";

const medalClasses = {
  gold: "border-[#FFD700]/55 bg-[#FFD700]/12 text-[#FFD700]",
  silver: "border-white/35 bg-white/10 text-white",
  bronze: "border-[#CD7F32]/50 bg-[#CD7F32]/12 text-[#CD7F32]",
};
const medalLabels = { gold: "Gold", silver: "Silber", bronze: "Bronze" };
const modeLabels = { online: "Online", offline: "Vor Ort", hybrid: "Hybrid" };
const statusLabels = { active: "Laufend", planned: "Geplant", completed: "Abgeschlossen", archived: "Archiviert" };
const statusClasses = {
  active: "border-[#00D26A]/40 bg-[#00D26A]/10 text-[#00D26A]",
  planned: "border-[#29B6E8]/40 bg-[#29B6E8]/10 text-[#29B6E8]",
  completed: "border-white/15 bg-white/5 text-white/50",
  archived: "border-white/10 bg-white/5 text-white/35",
};

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function placementText(item) {
  if (item.placement_label) return item.placement_label;
  if (!item.placement) return "Teilnahme";
  return `Platz ${item.placement}${item.participant_count ? ` von ${item.participant_count}` : ""}`;
}

function placementShort(item) {
  if (!item.placement) return "Teilnahme";
  return `${item.placement}.`;
}

function referenceLineup(item) {
  const memberNames = (item.lineup_members || []).map((member) => member.display_name).filter(Boolean);
  return [...memberNames, ...(item.lineup || [])];
}

function referenceGameName(item) {
  return item.game_name || gameLabel(item.game) || "Externes Turnier";
}

export default function ReferencesPage() {
  useDocumentTitle("Referenzen", "Externe Turniere, Ligen und Ergebnisse von THE LION SQUAD eSports.");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});

  const load = useCallback(() => {
    api.get("/references").then(({ data }) => {
      setItems(data.items || []);
      setSummary(data.summary || {});
    }).catch(() => {
      setItems([]);
      setSummary({});
    });
  }, []);

  useEffect(() => { load(); }, [load]);
  useApiInvalidation(load, ["references"]);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
        <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">Referenzen</h1>
        <p className="mt-4 text-white/70 max-w-3xl">
          Externe Turniere, Ligen und Events, bei denen THE LION SQUAD oder Vereinsspieler im Namen des Vereins angetreten sind.
          Platzierungen, Lineups und Ergebnisquellen sind hier zentral verlinkt.
        </p>

        <div className="mt-10 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Stat label="Teilnahmen" value={summary.total || 0} icon={Trophy} />
          <Stat label="Laufend" value={summary.active || 0} />
          <Stat label="Geplant" value={summary.planned || 0} />
          <Stat label="Podest" value={summary.podiums || 0} icon={Medal} />
          <Stat label="Gold" value={summary.gold || 0} tone="gold" />
          <Stat label="Silber" value={summary.silver || 0} />
          <Stat label="Bronze" value={summary.bronze || 0} tone="bronze" />
          <Stat label="Spiele" value={summary.games || 0} icon={Award} />
        </div>

        {items.length === 0 ? (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Medal className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Referenzen werden bald ergänzt.</div>
            <div className="text-sm mt-2">Sobald externe Turniere gepflegt sind, erscheinen sie hier.</div>
          </div>
        ) : (
          <div className="mt-12 space-y-4">
            {items.map((item) => <ReferenceCard key={item.id} item={item} />)}
          </div>
        )}
      </section>
    </PublicLayout>
  );
}

export function ReferenceDetailPage() {
  const { id } = useParams();
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  useDocumentTitle(item?.title || "Referenz", item?.description || "Referenz von THE LION SQUAD eSports.");

  useEffect(() => {
    setLoading(true);
    api.get(`/references/${id}`).then(({ data }) => setItem(data)).catch(() => setItem(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE REFERENZ ...</div></PublicLayout>;
  if (!item) return <PublicLayout><div className="p-20 text-center text-white/50">Referenz nicht gefunden.</div></PublicLayout>;

  return (
    <PublicLayout>
      <section className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <Link to="/references" className="text-xs uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">Zurück zu Referenzen</Link>
        <div className="mt-6 grid lg:grid-cols-[13rem_minmax(0,1fr)] gap-8">
          <PlacementPanel item={item} large />
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge className={statusClasses[item.status || "completed"] || statusClasses.completed}>{statusLabels[item.status || "completed"] || item.status}</Badge>
              {item.medal && <Badge className={medalClasses[item.medal] || medalClasses.gold}><Medal className="w-3 h-3" /> {medalLabels[item.medal] || item.medal}</Badge>}
              <Badge>{referenceGameName(item)}</Badge>
            </div>
            <h1 className="mt-4 font-heading text-4xl md:text-6xl font-black uppercase leading-[0.95] break-words">{item.title}</h1>
            <p className="mt-4 text-lg text-white/75">
              {item.team_name || "THE LION SQUAD"} · {placementText(item)}
              {item.location ? ` · ${item.location}` : ""}
            </p>
            <MetaGrid item={item} />
            {item.description && <TextBlock title="Bericht" text={item.description} />}
            {item.highlights && <TextBlock title="Highlights" text={item.highlights} tone="gold" />}
            <LineupBlock item={item} />
            <div className="mt-8 flex flex-wrap gap-2">
              <RefButton href={item.external_url} label="Turnierseite" />
              <RefButton href={item.bracket_url} label="Bracket" />
              <RefButton href={item.match_url} label="Matchseite" />
              <RefButton href={item.result_url} label="Ergebnis" />
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}

function Stat({ label, value, icon: Icon, tone }) {
  const color = tone === "gold" ? "text-[#FFD700]" : tone === "bronze" ? "text-[#CD7F32]" : "text-[#29B6E8]";
  return (
    <div className="border border-white/10 rounded-sm bg-[#121212] p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-white/45 font-bold">{label}</div>
        {Icon && <Icon className={`w-4 h-4 ${color}`} />}
      </div>
      <div className={`mt-2 font-display text-3xl md:text-4xl font-black ${color}`}>{value}</div>
    </div>
  );
}

function ReferenceCard({ item }) {
  const status = item.status || "completed";
  const lineup = referenceLineup(item);
  return (
    <article className="grid lg:grid-cols-[10rem_minmax(0,1fr)_12rem] gap-5 border border-white/10 rounded-sm bg-[#111] p-4 md:p-5 hover:border-[#29B6E8]/35 transition">
      <PlacementPanel item={item} />
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={statusClasses[status] || statusClasses.completed}>{statusLabels[status] || status}</Badge>
          {item.medal && <Badge className={medalClasses[item.medal] || medalClasses.gold}><Medal className="w-3 h-3" /> {medalLabels[item.medal] || item.medal}</Badge>}
          {item.organizer && <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{item.organizer}</span>}
        </div>
        <Link to={`/references/${item.id}`} className="block mt-2 font-heading text-2xl md:text-3xl font-black uppercase leading-tight break-words hover:text-[#29B6E8] transition">{item.title}</Link>
        <p className="mt-2 text-white/70">
          {item.team_name || "THE LION SQUAD"} · {placementText(item)}
          {item.location ? ` · ${item.location}` : ""}
        </p>
        {item.description && <p className="mt-3 text-sm text-white/62 leading-relaxed line-clamp-2">{item.description}</p>}
        {lineup.length > 0 && <LineupInline item={item} />}
      </div>
      <div className="flex lg:flex-col gap-2 flex-wrap lg:items-stretch">
        <Link to={`/references/${item.id}`} className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-[#29B6E8]/45 rounded-sm text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10">Details</Link>
        <RefButton href={item.external_url} label="Turnier" />
        <RefButton href={item.bracket_url} label="Bracket" />
        <RefButton href={item.result_url} label="Ergebnis" />
      </div>
    </article>
  );
}

function PlacementPanel({ item, large = false }) {
  const medalClass = item.medal ? medalClasses[item.medal] : "border-white/15 bg-white/5 text-white/65";
  return (
    <div className={`border rounded-sm ${medalClass} ${large ? "p-5" : "p-4"} flex lg:flex-col items-center lg:items-start gap-4`}>
      <div className={`${large ? "w-24 h-24" : "w-16 h-16"} rounded-sm bg-black/35 border border-current/20 flex items-center justify-center overflow-hidden shrink-0`}>
        {item.game?.logo_url ? (
          <img src={resolveMediaUrl(item.game.logo_url)} alt="" className="w-full h-full object-contain p-2" />
        ) : item.medal ? (
          <Medal className={large ? "w-10 h-10" : "w-7 h-7"} />
        ) : (
          <Trophy className={large ? "w-10 h-10" : "w-7 h-7"} />
        )}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-widest font-black opacity-80">Platzierung</div>
        <div className={`${large ? "text-5xl" : "text-4xl"} mt-1 font-display font-black leading-none`}>{placementShort(item)}</div>
        <div className="mt-2 text-xs text-white/55">{item.participant_count ? `${item.participant_count} Teilnehmer` : item.team_count ? `${item.team_count} Teams` : "Teilnahme"}</div>
        <div className="mt-1 text-xs text-white/45">{formatDate(item.start_date)}</div>
      </div>
    </div>
  );
}

function LineupInline({ item }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {(item.lineup_members || []).map((member) => <PlayerChip key={member.profile_id || member.display_name} member={member} />)}
      {(item.lineup || []).map((name) => <span key={name} className="px-2 py-1 border border-white/10 bg-black/20 text-xs text-white/55 rounded-sm">{name}</span>)}
    </div>
  );
}

function LineupBlock({ item }) {
  const lineup = referenceLineup(item);
  if (!lineup.length) return null;
  return (
    <div className="mt-8 border border-white/10 bg-[#121212] rounded-sm p-5">
      <h2 className="font-heading text-xl font-black uppercase flex items-center gap-2"><Users className="w-5 h-5 text-[#29B6E8]" /> Lineup</h2>
      <div className="mt-4 flex flex-wrap gap-2">
        {(item.lineup_members || []).map((member) => <PlayerChip key={member.profile_id || member.display_name} member={member} large />)}
        {(item.lineup || []).map((name) => <span key={name} className="px-3 py-2 border border-white/10 bg-black/20 text-sm text-white/65 rounded-sm">{name}</span>)}
      </div>
    </div>
  );
}

function PlayerChip({ member, large = false }) {
  const content = (
    <>
      <span className={`${large ? "w-9 h-9" : "w-7 h-7"} rounded-sm bg-black border border-white/10 overflow-hidden flex items-center justify-center shrink-0`}>
        {member.avatar_url ? <img src={resolveMediaUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" /> : <Users className="w-4 h-4 text-white/35" />}
      </span>
      <span className="min-w-0">
        <span className="block truncate">{member.display_name}</span>
        {member.username && <span className="block text-[10px] text-white/35 normal-case">@{member.username}</span>}
      </span>
    </>
  );
  const className = `inline-flex items-center gap-2 max-w-full border border-[#29B6E8]/25 bg-[#29B6E8]/10 text-white/80 rounded-sm ${large ? "px-3 py-2 text-sm" : "px-2 py-1 text-xs"} font-semibold`;
  if (member.profile_url) return <Link to={member.profile_url} className={`${className} hover:border-[#29B6E8]/60 hover:text-[#29B6E8]`}>{content}</Link>;
  return <span className={className}>{content}</span>;
}

function MetaGrid({ item }) {
  const rows = [
    ["Spiel", referenceGameName(item)],
    ["Modus", modeLabels[item.mode] || item.mode],
    ["Datum", [formatDate(item.start_date), formatDate(item.end_date)].filter(Boolean).join(" - ")],
    ["Veranstalter", item.organizer],
  ].filter(([, value]) => value);
  return (
    <div className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
      {rows.map(([label, value]) => (
        <div key={label} className="border border-white/10 bg-[#121212] rounded-sm p-3">
          <div className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{label}</div>
          <div className="mt-1 text-sm text-white/75">{value}</div>
        </div>
      ))}
    </div>
  );
}

function TextBlock({ title, text, tone }) {
  return (
    <div className={`mt-8 border rounded-sm p-5 ${tone === "gold" ? "border-[#FFD700]/25 bg-[#FFD700]/10" : "border-white/10 bg-[#121212]"}`}>
      <h2 className={`font-heading text-xl font-black uppercase ${tone === "gold" ? "text-[#FFD700]" : "text-white"}`}>{title}</h2>
      <p className="mt-3 text-sm md:text-base text-white/70 leading-relaxed whitespace-pre-line">{text}</p>
    </div>
  );
}

function Badge({ children, className = "border-white/10 bg-white/5 text-white/55" }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm border text-[10px] uppercase tracking-widest font-bold ${className}`}>{children}</span>;
}

function RefButton({ href, label }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm text-xs uppercase tracking-wider font-bold text-white/70 hover:text-[#29B6E8]">
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
