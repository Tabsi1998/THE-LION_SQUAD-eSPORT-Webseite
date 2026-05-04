import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Mail, Palette, Send, CheckCircle2, XCircle } from "lucide-react";

export default function AdminSettingsPage() {
  const [tab, setTab] = useState("email");
  const [email, setEmail] = useState({ resend_api_key: "", sender_name: "", sender_email: "", enabled: true, resend_api_key_masked: "" });
  const [brand, setBrand] = useState({ club_name: "", tagline: "", primary_color: "#29B6E8", logo_url: "", mascot_url: "", domain: "", timezone: "Europe/Vienna", imprint: "", privacy_policy: "" });
  const [testEmail, setTestEmail] = useState("");
  const [logs, setLogs] = useState([]);

  const load = async () => {
    const [e, b, l] = await Promise.all([
      api.get("/settings/email"),
      api.get("/settings/branding"),
      api.get("/settings/email/logs"),
    ]);
    setEmail({ ...email, ...e.data, resend_api_key: "" });
    setBrand({ ...brand, ...b.data });
    setLogs(l.data);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const saveEmail = async () => {
    const payload = { ...email };
    if (!payload.resend_api_key) delete payload.resend_api_key;
    try { await api.put("/settings/email", payload); toast.success("E-Mail-Einstellungen gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const saveBrand = async () => {
    try { await api.put("/settings/branding", brand); toast.success("Branding gespeichert."); load(); }
    catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };
  const sendTest = async () => {
    if (!testEmail) return toast.error("E-Mail-Adresse eingeben");
    try {
      const { data } = await api.post("/settings/email/test", { to: testEmail });
      if (data.ok) toast.success(`Testmail gesendet (ID: ${data.id || "—"})`);
      else toast.error(`Fehler: ${data.reason}`);
      load();
    } catch (e) { toast.error(formatApiError(e.response?.data?.detail)); }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">System</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Einstellungen</h1>

      <div className="flex gap-2 mb-6 border-b border-white/10">
        {[["email","E-Mail",Mail],["brand","Branding",Palette],["logs","Versandlogs",Send]].map(([k,l,Icn]) => (
          <button key={k} onClick={() => setTab(k)} data-testid={`settings-tab-${k}`}
            className={`px-4 py-3 text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2 ${tab===k ? "text-[#29B6E8] border-b-2 border-[#29B6E8]" : "text-white/60 hover:text-white"}`}>
            <Icn className="w-3.5 h-3.5" />{l}
          </button>
        ))}
      </div>

      {tab === "email" && (
        <div className="max-w-2xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="font-heading font-bold uppercase">Resend API</div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={email.enabled} onChange={(e)=>setEmail({...email, enabled: e.target.checked})} className="accent-[#29B6E8]" data-testid="email-enabled"/>
                <span>Versand aktiv</span>
              </label>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">API Key {email.resend_api_key_masked && <span className="text-white/40 normal-case">(aktuell: {email.resend_api_key_masked})</span>}</div>
              <input type="password" placeholder="re_..." value={email.resend_api_key} onChange={(e)=>setEmail({...email, resend_api_key: e.target.value})} data-testid="email-api-key" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono"/>
              <p className="text-xs text-white/40 mt-1">Leer lassen um den bestehenden Key beizubehalten.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absendername</div>
                <input value={email.sender_name || ""} onChange={(e)=>setEmail({...email, sender_name: e.target.value})} data-testid="email-sender-name" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="TLS ARENA"/>
              </div>
              <div>
                <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Absender-E-Mail</div>
                <input value={email.sender_email || ""} onChange={(e)=>setEmail({...email, sender_email: e.target.value})} data-testid="email-sender-email" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" placeholder="noreply@thelionsquad.at"/>
              </div>
            </div>
            <button onClick={saveEmail} data-testid="email-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
          </div>

          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <div className="font-heading font-bold uppercase">Testmail senden</div>
            <div className="flex gap-2">
              <input type="email" placeholder="test@example.com" value={testEmail} onChange={(e)=>setTestEmail(e.target.value)} data-testid="email-test-to" className="flex-1 bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
              <button onClick={sendTest} data-testid="email-test-send" className="px-4 py-2 border border-[#29B6E8] text-[#29B6E8] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Send className="w-3.5 h-3.5" /> Senden</button>
            </div>
          </div>
        </div>
      )}

      {tab === "brand" && (
        <div className="max-w-2xl space-y-4">
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
            <BrandField label="Vereinsname" value={brand.club_name} onChange={(v)=>setBrand({...brand, club_name: v})} testId="brand-club-name"/>
            <BrandField label="Tagline" value={brand.tagline} onChange={(v)=>setBrand({...brand, tagline: v})} testId="brand-tagline"/>
            <div className="grid grid-cols-2 gap-3">
              <BrandField label="Akzentfarbe (HEX)" value={brand.primary_color} onChange={(v)=>setBrand({...brand, primary_color: v})} testId="brand-color"/>
              <BrandField label="Domain" value={brand.domain} onChange={(v)=>setBrand({...brand, domain: v})} testId="brand-domain"/>
            </div>
            <BrandField label="Zeitzone" value={brand.timezone} onChange={(v)=>setBrand({...brand, timezone: v})} testId="brand-tz"/>
            <BrandField label="Logo URL" value={brand.logo_url} onChange={(v)=>setBrand({...brand, logo_url: v})} testId="brand-logo"/>
            <BrandField label="Mascot URL" value={brand.mascot_url} onChange={(v)=>setBrand({...brand, mascot_url: v})} testId="brand-mascot"/>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Impressum</div>
              <textarea value={brand.imprint || ""} onChange={(e)=>setBrand({...brand, imprint: e.target.value})} rows={4} data-testid="brand-imprint" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Datenschutz-Text</div>
              <textarea value={brand.privacy_policy || ""} onChange={(e)=>setBrand({...brand, privacy_policy: e.target.value})} rows={6} data-testid="brand-privacy" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
            </div>
            <button onClick={saveBrand} data-testid="brand-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm">Speichern</button>
          </div>
        </div>
      )}

      {tab === "logs" && (
        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[#0A0A0A] text-[11px] uppercase tracking-widest text-white/50">
              <tr><th className="text-left px-4 py-3">Zeit</th><th className="text-left px-4 py-3">An</th><th className="text-left px-4 py-3">Template</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Details</th></tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {logs.map((l)=>(
                <tr key={l.id}>
                  <td className="px-4 py-3 text-white/50 text-xs">{new Date(l.created_at).toLocaleString("de-DE")}</td>
                  <td className="px-4 py-3">{l.to}</td>
                  <td className="px-4 py-3 text-[#29B6E8] text-xs">{l.template_key}</td>
                  <td className="px-4 py-3">
                    {l.status === "sent" ? <span className="text-[#00FF88] inline-flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5"/> sent</span>
                    : l.status === "failed" ? <span className="text-[#FF3B30] inline-flex items-center gap-1"><XCircle className="w-3.5 h-3.5"/> failed</span>
                    : <span className="text-white/50">{l.status}</span>}
                  </td>
                  <td className="px-4 py-3 text-white/40 text-xs truncate">{l.error || l.message_id || "—"}</td>
                </tr>
              ))}
              {logs.length === 0 && <tr><td colSpan="5" className="text-center py-10 text-white/40">Noch keine Mails gesendet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  );
}

function BrandField({ label, value, onChange, testId }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div>
      <input value={value || ""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/>
    </label>
  );
}
