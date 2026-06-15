import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import {
  AuthCheckboxField,
  AuthFormAlert,
  AuthPasswordField,
  AuthSelectField,
  AuthTextField,
} from "@/components/tls/AuthFormFields";
import { toast } from "sonner";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getPasswordStrength(pw) {
  if (!pw) return { score: 0, label: "", color: "" };
  let score = 0;
  if (pw.length >= 10) score++;
  if (pw.length >= 14) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  if (score <= 1) return { score, label: "Schwach", color: "#FF3B30" };
  if (score <= 2) return { score, label: "Mittel", color: "#FFD700" };
  if (score <= 3) return { score, label: "Gut", color: "#29B6E8" };
  return { score, label: "Stark", color: "#00FF88" };
}

export default function RegisterPage() {
  useDocumentTitle(
    "Registrieren",
    "Kostenlosen Community-Account bei THE LION SQUAD eSports erstellen.",
    { robots: "noindex, follow" }
  );

  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    discord_name: "",
    birth_date: "",
    gender: "",
  });
  const [showPw, setShowPw] = useState(false);
  const [accept, setAccept] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const set = (field) => (value) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErr(null);
    setFieldErrors((current) => ({ ...current, [field]: null }));
  };

  const setCheckbox = (field, setter) => (value) => {
    setter(value);
    setErr(null);
    setFieldErrors((current) => ({ ...current, [field]: null }));
  };

  const validate = () => {
    const errors = {};
    if (!form.username.trim()) errors.username = "Bitte gib einen Benutzernamen ein.";
    if (!form.email.trim()) errors.email = "Bitte gib deine E-Mail-Adresse ein.";
    else if (!EMAIL_RE.test(form.email.trim())) errors.email = "Bitte gib eine gültige E-Mail-Adresse ein.";
    if (!form.password) errors.password = "Bitte vergib ein Passwort.";
    else if (form.password.length < 10) errors.password = "Das Passwort braucht mindestens 10 Zeichen.";
    if (!accept) errors.accept = "Bitte akzeptiere die Datenschutzbestimmungen.";
    if (!acceptTerms) errors.acceptTerms = "Bitte akzeptiere die Nutzungsbedingungen.";

    setFieldErrors(errors);
    const first = ["username", "email", "password", "accept", "acceptTerms"].find((field) => errors[field]);
    const idMap = {
      username: "register-username",
      email: "register-email",
      password: "register-password",
      accept: "register-accept",
      acceptTerms: "register-accept-terms",
    };
    if (first) document.getElementById(idMap[first])?.focus();
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setErr(null);
    setLoading(true);
    const payload = {
      username: form.username.trim(),
      email: form.email.trim(),
      password: form.password,
      discord_name: form.discord_name || null,
      birth_date: form.birth_date || null,
      gender: form.gender || null,
      accept_privacy: true,
      accept_terms: true,
      newsletter_consent: newsletter,
    };
    const res = await register(payload);
    setLoading(false);

    if (res.ok) {
      toast.success("Willkommen in der TLS Community!");
      nav("/dashboard");
    } else {
      setErr(res.error);
    }
  };

  const pwStrength = getPasswordStrength(form.password);

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-lg border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="md" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">Account erstellen</h1>
        <p className="text-sm text-white/60 text-center mt-1">Werde Teil der THE LION SQUAD Community.</p>
        <form onSubmit={submit} className="mt-8 space-y-4" noValidate aria-describedby={err ? "register-error" : undefined}>
          <AuthTextField
            id="register-username"
            label="Benutzername"
            value={form.username}
            onChange={set("username")}
            required
            autoComplete="username"
            error={fieldErrors.username}
            testId="register-username"
          />
          <AuthTextField
            id="register-email"
            label="E-Mail"
            type="email"
            value={form.email}
            onChange={set("email")}
            required
            autoComplete="email"
            error={fieldErrors.email}
            testId="register-email"
          />
          <div>
            <AuthPasswordField
              id="register-password"
              label="Passwort"
              value={form.password}
              onChange={set("password")}
              show={showPw}
              onToggle={() => setShowPw((value) => !value)}
              required
              minLength={10}
              autoComplete="new-password"
              description="Mindestens 10 Zeichen. Gross-/Kleinbuchstaben, Zahlen und Sonderzeichen erhoehen die Sicherheit."
              error={fieldErrors.password}
              testId="register-password"
            />
            {form.password && (
              <div className="mt-2 flex items-center gap-2" aria-live="polite">
                <div className="flex-1 flex gap-1" aria-hidden="true">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-1 flex-1 rounded-sm transition-all duration-300"
                      style={{ backgroundColor: pwStrength.score >= i ? pwStrength.color : "rgba(255,255,255,0.08)" }}
                    />
                  ))}
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: pwStrength.color }}>
                  {pwStrength.label}
                </span>
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <AuthTextField id="register-discord" label="Discord" value={form.discord_name} onChange={set("discord_name")} autoComplete="off" description="Optional" />
            <AuthTextField id="register-birth-date" label="Geburtsdatum" type="date" value={form.birth_date} onChange={set("birth_date")} autoComplete="bday" description="Optional" />
          </div>
          <AuthSelectField id="register-gender" label="Geschlecht" value={form.gender} onChange={set("gender")} description="Optional">
            <option value="">Keine Angabe</option>
            <option value="male">Maennlich</option>
            <option value="female">Weiblich</option>
            <option value="diverse">Divers</option>
          </AuthSelectField>
          <div className="space-y-2.5 pt-2">
            <AuthCheckboxField id="register-accept" checked={accept} onChange={setCheckbox("accept", setAccept)} required error={fieldErrors.accept} testId="register-accept">
              Ich akzeptiere die <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzbestimmungen</Link>.
            </AuthCheckboxField>
            <AuthCheckboxField id="register-accept-terms" checked={acceptTerms} onChange={setCheckbox("acceptTerms", setAcceptTerms)} required error={fieldErrors.acceptTerms} testId="register-accept-terms">
              Ich akzeptiere die Nutzungsbedingungen und Vereinsregeln.
            </AuthCheckboxField>
            <AuthCheckboxField id="register-newsletter" checked={newsletter} onChange={setCheckbox("newsletter", setNewsletter)} testId="register-newsletter">
              Newsletter & Vereinsinfos per E-Mail erhalten (optional, jederzeit widerrufbar).
            </AuthCheckboxField>
          </div>
          {err && <AuthFormAlert id="register-error">{err}</AuthFormAlert>}
          <button
            data-testid="register-submit"
            disabled={loading}
            type="submit"
            className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition"
          >
            {loading ? "Registriere ..." : "Account erstellen"}
          </button>
        </form>
        <div className="mt-6 text-sm text-white/60 text-center">
          Bereits registriert? <Link to="/login" className="text-[#29B6E8] hover:text-white font-bold">Login</Link>
        </div>
        <div className="mt-3 text-[11px] text-white/45 text-center">
          Du wirst <strong className="text-white/65">Community-Spieler</strong>. Eine offizielle Vereinsmitgliedschaft kann nur durch den Vorstand freigeschaltet werden.
        </div>
      </div>
    </div>
  );
}
