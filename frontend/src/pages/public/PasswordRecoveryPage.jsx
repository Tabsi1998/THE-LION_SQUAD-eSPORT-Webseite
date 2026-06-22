import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Logo } from "@/components/tls/Logo";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { AuthFormAlert, AuthPasswordField, AuthTextField } from "@/components/tls/AuthFormFields";
import { toast } from "sonner";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function ForgotPasswordPage() {
  useDocumentTitle("Passwort vergessen", "Passwort für deinen THE LION SQUAD Account zurücksetzen.", { robots: "noindex, follow" });

  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const setEmailValue = (value) => {
    setEmail(value);
    setFieldErrors({});
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

    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim() });
      setSent(true);
      toast.success("Wenn die E-Mail existiert, wurde ein Link gesendet.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Anfrage fehlgeschlagen.");
    }
    setLoading(false);
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
          <button disabled={loading} data-testid="forgot-submit" className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition">
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
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  const setField = (field, setter) => (value) => {
    setter(value);
    setFieldErrors((current) => ({ ...current, [field]: null }));
  };

  const validate = () => {
    const errors = {};
    if (!password) errors.password = "Bitte vergib ein neues Passwort.";
    else if (password.length < 10) errors.password = "Das Passwort braucht mindestens 10 Zeichen.";
    if (!confirm) errors.confirm = "Bitte wiederhole dein Passwort.";
    else if (password !== confirm) errors.confirm = "Die Passwörter stimmen nicht überein.";

    setFieldErrors(errors);
    const first = errors.password ? "reset-password" : errors.confirm ? "reset-password-confirm" : null;
    if (first) document.getElementById(first)?.focus();
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setLoading(true);
    try {
      await api.post("/auth/reset-password", { token, new_password: password });
      toast.success(isInvite ? "Account aktiviert. Du kannst dich jetzt einloggen." : "Passwort aktualisiert.");
      nav("/login");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Link ungültig oder abgelaufen.");
    }
    setLoading(false);
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
          <button disabled={loading} data-testid="reset-submit" className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition">
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
