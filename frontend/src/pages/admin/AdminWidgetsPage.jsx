import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { toast } from "sonner";
import { Copy, Eye } from "lucide-react";

export default function AdminWidgetsPage() {
  const [tournaments, setTournaments] = useState([]);
  const [challenges, setChallenges] = useState([]);
  const [selType, setSelType] = useState("bracket");
  const [selId, setSelId] = useState("");
  const [theme, setTheme] = useState("dark");
  const [height, setHeight] = useState(600);

  useEffect(() => {
    api.get("/tournaments").then(({ data }) => setTournaments(data));
    api.get("/f1/challenges").then(({ data }) => setChallenges(data));
  }, []);

  const base = process.env.REACT_APP_BACKEND_URL;
  const path = selType === "bracket" ? `/display/bracket/${selId}`
    : selType === "f1" ? `/display/f1/${selId}` : "";
  const url = selId ? `${base}${path}?theme=${theme}` : "";
  const iframe = url ? `<iframe src="${url}" width="100%" height="${height}" frameborder="0" style="border:none"></iframe>` : "";

  const copy = () => {
    navigator.clipboard.writeText(iframe);
    toast.success("iframe kopiert.");
  };

  const options = selType === "bracket" ? tournaments : challenges;

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">Embeds</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 mb-6">Widgets & iframes</h1>
      <div className="grid lg:grid-cols-2 gap-6">
        <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
          <Select label="Typ" value={selType} onChange={(v)=>{ setSelType(v); setSelId(""); }} options={[["bracket","Bracket"],["f1","F1 Leaderboard"]]} testId="widget-type"/>
          <Select label="Quelle" value={selId} onChange={setSelId} options={[["","— auswählen —"],...options.map(o=>[o.id, o.title])]} testId="widget-source"/>
          <Select label="Theme" value={theme} onChange={setTheme} options={[["dark","Dunkel"],["light","Hell"]]} testId="widget-theme"/>
          <Field label="Höhe (px)" type="number" value={height} onChange={(v)=>setHeight(Number(v)||600)} testId="widget-height"/>
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">iframe Code</div>
            <textarea readOnly value={iframe} rows={5} data-testid="widget-iframe" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-xs font-mono"/>
          </div>
          <div className="flex gap-2">
            <button onClick={copy} disabled={!iframe} data-testid="widget-copy" className="px-4 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2 disabled:opacity-40"><Copy className="w-3.5 h-3.5"/> Kopieren</button>
            {url && <a href={url} target="_blank" rel="noreferrer" className="px-4 py-2 border border-white/20 text-white font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-2"><Eye className="w-3.5 h-3.5"/> Vorschau</a>}
          </div>
        </div>
        <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden min-h-[400px]">
          {url ? <iframe src={url} className="w-full h-full min-h-[600px]" frameBorder="0" title="preview"/> : <div className="p-10 text-center text-white/40 font-display tracking-widest">VORSCHAU</div>}
        </div>
      </div>
    </AdminLayout>
  );
}
function Field({ label, value, onChange, type="text", testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><input type={type} value={value||""} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm"/></label>);
}
function Select({ label, value, onChange, options, testId }) {
  return (<label className="block"><div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{label}</div><select value={value} onChange={(e)=>onChange(e.target.value)} data-testid={testId} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm">{options.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>);
}
