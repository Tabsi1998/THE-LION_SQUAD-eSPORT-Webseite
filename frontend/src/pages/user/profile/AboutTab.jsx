import { Link } from "react-router-dom";
import { Smartphone } from "lucide-react";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";
import { footerButtons } from "@/lib/siteFooter";
import { StoreButton } from "@/components/tls/StoreButton";
import { openCookieSettings } from "@/components/tls/CookieConsent";

// Über die App (#1146): dieselbe Gruppe wie in der App - hier die LionsAPP zum Laden und das Rechtliche. Version und
// „Was ist neu“ zeigt die App selbst.

export function AboutTab() {
  const settings = usePublicSiteSettings();
  const stores = footerButtons(settings);
  return (
    <div className="space-y-5" data-testid="settings-about">
      <section className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5 space-y-3">
        <h2 className="font-heading font-black uppercase">Die LionsAPP</h2>
        <p className="text-sm text-white/60">Termine, Turniere, Chats und dein Profil am Handy – dasselbe Konto wie hier.</p>
        <div className="flex flex-wrap items-center gap-3" data-testid="settings-about-stores">
          {stores.playStoreUrl ? <StoreButton href={stores.playStoreUrl} testId="settings-play-button" /> : null}
          {stores.appStoreUrl ? <StoreButton href={stores.appStoreUrl} small="Laden im" big="App Store" icon="apple" testId="settings-appstore-button" /> : null}
          {!stores.playStoreUrl && !stores.appStoreUrl ? (
            <span className="inline-flex items-center gap-2 rounded-md border border-white/15 px-4 py-2.5 text-sm text-white/55"><Smartphone className="w-4 h-4" /> {stores.bothSoonLabel}</span>
          ) : null}
        </div>
      </section>
      <section className="border border-white/10 rounded-sm bg-[#0A0A0A] p-5">
        <h2 className="font-heading font-black uppercase">Rechtliches</h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
          <li><Link to="/privacy" className="text-[#29B6E8] hover:underline" data-testid="settings-privacy-policy">Datenschutz</Link></li>
          <li><Link to="/imprint" className="text-[#29B6E8] hover:underline" data-testid="settings-imprint">Impressum</Link></li>
          <li><Link to="/terms" className="text-[#29B6E8] hover:underline">Nutzungsbedingungen</Link></li>
          <li><button type="button" onClick={openCookieSettings} className="text-[#29B6E8] hover:underline">Cookie-Einstellungen</button></li>
        </ul>
      </section>
    </div>
  );
}
