// Einstellungen (#223): Abschnitt „SEO und Suchmaschinen“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { BrandField, BrandSelect } from "../fields";
import { SetupGuide } from "@/components/tls/SetupGuide";
import { Send, RefreshCw } from "lucide-react";
import { INDEXNOW_DEFAULT_PATHS } from "../shared";
import { SeoStatusCard } from "./parts";

export function SeoSection({ brand, savingBrand, submittingIndexNow, indexNowResult, imageUploadBusy, setBrandField, saveBrand, submitIndexNow, indexNowKeyUrl }) {
  return (
    <div className="max-w-7xl space-y-4">
      <SetupGuide guideKey="analytics" />
      <SetupGuide guideKey="search_console" />
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Indexierung</span>
          <h2 className="font-heading text-2xl font-black uppercase mt-1">SEO & Analytics</h2>
          <p className="text-sm text-white/55 mt-2 max-w-2xl">
            Analytics, Google Search Console, Bing Webmaster Tools und IndexNow liegen hier gebündelt. Social-Share-Bilder kommen automatisch aus dem jeweiligen Seitenbild oder aus Logo/Maskottchen.
          </p>
        </div>
        <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-3">
            <div>
              <div className="font-heading font-bold uppercase">Analytics</div>
              <p className="text-xs text-white/50 mt-1">Bei Google Analytics nur die Measurement-ID eintragen, z.B. G-3X155KW480. Das Google-Tag wird automatisch mit Consent Mode eingebunden und erst nach Statistik-Zustimmung aktiv gemessen. Für DebugView die Seite mit ?ga_debug öffnen.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <BrandSelect label="Analytics" value={brand.analytics_provider || ""} onChange={(v) => setBrandField("analytics_provider", v)} testId="brand-analytics-provider" options={[["", "Aus"], ["google", "Google Analytics"], ["plausible", "Plausible"]]} />
              <BrandField label="Google Measurement ID" value={brand.google_analytics_id} onChange={(v) => setBrandField("google_analytics_id", v)} testId="brand-ga-id" placeholder="G-XXXXXXXXXX" />
              <BrandField label="Plausible Domain" value={brand.plausible_domain} onChange={(v) => setBrandField("plausible_domain", v)} testId="brand-plausible-domain" placeholder="lionsquad.at" />
            </div>
        </div>
        <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-3">
          <div>
            <div className="font-heading font-bold uppercase">Suchmaschinen-Verknuepfung</div>
            <p className="text-xs text-white/50 mt-1">Für Search Console beim HTML-Tag nur den content-Wert eintragen, nicht das komplette Meta-Tag. IndexNow sendet Startseite und Sitemap aktiv an Microsoft/Bing-kompatible Suchmaschinen.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <BrandField label="Google Site Verification" value={brand.google_site_verification} onChange={(v) => setBrandField("google_site_verification", v)} testId="brand-google-verification" />
            <BrandField label="Bing msvalidate.01" value={brand.msvalidate_01} onChange={(v) => setBrandField("msvalidate_01", v)} testId="brand-bing-verification" />
            <BrandField label="IndexNow Key" value={brand.indexnow_key} onChange={(v) => setBrandField("indexnow_key", v)} testId="brand-indexnow-key" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <SeoStatusCard ok={!!brand.google_site_verification} title="Google" detail={brand.google_site_verification ? "Search Console Verification gesetzt" : "Verification-Content fehlt"} />
            <SeoStatusCard ok={!!brand.msvalidate_01} title="Bing" detail={brand.msvalidate_01 ? "Bing Verification gesetzt" : "msvalidate.01 fehlt"} />
            <SeoStatusCard ok={!!brand.indexnow_key} title="IndexNow" detail={brand.indexnow_key ? `Key-Datei: ${indexNowKeyUrl}` : "Key fehlt, Submit deaktiviert"} />
          </div>
          <div className="rounded-sm border border-white/10 bg-[#121212] p-3 text-xs text-white/50">
            <div className="font-bold uppercase tracking-widest text-white/70">Gesendete IndexNow-URLs</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {INDEXNOW_DEFAULT_PATHS.map((path) => (
                <span key={path} className="rounded-sm border border-white/10 bg-black/20 px-2 py-1 font-mono text-[11px] text-white/55">{path}</span>
              ))}
            </div>
            {indexNowResult && (
              <div className={`mt-3 rounded-sm border px-3 py-2 ${indexNowResult.ok ? "border-[#10B981]/25 text-[#10B981]" : "border-[#FF3B30]/25 text-[#FF3B30]"}`}>
                {indexNowResult.ok ? `${indexNowResult.submitted || 0} URLs gesendet` : indexNowResult.error}
                {indexNowResult.submitted_at && <span className="text-white/35"> - {new Date(indexNowResult.submitted_at).toLocaleString("de-DE")}</span>}
              </div>
            )}
          </div>
          <button type="button" onClick={submitIndexNow} disabled={!brand.indexnow_key || submittingIndexNow} className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-[#29B6E8]/45 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">
            {submittingIndexNow ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {submittingIndexNow ? "Sende..." : "IndexNow senden"}
          </button>
        </div>
        <button onClick={saveBrand} disabled={imageUploadBusy || savingBrand} data-testid="seo-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingBrand ? "Speichere..." : "SEO & Analytics speichern"}</button>
      </div>
    </div>
  );
}
