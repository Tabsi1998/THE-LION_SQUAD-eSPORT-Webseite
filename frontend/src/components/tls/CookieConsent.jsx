import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Settings, X } from "lucide-react";

const STORAGE_KEY = "tls_cookie_consent_v1";
const MAX_AGE_DAYS = 30;
const DEFAULT_CONSENT = {
  essential: true,
  external_media: false,
  analytics: false,
  meta: false,
  tiktok: false,
};

const CookieConsentContext = createContext({
  consent: DEFAULT_CONSENT,
  hasChoice: false,
  openSettings: () => {},
  hasConsent: () => false,
});

function readStoredConsent() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.expires_at || Date.now() > parsed.expires_at) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStoredConsent(consent) {
  const now = Date.now();
  const payload = {
    ...DEFAULT_CONSENT,
    ...consent,
    essential: true,
    saved_at: now,
    expires_at: now + MAX_AGE_DAYS * 24 * 60 * 60 * 1000,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  window.dispatchEvent(new CustomEvent("tls-cookie-consent-changed", { detail: payload }));
  return payload;
}

export function CookieConsentProvider({ children }) {
  const [stored, setStored] = useState(() => readStoredConsent());
  const [open, setOpen] = useState(() => !readStoredConsent());
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_CONSENT, ...(readStoredConsent() || {}) }));

  const openSettings = useCallback(() => {
    const current = readStoredConsent();
    setDraft({ ...DEFAULT_CONSENT, ...(current || {}) });
    setOpen(true);
  }, []);

  useEffect(() => {
    const handler = () => openSettings();
    const changed = () => setStored(readStoredConsent());
    window.addEventListener("tls-cookie-settings", handler);
    window.addEventListener("tls-cookie-consent-changed", changed);
    return () => {
      window.removeEventListener("tls-cookie-settings", handler);
      window.removeEventListener("tls-cookie-consent-changed", changed);
    };
  }, [openSettings]);

  const save = useCallback((next) => {
    const payload = writeStoredConsent(next);
    setStored(payload);
    setDraft(payload);
    setOpen(false);
  }, []);

  const value = useMemo(() => ({
    consent: { ...DEFAULT_CONSENT, ...(stored || {}) },
    hasChoice: !!stored,
    openSettings,
    hasConsent: (key) => key === "essential" || !!stored?.[key],
  }), [openSettings, stored]);

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[80] bg-black/70 backdrop-blur-sm flex items-start md:items-center justify-center overflow-y-auto p-3 sm:p-4">
          <div className="w-full max-w-3xl max-h-[calc(100vh-1.5rem)] md:max-h-[calc(100vh-2rem)] overflow-y-auto border border-[#29B6E8]/40 bg-[#050505] rounded-sm shadow-2xl shadow-black/60">
            <div className="p-4 sm:p-5 md:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.3em] font-bold text-[#29B6E8]">Datenschutz</div>
                  <h2 className="mt-2 font-heading text-xl sm:text-3xl md:text-4xl font-black uppercase">Cookie-Einstellungen</h2>
                </div>
                {stored && (
                  <button type="button" onClick={() => setOpen(false)} className="text-white/45 hover:text-white"><X className="w-5 h-5" /></button>
                )}
              </div>
              <p className="mt-3 md:mt-4 text-sm md:text-base text-white/70 leading-relaxed">
                Wir verwenden notwendige Speicherungen für Login, Sicherheit und deine Cookie-Auswahl. Optionale Dienste wie eingebettete Karten, Streams, Statistik oder Social-/Marketing-Dienste aktivieren wir erst nach deiner Zustimmung. Du kannst die Auswahl jederzeit im Footer ändern.
              </p>
              <div className="mt-4 md:mt-6 divide-y divide-white/10 border-y border-white/10">
                <ConsentRow title="Essentiell" text="Login, CSRF-Schutz, Warenkorb-/Formularstatus und diese Einwilligungsinfo." locked checked />
                <details className="group">
                  <summary className="cursor-pointer list-none py-3 md:py-4 flex items-center justify-between gap-4">
                    <div>
                      <div className="font-heading font-black uppercase text-base md:text-lg">Optionale Dienste</div>
                      <div className="mt-1 text-xs text-white/50 max-w-xl">Externe Medien, Statistik und Social-/Marketing-Dienste einzeln einstellen.</div>
                    </div>
                    <span className="rounded-sm border border-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-white/55 group-open:text-white">Einblenden</span>
                  </summary>
                  <div className="divide-y divide-white/10 border-t border-white/10">
                <ConsentRow
                  title="Externe Medien"
                  text="Google Maps, Twitch, YouTube oder ähnliche Einbettungen direkt auf der Seite."
                  checked={draft.external_media}
                  onChange={(v) => setDraft((cur) => ({ ...cur, external_media: v }))}
                />
                <ConsentRow
                  title="Statistik"
                  text="Reichweitenmessung und technische Auswertung, sofern solche Tools eingebunden werden."
                  checked={draft.analytics}
                  onChange={(v) => setDraft((cur) => ({ ...cur, analytics: v }))}
                />
                <ConsentRow
                  title="Meta"
                  text="Facebook-/Instagram-Pixel, Meta-Embeds oder Meta-Marketing-Dienste, falls aktiv eingebunden."
                  checked={draft.meta}
                  onChange={(v) => setDraft((cur) => ({ ...cur, meta: v }))}
                />
                <ConsentRow
                  title="TikTok"
                  text="TikTok-Pixel, TikTok-Embeds oder TikTok-Marketing-Dienste, falls aktiv eingebunden."
                  checked={draft.tiktok}
                  onChange={(v) => setDraft((cur) => ({ ...cur, tiktok: v }))}
                />
                  </div>
                </details>
              </div>
              <div className="mt-4 md:mt-6 grid gap-2 sm:grid-cols-3">
                <button type="button" onClick={() => save(DEFAULT_CONSENT)} className="px-4 py-3 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-white/5">
                  Alle ablehnen
                </button>
                <button type="button" onClick={() => save(draft)} className="px-4 py-3 border border-[#29B6E8]/50 text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm text-xs hover:bg-[#29B6E8]/10 inline-flex items-center justify-center gap-2">
                  <Settings className="w-4 h-4" /> Auswahl speichern
                </button>
                <button type="button" onClick={() => save({ external_media: true, analytics: true, meta: true, tiktok: true })} className="px-4 py-3 bg-white text-black font-bold uppercase tracking-wider rounded-sm text-xs inline-flex items-center justify-center gap-2">
                  <Check className="w-4 h-4" /> Alle akzeptieren
                </button>
              </div>
              <div className="mt-4 text-xs text-white/45">
                Details findest du in der <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzerklärung</Link>. Speicherung der Auswahl: {MAX_AGE_DAYS} Tage.
              </div>
            </div>
          </div>
        </div>
      )}
    </CookieConsentContext.Provider>
  );
}

function ConsentRow({ title, text, checked, locked = false, onChange }) {
  return (
    <div className="py-3 md:py-4 flex items-center justify-between gap-4 md:gap-5">
      <div>
        <div className="font-heading font-black uppercase text-base md:text-lg">{title}</div>
        <div className="mt-1 text-xs text-white/50 max-w-xl">{text}</div>
      </div>
      <button
        type="button"
        disabled={locked}
        aria-pressed={checked}
        onClick={() => onChange?.(!checked)}
        className={`relative w-14 h-8 rounded-full border transition shrink-0 ${checked ? "bg-[#29B6E8] border-[#29B6E8]" : "bg-white/20 border-white/20"} ${locked ? "opacity-80 cursor-not-allowed" : "hover:border-white/50"}`}
      >
        <span className={`absolute top-1 h-6 w-6 rounded-full bg-white transition ${checked ? "left-7" : "left-1"}`} />
      </button>
    </div>
  );
}

export function useCookieConsent() {
  return useContext(CookieConsentContext);
}

export function openCookieSettings() {
  window.dispatchEvent(new Event("tls-cookie-settings"));
}
