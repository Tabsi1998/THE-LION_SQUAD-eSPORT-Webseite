import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Logo } from "@/components/tls/Logo";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { AuthFormAlert, AuthPasswordField, AuthTextField } from "@/components/tls/AuthFormFields";
import { toast } from "sonner";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordPage() {
  useDocumentTitle("Passwort vergessen", "Passwort für deinen THE LION SQUAD Account zurücksetzen.", { robots: "noindex, follow" });

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const { submitting: loading, submitOnce } = useSubmissionGuard();
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");

  const setEmailValue = (value) => {
    setEmail(value);
    setFieldErrors({});
    setSubmitError("");
  };

  const validate = () => {
    const errors = {};
    if (!email.trim()) errors["forgot-email"] = "Bitte gib deine E-Mail-Adresse ein.";
    else if (!EMAIL_RE.test(email.trim())) errors["forgot-email"] = "Bitte gib eine gültige E-Mail-Adresse ein.";

    setFieldErrors(errors);
    if (errors["forgot-email"]) document.getElementById("forgot-email")?.focus();
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setSubmitError("");
    const attempt = await submitOnce(() => api.post("/auth/forgot-password", { email: email.trim() }));
    if (!attempt.started) return;
    if (!attempt.error) {
      setSent(true);
      toast.success("Wenn die E-Mail existiert, wurde ein Link gesendet.");
    } else {
      const err = attempt.error;
      const message = formatApiError(err.response?.data?.detail) || "Anfrage fehlgeschlagen.";
      setSubmitError(message);
      toast.error(message);
    }
  };

  return (
    <AuthShell title="Passwort vergessen" subtitle="Wir senden dir einen sicheren Link zum Zurücksetzen.">
      {sent ? (
        <AuthFormAlert id="forgot-success" tone="success">
          Bitte prüfe dein Postfach. Der Link ist zeitlich begrenzt gültig.
        </AuthFormAlert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <AuthTextField
            id="forgot-email"
            label="E-Mail"
            type="email"
            value={email}
            onChange={setEmailValue}
            required
            autoComplete="email"
            error={fieldErrors["forgot-email"]}
            testId="forgot-email"
          />
          {submitError && <AuthFormAlert id="forgot-submit-error">{submitError}</AuthFormAlert>}
          <button disabled={loading} data-testid="forgot-submit" className="tls-btn tls-btn--primary w-full py-3 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
            {loading ? "Sende ..." : "Link senden"}
          </button>
        </form>
      )}
      <div className="mt-6 text-sm text-center"><Link to="/login" className="text-white/50 hover:text-[#29B6E8]">Zurück zum Login</Link></div>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  useDocumentTitle("Passwort setzen", "Neues Passwort für deinen THE LION SQUAD Account vergeben.", { robots: "noindex, follow" });

  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") || "";
  const isInvite = params.get("invite") === "1";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [acceptPrivacy, setAcceptPrivacy] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const { submitting: loading, submitOnce } = useSubmissionGuard();
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitError, setSubmitError] = useState("");

  const setField = (field, setter) => (value) => {
    setter(value);
    setFieldErrors((current) => ({ ...current, [field]: null }));
    setSubmitError("");
  };

  const validate = () => {
    const errors = {};
    if (!password) errors.password = "Bitte vergib ein neues Passwort.";
    else if (password.length < 10) errors.password = "Das Passwort braucht mindestens 10 Zeichen.";
    if (!confirm) errors.confirm = "Bitte wiederhole dein Passwort.";
    else if (password !== confirm) errors.confirm = "Die Passwörter stimmen nicht überein.";
    if (isInvite && !acceptPrivacy) errors.acceptPrivacy = "Bitte akzeptiere die Datenschutzerklärung.";
    if (isInvite && !acceptTerms) errors.acceptTerms = "Bitte akzeptiere die Nutzungsbedingungen.";

    setFieldErrors(errors);
    const first = errors.password ? "reset-password" : errors.confirm ? "reset-password-confirm" : null;
    if (first) document.getElementById(first)?.focus();
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setSubmitError("");
    const attempt = await submitOnce(() => api.post("/auth/reset-password", {
      token,
      new_password: password,
      accept_privacy: isInvite ? acceptPrivacy : false,
      accept_terms: isInvite ? acceptTerms : false,
    }));
    if (!attempt.started) return;
    if (!attempt.error) {
      toast.success(isInvite ? "Account aktiviert. Du kannst dich jetzt einloggen." : "Passwort aktualisiert.");
      nav("/login");
    } else {
      const err = attempt.error;
      const message = formatApiError(err.response?.data?.detail) || "Link ungültig oder abgelaufen.";
      setSubmitError(message);
      toast.error(message);
    }
  };

  return (
    <AuthShell title={isInvite ? "Account aktivieren" : "Passwort setzen"} subtitle="Vergib ein neues Passwort für deinen Account.">
      {!token ? (
        <AuthFormAlert id="reset-token-error">
          Der Link ist unvollstaendig. Bitte fordere einen neuen Link an.
        </AuthFormAlert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <AuthPasswordField
            id="reset-password"
            label="Neues Passwort"
            value={password}
            onChange={setField("password", setPassword)}
            show={showPassword}
            onToggle={() => setShowPassword((value) => !value)}
            required
            minLength={10}
            autoComplete="new-password"
            description="Mindestens 10 Zeichen."
            error={fieldErrors.password}
            testId="reset-password"
          />
          <AuthPasswordField
            id="reset-password-confirm"
            label="Passwort wiederholen"
            value={confirm}
            onChange={setField("confirm", setConfirm)}
            show={showConfirm}
            onToggle={() => setShowConfirm((value) => !value)}
            required
            autoComplete="new-password"
            error={fieldErrors.confirm}
            testId="reset-password-confirm"
          />
          {isInvite && <div className="space-y-3 border border-white/10 rounded-sm p-4 bg-black/20">
            <label className="flex items-start gap-3 text-sm text-white/70">
              <input type="checkbox" checked={acceptPrivacy} onChange={(event) => setAcceptPrivacy(event.target.checked)} className="mt-1 accent-[#29B6E8]" />
              <span>Ich akzeptiere die <Link to="/privacy" target="_blank" className="text-[#29B6E8] underline">Datenschutzerklärung</Link>.{fieldErrors.acceptPrivacy && <span role="alert" className="block text-xs text-[#FF8A80] mt-1">{fieldErrors.acceptPrivacy}</span>}</span>
            </label>
            <label className="flex items-start gap-3 text-sm text-white/70">
              <input type="checkbox" checked={acceptTerms} onChange={(event) => setAcceptTerms(event.target.checked)} className="mt-1 accent-[#29B6E8]" />
              <span>Ich akzeptiere die <Link to="/terms" target="_blank" className="text-[#29B6E8] underline">Nutzungsbedingungen</Link>.{fieldErrors.acceptTerms && <span role="alert" className="block text-xs text-[#FF8A80] mt-1">{fieldErrors.acceptTerms}</span>}</span>
            </label>
          </div>}
          {submitError && <AuthFormAlert id="reset-submit-error">{submitError}</AuthFormAlert>}
          <button disabled={loading} data-testid="reset-submit" className="tls-btn tls-btn--primary w-full py-3 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">
            {loading ? "Speichere ..." : "Passwort speichern"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}

function AuthShell({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="md" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">{title}</h1>
        <p className="text-sm text-white/60 text-center mt-1 mb-8">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}
