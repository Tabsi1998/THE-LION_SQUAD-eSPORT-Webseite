import { useMemo, useState } from "react";
import { Gem, Pause, Play, Sparkles, Volume2, VolumeX } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { Badge } from "@/components/achievements/Badge";
import { BADGE_ART_KEYS } from "@/components/achievements/badgeArt";
import { MATERIAL_LOOKS, MATERIAL_ORDER } from "@/components/achievements/materials";
import { CeremonyHost } from "@/components/achievements/ceremony/CeremonyHost";
import { createCeremonyQueue } from "@/components/achievements/ceremony/queue";
import { readSoundPrefs } from "@/components/achievements/ceremony/sounds";
import { MOTIONS, SEQUENCE_KEYS, SEQUENCES } from "@/components/achievements/ceremony/select";

const previewQueue = createCeremonyQueue();
const CATEGORY_LABELS = { match: "Spielen", tournament: "Turnier", fastlap: "Fast Lap", season: "Saison", team: "Team", community: "Community", creator: "Streaming & Creator", profile: "Profil & Konto", club: "Verein", special: "Besonders", hidden: "Geheim" };
const SIZES = ["sm", "md", "lg", "xl", "hero"];
const ALL = "all";

// Ein Beispielpaket für die Zeremonie-Vorschau: Material, Kategorie und Ablauf frei kombinierbar.
export function sampleCeremony({ material, category, sequence, art }) {
  const rank = MATERIAL_LOOKS[material]?.rank || 5;
  const make = (i, m = material) => ({
    code: `preview_${m}_${i}`, name: `Beispiel ${["I", "II", "III"][i]}`, description: `So sieht ${MATERIAL_LOOKS[m].name} in „${CATEGORY_LABELS[category] || category}“ aus.`,
    material: m, material_name: MATERIAL_LOOKS[m].name, rank: MATERIAL_LOOKS[m].rank, category, icon: "trophy", art, group_name: CATEGORY_LABELS[category] || category, points: 10 * (MATERIAL_LOOKS[m].rank || rank), award_id: "vorschau", hidden: category === "hidden",
  });
  if (sequence === "levelup") return { tiers: [], levelUp: { level: 10, previous: 9, title: "Kämpfer", titleChanged: true, prestige: 1, prestigeGained: true } };
  if (sequence === "stack") return { tiers: [make(0), make(1, "silver"), make(2, "wood")] };
  if (sequence === "diamond") return { tiers: [make(0, "diamond")] };
  if (sequence === "legendary") return { tiers: [make(0, "legendary")] };
  const context = { first: { firstEver: true }, group: { groupCompleted: "preview" }, category: { categoryCompleted: category } }[sequence] || {};
  return { tiers: [make(0)], context };
}

function Toggle({ on, onClick, testId, children, color = "#00FF88" }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} data-testid={testId} className="inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest border rounded-sm" style={on ? { borderColor: `${color}99`, color } : { borderColor: "rgba(255,255,255,0.15)", color: "rgba(255,255,255,0.6)" }}>
      {children}
    </button>
  );
}

const SELECT = "bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80";

/**
 * Vorschau (E8/E10): jede Zeremonie aus Material, Kategorie (Bewegung) und Sonderablauf, mit Klang an/aus und
 * „weniger Bewegung“; dazu die Abzeichen-Galerie - jedes Motiv in jedem Material, Größen, Rang-Kerben, Silhouette.
 */
export function PreviewTab() {
  const { user } = useAuth();
  const systemReduced = useReducedMotion();
  const [material, setMaterial] = useState("gold");
  const [size, setSize] = useState("lg");
  const [animate, setAnimate] = useState(true);
  const [locked, setLocked] = useState(false);
  const [rank, setRank] = useState(5);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState("crossed-swords");
  const keys = useMemo(() => BADGE_ART_KEYS.filter((key) => !query || key.includes(query.trim().toLowerCase())), [query]);
  const [ceremonyMaterial, setCeremonyMaterial] = useState("gold");
  const [ceremonyCategory, setCeremonyCategory] = useState("match");
  const [ceremonySequence, setCeremonySequence] = useState("single");
  const [sound, setSound] = useState(() => !readSoundPrefs(user).muted);
  const [reduced, setReduced] = useState(() => systemReduced || user?.ceremony_mode === "subtle");
  const playCeremony = () => {
    previewQueue.clear();
    previewQueue.enqueue({ id: `preview-${Date.now()}`, ...sampleCeremony({ material: ceremonyMaterial, category: ceremonyCategory, sequence: ceremonySequence, art: focus }) });
  };
  const everyMaterial = material === ALL;
  const look = MATERIAL_LOOKS[everyMaterial ? "gold" : material];

  return (
    <div data-testid="achievement-preview-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-white/55">{BADGE_ART_KEYS.length} Motive · {MATERIAL_ORDER.length} Materialien · Rang-Kerben, Silhouette und Bewegung</p>
        <div className="flex flex-wrap items-center gap-2" data-testid="preview-controls">
          <select value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Material" data-testid="preview-material" className={SELECT}>
            {MATERIAL_ORDER.map((key) => <option key={key} value={key}>{MATERIAL_LOOKS[key].name}</option>)}
            <option value={ALL}>Alle Materialien</option>
          </select>
          <select value={size} onChange={(e) => setSize(e.target.value)} aria-label="Größe" data-testid="preview-size" className={SELECT}>
            {SIZES.map((key) => <option key={key} value={key}>{key}</option>)}
          </select>
          <select value={rank} onChange={(e) => setRank(Number(e.target.value))} aria-label="Rang" data-testid="preview-rank" className={SELECT}>
            {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n ? `Rang ${n}` : "ohne Kerben"}</option>)}
          </select>
          <Toggle on={locked} onClick={() => setLocked((v) => !v)} testId="preview-locked" color="#29B6E8">Silhouette</Toggle>
          <Toggle on={animate} onClick={() => setAnimate((v) => !v)} testId="preview-animate">{animate ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />} Bewegung</Toggle>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Motiv suchen" aria-label="Motiv suchen" data-testid="preview-search" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs text-white/80 w-40" />
        </div>
      </div>

      {/* Zeremonie abspielen: jede Kombination aus Material, Bewegung (Kategorie) und Sonderablauf */}
      <section className="mt-6 border border-[#FFD700]/25 rounded-sm bg-[#121212] p-5" data-testid="preview-ceremony">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-[#FFD700]" />
          <h2 className="font-heading text-lg font-bold uppercase">Zeremonie abspielen</h2>
        </div>
        <p className="text-xs text-white/50 mb-4">Material bestimmt Look und Klang, die Kategorie die Bewegung, der Ablauf die Sonderteile. Klang und „weniger Bewegung“ gelten nur hier in der Vorschau.</p>
        <div className="flex flex-wrap items-center gap-2">
          <select value={ceremonyMaterial} onChange={(e) => setCeremonyMaterial(e.target.value)} aria-label="Material der Zeremonie" data-testid="ceremony-material" className={SELECT}>
            {MATERIAL_ORDER.map((key) => <option key={key} value={key}>{MATERIAL_LOOKS[key].name}</option>)}
          </select>
          <select value={ceremonyCategory} onChange={(e) => setCeremonyCategory(e.target.value)} aria-label="Kategorie (Bewegung)" data-testid="ceremony-category" className={SELECT}>
            {Object.keys(MOTIONS).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key] || key} · {MOTIONS[key]}</option>)}
          </select>
          <select value={ceremonySequence} onChange={(e) => setCeremonySequence(e.target.value)} aria-label="Sonderablauf" data-testid="ceremony-sequence" className={SELECT}>
            {SEQUENCE_KEYS.map((key) => <option key={key} value={key}>{SEQUENCES[key].label}</option>)}
          </select>
          <Toggle on={sound} onClick={() => setSound((v) => !v)} testId="ceremony-sound" color="#FFD700">{sound ? <Volume2 className="w-3 h-3" /> : <VolumeX className="w-3 h-3" />} Klang</Toggle>
          <Toggle on={reduced} onClick={() => setReduced((v) => !v)} testId="ceremony-reduced" color="#29B6E8">Weniger Bewegung</Toggle>
          <button type="button" onClick={playCeremony} data-testid="ceremony-play" className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#FFD700]/60 text-[#FFD700] text-[10px] font-bold uppercase tracking-widest rounded-sm hover:bg-[#FFD700]/10">
            <Play className="w-3 h-3" /> Abspielen
          </button>
        </div>
      </section>
      <CeremonyHost queue={previewQueue} quietPrefixes={[]} reducedOverride={reduced} sound={sound ? "on" : "off"} />

      {/* Ein Motiv in allen Materialien */}
      <section className="mt-8 border border-white/10 rounded-sm bg-[#121212] p-5" data-testid="preview-material-row">
        <div className="flex items-center gap-2 mb-4">
          <Gem className="w-4 h-4 text-[#FFD700]" />
          <h2 className="font-heading text-lg font-bold uppercase">„{focus}“ in jedem Material</h2>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-3">
          {MATERIAL_ORDER.map((key) => (
            <div key={key} className="flex flex-col items-center gap-2 text-center" data-testid={`preview-material-${key}`}>
              <Badge material={key} rank={MATERIAL_LOOKS[key].rank <= 7 ? rank || MATERIAL_LOOKS[key].rank : 0} art={focus} size="xl" animate={animate} earned={!locked} percent={locked ? 62 : 0} />
              <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: MATERIAL_LOOKS[key].rim }}>{MATERIAL_LOOKS[key].name}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Alle Motive im gewählten Material - oder jedes Motiv in allen Materialien */}
      <section className="mt-8" data-testid="preview-gallery">
        <div className="flex items-baseline justify-between mb-4">
          <h2 className="font-heading text-lg font-bold uppercase">Alle Motive · {everyMaterial ? "alle Materialien" : <span style={{ color: look.rim }}>{look.name}</span>}</h2>
          <span className="text-[10px] uppercase tracking-widest text-white/40" data-testid="preview-count">{keys.length} Motive</span>
        </div>
        {everyMaterial ? (
          <div className="space-y-2" data-testid="preview-matrix">
            {keys.map((key) => (
              <div key={key} className="flex items-center gap-3 border border-white/10 rounded-sm bg-[#0F0F10] px-3 py-2 overflow-x-auto" data-testid={`preview-matrix-${key}`}>
                <button type="button" onClick={() => setFocus(key)} aria-pressed={focus === key} className="w-32 shrink-0 text-left text-[10px] uppercase tracking-widest text-white/55 break-all hover:text-white">{key}</button>
                {MATERIAL_ORDER.map((m) => <Badge key={m} material={m} rank={MATERIAL_LOOKS[m].rank <= 7 ? rank || MATERIAL_LOOKS[m].rank : 0} art={key} size="sm" animate={false} earned={!locked} percent={locked ? 45 : 0} />)}
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
            {keys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setFocus(key)}
                aria-pressed={focus === key}
                data-testid={`preview-motif-${key}`}
                className={`flex flex-col items-center gap-2 border rounded-sm bg-[#0F0F10] p-3 transition ${focus === key ? "border-white/40" : "border-white/10 hover:border-white/25"}`}
              >
                <Badge material={material} rank={rank} art={key} size={size} animate={animate} earned={!locked} percent={locked ? 45 : 0} />
                <span className="text-[9px] uppercase tracking-widest text-white/50 break-all">{key}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
