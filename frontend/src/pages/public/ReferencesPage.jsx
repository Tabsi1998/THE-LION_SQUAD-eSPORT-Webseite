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

function platformLabel(value) {
  const map = { ALL: "Alle Plattformen", XBO: "Xbox", XBOX: "Xbox", PS: "PlayStation", PC: "PC" };
  return String(value || "")
    .split("+")
    .map((part) => map[part.trim().toUpperCase()] || part.trim())
    .filter(Boolean)
    .join(" + ");
}

function titleParts(item) {
  let rest = String(item.title || "").trim();
  const platforms = [];
  let match = rest.match(/^\[([^\]]+)\]\s*/);
  while (match) {
    platforms.push(match[1].trim());
    rest = rest.slice(match[0].length).trim();
    match = rest.match(/^\[([^\]]+)\]\s*/);
  }
  const segments = rest.split(/\s*\|\s*/).map((part) => part.trim()).filter(Boolean);
  const metaPlatforms = Array.isArray(item.reference_meta?.platforms) ? item.reference_meta.platforms : [];
  const platformLabels = platforms.map((platform) => (
    metaPlatforms.find((entry) => entry.key === platform)?.label || platformLabel(platform)
  ));
  const chips = platformLabels;
  if (segments[0]) {
    const format = segments[0].match(/\b(HC|CORE)\b/i)?.[1]?.toUpperCase();
    if (format) chips.push(format);
  }
  if (segments.length >= 3) {
    chips.push(segments[1]);
    return { title: segments.slice(2).join(" | "), platforms, platformLabels, chips };
  }
  return { title: rest || item.title, platforms, platformLabels, chips };
}

function gameKey(item) {
  return item.game?.id || item.game_id || referenceGameName(item);
}

function gameTitle(item) {
  return item.game?.display_name || item.game?.name || referenceGameName(item);
}

function groupReferences(items) {
  const games = new Map();
  items.forEach((item) => {
    const gKey = gameKey(item);
    if (!games.has(gKey)) {
      games.set(gKey, {
        key: gKey,
        title: gameTitle(item),
        logo: item.game?.logo_url,
        platforms: new Map(),
      });
    }
    const game = games.get(gKey);
    const parts = titleParts(item);
    const platform = parts.platforms[0] || "all";
    if (!game.platforms.has(platform)) {
      game.platforms.set(platform, { key: platform, label: parts.platformLabels[0] || platformLabel(platform), items: [] });
    }
    game.platforms.get(platform).items.push(item);
  });
  return Array.from(games.values()).map((game) => ({
    ...game,
    count: Array.from(game.platforms.values()).reduce((sum, group) => sum + group.items.length, 0),
    platforms: Array.from(game.platforms.values()),
  }));
}

export default function ReferencesPage() {
  useDocumentTitle("Referenzen", "Externe Turniere, Ligen und Ergebnisse von THE LION SQUAD eSports.");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [filter, setFilter] = useState("all");
  const [gameFilter, setGameFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");

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
  const filteredItems = items.filter((item) => {
    if (filter === "podium") return item.placement && Number(item.placement) <= 3;
    if (filter === "active") return item.status === "active" || item.status === "planned";
    if (filter === "completed") return item.status === "completed" || item.status === "archived";
    return true;
  }).filter((item) => {
    if (gameFilter !== "all" && gameKey(item) !== gameFilter) return false;
    if (platformFilter !== "all" && (titleParts(item).platforms[0] || "all") !== platformFilter) return false;
    return true;
  });
  const gameOptions = groupReferences(items).map((game) => ({ key: game.key, label: game.title, count: game.count }));
  const platformOptions = Array.from(new Map(items.map((item) => {
    const parts = titleParts(item);
    const platform = parts.platforms[0] || "all";
    return [platform, { key: platform, label: parts.platformLabels[0] || platformLabel(platform) }];
  })).values());
  const groupedItems = groupReferences(filteredItems);

  return (
    <PublicLayout>
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Verein</span>
          <h1 className="mt-3 font-heading text-4xl md:text-6xl font-black uppercase">Referenzen</h1>
          <p className="mt-4 text-white/70 max-w-3xl">
            Externe Turniere, Ligen und Events, bei denen THE LION SQUAD oder Vereinsspieler im Namen des Vereins angetreten sind.
            Platzierungen, Lineups und Ergebnisquellen sind hier zentral verlinkt.
          </p>
        </div>

        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
          <Stat label="Teilnahmen" value={summary.total || 0} icon={Trophy} />
          <Stat label="Laufend" value={summary.active || 0} />
          <Stat label="Geplant" value={summary.planned || 0} />
          <Stat label="Podest" value={summary.podiums || 0} icon={Medal} />
          <Stat label="Gold" value={summary.gold || 0} tone="gold" />
          <Stat label="Silber" value={summary.silver || 0} />
          <Stat label="Bronze" value={summary.bronze || 0} tone="bronze" />
          <Stat label="Spiele" value={summary.games || 0} icon={Award} />
        </div>

        <div className="mt-8 space-y-3">
          <FilterRow label="Status">
            <FilterButton active={filter === "all"} onClick={() => setFilter("all")}>Alle</FilterButton>
            <FilterButton active={filter === "podium"} onClick={() => setFilter("podium")}>Podest</FilterButton>
            <FilterButton active={filter === "active"} onClick={() => setFilter("active")}>Laufend/Geplant</FilterButton>
            <FilterButton active={filter === "completed"} onClick={() => setFilter("completed")}>Abgeschlossen</FilterButton>
          </FilterRow>
          <FilterRow label="Spiel">
            <FilterButton active={gameFilter === "all"} onClick={() => setGameFilter("all")}>Alle Spiele</FilterButton>
            {gameOptions.map((game) => (
              <FilterButton key={game.key} active={gameFilter === game.key} onClick={() => setGameFilter(game.key)}>
                {game.label} ({game.count})
              </FilterButton>
            ))}
          </FilterRow>
          {platformOptions.length > 1 && (
            <FilterRow label="Plattform">
              <FilterButton active={platformFilter === "all"} onClick={() => setPlatformFilter("all")}>Alle Plattformen</FilterButton>
              {platformOptions.map((platform) => (
                <FilterButton key={platform.key} active={platformFilter === platform.key} onClick={() => setPlatformFilter(platform.key)}>
                  {platform.label}
                </FilterButton>
              ))}
            </FilterRow>
          )}
        </div>

        {items.length === 0 ? (
          <div className="mt-12 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Medal className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Referenzen werden bald ergänzt.</div>
            <div className="text-sm mt-2">Sobald externe Turniere gepflegt sind, erscheinen sie hier.</div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="mt-8 border border-dashed border-white/15 rounded-sm p-10 text-center text-white/45">
            Keine Referenzen in diesem Filter.
          </div>
        ) : (
          <div className="mt-8 space-y-8">
            {groupedItems.map((game) => <ReferenceGameGroup key={game.key} group={game} />)}
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
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <Link to="/references" className="text-xs uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">Zurück zu Referenzen</Link>
        <div className="mt-6 grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-8 items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <Badge className={statusClasses[item.status || "completed"] || statusClasses.completed}>{statusLabels[item.status || "completed"] || item.status}</Badge>
              <Badge>{referenceGameName(item)}</Badge>
            </div>
            <TitleChips item={item} className="mt-4" />
            <h1 className="mt-3 font-heading text-4xl md:text-5xl xl:text-6xl font-black uppercase leading-[0.95] break-words max-w-5xl">{titleParts(item).title}</h1>
            <p className="mt-4 text-lg text-white/75">
              {item.team_name || "THE LION SQUAD"}
              {item.location ? ` · ${item.location}` : ""}
            </p>
            <MetaGrid item={item} />
          </div>
          <aside className="space-y-3 xl:sticky xl:top-24">
            <PlacementPanel item={item} large />
            <div className="grid gap-2">
              <RefButton href={item.external_url} label="Turnierseite" />
              <RefButton href={item.bracket_url} label="Bracket" />
              <RefButton href={item.match_url} label="Matchseite" />
              <RefButton href={item.result_url} label="Ergebnis" />
            </div>
          </aside>
        </div>
        <div className="mt-8 grid lg:grid-cols-[minmax(0,1fr)_25rem] gap-6 items-start">
          <div className="min-w-0">
            {item.description && <TextBlock title="Bericht" text={item.description} />}
            {item.highlights && <TextBlock title="Highlights" text={item.highlights} tone="gold" />}
          </div>
          <LineupBlock item={item} compact />
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

function FilterRow({ label, children }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2">
      <div className="w-24 shrink-0 text-[10px] uppercase tracking-widest text-white/35 font-bold">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FilterButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-2 border rounded-sm text-xs uppercase tracking-wider font-bold transition ${active ? "border-[#29B6E8] bg-[#29B6E8] text-black" : "border-white/10 text-white/55 hover:text-white hover:border-[#29B6E8]/45"}`}
    >
      {children}
    </button>
  );
}

function ReferenceGameGroup({ group }) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <div className="w-11 h-11 border border-white/10 bg-black rounded-sm flex items-center justify-center overflow-hidden">
          {group.logo ? <img src={resolveMediaUrl(group.logo)} alt="" className="w-full h-full object-contain p-1.5" /> : <Trophy className="w-5 h-5 text-[#29B6E8]" />}
        </div>
        <div className="min-w-0">
          <h2 className="font-heading text-2xl font-black uppercase leading-tight truncate">{group.title}</h2>
          <div className="text-xs text-white/40">{group.count} Referenzen</div>
        </div>
      </div>
      <div className="space-y-5">
        {group.platforms.map((platform) => (
          <div key={platform.key}>
            {group.platforms.length > 1 && (
              <div className="mb-2 text-[10px] uppercase tracking-widest text-white/40 font-bold">{platform.label}</div>
            )}
            <div className="grid xl:grid-cols-2 gap-4">
              {platform.items.map((item) => <ReferenceCard key={item.id} item={item} />)}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TitleChips({ item, className = "" }) {
  const chips = titleParts(item).chips.filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className={`${className} flex flex-wrap gap-1.5`}>
      {chips.map((chip) => (
        <span key={chip} className="px-2 py-1 border border-white/10 bg-white/[0.03] rounded-sm text-[10px] uppercase tracking-widest text-white/50 font-bold">{chip}</span>
      ))}
    </div>
  );
}

function ReferenceCard({ item }) {
  const status = item.status || "completed";
  const lineup = referenceLineup(item);
  const parts = titleParts(item);
  return (
    <article className="h-full grid sm:grid-cols-[6.5rem_minmax(0,1fr)] gap-4 border border-white/10 rounded-sm bg-[#111] p-4 hover:border-[#29B6E8]/35 transition">
      <PlacementPanel item={item} />
      <div className="min-w-0 flex flex-col">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge className={statusClasses[status] || statusClasses.completed}>{statusLabels[status] || status}</Badge>
          {item.organizer && <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold">{item.organizer}</span>}
        </div>
        <TitleChips item={item} className="mt-2" />
        <Link to={`/references/${item.id}`} className="block mt-2 font-heading text-xl md:text-2xl font-black uppercase leading-tight break-words hover:text-[#29B6E8] transition">{parts.title}</Link>
        <p className="mt-2 text-sm text-white/70">
          {item.team_name || "THE LION SQUAD"}
          {item.location ? ` · ${item.location}` : ""}
        </p>
        {item.description && <p className="mt-3 text-sm text-white/62 leading-relaxed line-clamp-2">{item.description}</p>}
        {lineup.length > 0 && <LineupInline item={item} compact />}
        <div className="mt-auto pt-4 flex flex-wrap gap-2">
          <Link to={`/references/${item.id}`} className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-[#29B6E8]/45 rounded-sm text-xs uppercase tracking-wider font-bold text-[#29B6E8] hover:bg-[#29B6E8]/10">Details</Link>
          <RefButton href={item.external_url} label="Turnier" />
          <RefButton href={item.bracket_url} label="Bracket" />
          <RefButton href={item.result_url} label="Ergebnis" />
        </div>
      </div>
    </article>
  );
}

function PlacementPanel({ item, large = false }) {
  const medalClass = item.medal ? medalClasses[item.medal] : "border-white/15 bg-white/5 text-white/65";
  return (
    <div className={`border rounded-sm ${medalClass} ${large ? "p-5" : "p-3"} flex ${large ? "xl:flex-col" : "sm:flex-col"} items-center ${large ? "xl:items-start" : "sm:items-start"} gap-3`}>
      <div className={`${large ? "w-24 h-24" : "w-14 h-14"} rounded-sm bg-black/35 border border-current/20 flex items-center justify-center overflow-hidden shrink-0`}>
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
        <div className={`${large ? "text-5xl" : "text-3xl"} mt-1 font-display font-black leading-none`}>{placementShort(item)}</div>
        <div className="mt-2 text-xs text-white/55">{item.participant_count ? `${item.participant_count} Teilnehmer` : item.team_count ? `${item.team_count} Teams` : "Teilnahme"}</div>
        <div className="mt-1 text-xs text-white/45">{formatDate(item.start_date)}</div>
      </div>
    </div>
  );
}

function LineupInline({ item, compact = false }) {
  const members = item.lineup_members || [];
  const names = item.lineup || [];
  const max = compact ? 6 : 99;
  const visibleMembers = members.slice(0, max);
  const remainingSlots = Math.max(max - visibleMembers.length, 0);
  const visibleNames = names.slice(0, remainingSlots);
  const hidden = members.length + names.length - visibleMembers.length - visibleNames.length;
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {visibleMembers.map((member) => <PlayerChip key={member.profile_id || member.display_name} member={member} />)}
      {visibleNames.map((name) => <span key={name} className="px-2 py-1 border border-white/10 bg-black/20 text-xs text-white/55 rounded-sm">{name}</span>)}
      {hidden > 0 && <span className="px-2 py-1 border border-white/10 bg-black/20 text-xs text-white/45 rounded-sm">+{hidden}</span>}
    </div>
  );
}

function LineupBlock({ item, compact = false }) {
  const lineup = referenceLineup(item);
  if (!lineup.length) return null;
  return (
    <div className={`${compact ? "" : "mt-8"} border border-white/10 bg-[#121212] rounded-sm p-5`}>
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
