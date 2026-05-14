import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { Logo } from "@/components/tls/Logo";
import { toast } from "sonner";

export default function RegisterPage() {
  const { register } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({
    username: "", email: "", password: "",
    discord_name: "", birth_date: "", gender: "",
  });
  const [accept, setAccept] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [newsletter, setNewsletter] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!accept) { setErr("Bitte akzeptiere die Datenschutzbestimmungen."); return; }
    if (!acceptTerms) { setErr("Bitte akzeptiere die Nutzungsbedingungen."); return; }
    setErr(null); setLoading(true);
    const payload = {
      username: form.username,
      email: form.email,
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
    } else setErr(res.error);
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-6 bg-grid">
      <div className="w-full max-w-lg border border-white/10 rounded-sm bg-[#121212] p-8 md:p-10">
        <div className="flex justify-center mb-8"><Logo size="md" /></div>
        <h1 className="font-heading text-2xl font-black uppercase text-center">Account erstellen</h1>
        <p className="text-sm text-white/60 text-center mt-1">Werde Teil der THE LION SQUAD Community.</p>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Benutzername *" value={form.username} onChange={set("username")} required testId="register-username" />
          <Field label="E-Mail *" type="email" value={form.email} onChange={set("email")} required testId="register-email" />
          <Field label="Passwort *" type="password" value={form.password} onChange={set("password")} required minLength={10} testId="register-password" />
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Discord (optional)" value={form.discord_name} onChange={set("discord_name")} />
            <Field label="Geburtsdatum (optional)" type="date" value={form.birth_date} onChange={set("birth_date")} />
          </div>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Geschlecht (optional)</div>
            <select value={form.gender} onChange={set("gender")} className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2.5 rounded-sm text-white focus:outline-none">
              <option value="">Keine Angabe</option>
              <option value="male">Männlich</option>
              <option value="female">Weiblich</option>
              <option value="diverse">Divers</option>
            </select>
          </label>
          <div className="space-y-2.5 pt-2">
            <label className="flex items-start gap-2 text-sm text-white/70">
              <input type="checkbox" data-testid="register-accept" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-1 accent-[#29B6E8]" />
              <span>Ich akzeptiere die <Link to="/privacy" className="text-[#29B6E8] hover:underline">Datenschutzbestimmungen</Link>. *</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-white/70">
              <input type="checkbox" data-testid="register-accept-terms" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} className="mt-1 accent-[#29B6E8]" />
              <span>Ich akzeptiere die Nutzungsbedingungen und Vereinsregeln. *</span>
            </label>
            <label className="flex items-start gap-2 text-sm text-white/70">
              <input type="checkbox" data-testid="register-newsletter" checked={newsletter} onChange={(e) => setNewsletter(e.target.checked)} className="mt-1 accent-[#29B6E8]" />
              <span>Newsletter & Vereinsinfos per E-Mail erhalten (optional, jederzeit widerrufbar).</span>
            </label>
          </div>
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
        <div className="mt-3 text-[11px] text-white/40 text-center">
          Du wirst <strong className="text-white/60">Community-Spieler</strong>. Eine offizielle Vereinsmitgliedschaft kann nur durch den Vorstand freigeschaltet werden.
        </div>
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
        onChange={onChange}
        required={required}
        minLength={minLength}
        data-testid={testId}
        className="w-full bg-[#0A0A0A] border border-white/10 focus:border-[#29B6E8] px-3 py-2.5 rounded-sm text-white focus:outline-none"
      />
    </label>
  );
}
