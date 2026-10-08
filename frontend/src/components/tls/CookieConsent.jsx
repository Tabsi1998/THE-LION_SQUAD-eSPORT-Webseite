import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Link, useInRouterContext, useLocation } from "react-router-dom";
import { ChevronDown, X } from "lucide-react";

const STORAGE_KEY = "tls_cookie_consent_v1";
// Die Wahl gilt sechs Monate (#1226). Eine ältere, gespeicherte Wahl gilt bis zu ihrem eigenen Ablauf (expires_at).
export const MAX_AGE_DAYS = 180;
const DEFAULT_CONSENT = {
  essential: true,
  external_media: false,
  analytics: false,
  meta: false,
  tiktok: false,
};
const ALL_OPTIONAL = { external_media: true, analytics: true, meta: true, tiktok: true };

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
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ohne Speicher (privates Fenster) gilt die Wahl für diesen Besuch.
  }
  window.dispatchEvent(new CustomEvent("tls-cookie-consent-changed", { detail: payload }));
  return payload;
}

// TV und Beamer (#1110, Entscheidung vom 07.10.2026): Auf den Anzeige-Seiten erscheint kein Cookie-Hinweis - dort
// klickt niemand. Es läuft dort nur das Nötige (keine Statistik, keine fremden Inhalte), egal was gespeichert ist.
function isDisplayPath(pathname) {
  return /^\/display(?:\/|$)/.test(pathname || "");
}

function RouteWatch({ onPath }) {
  const { pathname } = useLocation();
  useEffect(() => {
    onPath(pathname);
  }, [onPath, pathname]);
  return null;
}

const OPTIONAL_ROWS = [
  { key: "external_media", title: "Externe Medien", text: "Google Maps, Twitch, YouTube oder ähnliche Einbettungen direkt auf der Seite." },
  { key: "analytics", title: "Statistik", text: "Reichweitenmessung und technische Auswertung, sofern solche Tools eingebunden werden." },
  { key: "meta", title: "Meta", text: "Facebook-/Instagram-Pixel, Meta-Embeds oder Meta-Marketing-Dienste, falls aktiv eingebunden." },
  { key: "tiktok", title: "TikTok", text: "TikTok-Pixel, TikTok-Embeds oder TikTok-Marketing-Dienste, falls aktiv eingebunden." },
];

export function CookieConsentProvider({ children }) {
  const inRouter = useInRouterContext();
  const [pathname, setPathname] = useState(() => (typeof window === "undefined" ? "" : window.location.pathname));
  const displayScreen = isDisplayPath(pathname);
  const [stored, setStored] = useState(() => readStoredConsent());
  const [open, setOpen] = useState(() => !readStoredConsent());
  const [details, setDetails] = useState(false);
  const [draft, setDraft] = useState(() => ({ ...DEFAULT_CONSENT, ...(readStoredConsent() || {}) }));

  const openSettings = useCallback(() => {
    const current = readStoredConsent();
    setDraft({ ...DEFAULT_CONSENT, ...(current || {}) });
    // Aus „Cookie-Einstellungen“ in der Fußzeile geht es gleich zu den Schaltern.
    setDetails(Boolean(current));
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
    setDetails(false);
    setOpen(false);
  }, []);

  const value = useMemo(() => ({
    consent: { ...DEFAULT_CONSENT, ...(stored || {}) },
    hasChoice: !!stored,
    openSettings,
    hasConsent: (key) => key === "essential" || (!displayScreen && !!stored?.[key]),
  }), [displayScreen, openSettings, stored]);

  return (
    <CookieConsentContext.Provider value={value}>
      {children}
      {inRouter ? <RouteWatch onPath={setPathname} /> : null}
      {open && !displayScreen && (
        // Cookie-Hinweis als schmales Blatt am unteren Rand (#1226, Variante A): keine Unschärfe, kein Fenster über der
        // Seite - der Inhalt dahinter bleibt lesbar, scrollbar und klickbar. Am Handy liegt das Blatt über der unteren
        // Leiste (.tls-cookie-sheet in index.css), ab 640 px mittig und höchstens 720 px breit.
        <div className="tls-cookie-sheet fixed inset-x-0 bottom-0 z-[80] flex justify-center p-2 sm:p-4 pointer-events-none" data-testid="cookie-sheet">
          <section
            role="dialog"
            aria-modal="false"
            aria-labelledby="cookie-sheet-title"
            className={`pointer-events-auto w-full sm:max-w-[720px] ${details ? "max-h-[70vh]" : "max-h-[33vh]"} overflow-y-auto border border-[#29B6E8]/40 bg-[#050505] rounded-sm shadow-2xl shadow-black/60 p-4 sm:p-5`}
            data-details={details ? "true" : "false"}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 id="cookie-sheet-title" className="font-heading text-sm sm:text-base font-black uppercase">Cookies und eingebettete Inhalte</h2>
                <p className="mt-1 text-xs sm:text-sm text-white/70">
                  Nötiges ist immer an. Karten, Videos und Statistik nur, wenn du willst. Mehr in der <Link to="/privacy" className="text-[#29B6E8] underline underline-offset-2 hover:text-white">Datenschutzerklärung</Link>.
                </p>
              </div>
              {stored && (
                <button type="button" onClick={() => setOpen(false)} aria-label="Schließen" className="shrink-0 text-white/45 hover:text-white"><X className="w-5 h-5" /></button>
              )}
            </div>
            {/* Zwei gleich große, gleich gestaltete Knöpfe - niemand wird zu einem der beiden gedrängt. */}
            <div className="mt-3 grid grid-cols-2 gap-2" data-testid="cookie-choices">
              <button type="button" onClick={() => save(DEFAULT_CONSENT)} data-testid="cookie-essential-only" className="tls-btn tls-btn--secondary w-full px-3 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider">
                Nur Nötiges
              </button>
              <button type="button" onClick={() => save(ALL_OPTIONAL)} data-testid="cookie-allow-all" className="tls-btn tls-btn--secondary w-full px-3 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider">
                Alle erlauben
              </button>
            </div>
            <button type="button" onClick={() => setDetails((value) => !value)} aria-expanded={details} aria-controls="cookie-sheet-details" data-testid="cookie-details-toggle"
              className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-white/65 hover:text-white underline-offset-4 hover:underline">
              Einzeln wählen <ChevronDown className={`w-3.5 h-3.5 transition-transform ${details ? "rotate-180" : ""}`} />
            </button>
            {details && (
              <div id="cookie-sheet-details" className="mt-2 divide-y divide-white/10 border-y border-white/10" data-testid="cookie-details">
                <ConsentRow title="Essentiell" text="Login, CSRF-Schutz, Formularstatus und diese Einwilligungsinfo." locked checked />
                {OPTIONAL_ROWS.map((row) => (
                  <ConsentRow
                    key={row.key}
                    title={row.title}
                    text={row.text}
                    checked={Boolean(draft[row.key])}
                    onChange={(checked) => setDraft((current) => ({ ...current, [row.key]: checked }))}
                  />
                ))}
                <div className="py-3">
                  <button type="button" onClick={() => save(draft)} data-testid="cookie-save-selection" className="tls-btn tls-btn--quiet w-full px-3 py-2.5 rounded-sm text-xs font-bold uppercase tracking-wider">
                    Auswahl speichern
                  </button>
                </div>
              </div>
            )}
            <p className="mt-2 text-[11px] text-white/60">Deine Wahl gilt sechs Monate. Ändern kannst du sie jederzeit über „Cookie-Einstellungen“ in der Fußzeile.</p>
          </section>
        </div>
      )}
    </CookieConsentContext.Provider>
  );
}

// Ein Schalter mit Namen für Vorleseprogramme (#1226): „Externe Medien erlauben“, Rolle „switch“.
function ConsentRow({ title, text, checked, locked = false, onChange }) {
  return (
    <div className="py-3 flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="font-heading font-black uppercase text-sm">{title}</div>
        <div className="mt-0.5 text-xs text-white/50">{text}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={locked ? `${title} – immer an` : `${title} erlauben`}
        disabled={locked}
        onClick={() => onChange?.(!checked)}
        className={`relative w-12 h-7 rounded-full border transition shrink-0 ${checked ? "bg-[#29B6E8] border-[#29B6E8]" : "bg-white/20 border-white/20"} ${locked ? "opacity-80 cursor-not-allowed" : "hover:border-white/50"}`}
      >
        <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition-all ${checked ? "left-6" : "left-1"}`} />
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
