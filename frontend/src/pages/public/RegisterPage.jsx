import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { toast } from "sonner";

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "", display_name: "" });
  const [accept, setAccept] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!accept) { setErr("Bitte akzeptiere die Datenschutzbestimmungen."); return; }
    setErr(null); setLoading(true);
    const res = await register({ ...form, accept_privacy: true });
    setLoading(false);
    if (res.ok) { toast.success("Willkommen im Rudel!"); nav("/dashboard"); }
    else setErr(res.error);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="md" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">Registrieren</h1>
        <p className="text-sm text-white/60 text-center mt-1">Join The Lion Squad.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Username" value={form.username} onChange={set("username")} required testId="register-username" />
          <Field label="Display Name" value={form.display_name} onChange={set("display_name")} testId="register-display" />
          <Field label="E-Mail" type="email" value={form.email} onChange={set("email")} required testId="register-email" />
          <Field label="Passwort" type="password" value={form.password} onChange={set("password")} required testId="register-password" />
          <label className="flex items-start gap-2 text-sm text-white/70">
            <input type="checkbox" data-testid="register-accept" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 accent-[#29B6E8]" />
            <span>Ich akzeptiere die Datenschutzbestimmungen und Regeln der TLS ARENA.</span>
          </label>
          {err && <div data-testid="register-error" className="text-sm text-[#FF3B30] bg-[#FF3B30]/10 border border-[#FF3B30]/30 p-2 rounded-sm">{err}</div>}
          <button
            data-testid="register-submit"
            disabled={loading}
            type="submit"
            className="w-full py-3 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm hover:bg-[#1E95C2] disabled:opacity-50 transition"
          >
            {loading ? "Registriere …" : "Account erstellen"}
          </button>
        </form>
        <div className="mt-6 text-sm text-white/60 text-center">
          Bereits registriert? <Link to="/login" className="text-[#29B6E8] hover:text-white font-bold">Login</Link>
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
        onChange={onChange}
        required={required}
        data-testid={testId}
        className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2.5 rounded-sm text-white focus:outline-none"
      />
    </label>
  );
}
