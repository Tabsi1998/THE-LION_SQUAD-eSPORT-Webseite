import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Gem, Play, Pause, Sparkles } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { Badge } from "@/components/achievements/Badge";
import { BADGE_ART_KEYS } from "@/components/achievements/badgeArt";
import { MATERIAL_LOOKS, MATERIAL_ORDER } from "@/components/achievements/materials";
import { CeremonyHost } from "@/components/achievements/ceremony/CeremonyHost";
import { createCeremonyQueue } from "@/components/achievements/ceremony/queue";
import { MOTIONS, SEQUENCE_KEYS, SEQUENCES } from "@/components/achievements/ceremony/select";

const previewQueue = createCeremonyQueue();
const CATEGORY_LABELS = { match: "Spielen", tournament: "Turnier", fastlap: "Fast Lap", season: "Saison", team: "Team", community: "Community", creator: "Streaming & Creator", profile: "Profil & Konto", club: "Verein", special: "Besonders", hidden: "Geheim" };

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

// Vorschau der Abzeichen-Kunst (E8, #618; verlinkt aus E10): jedes Motiv in jedem Material, Größen,
// Rang-Kerben, Silhouette mit Fortschritt, Bewegung an/aus - damit man sieht, was die Leute sehen,
// bevor es jemand sieht. Zeremonien kommen mit dem nächsten Teil dazu.
const SIZES = ["sm", "md", "lg", "xl", "hero"];

export default function AdminAchievementPreviewPage() {
  const [material, setMaterial] = useState("gold");
  const [size, setSize] = useState("lg");
  const [animate, setAnimate] = useState(true);
  const [locked, setLocked] = useState(false);
  const [rank, setRank] = useState(5);
  const [query, setQuery] = useState("");
  const [focus, setFocus] = useState("crossed-swords");
  const keys = useMemo(() => BADGE_ART_KEYS.filter((key) => !query || key.includes(query.trim().toLowerCase())), [query]);
  const look = MATERIAL_LOOKS[material];
  const [ceremonyMaterial, setCeremonyMaterial] = useState("gold");
  const [ceremonyCategory, setCeremonyCategory] = useState("match");
  const [ceremonySequence, setCeremonySequence] = useState("single");
  const playCeremony = () => {
    previewQueue.clear();
    previewQueue.enqueue({ id: `preview-${Date.now()}`, ...sampleCeremony({ material: ceremonyMaterial, category: ceremonyCategory, sequence: ceremonySequence, art: focus }) });
  };

  return (
    <AdminLayout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8" data-testid="achievement-preview-page">
        <Link to="/admin/achievements" className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white">
          <ArrowLeft className="w-3 h-3" /> Achievements
        </Link>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Abzeichen-Kunst</span>
            <h1 className="mt-1 font-heading text-3xl md:text-4xl font-black uppercase">Vorschau</h1>
            <p className="mt-1 text-sm text-white/55">{BADGE_ART_KEYS.length} Motive · {MATERIAL_ORDER.length} Materialien · Rang-Kerben, Silhouette und Bewegung</p>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="preview-controls">
            <select value={material} onChange={(e) => setMaterial(e.target.value)} aria-label="Material" data-testid="preview-material" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80">
              {MATERIAL_ORDER.map((key) => <option key={key} value={key}>{MATERIAL_LOOKS[key].name}</option>)}
            </select>
            <select value={size} onChange={(e) => setSize(e.target.value)} aria-label="Größe" data-testid="preview-size" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80">
              {SIZES.map((key) => <option key={key} value={key}>{key}</option>)}
            </select>
            <select value={rank} onChange={(e) => setRank(Number(e.target.value))} aria-label="Rang" data-testid="preview-rank" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80">
              {[0, 1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>{n ? `Rang ${n}` : "ohne Kerben"}</option>)}
            </select>
            <button type="button" onClick={() => setLocked((v) => !v)} aria-pressed={locked} data-testid="preview-locked" className={`px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest border rounded-sm ${locked ? "border-[#29B6E8]/60 text-[#29B6E8]" : "border-white/15 text-white/60"}`}>
              Silhouette
            </button>
            <button type="button" onClick={() => setAnimate((v) => !v)} aria-pressed={animate} data-testid="preview-animate" className={`inline-flex items-center gap-1 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-widest border rounded-sm ${animate ? "border-[#00FF88]/60 text-[#00FF88]" : "border-white/15 text-white/60"}`}>
              {animate ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />} Bewegung
            </button>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Motiv suchen" aria-label="Motiv suchen" data-testid="preview-search" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs text-white/80 w-40" />
          </div>
        </div>

        {/* Zeremonie abspielen: jede Kombination aus Material, Bewegung (Kategorie) und Sonderablauf */}
        <section className="mt-8 border border-[#FFD700]/25 rounded-sm bg-[#121212] p-5" data-testid="preview-ceremony">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-[#FFD700]" />
            <h2 className="font-heading text-lg font-bold uppercase">Zeremonie abspielen</h2>
          </div>
          <p className="text-xs text-white/50 mb-4">Material bestimmt Look und Klang, die Kategorie die Bewegung, der Ablauf die Sonderteile. Ton und „dezent“ folgen deinen Profileinstellungen; die Bewegung oben schaltet die Abzeichen-Effekte.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select value={ceremonyMaterial} onChange={(e) => setCeremonyMaterial(e.target.value)} aria-label="Material der Zeremonie" data-testid="ceremony-material" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80">
              {MATERIAL_ORDER.map((key) => <option key={key} value={key}>{MATERIAL_LOOKS[key].name}</option>)}
            </select>
            <select value={ceremonyCategory} onChange={(e) => setCeremonyCategory(e.target.value)} aria-label="Kategorie (Bewegung)" data-testid="ceremony-category" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80">
              {Object.keys(MOTIONS).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key] || key} · {MOTIONS[key]}</option>)}
            </select>
            <select value={ceremonySequence} onChange={(e) => setCeremonySequence(e.target.value)} aria-label="Sonderablauf" data-testid="ceremony-sequence" className="bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1.5 text-xs uppercase tracking-widest text-white/80">
              {SEQUENCE_KEYS.map((key) => <option key={key} value={key}>{SEQUENCES[key].label}</option>)}
            </select>
            <button type="button" onClick={playCeremony} data-testid="ceremony-play" className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-[#FFD700]/60 text-[#FFD700] text-[10px] font-bold uppercase tracking-widest rounded-sm hover:bg-[#FFD700]/10">
              <Play className="w-3 h-3" /> Abspielen
            </button>
          </div>
        </section>
        <CeremonyHost queue={previewQueue} quietPrefixes={[]} />

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

        {/* Alle Motive im gewählten Material */}
        <section className="mt-8" data-testid="preview-gallery">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-heading text-lg font-bold uppercase">Alle Motive · <span style={{ color: look.rim }}>{look.name}</span></h2>
            <span className="text-[10px] uppercase tracking-widest text-white/40" data-testid="preview-count">{keys.length} Motive</span>
          </div>
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
        </section>
      </div>
    </AdminLayout>
  );
}
