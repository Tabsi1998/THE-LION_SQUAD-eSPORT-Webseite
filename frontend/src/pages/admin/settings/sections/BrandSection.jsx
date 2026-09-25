// Einstellungen (#223): Abschnitt „Marke und Hinweisleisten“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { ImageUpload } from "@/components/tls/ImageUpload";
import { BrandField, BrandSelect, LegalTextArea } from "../fields";
import { SetupGuide } from "@/components/tls/SetupGuide";
import { Trash2, Plus } from "lucide-react";
import { BannerPreview, BannerScopePicker, BrandNumberField, BrandDateTimeField } from "./parts";

export function BrandSection({ brand, siteBanners, bannerForm, editingBannerId, savingBanner, savingBrand, generatingFavicon, imageUploadBusy, setBrandField, saveBrand, setBannerField, applyBannerTemplate, editBanner, resetBannerForm, saveSiteBanner, deleteSiteBanner, faviconDarkOnly, generateUniversalFavicon }) {
  return (
    <div className="max-w-7xl space-y-4">
      <SetupGuide guideKey="play_store" />
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <BrandField label="Vereinsname" value={brand.club_name} onChange={(v) => setBrandField("club_name", v)} testId="brand-club-name" />
        <BrandField label="Tagline" value={brand.tagline} onChange={(v) => setBrandField("tagline", v)} testId="brand-tagline" />
        <BrandField label="Website-/Browsertitel" value={brand.site_title} onChange={(v) => setBrandField("site_title", v)} testId="brand-site-title" placeholder="THE LION SQUAD - eSPORTS" />
        <BrandField label="SEO Beschreibung" value={brand.site_description} onChange={(v) => setBrandField("site_description", v)} testId="brand-site-description" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BrandField label="Akzentfarbe (HEX)" value={brand.primary_color} onChange={(v) => setBrandField("primary_color", v)} testId="brand-color" />
          <BrandField label="Domain" value={brand.domain} onChange={(v) => setBrandField("domain", v)} testId="brand-domain" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <BrandField label="Zeitzone" value={brand.timezone} onChange={(v) => setBrandField("timezone", v)} testId="brand-tz" />
          <BrandField label="Kontakt E-Mail" value={brand.contact_email} onChange={(v) => setBrandField("contact_email", v)} testId="brand-contact-email" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ImageUpload value={brand.logo_url} onChange={(v) => setBrandField("logo_url", v)} label="Standard-Logo" testId="brand-logo" variant="square" allowLibrary />
          <ImageUpload value={brand.logo_dark_url} onChange={(v) => setBrandField("logo_dark_url", v)} label="Logo auf dunklem Hintergrund" testId="brand-logo-dark" variant="square" allowLibrary />
          <ImageUpload value={brand.logo_light_url} onChange={(v) => setBrandField("logo_light_url", v)} label="Logo auf hellem Hintergrund" testId="brand-logo-light" variant="square" allowLibrary />
          <ImageUpload value={brand.share_banner_url} onChange={(v) => setBrandField("share_banner_url", v)} label="Standard SEO-/Teilen-Banner" testId="brand-share-banner" variant="wide" allowLibrary />
          <ImageUpload value={brand.mascot_url} onChange={(v) => setBrandField("mascot_url", v)} label="Maskottchen" testId="brand-mascot" variant="square" allowLibrary />
          <ImageUpload value={brand.qr_logo_url} onChange={(v) => setBrandField("qr_logo_url", v)} label="QR-Logo" testId="brand-qr-logo" variant="square" allowLibrary />
          <ImageUpload value={brand.favicon_url} onChange={(v) => setBrandField("favicon_url", v)} label="Standard-Favicon" testId="brand-favicon" variant="square" allowLibrary />
          <ImageUpload value={brand.favicon_light_url} onChange={(v) => setBrandField("favicon_light_url", v)} label="Favicon für hellen Modus" testId="brand-favicon-light" variant="square" allowLibrary />
          <ImageUpload value={brand.favicon_dark_url} onChange={(v) => setBrandField("favicon_dark_url", v)} label="Favicon für dunklen Modus" testId="brand-favicon-dark" variant="square" allowLibrary />
        </div>
        {/* Play-Store-Link (#425): erst eintragen, wenn der Eintrag öffentlich ist - dann zeigen Footer und Startseite den offiziellen Badge. */}
        <BrandField label="Play-Store-Link (LionsAPP)" value={brand.play_store_url} onChange={(v) => setBrandField("play_store_url", v)} placeholder="https://play.google.com/store/apps/details?id=at.lionsquad.app" hint="leer lassen, bis die App öffentlich ist" testId="brand-play-store-url" />
        <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-3 text-xs text-white/60 flex flex-col md:flex-row md:items-center gap-3" data-testid="brand-favicon-universal">
          <div className="flex-1">
            <div className="font-bold text-white/80 uppercase tracking-wider">Standard-Favicon für hell und dunkel</div>
            <p className="mt-1">
              Browser ohne Hell/Dunkel-Erkennung und der Home-Bildschirm nehmen den Standard-Favicon.{" "}
              {faviconDarkOnly
                ? <span className="text-[#FFD700]" data-testid="brand-favicon-dark-only">Deiner ist die Fassung für dunkel – auf hellen Tableisten unsichtbar.</span>
                : "Erzeugt wird das weiße Logo (Favicon dunkel, sonst Maskottchen) auf einem Kreis in der Akzentfarbe."}
            </p>
          </div>
          <button type="button" onClick={generateUniversalFavicon} disabled={generatingFavicon} data-testid="brand-favicon-generate" className="px-4 py-2 border border-[#29B6E8]/45 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50 whitespace-nowrap">
            {generatingFavicon ? "Erzeuge..." : "Aus Logo und Akzentfarbe erzeugen"}
          </button>
        </div>
        <div className="border border-[#29B6E8]/20 bg-[#29B6E8]/5 rounded-sm p-3 text-xs text-white/60">
          Standardbilder werden verwendet, wenn eine Seite kein eigenes Bild hat. SEO nutzt Beitrags-/Event-/Turnierbild zuerst, danach den Teilen-Banner, danach Logo oder Maskottchen. QR-Codes verwenden das QR-Logo in der Mitte, mit Maskottchen als Fallback.
        </div>
        <div className="border border-white/10 bg-[#0A0A0A] rounded-sm p-4 space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
            <div>
              <div className="font-heading font-bold uppercase">Banner-Manager</div>
              <p className="text-xs text-white/50 mt-1">Mehrere Hinweise mit Templates, Zielbereichen, Priorität, Vorschau und Klick-/Sichtungsstatistik.</p>
            </div>
            <button type="button" onClick={resetBannerForm} className="inline-flex items-center justify-center gap-2 px-3 py-2 border border-[#29B6E8]/45 text-[#29B6E8] rounded-sm text-xs font-bold uppercase tracking-wider">
              <Plus className="w-3.5 h-3.5" /> Neuer Banner
            </button>
          </div>

          <div className="grid xl:grid-cols-[minmax(0,1.08fr)_minmax(26rem,0.92fr)] gap-4">
            <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold uppercase tracking-widest text-xs text-white/65">{editingBannerId ? "Banner bearbeiten" : "Neuer Banner"}</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={!!bannerForm.enabled} onChange={(e) => setBannerField("enabled", e.target.checked)} className="accent-[#29B6E8]" />
                  <span>Aktiv</span>
                </label>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <BrandSelect label="Template" value={bannerForm.template || "custom"} onChange={applyBannerTemplate} testId="site-banner-template" options={[
                  ["custom", "Eigener Hinweis"],
                  ["live", "Live"],
                  ["maintenance", "Wartung"],
                  ["event", "Event"],
                  ["registration", "Anmeldung offen"],
                  ["discord", "Discord"],
                ]} />
                <BrandNumberField label="Priorität" value={bannerForm.priority || 50} min={0} max={999} onChange={(v) => setBannerField("priority", v)} testId="site-banner-priority" />
              </div>
              <BrandField label="Interner Titel" value={bannerForm.title} onChange={(v) => setBannerField("title", v)} testId="site-banner-title" placeholder="z.B. GH Check-in" />
              <LegalTextArea label="Text" value={bannerForm.text} onChange={(v) => setBannerField("text", v)} testId="site-banner-text" rows={2} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <BrandSelect label="Stil" value={bannerForm.tone} onChange={(v) => setBannerField("tone", v)} testId="site-banner-tone" options={[["info", "Info"], ["live", "Live"], ["warning", "Warnung"], ["success", "Erfolg"]]} />
                <BrandSelect label="Design" value={bannerForm.style} onChange={(v) => setBannerField("style", v)} testId="site-banner-style" options={[["neon", "Neon"], ["solid", "Signal"], ["minimal", "Minimal"]]} />
                <BrandSelect label="Animation" value={bannerForm.mode} onChange={(v) => setBannerField("mode", v)} testId="site-banner-mode" options={[["ticker", "Lauftext"], ["static", "Statisch"]]} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <BrandSelect label="Position" value={bannerForm.position} onChange={(v) => setBannerField("position", v)} testId="site-banner-position" options={[["below_nav", "Unter Navigation"], ["bottom_fixed", "Unten fixiert"], ["above_footer", "Über Footer"]]} />
                <BrandSelect label="Zielgruppe" value={bannerForm.audience} onChange={(v) => setBannerField("audience", v)} testId="site-banner-audience" options={[["all", "Alle Besucher"], ["logged_in", "Eingeloggt"], ["members", "Vereinsmitglieder"], ["admins", "Admins"]]} />
              </div>
              {/* Wo der Banner läuft (#245): mindestens ein Kanal; in der App oben über den Tabs. */}
              <div className="flex flex-wrap items-center gap-4 text-sm" data-testid="site-banner-channels">
                <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">Läuft auf</span>
                {[["web", "Webseite"], ["app", "App"]].map(([channel, label]) => (
                  <label key={channel} className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={(bannerForm.channels || ["web"]).includes(channel)}
                      onChange={(e) => {
                        const current = bannerForm.channels || ["web"];
                        const next = e.target.checked ? [...new Set([...current, channel])] : current.filter((item) => item !== channel);
                        setBannerField("channels", next.length ? next : [channel === "web" ? "app" : "web"]);
                      }}
                      data-testid={`site-banner-channel-${channel}`}
                      className="accent-[#29B6E8]"
                    />
                    {label}
                  </label>
                ))}
                {(bannerForm.channels || ["web"]).includes("app") && <span className="text-xs text-[#29B6E8]">Läuft auch in der App – oben über den Tabs.</span>}
              </div>
              <BannerScopePicker value={bannerForm.scope} onChange={(v) => setBannerField("scope", v)} />
              {bannerForm.scope === "custom" && <BrandField label="Eigener URL-Pfad" value={bannerForm.path} onChange={(v) => setBannerField("path", v)} testId="site-banner-path" placeholder="/tournaments/gamers-heaven" />}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <BrandNumberField label="Mindestlaufzeit Sek." value={bannerForm.speed_seconds || 22} min={8} max={180} onChange={(v) => setBannerField("speed_seconds", v)} testId="site-banner-speed" />
                <BrandDateTimeField label="Anzeigen ab" value={bannerForm.starts_at} onChange={(v) => setBannerField("starts_at", v)} testId="site-banner-starts" />
                <BrandDateTimeField label="Anzeigen bis" value={bannerForm.ends_at} onChange={(v) => setBannerField("ends_at", v)} testId="site-banner-ends" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <BrandField label="Link URL" value={bannerForm.link_url} onChange={(v) => setBannerField("link_url", v)} testId="site-banner-link-url" placeholder="/events oder https://..." />
                <BrandField label="Link-Text" value={bannerForm.link_label} onChange={(v) => setBannerField("link_label", v)} testId="site-banner-link-label" placeholder="Mehr anzeigen" />
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" onClick={saveSiteBanner} disabled={savingBanner} className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
                  {savingBanner ? "Speichere..." : editingBannerId ? "Banner speichern" : "Banner erstellen"}
                </button>
                {editingBannerId && <button type="button" onClick={resetBannerForm} className="px-5 py-2 border border-white/15 text-white/70 font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>}
              </div>
            </div>

            <div className="space-y-4">
              <BannerPreview banner={bannerForm} />
              <div className="border border-white/10 bg-[#121212] rounded-sm p-4">
                <div className="font-bold uppercase tracking-widest text-xs text-white/65 mb-3">Banner</div>
                <div className="space-y-2 max-h-[31rem] overflow-y-auto pr-1">
                  {siteBanners.map((banner) => (
                    <div key={banner.id} className="border border-white/10 bg-black/20 rounded-sm p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-bold text-sm truncate">{banner.title || banner.text}</div>
                          <div className="text-[11px] text-white/45 truncate">{banner.scope} · {banner.position} · Prio {banner.priority}</div>
                          <div className="mt-1 text-[11px] text-white/45">Views {banner.stats?.impressions || 0} · Klicks {banner.stats?.clicks || 0}</div>
                        </div>
                        <div className="flex gap-1 shrink-0">
                          <button type="button" onClick={() => editBanner(banner)} className="px-2 py-1 border border-[#29B6E8]/35 text-[#29B6E8] rounded-sm text-[11px] font-bold uppercase">Edit</button>
                          <button type="button" onClick={() => deleteSiteBanner(banner)} className="px-2 py-1 border border-[#FF3B30]/35 text-[#FF3B30] rounded-sm text-[11px] font-bold uppercase"><Trash2 className="w-3 h-3" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {siteBanners.length === 0 && <div className="text-sm text-white/35 py-6 text-center">Noch keine separaten Banner angelegt.</div>}
                </div>
              </div>
            </div>
          </div>
        </div>
        <p className="text-xs text-white/45">Impressum, Datenschutz und Vereinsdaten liegen im Tab Rechtliches.</p>
        <button onClick={saveBrand} disabled={imageUploadBusy || savingBrand} data-testid="brand-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{savingBrand ? "Speichere..." : "Speichern"}</button>
      </div>
    </div>
  );
}
