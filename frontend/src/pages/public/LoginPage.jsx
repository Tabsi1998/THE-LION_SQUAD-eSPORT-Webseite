import { useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { toast } from "sonner";

export default function LoginPage() {
  const { login } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/dashboard";
  const nav = useNavigate();
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setErr(null); setLoading(true);
    const res = await login(email, pw);
    setLoading(false);
    if (res.ok) { toast.success("Willkommen zurück!"); nav(next); }
    else setErr(res.error);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="md" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">Login</h1>
        <p className="text-sm text-white/60 text-center mt-1">Willkommen bei THE LION SQUAD.</p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="E-Mail" type="email" value={email} onChange={setEmail} required testId="login-email" />
          <Field label="Passwort" type="password" value={pw} onChange={setPw} required testId="login-password" />
          {err && <div data-testid="login-error" className="text-sm text-[#FF3B30] bg-[#FF3B30]/10 border border-[#FF3B30]/30 p-2 rounded-sm">{err}</div>}
          <button
            data-testid="login-submit"
            disabled={loading}
            type="submit"
            className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition"
          >
            {loading ? "Login …" : "Einloggen"}
          </button>
        </form>
        <div className="mt-6 text-sm text-white/60 text-center space-y-2">
          <div>Kein Account? <Link to="/register" className="text-[#29B6E8] hover:text-white font-bold">Registrieren</Link></div>
          <div><Link to="/forgot-password" className="text-white/40 hover:text-[#29B6E8]">Passwort vergessen?</Link></div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        data-testid={testId}
        className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2.5 rounded-sm text-white placeholder:text-white/30 focus:outline-none"
      />
    </label>
  );
}
