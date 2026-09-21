import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";
import { toast } from "sonner";

const GOOGLE_SCRIPT_ID = "google-identity-services";

function loadGoogleIdentityServices() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(GOOGLE_SCRIPT_ID);
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google), { once: true });
      existing.addEventListener("error", () => reject(new Error("Google-Bibliothek konnte nicht geladen werden.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = GOOGLE_SCRIPT_ID;
    script.src = "https://accounts.google.com/gsi/client?hl=de";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => reject(new Error("Google-Bibliothek konnte nicht geladen werden."));
    document.head.appendChild(script);
  });
}

function safeReturnPath(value) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export function GoogleAuthButton({
  label = "Mit Google fortfahren",
  returnPath = "/dashboard",
  intent = "login",
  acceptPrivacy = false,
  acceptTerms = false,
  newsletterConsent = false,
  remember = true,
  onSuccess,
}) {
  const settings = usePublicSiteSettings();
  const { googleAuthenticate, googleLink, googleProcessing, setMfaTicket } = useAuth();
  // Der Haken „Angemeldet bleiben“ darf den Google-Knopf nicht neu aufbauen (#348).
  const rememberRef = useRef(remember);
  rememberRef.current = remember;
  const navigate = useNavigate();
  const buttonRef = useRef(null);
  const [loadError, setLoadError] = useState("");
  const isRegistration = intent === "register";
  const isLinking = intent === "link";
  const consentMissing = isRegistration && (!acceptPrivacy || !acceptTerms);
  const enabled = settings.google_configured === true
    && (isLinking ? settings.google_linking_enabled === true : settings.google_login_enabled === true)
    && (!isRegistration || settings.google_registration_enabled === true);

  useEffect(() => {
    if (!enabled || consentMissing || !buttonRef.current) return undefined;
    let active = true;
    setLoadError("");
    loadGoogleIdentityServices()
      .then((google) => {
        if (!active || !buttonRef.current) return;
        google.accounts.id.initialize({
          client_id: settings.google_client_id,
          ux_mode: "popup",
          auto_select: false,
          cancel_on_tap_outside: true,
          callback: async ({ credential }) => {
            if (!credential) return;
            const result = isLinking
              ? await googleLink(credential)
              : await googleAuthenticate(credential, { intent, acceptPrivacy, acceptTerms, newsletterConsent, remember: rememberRef.current });
            if (!result.ok) {
              toast.error(result.error);
              return;
            }
            if (result.mfaRequired) {
              setMfaTicket(result.ticket);
              navigate("/login?mfa=1");
              toast.info("Bitte bestätige die Admin-Anmeldung mit deinem zweiten Faktor.");
              return;
            }
            if (isLinking) {
              toast.success(`Google verknüpft${result.data?.google_email ? `: ${result.data.google_email}` : ""}.`);
            } else {
              toast.success(result.data?._created ? "Willkommen im Rudel! Account erstellt." : "Erfolgreich angemeldet.");
              navigate(safeReturnPath(returnPath));
            }
            onSuccess?.(result.data);
          },
        });
        buttonRef.current.replaceChildren();
        google.accounts.id.renderButton(buttonRef.current, {
          type: "standard",
          theme: "outline",
          size: "large",
          shape: "rectangular",
          text: isRegistration ? "signup_with" : "continue_with",
          logo_alignment: "left",
          locale: "de",
          width: Math.max(240, Math.min(400, buttonRef.current.clientWidth || 320)),
        });
      })
      .catch((error) => active && setLoadError(error.message));
    return () => { active = false; };
  }, [acceptPrivacy, acceptTerms, consentMissing, enabled, googleAuthenticate, googleLink, intent, isLinking, isRegistration, navigate, newsletterConsent, onSuccess, returnPath, settings.google_client_id, setMfaTicket]);

  if (!enabled) return null;
  return (
    <div className="mt-5" data-testid="google-auth-block">
      {!isLinking && (
        <div className="flex items-center gap-3 my-4">
          <span className="h-px flex-1 bg-white/10" />
          <span className="text-[10px] uppercase tracking-[0.3em] text-white/35">oder</span>
          <span className="h-px flex-1 bg-white/10" />
        </div>
      )}
      {consentMissing ? (
        <button type="button" disabled className="w-full py-3 rounded-sm bg-white/10 text-white/40 font-bold" data-testid="google-auth-button">
          Erst Datenschutz und Nutzungsbedingungen akzeptieren
        </button>
      ) : (
        <div ref={buttonRef} aria-label={label} className={`min-h-10 ${googleProcessing ? "pointer-events-none opacity-50" : ""}`} data-testid="google-auth-button" />
      )}
      {loadError && <p className="mt-2 text-xs text-[#FF6B6B]" role="alert">{loadError}</p>}
    </div>
  );
}
