import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Logo } from "@/components/tls/Logo";
import { toast } from "sonner";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setSent(true);
      toast.success("Wenn die E-Mail existiert, wurde ein Link gesendet.");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Anfrage fehlgeschlagen.");
    }
    setLoading(false);
  };

  return (
    <AuthShell title="Passwort vergessen" subtitle="Wir senden dir einen sicheren Link zum Zuruecksetzen.">
      {sent ? (
        <div className="text-sm text-white/70 border border-[#00FF88]/30 bg-[#00FF88]/10 p-4 rounded-sm">
          Bitte prüfe dein Postfach. Der Link ist zeitlich begrenzt gültig.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="E-Mail" type="email" value={email} onChange={setEmail} required testId="forgot-email" />
          <button disabled={loading} data-testid="forgot-submit" className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition">
            {loading ? "Sende..." : "Link senden"}
          </button>
        </form>
      )}
      <div className="mt-6 text-sm text-center"><Link to="/login" className="text-white/50 hover:text-[#29B6E8]">Zurueck zum Login</Link></div>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const token = params.get("token") || "";
  const isInvite = params.get("invite") === "1";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 10) {
      toast.error("Passwort muss mindestens 10 Zeichen haben.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwörter stimmen nicht überein.");
      return;
    }
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
        <div className="text-sm text-[#FF3B30] border border-[#FF3B30]/30 bg-[#FF3B30]/10 p-4 rounded-sm">
          Der Link ist unvollständig. Bitte fordere einen neuen Link an.
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Neues Passwort" type="password" value={password} onChange={setPassword} required minLength={10} testId="reset-password" />
          <Field label="Passwort wiederholen" type="password" value={confirm} onChange={setConfirm} required testId="reset-password-confirm" />
          <button disabled={loading} data-testid="reset-submit" className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition">
            {loading ? "Speichere..." : "Passwort speichern"}
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

function Field({ label, value, onChange, type = "text", required, minLength, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        data-testid={testId}
        className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2.5 rounded-sm text-white placeholder:text-white/30 focus:outline-none"
      />
    </label>
  );
}
