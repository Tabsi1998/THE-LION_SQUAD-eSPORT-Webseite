import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { AuthFormAlert, AuthPasswordField, AuthTextField } from "@/components/tls/AuthFormFields";
import { GoogleAuthButton } from "@/components/tls/GoogleAuthButton";
import { usePublicSiteSettings } from "@/hooks/usePublicSiteSettings";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { enrollPasskey, passkeyAutofillAvailable, passkeyError, passkeysSupported, signInWithPasskey, startPasskeyAutofill } from "@/lib/passkeys";
import { deviceLabel, dismissPasskeyOffer, readRemember, shouldOfferPasskey, writeRemember } from "@/lib/loginComfort";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  useDocumentTitle("Login", "Login für Mitglieder und Community-User von THE LION SQUAD eSports.", { robots: "noindex, follow" });

  const { login, completeMfa, setUser, mfaTicket, setMfaTicket } = useAuth();
  const settings = usePublicSiteSettings();
  const [params] = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [showPw, setShowPw] = useState(false);
  const { submitting: loading, submitOnce } = useSubmissionGuard();
  const [err, setErr] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [passkeysEnabled, setPasskeysEnabled] = useState(false);
  const [remember, setRemember] = useState(readRemember);
  const [offerPasskey, setOfferPasskey] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const rememberRef = useRef(remember);
  const stopAutofillRef = useRef(null);
  rememberRef.current = remember;
  useEffect(() => {
    if (passkeysSupported()) api.get("/auth/passkeys/status").then(({ data }) => setPasskeysEnabled(data.enabled === true)).catch(() => {});
  }, []);

  const finishPasskeySignIn = (data) => {
    if (data.mfa_required) {
      setMfaTicket(data.mfa_ticket);
    } else {
      setUser(data);
      toast.success("Willkommen zurück!");
      nav(next);
    }
  };

  // Gespeicherte Passkeys schlägt der Browser im E-Mail-Feld von selbst vor (#348).
  useEffect(() => {
    if (!passkeysEnabled || mfaTicket) return undefined;
    let cancelled = false;
    passkeyAutofillAvailable().then((available) => {
      if (cancelled || !available) return;
      stopAutofillRef.current = startPasskeyAutofill({
        remember: () => rememberRef.current,
        onSignedIn: finishPasskeySignIn,
        onError: (error) => setErr(passkeyError(error)),
      });
    });
    return () => {
      cancelled = true;
      stopAutofillRef.current?.();
      stopAutofillRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passkeysEnabled, mfaTicket]);

  const changeRemember = (value) => {
    setRemember(value);
    writeRemember(value);
  };

  const passkeyLogin = async () => {
    setErr(null);
    // Es darf nur eine Passkey-Anfrage geben: erst die stille beenden.
    stopAutofillRef.current?.();
    stopAutofillRef.current = null;
    const attempt = await submitOnce(() => signInWithPasskey({ remember }));
    if (!attempt.started) return;
    if (attempt.error) { setErr(passkeyError(attempt.error)); return; }
    finishPasskeySignIn(attempt.value);
  };

  // Nach einer Anmeldung mit Passwort: einmal fragen, ob es nächstes Mal ohne geht.
  const afterPasswordLogin = async () => {
    let passkeyCount = 0;
    try {
      const { data } = await api.get("/auth/passkeys");
      passkeyCount = Array.isArray(data) ? data.length : 0;
    } catch {
      passkeyCount = 1; // im Zweifel nicht fragen
    }
    if (pw && shouldOfferPasskey({ supported: passkeysSupported(), enabled: passkeysEnabled, passkeyCount })) {
      setOfferPasskey(true);
      return;
    }
    nav(next);
  };

  const answerOffer = async (answer) => {
    if (answer === "setup") {
      setEnrolling(true);
      try {
        await enrollPasskey(deviceLabel(), pw);
        toast.success("Passkey eingerichtet – nächstes Mal reicht Fingerabdruck oder Gesicht.");
      } catch (error) {
        toast.error(passkeyError(error));
        dismissPasskeyOffer("later");
      } finally {
        setEnrolling(false);
      }
    } else {
      dismissPasskeyOffer(answer);
    }
    setPw("");
    nav(next);
  };

  const setField = (field, setter) => (value) => {
    setter(value);
    setErr(null);
    setVerificationRequired(false);
    setFieldErrors((current) => ({ ...current, [field]: null }));
  };

  const validate = () => {
    const errors = {};
    if (!email.trim()) errors["login-email"] = "Bitte gib deine E-Mail-Adresse ein.";
    else if (!EMAIL_RE.test(email.trim())) errors["login-email"] = "Bitte gib eine gültige E-Mail-Adresse ein.";
    if (!pw) errors["login-password"] = "Bitte gib dein Passwort ein.";

    setFieldErrors(errors);
    const firstError = ["login-email", "login-password"].find((id) => errors[id]);
    if (firstError) document.getElementById(firstError)?.focus();
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (mfaTicket) {
      if (!mfaCode.trim()) {
        setErr("Bitte gib den sechsstelligen MFA- oder einen Wiederherstellungscode ein.");
        return;
      }
      const attempt = await submitOnce(() => completeMfa(mfaTicket, mfaCode.trim()));
      if (!attempt.started) return;
      const result = attempt.value;
      if (result?.ok) {
        toast.success("Anmeldung bestätigt.");
        await afterPasswordLogin();
      } else {
        setErr(result?.error || "MFA-Anmeldung fehlgeschlagen.");
      }
      return;
    }
    if (!validate()) return;

    setErr(null);
    stopAutofillRef.current?.();
    stopAutofillRef.current = null;
    const attempt = await submitOnce(() => login(email.trim(), pw, { remember }));
    if (!attempt.started) return;
    if (attempt.error) {
      setErr("Login konnte nicht abgeschlossen werden. Bitte versuche es erneut.");
      return;
    }
    const res = attempt.value;

    if (res.ok) {
      if (res.mfaRequired) {
        setMfaTicket(res.ticket);
        setErr(null);
        return;
      }
      toast.success("Willkommen zurück!");
      await afterPasswordLogin();
    } else {
      setErr(res.error);
      setVerificationRequired(!!res.verificationRequired);
    }
  };

  if (offerPasskey) {
    return (
      <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
        <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10" data-testid="passkey-offer">
          <div className="flex justify-center mb-8"><Logo size="xl" /></div>
          <h1 className="font-heading text-2xl font-black uppercase text-center">Nächstes Mal ohne Passwort?</h1>
          <p className="text-sm text-white/65 text-center mt-3">
            Mit einem Passkey meldest du dich auf diesem Gerät mit Fingerabdruck, Gesicht oder Geräte-PIN an – schneller und sicherer als ein Passwort.
            Dein Passwort bleibt als zweiter Weg bestehen.
          </p>
          <div className="mt-8 space-y-3">
            <button type="button" disabled={enrolling} onClick={() => answerOffer("setup")} data-testid="passkey-offer-setup"
              className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{enrolling ? "Richte ein …" : "Jetzt einrichten"}</button>
            <button type="button" disabled={enrolling} onClick={() => answerOffer("later")} data-testid="passkey-offer-later"
              className="w-full py-3 border border-white/15 text-white/80 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">Später</button>
            <button type="button" disabled={enrolling} onClick={() => answerOffer("never")} data-testid="passkey-offer-never"
              className="w-full text-xs text-white/45 hover:text-white">Nicht mehr fragen</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="xl" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">Login</h1>
        <p className="text-sm text-white/60 text-center mt-1">{mfaTicket ? "Gib den Code aus deiner Authenticator-App ein." : "Willkommen bei THE LION SQUAD."}</p>

        {mfaTicket ? (
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            <AuthTextField
              id="login-mfa-code"
              label="MFA- oder Wiederherstellungscode"
              value={mfaCode}
              onChange={(value) => { setMfaCode(value); setErr(null); }}
              autoComplete="one-time-code"
              inputMode="text"
              required
              testId="login-mfa-code"
            />
            {err && <AuthFormAlert id="login-error">{err}</AuthFormAlert>}
            <button disabled={loading} type="submit" className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50" data-testid="login-mfa-submit">
              {loading ? "Prüfe …" : "Anmeldung bestätigen"}
            </button>
            <button type="button" disabled={loading} onClick={() => { setMfaTicket(""); setMfaCode(""); setErr(null); }} className="w-full text-xs text-white/45 hover:text-white">Zurück zum Login</button>
          </form>
        ) : settings.password_login_enabled !== false ? <form onSubmit={submit} className="mt-8 space-y-4" noValidate aria-describedby={err ? "login-error" : undefined}>
          <AuthTextField
            id="login-email"
            label="E-Mail"
            type="email"
            value={email}
            onChange={setField("login-email", setEmail)}
            required
            autoComplete="username webauthn"
            error={fieldErrors["login-email"]}
            testId="login-email"
          />
          <AuthPasswordField
            id="login-password"
            label="Passwort"
            value={pw}
            onChange={setField("login-password", setPw)}
            show={showPw}
            onToggle={() => setShowPw((value) => !value)}
            required
            autoComplete="current-password"
            error={fieldErrors["login-password"]}
            testId="login-password"
          />
          <label className="flex items-start gap-2 text-sm text-white/75" htmlFor="login-remember">
            <input id="login-remember" type="checkbox" checked={remember} onChange={(e) => changeRemember(e.target.checked)} data-testid="login-remember" className="mt-0.5 accent-[#29B6E8]" />
            <span>Angemeldet bleiben <span className="block text-xs text-white/45">{remember ? "Auf diesem Gerät bleibst du angemeldet, solange du es alle paar Wochen benutzt." : "Du wirst abgemeldet, sobald du den Browser schließt – richtig für fremde Geräte."}</span></span>
          </label>
          {err && <AuthFormAlert id="login-error">{err}</AuthFormAlert>}
          {verificationRequired && (
            <div className="space-y-2 text-sm" data-testid="login-verification-recovery">
              <p className="text-white/70">Dein Konto bleibt bestehen. Bestätige zuerst deine E-Mail-Adresse; danach meldest du dich mit deinem bisherigen Passwort und gegebenenfalls MFA an.</p>
              <Link to="/verify-email" state={{ email: email.trim() }} className="inline-block py-2 text-[#29B6E8] underline">Bestätigungslink anfordern</Link>
            </div>
          )}
          <button
            data-testid="login-submit"
            disabled={loading}
            type="submit"
            className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition"
          >
            {loading ? "Login ..." : "Einloggen"}
          </button>
        </form> : (
          <div className="mt-8 border border-white/10 bg-white/5 p-4 text-sm text-white/60" data-testid="password-login-disabled">
            Die Anmeldung mit E-Mail und Passwort ist derzeit deaktiviert.
          </div>
        )}
        {!mfaTicket && <GoogleAuthButton label="Mit Google einloggen" returnPath={next} intent="login" remember={remember} />}
        {!mfaTicket && passkeysEnabled && (
          <div className="mt-4 space-y-2">
            <button type="button" disabled={loading} onClick={passkeyLogin} data-testid="login-passkey"
              className="w-full min-h-11 py-3 border border-[#29B6E8]/60 text-[#29B6E8] rounded-sm font-bold disabled:opacity-50">Mit Passkey anmelden</button>
            <p className="text-xs text-white/60 text-center">Bereits im Profil eingerichtet? Verwende deinen gespeicherten Passkey.</p>
            {settings.password_login_enabled === false && err && <AuthFormAlert id="passkey-error">{err}</AuthFormAlert>}
          </div>
        )}
        <div className="mt-6 text-sm text-white/60 text-center space-y-2">
          {settings.registration_enabled !== false && (
            <div>Kein Account? <Link to="/register" className="text-[#29B6E8] hover:text-white font-bold">Registrieren</Link></div>
          )}
          <div><Link to="/forgot-password" className="text-white/45 hover:text-[#29B6E8]">Passwort vergessen?</Link></div>
          <div><Link to="/verify-email" state={{ email: email.trim() }} className="text-white/60 hover:text-[#29B6E8]">Keine Bestätigungs-E-Mail erhalten?</Link></div>
        </div>
      </div>
    </div>
  );
}
