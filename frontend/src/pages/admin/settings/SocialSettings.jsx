import { Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { BrandField, BrandSelect } from "./fields";

// Reiter Social Links (#223: aus AdminSettingsPage herausgelöst, Verhalten unverändert): die Liste für den
// Footer und die Social-Erkennung - und seit #326 Teil 4 der Stand, ob die öffentlichen Kanäle aus Dolibarr
// kommen (der Schalter liegt seit #510 unter Dolibarr → Funktionen). Der Entwurf (`brand`) und das Speichern bleiben bei der Seite.

export const SOCIAL_PLATFORM_OPTIONS = [
  ["discord", "Discord"],
  ["whatsapp", "WhatsApp Kanal"],
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["tiktok", "TikTok"],
  ["youtube", "YouTube"],
  ["twitch", "Twitch"],
  ["custom", "Eigener Link"],
];

export function SocialsTab({ brand, setSocialLink, addSocialLink, removeSocialLink, saveBrand, saving }) {
  return (
    <div className="max-w-7xl space-y-4">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Footer & SEO</span>
            <h2 className="font-heading text-2xl font-black uppercase mt-1">Social Links</h2>
            <p className="text-sm text-white/55 mt-2 max-w-2xl">
              Diese Liste steuert die Icons im Footer und die Social-Erkennung für Suchmaschinen. Nur aktive Links mit URL werden ausgespielt.
            </p>
          </div>
          <button type="button" onClick={addSocialLink} className="inline-flex items-center gap-2 px-4 py-2 border border-[#29B6E8]/45 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider">
            <Plus className="w-3.5 h-3.5" /> Link
          </button>
        </div>
        {/* Kanäle aus Dolibarr (#326 Teil 4): die öffentlichen Kanäle des Vereins aus dem Vereinsmodul */}
        <div className={`border rounded-sm p-4 space-y-1 ${brand.channels_from_dolibarr ? "border-[#29B6E8]/40 bg-[#29B6E8]/5" : "border-white/10"}`} data-testid="socials-dolibarr">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-white/80 font-bold">
            <span data-testid="socials-dolibarr-title">{brand.channels_from_dolibarr ? "Kanäle kommen aus Dolibarr" : "Kanäle von Hand"}</span>
            <Link to="/admin/dolibarr?tab=features" className="text-[11px] uppercase tracking-wider text-[#29B6E8] hover:underline font-bold" data-testid="socials-dolibarr-features">Schalter: Dolibarr → Funktionen →</Link>
          </div>
          <p className="text-xs text-white/50">Footer und Suchmaschinen nehmen dann die öffentlichen Kanäle des Vereins aus dem Vereinsmodul (Einrichtung → Vereine → Kanäle und Konten), in dessen Reihenfolge – stündlich nachgelesen. Stehen dort keine, gilt die Liste unten; sie bleibt auch der Rückfall.</p>
        </div>
        <div className="space-y-2">
          {(brand.social_links || []).map((social, index) => (
            <div key={`${social.platform}-${index}`} className="grid grid-cols-1 lg:grid-cols-[10rem_minmax(8rem,12rem)_minmax(0,1fr)_auto_auto] gap-2 items-end border border-white/10 bg-black/20 rounded-sm p-3">
              <BrandSelect label="Plattform" value={social.platform || "custom"} onChange={(v) => setSocialLink(index, "platform", v)} testId={`brand-social-platform-${index}`} options={SOCIAL_PLATFORM_OPTIONS} />
              <BrandField label="Label" value={social.label || ""} onChange={(v) => setSocialLink(index, "label", v)} testId={`brand-social-label-${index}`} />
              <BrandField label="URL" value={social.url || ""} onChange={(v) => setSocialLink(index, "url", v)} testId={`brand-social-url-${index}`} placeholder="https://..." />
              <label className="inline-flex items-center gap-2 text-sm h-10">
                <input type="checkbox" checked={social.enabled !== false} onChange={(e) => setSocialLink(index, "enabled", e.target.checked)} className="accent-[#29B6E8]" />
                Aktiv
              </label>
              <button type="button" onClick={() => removeSocialLink(index)} className="h-10 px-3 border border-[#FF3B30]/35 text-[#FF3B30] rounded-sm inline-flex items-center justify-center">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          {!(brand.social_links || []).length && <div className="text-sm text-white/40 border border-dashed border-white/10 rounded-sm p-4">Noch keine Social Links gepflegt.</div>}
        </div>
        <button onClick={saveBrand} disabled={saving} data-testid="socials-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{saving ? "Speichere..." : "Socials speichern"}</button>
      </div>
    </div>
  );
}
