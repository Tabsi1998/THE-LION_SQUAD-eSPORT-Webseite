import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { AuthFormAlert, AuthPasswordField, AuthTextField } from "@/components/tls/AuthFormFields";
import { toast } from "sonner";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function LoginPage() {
  useDocumentTitle("Login", "Login fuer Mitglieder und Community-User von THE LION SQUAD eSports.", { robots: "noindex, follow" });

  const { login } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});

  const setField = (field, setter) => (value) => {
    setter(value);
    setErr(null);
    setFieldErrors((current) => ({ ...current, [field]: null }));
  };

  const validate = () => {
    const errors = {};
    if (!email.trim()) errors["login-email"] = "Bitte gib deine E-Mail-Adresse ein.";
    else if (!EMAIL_RE.test(email.trim())) errors["login-email"] = "Bitte gib eine gueltige E-Mail-Adresse ein.";
    if (!pw) errors["login-password"] = "Bitte gib dein Passwort ein.";

    setFieldErrors(errors);
    const firstError = ["login-email", "login-password"].find((id) => errors[id]);
    if (firstError) document.getElementById(firstError)?.focus();
    return Object.keys(errors).length === 0;
  };

  const submit = async (event) => {
    event.preventDefault();
    if (!validate()) return;

    setErr(null);
    setLoading(true);
    const res = await login(email.trim(), pw);
    setLoading(false);

    if (res.ok) {
      toast.success("Willkommen zurueck!");
      nav(next);
    } else {
      setErr(res.error);
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="md" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">Login</h1>
        <p className="text-sm text-white/60 text-center mt-1">Willkommen bei THE LION SQUAD.</p>

        <form onSubmit={submit} className="mt-8 space-y-4" noValidate aria-describedby={err ? "login-error" : undefined}>
          <AuthTextField
            id="login-email"
            label="E-Mail"
            type="email"
            value={email}
            onChange={setField("login-email", setEmail)}
            required
            autoComplete="email"
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
          {err && <AuthFormAlert id="login-error">{err}</AuthFormAlert>}
          <button
            data-testid="login-submit"
            disabled={loading}
            type="submit"
            className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition"
          >
            {loading ? "Login ..." : "Einloggen"}
          </button>
        </form>
        <div className="mt-6 text-sm text-white/60 text-center space-y-2">
          <div>Kein Account? <Link to="/register" className="text-[#29B6E8] hover:text-white font-bold">Registrieren</Link></div>
          <div><Link to="/forgot-password" className="text-white/45 hover:text-[#29B6E8]">Passwort vergessen?</Link></div>
        </div>
      </div>
    </div>
  );
}
