import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { api, resolveMediaUrl } from "@/lib/api";
import { gameLabel } from "@/lib/gameLabels";
import { seoTextPreview } from "@/lib/textPreview";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { useCountUp } from "@/hooks/useCountUp";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ArrowRight, ExternalLink, Handshake, Medal, Trophy, User, Users } from "lucide-react";

// Referenzen als Erfolgswand (#409, Design-Rework nach Rückmeldung des Betreibers): oben die
// Medaillenbilanz des Vereins, dann die Trophäenwand mit allen Podestplätzen (Spiel-Cover, große
// Platzierung, Aufstellung), dann die Bilanz je Spiel und darunter alle Teilnahmen als Zeitleiste
// nach Saison. Eine Referenz ist eine Turnierteilnahme mit Einträgen (Team oder Einzelstarter).
// Die Karten funktionieren ohne Bilder - mit Cover werden sie besser.

const MEDAL = {
  gold: { label: "Gold", ring: "from-[#FFF2A8] via-[#FFD700] to-[#9A7400]", text: "text-[#FFD700]", soft: "bg-[#FFD700]/10 border-[#FFD700]/40", glow: "shadow-[0_0_48px_rgba(255,215,0,0.22)]" },
  silver: { label: "Silber", ring: "from-[#FFFFFF] via-[#C9C9C9] to-[#6E6E6E]", text: "text-[#E2E2E2]", soft: "bg-white/10 border-white/40", glow: "shadow-[0_0_48px_rgba(220,220,220,0.16)]" },
  bronze: { label: "Bronze", ring: "from-[#F2C08E] via-[#CD7F32] to-[#6E3F16]", text: "text-[#E4A464]", soft: "bg-[#CD7F32]/10 border-[#CD7F32]/45", glow: "shadow-[0_0_48px_rgba(205,127,50,0.2)]" },
};
const MEDAL_RANK = { gold: 0, silver: 1, bronze: 2 };
const modeLabels = { online: "Online", offline: "Vor Ort", hybrid: "Hybrid" };
const statusLabels = { active: "Laufend", planned: "Geplant", completed: "Abgeschlossen", archived: "Archiviert" };

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("de-DE", { dateStyle: "medium" });
}

function referenceGameName(item) {
  return item.game_name || gameLabel(item.game) || "Externes Turnier";
}

export function displayTitle(item) {
  return item.display_title || item.title || "Referenz";
}

export function entriesOf(item) {
  return Array.isArray(item.entries) && item.entries.length ? item.entries : [];
}

function platformLabel(item, key) {
  const meta = Array.isArray(item.reference_meta?.platforms) ? item.reference_meta.platforms : [];
  return meta.find((entry) => entry.key === key)?.label || key;
}

function entryPeople(entry) {
  const members = (entry.lineup_members || []).map((member) => member.display_name).filter(Boolean);
  return [...members, ...(entry.lineup || [])];
}

function entryTitle(entry) {
  if (entry.kind === "solo") return entryPeople(entry)[0] || "Einzelstarter";
  return entry.team_name || "THE LION SQUAD";
}

function gameKey(item) {
  return item.game?.id || item.game_id || referenceGameName(item);
}

function gameTitle(item) {
  return item.game?.display_name || item.game?.name || referenceGameName(item);
}

function bestPlacement(item) {
  return Number(item.best_placement || item.placement || 0) || null;
}

function medalOf(item) {
  if (item.medal) return item.medal;
  const placement = bestPlacement(item);
  return placement === 1 ? "gold" : placement === 2 ? "silver" : placement === 3 ? "bronze" : null;
}

function timeOf(item) {
  const date = new Date(item.start_date || item.end_date || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export function groupReferences(items) {
  const games = new Map();
  items.forEach((item) => {
    const key = gameKey(item);
    if (!games.has(key)) games.set(key, { key, title: gameTitle(item), logo: item.game?.logo_url, cover: item.game?.cover_url, items: [] });
    games.get(key).items.push(item);
  });
  return Array.from(games.values()).map((game) => ({
    ...game,
    count: game.items.length,
    podiums: game.items.filter((item) => medalOf(item)).length,
    best: game.items.map(bestPlacement).filter(Boolean).sort((a, b) => a - b)[0] || null,
  }));
}

// Podestplätze zuerst nach Medaille, dann das Neueste zuerst.
export function trophyItems(items) {
  return items.filter((item) => medalOf(item)).sort((a, b) => (MEDAL_RANK[medalOf(a)] - MEDAL_RANK[medalOf(b)]) || (timeOf(b) - timeOf(a)));
}

// Zeitleiste: Saisons absteigend (numerisch), Teilnahmen ohne Saison unter „Weitere“, innerhalb neu → alt.
export function timelineGroups(items) {
  const groups = new Map();
  items.forEach((item) => {
    const key = item.season || "";
    if (!groups.has(key)) groups.set(key, { key, label: item.season || "Weitere Turniere", items: [] });
    groups.get(key).items.push(item);
  });
  return Array.from(groups.values())
    .map((group) => ({ ...group, items: group.items.slice().sort((a, b) => timeOf(b) - timeOf(a)) }))
    .sort((a, b) => (a.key === "" ? 1 : b.key === "" ? -1 : b.key.localeCompare(a.key, "de-AT", { numeric: true })));
}

export default function ReferencesPage() {
  useDocumentTitle("Erfolge & Referenzen", "Turniere, Ligen, Platzierungen und Podestplätze von THE LION SQUAD eSports - die Erfolgswand des Vereins.");
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState({});
  const [podiumOnly, setPodiumOnly] = useState(false);
  const [gameFilter, setGameFilter] = useState("all");
  const [platformFilter, setPlatformFilter] = useState("all");
  const [seasonFilter, setSeasonFilter] = useState("all");

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

  const games = useMemo(() => groupReferences(items), [items]);
  const trophies = useMemo(() => trophyItems(items), [items]);
  const platformOptions = useMemo(() => Array.from(new Map(items.flatMap((item) => (item.platforms || []).map((key) => [key, { key, label: platformLabel(item, key) }]))).values()), [items]);
  const seasonOptions = useMemo(() => Array.from(new Set(items.map((item) => item.season).filter(Boolean))).sort((a, b) => b.localeCompare(a, "de-AT", { numeric: true })), [items]);

  const filteredItems = items.filter((item) => {
    if (podiumOnly && !entriesOf(item).some((entry) => entry.placement && Number(entry.placement) <= 3) && !medalOf(item)) return false;
    if (gameFilter !== "all" && gameKey(item) !== gameFilter) return false;
    if (platformFilter !== "all" && !(item.platforms || []).includes(platformFilter)) return false;
    if (seasonFilter !== "all" && (item.season || "") !== seasonFilter) return false;
    return true;
  });
  const timeline = timelineGroups(filteredItems);
  const filtersActive = podiumOnly || gameFilter !== "all" || platformFilter !== "all" || seasonFilter !== "all";
  const counts = { gold: summary.gold || 0, silver: summary.silver || 0, bronze: summary.bronze || 0 };

  return (
    <PublicLayout>
      {/* Hero: die Medaillenbilanz des Vereins */}
      <section className="relative overflow-hidden border-b border-white/10 bg-grid-dense" data-testid="references-hero">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,215,0,0.14),transparent_45%),radial-gradient(circle_at_85%_30%,rgba(41,182,232,0.14),transparent_45%)]" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 md:py-20">
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Verein · Erfolgswand</span>
          <h1 className="mt-3 font-heading text-5xl md:text-7xl font-black uppercase leading-[0.95]">Erfolge &amp;<br />Referenzen</h1>
          <p className="mt-5 text-white/70 max-w-2xl text-lg">
            Wo THE LION SQUAD im Namen des Vereins angetreten ist – als Team oder mit Einzelstartern – und was dabei herausgekommen ist.
          </p>
          <div className="mt-10 grid grid-cols-3 gap-2 sm:gap-3 max-w-3xl" data-testid="references-numbers">
            <MedalStat medal="gold" value={counts.gold} testId="references-stat-gold" />
            <MedalStat medal="silver" value={counts.silver} testId="references-stat-silver" />
            <MedalStat medal="bronze" value={counts.bronze} testId="references-stat-bronze" />
          </div>
          <div className="mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm text-white/60">
            <CountLine label="Teilnahmen" value={summary.total || 0} testId="references-stat-total" />
            <CountLine label="Podestplätze" value={summary.podiums || 0} testId="references-stat-podiums" />
            <CountLine label="Spiele" value={summary.games || games.length} testId="references-stat-games" />
            <CountLine label="Saisons" value={(summary.seasons || seasonOptions).length} testId="references-stat-seasons" />
          </div>
        </div>
      </section>

      {/* Trophäenwand: jeder Podestplatz als Trophäe */}
      {trophies.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12" data-testid="references-trophies">
          <SectionTitle icon={Trophy} accent="#FFD700" eyebrow="Trophäenwand" title="Unsere Podestplätze" hint={`${trophies.length} ${trophies.length === 1 ? "Podestplatz" : "Podestplätze"}`} />
          <div className="mt-6 flex gap-4 overflow-x-auto snap-x snap-mandatory pb-3 -mx-4 px-4 sm:mx-0 sm:px-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:pb-0">
            {trophies.map((item) => <TrophyCard key={item.id} item={item} />)}
          </div>
        </section>
      )}

      {/* Bilanz je Spiel - zugleich der Spiel-Filter */}
      {games.length > 0 && (
        <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-10" data-testid="references-games">
          <SectionTitle icon={Medal} accent="#29B6E8" eyebrow="Bilanz je Spiel" title="Wo wir antreten" />
          <div className="mt-6 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
            <GameTile active={gameFilter === "all"} onClick={() => setGameFilter("all")} title="Alle Spiele" count={items.length} podiums={trophies.length} testId="references-game-all" />
            {games.map((game) => (
              <GameTile key={game.key} active={gameFilter === game.key} onClick={() => setGameFilter(gameFilter === game.key ? "all" : game.key)} title={game.title} logo={game.logo} count={game.count} podiums={game.podiums} best={game.best} testId={`references-game-${game.key}`} />
            ))}
          </div>
        </section>
      )}

      {/* Zeitleiste aller Teilnahmen mit Filtern */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-16" data-testid="references-timeline">
        <SectionTitle icon={Users} accent="#29B6E8" eyebrow="Alle Teilnahmen" title="Saison für Saison" hint={filtersActive ? `${filteredItems.length} von ${items.length}` : `${items.length} ${items.length === 1 ? "Teilnahme" : "Teilnahmen"}`} />
        <div className="mt-5 flex flex-wrap items-center gap-2" data-testid="references-filters">
          <FilterChip active={podiumOnly} onClick={() => setPodiumOnly((value) => !value)} tone="gold">Podest</FilterChip>
          {seasonOptions.length > 0 && (
            <>
              <span className="hidden sm:inline text-white/20">|</span>
              <FilterChip active={seasonFilter === "all"} onClick={() => setSeasonFilter("all")}>Alle Saisons</FilterChip>
              {seasonOptions.map((season) => (
                <FilterChip key={season} active={seasonFilter === season} onClick={() => setSeasonFilter(seasonFilter === season ? "all" : season)} testId={`references-season-${season}`}>{season}</FilterChip>
              ))}
            </>
          )}
          {platformOptions.length > 1 && (
            <>
              <span className="hidden sm:inline text-white/20">|</span>
              {platformOptions.map((platform) => (
                <FilterChip key={platform.key} active={platformFilter === platform.key} onClick={() => setPlatformFilter(platformFilter === platform.key ? "all" : platform.key)}>{platform.label}</FilterChip>
              ))}
            </>
          )}
          {filtersActive && (
            <button type="button" onClick={() => { setPodiumOnly(false); setGameFilter("all"); setPlatformFilter("all"); setSeasonFilter("all"); }} data-testid="references-reset" className="ml-auto text-[11px] uppercase tracking-wider font-bold text-white/45 hover:text-white">Filter zurücksetzen</button>
          )}
        </div>

        {items.length === 0 ? (
          <div className="mt-10 border border-dashed border-white/15 rounded-sm p-12 text-center text-white/50">
            <Medal className="w-10 h-10 mx-auto opacity-40 mb-4" />
            <div className="font-heading font-bold text-lg">Referenzen werden bald ergänzt.</div>
            <div className="text-sm mt-2">Sobald externe Turniere gepflegt sind, erscheinen sie hier.</div>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="mt-8 border border-dashed border-white/15 rounded-sm p-10 text-center text-white/45" data-testid="references-empty-filter">
            Keine Referenzen in diesem Filter.
          </div>
        ) : (
          <div className="mt-8 space-y-10">
            {timeline.map((group) => <SeasonBlock key={group.key || "none"} group={group} />)}
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
  const seoTitle = item ? displayTitle(item) : "Referenz";
  const seoDescription = seoTextPreview(
    item?.description || item?.highlights,
    `${referenceGameName(item || {})} Referenz von THE LION SQUAD eSports mit Platzierung, Aufstellung und Ergebnis.`
  );
  useDocumentTitle(seoTitle, seoDescription, {
    image: item?.game?.cover_url || item?.game?.logo_url,
    canonical: item?.id ? `${window.location.origin}/references/${item.id}` : undefined,
  });

  useEffect(() => {
    setLoading(true);
    api.get(`/references/${id}`).then(({ data }) => setItem(data)).catch(() => setItem(null)).finally(() => setLoading(false));
  }, [id]);

  if (loading) return <PublicLayout><div className="p-20 text-center font-display tracking-widest text-white/40">LADE REFERENZ ...</div></PublicLayout>;
  if (!item) return <PublicLayout><div className="p-20 text-center text-white/50">Referenz nicht gefunden.</div></PublicLayout>;

  const entries = entriesOf(item);
  const medal = medalOf(item);
  const cover = item.game?.cover_url;
  return (
    <PublicLayout>
      <section className="relative overflow-hidden border-b border-white/10" data-testid="reference-detail-hero">
        {cover && <img src={resolveMediaUrl(cover)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-25" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/85 to-[#0A0A0A]/40" />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 md:py-16">
          <Link to="/references" className="text-xs uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">← Erfolge &amp; Referenzen</Link>
          <div className="mt-6 grid md:grid-cols-[auto_minmax(0,1fr)] gap-6 md:gap-10 items-start">
            <PlacementBadge placement={bestPlacement(item)} medal={medal} size="xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <GameChip item={item} />
                <Badge>{statusLabels[item.status || "completed"] || item.status}</Badge>
                {medal && <Badge className={`${MEDAL[medal].soft} ${MEDAL[medal].text}`}>{MEDAL[medal].label}</Badge>}
              </div>
              <h1 className="mt-3 font-heading text-4xl md:text-5xl xl:text-6xl font-black uppercase leading-[0.95] break-words max-w-5xl">{displayTitle(item)}</h1>
              <p className="mt-3 text-lg text-white/70">
                {[item.organizer, item.league, item.season].filter(Boolean).join(" · ")}
              </p>
              <FieldChips item={item} className="mt-4" />
            </div>
          </div>
        </div>
      </section>

      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid xl:grid-cols-[minmax(0,1fr)_20rem] gap-8 items-start">
          <div className="min-w-0 space-y-8">
            <div data-testid="reference-detail-entries">
              <SectionTitle icon={Users} accent="#29B6E8" eyebrow={entries.length === 1 ? "Unser Eintrag" : "Unsere Einträge"} title={entries.length === 1 ? entryTitle(entries[0]) : "Team und Einzelstarter"} />
              <div className="mt-5 grid gap-3">
                {entries.map((entry) => <EntryRow key={entry.id} entry={entry} large />)}
              </div>
            </div>
            {item.highlights && <TextBlock title="Highlights" text={item.highlights} tone="gold" />}
            {item.description && <TextBlock title="Bericht" text={item.description} />}
          </div>
          <aside className="space-y-3 xl:sticky xl:top-24">
            <MetaList item={item} />
            <div className="grid gap-2">
              <RefButton href={item.external_url} label="Turnierseite" />
              <RefButton href={item.bracket_url} label="Bracket" />
              <RefButton href={item.match_url} label="Matchseite" />
              <RefButton href={item.result_url} label="Ergebnis" />
            </div>
          </aside>
        </div>
      </section>
    </PublicLayout>
  );
}

// ---------------------------------------------------------------- Bausteine

function SectionTitle({ icon: Icon, accent, eyebrow, title, hint }) {
  return (
    <div className="flex items-end justify-between gap-4 flex-wrap">
      <div>
        <div className="text-[11px] uppercase tracking-[0.3em] font-bold flex items-center gap-2" style={{ color: accent }}>
          {Icon && <Icon className="w-3.5 h-3.5" />} {eyebrow}
        </div>
        <h2 className="mt-2 font-heading text-2xl md:text-3xl font-black uppercase">{title}</h2>
      </div>
      {hint && <div className="text-xs uppercase tracking-widest font-bold text-white/40">{hint}</div>}
    </div>
  );
}

function MedalStat({ medal, value, testId }) {
  const [shown, ref] = useCountUp(value);
  const tone = MEDAL[medal];
  return (
    <div ref={ref} className={`border rounded-sm px-3 sm:px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${tone.soft}`} data-testid={testId}>
      <MedalEmblem medal={medal} size="md" />
      <div>
        <div className={`font-heading text-3xl md:text-4xl font-black tabular-nums ${tone.text}`}>{shown}</div>
        <div className="text-[10px] uppercase tracking-widest font-bold text-white/50">{tone.label}</div>
      </div>
    </div>
  );
}

function CountLine({ label, value, testId }) {
  return <span data-testid={testId}><span className="text-white font-bold tabular-nums">{value}</span> {label}</span>;
}

// Die Medaille: ein Kreis mit metallischem Verlauf - Gold, Silber oder Bronze.
function MedalEmblem({ medal, size = "md" }) {
  const tone = MEDAL[medal];
  const dims = size === "lg" ? "w-16 h-16" : size === "sm" ? "w-8 h-8" : "w-12 h-12";
  return (
    <span className={`${dims} shrink-0 rounded-full bg-gradient-to-br ${tone.ring} p-[3px] ${tone.glow}`} aria-hidden="true">
      <span className="w-full h-full rounded-full bg-[#0A0A0A]/80 flex items-center justify-center">
        <Medal className={`${size === "lg" ? "w-7 h-7" : size === "sm" ? "w-4 h-4" : "w-5 h-5"} ${tone.text}`} />
      </span>
    </span>
  );
}

// Die Platzierung als Abzeichen: Ring in Medaillenfarbe (oder neutral), Zahl groß, „Dabei“ ohne Platz.
function PlacementBadge({ placement, medal, size = "md" }) {
  const tone = medal ? MEDAL[medal] : null;
  const dims = size === "xl" ? "w-32 h-32 md:w-40 md:h-40" : size === "lg" ? "w-20 h-20" : "w-14 h-14";
  const font = size === "xl" ? "text-5xl md:text-6xl" : size === "lg" ? "text-3xl" : "text-xl";
  return (
    <div className={`${dims} shrink-0 rounded-full p-[3px] bg-gradient-to-br ${tone ? `${tone.ring} ${tone.glow}` : "from-white/30 via-white/10 to-white/5"}`} data-testid="placement-badge" data-medal={medal || "none"}>
      <div className="w-full h-full rounded-full bg-[#0B0B0B] flex flex-col items-center justify-center">
        {placement ? (
          <>
            <span className={`font-display font-black leading-none tabular-nums ${font} ${tone ? tone.text : "text-white"}`}>{placement}.</span>
            {size !== "md" && <span className="mt-1 text-[10px] uppercase tracking-widest font-bold text-white/45">{tone ? tone.label : "Platz"}</span>}
          </>
        ) : (
          <>
            <Trophy className={`${size === "xl" ? "w-10 h-10" : "w-5 h-5"} text-white/60`} />
            <span className="mt-1 text-[9px] uppercase tracking-widest font-black text-white/50">Dabei</span>
          </>
        )}
      </div>
    </div>
  );
}

function GameChip({ item }) {
  return (
    <span className="inline-flex items-center gap-2 pl-1 pr-2.5 py-1 border border-white/10 bg-black/40 rounded-sm text-[10px] uppercase tracking-widest font-bold text-white/70">
      <span className="w-5 h-5 rounded-sm bg-black overflow-hidden flex items-center justify-center">
        {item.game?.logo_url ? <img src={resolveMediaUrl(item.game.logo_url)} alt="" className="w-full h-full object-contain" /> : <Trophy className="w-3 h-3 text-[#29B6E8]" />}
      </span>
      {gameTitle(item)}
    </span>
  );
}

// Trophäe: Spiel-Cover als Hintergrund, große Platzierung, Titel, Saison, Aufstellung.
function TrophyCard({ item }) {
  const medal = medalOf(item);
  const tone = MEDAL[medal] || MEDAL.bronze;
  const cover = item.game?.cover_url;
  const people = entriesOf(item).flatMap((entry) => entry.lineup_members || []);
  const bestEntry = entriesOf(item).find((entry) => Number(entry.placement) === bestPlacement(item)) || entriesOf(item)[0];
  return (
    <Link to={`/references/${item.id}`} data-testid={`reference-trophy-${item.id}`} className={`group relative shrink-0 w-[85vw] max-w-sm lg:w-auto lg:max-w-none snap-start overflow-hidden rounded-sm border ${tone.soft} bg-[#0F0F0F] min-h-[18rem] flex flex-col transition hover:-translate-y-1 ${tone.glow}`}>
      {cover && <img src={resolveMediaUrl(cover)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30 group-hover:opacity-40 group-hover:scale-105 transition duration-700" />}
      <div className="absolute inset-0 bg-gradient-to-t from-[#0A0A0A] via-[#0A0A0A]/80 to-transparent" />
      <div className={`absolute top-0 inset-x-0 h-1 bg-gradient-to-r ${tone.ring}`} />
      <div className="relative p-5 flex flex-col h-full">
        <div className="flex items-start justify-between gap-3">
          <GameChip item={item} />
          <span className={`text-[10px] uppercase tracking-widest font-black ${tone.text}`}>{tone.label}</span>
        </div>
        <div className="mt-5 flex items-center gap-4">
          <PlacementBadge placement={bestPlacement(item)} medal={medal} size="lg" />
          <div className="min-w-0">
            <div className="font-heading text-xl md:text-2xl font-black uppercase leading-tight break-words group-hover:text-[#FFD700] transition">{displayTitle(item)}</div>
            <div className="mt-1 text-xs text-white/55">{[item.league, item.season, formatDate(item.start_date)].filter(Boolean).join(" · ")}</div>
          </div>
        </div>
        <div className="mt-auto pt-5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-widest font-bold text-white/40">{bestEntry?.kind === "solo" ? "Einzelstarter" : bestEntry?.team_name || "Team"}</div>
            <AvatarStack members={people} className="mt-1.5" />
          </div>
          <div className="text-[10px] uppercase tracking-widest font-bold text-white/45 whitespace-nowrap">
            {bestEntry?.team_count ? `von ${bestEntry.team_count} Teams` : bestEntry?.participant_count ? `von ${bestEntry.participant_count}` : ""}
          </div>
        </div>
      </div>
    </Link>
  );
}

function AvatarStack({ members, className = "", max = 6 }) {
  if (!members?.length) return null;
  const shown = members.slice(0, max);
  const rest = members.length - shown.length;
  return (
    <div className={`flex items-center ${className}`}>
      {shown.map((member, index) => (
        <span key={member.profile_id || member.display_name || index} title={member.display_name} className={`w-8 h-8 rounded-full border-2 border-[#0F0F0F] bg-[#1A1A1A] overflow-hidden flex items-center justify-center ${index ? "-ml-2" : ""}`}>
          {member.avatar_url ? <img src={resolveMediaUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" /> : <span className="text-[10px] font-black text-white/60">{(member.display_name || "?").slice(0, 1).toUpperCase()}</span>}
        </span>
      ))}
      {rest > 0 && <span className="-ml-2 w-8 h-8 rounded-full border-2 border-[#0F0F0F] bg-[#29B6E8]/20 text-[#29B6E8] text-[10px] font-black flex items-center justify-center">+{rest}</span>}
    </div>
  );
}

function GameTile({ active, onClick, title, logo, count, podiums, best, testId }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} className={`text-left border rounded-sm p-3 flex items-center gap-3 transition ${active ? "border-[#29B6E8] bg-[#29B6E8]/10" : "border-white/10 bg-[#111] hover:border-[#29B6E8]/40"}`}>
      <span className="w-11 h-11 shrink-0 rounded-sm bg-black border border-white/10 overflow-hidden flex items-center justify-center">
        {logo ? <img src={resolveMediaUrl(logo)} alt="" className="w-full h-full object-contain p-1" /> : <Trophy className="w-5 h-5 text-[#29B6E8]" />}
      </span>
      <span className="min-w-0">
        <span className="block font-heading font-black uppercase text-sm truncate">{title}</span>
        <span className="block text-[10px] uppercase tracking-widest font-bold text-white/45">
          {count} {count === 1 ? "Teilnahme" : "Teilnahmen"}{podiums ? ` · ${podiums}× Podest` : ""}{best ? ` · Best ${best}.` : ""}
        </span>
      </span>
    </button>
  );
}

function FilterChip({ active, onClick, children, testId, tone }) {
  const activeClass = tone === "gold" ? "border-[#FFD700] bg-[#FFD700] text-black" : "border-[#29B6E8] bg-[#29B6E8] text-black";
  return (
    <button type="button" onClick={onClick} data-testid={testId} className={`px-3 py-1.5 border rounded-full text-[11px] uppercase tracking-wider font-bold transition ${active ? activeClass : "border-white/15 text-white/60 hover:text-white hover:border-white/40"}`}>
      {children}
    </button>
  );
}

function SeasonBlock({ group }) {
  return (
    <div data-testid={`references-timeline-${group.key || "none"}`}>
      <div className="flex items-center gap-3">
        <div className="font-heading text-xl font-black uppercase text-[#FFD700]">{group.label}</div>
        <div className="flex-1 border-t border-white/10" />
        <div className="text-[10px] uppercase tracking-widest font-bold text-white/40">{group.items.length} {group.items.length === 1 ? "Teilnahme" : "Teilnahmen"}</div>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        {group.items.map((item) => <ReferenceCard key={item.id} item={item} />)}
      </div>
    </div>
  );
}

// Plattform, Format, Liga und Saison als Chips - aus den Feldern, nicht mehr aus dem Titel.
function FieldChips({ item, className = "" }) {
  const chips = [
    ...(item.platforms || []).map((key) => platformLabel(item, key)),
    item.format,
    item.league,
    item.season,
  ].filter(Boolean);
  if (!chips.length) return null;
  return (
    <div className={`${className} flex flex-wrap gap-1.5`} data-testid={`reference-chips-${item.id}`}>
      {chips.map((chip) => (
        <span key={chip} className="px-2 py-1 border border-white/10 bg-white/[0.03] rounded-sm text-[10px] uppercase tracking-widest text-white/50 font-bold">{chip}</span>
      ))}
    </div>
  );
}

// Eine Teilnahme in der Zeitleiste: Platzierung links, Titel und Chips, dann die Einträge.
function ReferenceCard({ item }) {
  const entries = entriesOf(item);
  const medal = medalOf(item);
  const tone = medal ? MEDAL[medal] : null;
  const single = entries.length === 1 ? entries[0] : null;
  return (
    <article className={`relative overflow-hidden h-full flex flex-col border rounded-sm bg-[#111] p-4 transition hover:border-[#29B6E8]/40 ${tone ? tone.soft : "border-white/10"}`} data-testid={`reference-card-${item.id}`}>
      {tone && <div className={`absolute top-0 left-0 bottom-0 w-1 bg-gradient-to-b ${tone.ring}`} />}
      <div className="flex items-start gap-4">
        <PlacementBadge placement={bestPlacement(item)} medal={medal} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <GameChip item={item} />
            {item.organizer && <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold truncate">{item.organizer}</span>}
            {(item.partners || []).map((partner) => (
              <Link key={partner.id} to={`/partners/${partner.slug || partner.id}`} data-testid={`reference-partner-${partner.slug || partner.id}`} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold text-[#29B6E8] hover:text-white">
                <Handshake className="w-3 h-3" /> {partner.name}
              </Link>
            ))}
          </div>
          <Link to={`/references/${item.id}`} className="block mt-2 font-heading text-lg md:text-xl font-black uppercase leading-tight break-words hover:text-[#29B6E8] transition">{displayTitle(item)}</Link>
          <p className="mt-1 text-xs text-white/50">
            {[formatDate(item.start_date), item.location, single?.team_count ? `${single.team_count} Teams` : single?.participant_count ? `${single.participant_count} Teilnehmer` : ""].filter(Boolean).join(" · ")}
          </p>
          <FieldChips item={item} className="mt-2" />
        </div>
      </div>
      <div className="mt-4 grid gap-2">
        {entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
      </div>
      <div className="mt-auto pt-4 flex flex-wrap items-center gap-2">
        <Link to={`/references/${item.id}`} className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider font-bold text-[#29B6E8] hover:text-white">Details <ArrowRight className="w-3 h-3" /></Link>
        <span className="ml-auto flex flex-wrap gap-2">
          <RefButton href={item.external_url} label="Turnier" compact />
          <RefButton href={item.bracket_url} label="Bracket" compact />
          <RefButton href={item.result_url} label="Ergebnis" compact />
        </span>
      </div>
    </article>
  );
}

// Ein Eintrag der Teilnahme: Platz in Medaillenfarbe, Team oder Einzelstarter, Aufstellung mit Avataren.
function EntryRow({ entry, large = false }) {
  const tone = entry.medal ? MEDAL[entry.medal] : null;
  const isSolo = entry.kind === "solo";
  const members = entry.lineup_members || [];
  const names = isSolo && members.length ? [] : (entry.lineup || []);
  const counts = entry.participant_count ? `von ${entry.participant_count}` : entry.team_count ? `von ${entry.team_count} Teams` : "";
  return (
    <div className={`flex items-center gap-3 border rounded-sm ${tone ? tone.soft : "border-white/10 bg-white/[0.03]"} ${large ? "p-4" : "p-2.5"}`} data-testid={`reference-entry-${entry.id}`}>
      <div className={`${large ? "w-14 h-14" : "w-10 h-10"} shrink-0 rounded-full p-[2px] bg-gradient-to-br ${tone ? tone.ring : "from-white/25 to-white/5"}`}>
        <div className="w-full h-full rounded-full bg-[#0B0B0B] flex items-center justify-center">
          {entry.placement ? (
            <span className={`${large ? "text-xl" : "text-sm"} font-display font-black leading-none tabular-nums ${tone ? tone.text : "text-white"}`}>{entry.placement}.</span>
          ) : (
            <span className="text-[8px] uppercase tracking-widest font-black text-white/60">Dabei</span>
          )}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-black text-white/45">
            {isSolo ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />} {isSolo ? "Einzel" : "Team"}
          </span>
          <span className="font-bold text-sm text-white truncate">{entryTitle(entry)}</span>
          {entry.placement_label && <span className="text-[10px] uppercase tracking-widest text-white/45">{entry.placement_label}</span>}
          {counts && <span className="text-[10px] uppercase tracking-widest text-white/45">{counts}</span>}
        </div>
        {(!isSolo || members.length === 0) && (members.length > 0 || names.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {members.map((member) => <PlayerChip key={member.profile_id || member.display_name} member={member} />)}
            {names.map((name) => <span key={name} className="px-2 py-0.5 border border-white/10 bg-black/20 text-xs text-white/55 rounded-sm">{name}</span>)}
          </div>
        )}
        {isSolo && members[0] && (
          <div className="mt-1.5"><PlayerChip member={members[0]} /></div>
        )}
      </div>
    </div>
  );
}

function PlayerChip({ member }) {
  const content = (
    <>
      <span className="w-6 h-6 rounded-full bg-black border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
        {member.avatar_url ? <img src={resolveMediaUrl(member.avatar_url)} alt="" className="w-full h-full object-cover" /> : <span className="text-[9px] font-black text-white/50">{(member.display_name || "?").slice(0, 1).toUpperCase()}</span>}
      </span>
      <span className="truncate">{member.display_name}</span>
    </>
  );
  const className = "inline-flex items-center gap-1.5 max-w-full border border-white/10 bg-black/30 text-white/80 rounded-full pl-0.5 pr-2.5 py-0.5 text-xs font-semibold";
  if (member.profile_url) return <Link to={member.profile_url} className={`${className} hover:border-[#29B6E8]/60 hover:text-[#29B6E8]`}>{content}</Link>;
  return <span className={className}>{content}</span>;
}

function MetaList({ item }) {
  const rows = [
    ["Spiel", referenceGameName(item)],
    ["Veranstalter", item.organizer],
    ["Partner", (item.partners || []).length ? (
      <span className="flex flex-wrap justify-end gap-2">
        {item.partners.map((partner) => (
          <Link key={partner.id} to={`/partners/${partner.slug || partner.id}`} data-testid={`reference-detail-partner-${partner.slug || partner.id}`} className="text-[#29B6E8] hover:text-white">{partner.name}</Link>
        ))}
      </span>
    ) : ""],
    ["Liga", item.league],
    ["Saison", item.season],
    ["Modus", modeLabels[item.mode] || item.mode],
    ["Datum", [formatDate(item.start_date), formatDate(item.end_date)].filter(Boolean).join(" – ")],
    ["Ort", item.location],
  ].filter(([, value]) => value);
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm divide-y divide-white/5" data-testid="reference-detail-meta">
      {rows.map(([label, value]) => (
        <div key={label} className="px-4 py-2.5 flex items-start justify-between gap-3">
          <span className="text-[10px] uppercase tracking-widest text-white/40 font-bold pt-0.5">{label}</span>
          <span className="text-sm text-white/80 text-right">{value}</span>
        </div>
      ))}
    </div>
  );
}

function TextBlock({ title, text, tone }) {
  return (
    <div className={`border rounded-sm p-5 ${tone === "gold" ? "border-[#FFD700]/25 bg-[#FFD700]/10" : "border-white/10 bg-[#121212]"}`}>
      <h2 className={`font-heading text-xl font-black uppercase ${tone === "gold" ? "text-[#FFD700]" : "text-white"}`}>{title}</h2>
      <p className="mt-3 text-sm md:text-base text-white/70 leading-relaxed whitespace-pre-line">{text}</p>
    </div>
  );
}

function Badge({ children, className = "border-white/10 bg-white/5 text-white/55" }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-sm border text-[10px] uppercase tracking-widest font-bold ${className}`}>{children}</span>;
}

function RefButton({ href, label, compact = false }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`inline-flex items-center justify-center gap-1.5 border border-white/10 hover:border-[#29B6E8]/50 rounded-sm uppercase tracking-wider font-bold text-white/70 hover:text-[#29B6E8] ${compact ? "px-2.5 py-1.5 text-[10px]" : "px-3 py-2 text-xs"}`}>
      {label} <ExternalLink className="w-3 h-3" />
    </a>
  );
}
