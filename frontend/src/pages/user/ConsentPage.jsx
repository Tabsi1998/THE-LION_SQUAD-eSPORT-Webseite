import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { PublicLayout } from "@/components/tls/PublicLayout";
import { toast } from "sonner";

export default function ConsentPage() {
  const { user, refresh } = useAuth();
  const navigate = useNavigate();
  const [privacy, setPrivacy] = useState(false);
  const [terms, setTerms] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    if (!privacy || !terms) return;
    setBusy(true);
    try {
      await api.post("/auth/consent", { accept_privacy: privacy, accept_terms: terms });
      await refresh();
      toast.success("Deine Zustimmung wurde gespeichert.");
      navigate("/dashboard", { replace: true });
    } catch (error) {
      toast.error(formatRequestError(error, "Zustimmung konnte nicht gespeichert werden."));
    } finally { setBusy(false); }
  };

  return <PublicLayout>
    <main className="max-w-2xl mx-auto px-4 py-16">
      <div className="border border-[#29B6E8]/25 bg-[#121212] rounded-sm p-6 md:p-8">
        <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Datenschutz-Update</span>
        <h1 className="font-heading text-3xl font-black uppercase mt-2">Aktuelle Bedingungen bestätigen</h1>
        <p className="mt-3 text-sm text-white/60">Für deinen Account gelten aktualisierte Dokumentversionen. Bitte lies sie und bestätige sie ausdrücklich. Ohne Bestätigung bleibt der restliche Mitgliederbereich gesperrt.</p>
        <div className="mt-3 text-xs text-white/40">Datenschutz: {user?.required_privacy_policy_version || "aktuell"} · Bedingungen: {user?.required_terms_version || "aktuell"}</div>
        <form onSubmit={submit} className="mt-6 space-y-4">
          <label className="flex items-start gap-3 border border-white/10 p-4 rounded-sm">
            <input type="checkbox" checked={privacy} onChange={(event) => setPrivacy(event.target.checked)} className="mt-1 accent-[#29B6E8]" />
            <span className="text-sm">Ich habe die <Link to="/privacy" target="_blank" className="text-[#29B6E8] underline">Datenschutzerklärung</Link> gelesen und akzeptiere sie.</span>
          </label>
          <label className="flex items-start gap-3 border border-white/10 p-4 rounded-sm">
            <input type="checkbox" checked={terms} onChange={(event) => setTerms(event.target.checked)} className="mt-1 accent-[#29B6E8]" />
            <span className="text-sm">Ich akzeptiere die veröffentlichten <Link to="/terms" target="_blank" className="text-[#29B6E8] underline">Nutzungsbedingungen</Link>.</span>
          </label>
          <button disabled={busy || !privacy || !terms} className="tls-btn tls-btn--primary w-full py-3 font-black uppercase tracking-wider disabled:opacity-40">{busy ? "Speichere …" : "Bestätigen und fortfahren"}</button>
        </form>
      </div>
    </main>
  </PublicLayout>;
}
