/**
 * Erfolge im Admin (E10, #620): alles an einem Ort, in neun Reitern -
 * Übersicht · Katalog · Vergeben · Saison · Jahresrückblick (#1195) · XP · Vorschau · Negativ und Vorfälle · Statistik.
 * Massenvergabe, Import und XP-Eingriffe nur für Vorstand oder Systemverwaltung (der Server prüft das auch).
 */
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertOctagon, Award, BarChart3, BookOpen, CalendarCheck, Eye, LayoutDashboard, Sparkles, Zap } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { OverviewTab } from "./achievements/OverviewTab";
import { CatalogTab } from "./achievements/CatalogTab";
import { AwardTab } from "./achievements/AwardTab";
import { SeasonTab } from "./achievements/SeasonTab";
import { YearReviewTab } from "./achievements/YearReviewTab";
import { XpTab } from "./achievements/XpTab";
import { PreviewTab } from "./achievements/PreviewTab";
import { NegativeTab } from "./achievements/NegativeTab";
import { StatsTab } from "./achievements/StatsTab";
import { useBoardRights } from "./achievements/shared";

export { MATERIALS, materialColor, materialLabel } from "./achievements/shared";

export const TABS = [
  { key: "overview", label: "Übersicht", icon: LayoutDashboard },
  { key: "catalog", label: "Katalog", icon: BookOpen },
  { key: "award", label: "Vergeben", icon: Award },
  { key: "season", label: "Saison", icon: CalendarCheck },
  { key: "year", label: "Jahresrückblick", icon: Sparkles },
  { key: "xp", label: "XP", icon: Zap },
  { key: "preview", label: "Vorschau", icon: Eye },
  { key: "negative", label: "Negativ & Vorfälle", icon: AlertOctagon },
  { key: "stats", label: "Statistik", icon: BarChart3 },
];

export default function AdminAchievementsPage() {
  const board = useBoardRights();
  // Reiter per ?tab= ansteuerbar (Admin-Suche, Links); unbekannte fallen auf die Übersicht.
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get("tab");
  const valid = (key) => TABS.some((t) => t.key === key);
  const [tab, setTabState] = useState(() => (valid(requested) ? requested : "overview"));
  const setTab = (key) => {
    setTabState(key);
    setSearchParams(key === "overview" ? {} : { tab: key }, { replace: true });
  };
  useEffect(() => {
    if (valid(requested) && requested !== tab) setTabState(requested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested]);

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#FFD700]">Content</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">Erfolge</h1>
      <p className="mt-2 text-white/55 text-sm max-w-2xl">
        Katalog, Vergaben, Saisonabschluss, XP und Vorschau an einem Ort. Jede Aktion steht im Protokoll unter „Vergeben“.
      </p>

      <div className="mt-6 flex gap-1 border-b border-white/10 overflow-x-auto" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            data-testid={`ach-tab-${key}`}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition ${tab === key ? "border-[#FFD700] text-[#FFD700]" : "border-transparent text-white/50 hover:text-white"}`}
          >
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {tab === "overview" && <OverviewTab />}
        {tab === "catalog" && <CatalogTab board={board} />}
        {tab === "award" && <AwardTab board={board} />}
        {tab === "season" && <SeasonTab />}
        {tab === "year" && <YearReviewTab />}
        {tab === "xp" && <XpTab board={board} />}
        {tab === "preview" && <PreviewTab />}
        {tab === "negative" && <NegativeTab />}
        {tab === "stats" && <StatsTab />}
      </div>
    </AdminLayout>
  );
}
