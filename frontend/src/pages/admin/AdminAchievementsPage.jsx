/**
 * Erfolge im Admin (E10, #620): alles an einem Ort, in neun Reitern -
 * Übersicht · Katalog · Vergeben · Saison · Jahresrückblick (#1195) · XP · Vorschau · Negativ und Vorfälle · Statistik.
 * Massenvergabe, Import und XP-Eingriffe nur für Vorstand oder Systemverwaltung (der Server prüft das auch).
 */
import { useEffect, useRef, useState } from "react";
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
import { ShortCaps } from "@/components/tls/ShortCaps";

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
  // Nur ein neuer ?tab= (Zurück im Browser, Link) stellt den Reiter um - verglichen mit dem aktuellen Reiter (Ref), damit
  // ein Klick, der Reiter und Adresse zugleich setzt, nicht kurz auf den alten zurückspringt (#937).
  const requestedValid = valid(requested);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  useEffect(() => {
    if (requestedValid && requested !== tabRef.current) setTabState(requested);
  }, [requested, requestedValid]);

  return (
    <AdminLayout>
      <span className="tls-type-label text-honor">Content</span>
      <h1 className="tls-type-title mt-1"><ShortCaps>Erfolge</ShortCaps></h1>
      <p className="mt-2 text-white/55 tls-type-body max-w-2xl">
        Katalog, Vergaben, Saisonabschluss, XP und Vorschau an einem Ort. Jede Aktion steht im Protokoll unter „Vergeben“.
      </p>

      <div className="mt-6 flex gap-1 border-b border-white/10 tls-swipe pb-0" role="tablist">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            data-testid={`ach-tab-${key}`}
            className={`px-4 py-2 tls-type-label inline-flex items-center gap-2 border-b-2 whitespace-nowrap transition ${tab === key ? "border-brand text-brand" : "border-transparent text-white/50 hover:text-white"}`}
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
