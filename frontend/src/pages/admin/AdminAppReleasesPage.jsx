import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, RefreshCw, Smartphone, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { useConfirm } from "@/components/tls/ConfirmDialog";

// App-Versionen (#250): Der Server hält je Build eine APK für angemeldete
// Nutzer. Hier liegt die Liste, das aktuelle Release, die Pflicht-Grenze
// (min_build) und der Upload von Hand - das Release-Skript schickt die APK
// sonst selbst.

function formatTime(value) {
  if (!value) return "-";
  try {
    return new Date(value).toLocaleString("de-DE");
  } catch {
    return value;
  }
}

export function formatSize(bytes) {
  const size = Number(bytes || 0);
  if (!size) return "-";
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(size / 1024)} KB`;
}

export default function AdminAppReleasesPage() {
  const confirm = useConfirm();
  const [rows, setRows] = useState([]);
  const [tokenStatus, setTokenStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ version: "", build: "", notes: "", min_build: "", set_current: true, file: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, statusResult] = await Promise.all([
        api.get("/admin/app-releases"),
        api.get("/admin/app-releases/status").catch(() => ({ data: null })),
      ]);
      setRows(Array.isArray(data) ? data : []);
      setTokenStatus(statusResult?.data?.upload_token || null);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const upload = async (event) => {
    event.preventDefault();
    if (!form.file) return toast.error("Bitte eine APK auswählen.");
    if (!form.version.trim() || !form.build) return toast.error("Version und Build angeben.");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", form.file);
      body.append("version", form.version.trim());
      body.append("build", String(form.build));
      body.append("notes", form.notes);
      if (form.min_build) body.append("min_build", String(form.min_build));
      body.append("set_current", form.set_current ? "true" : "false");
      await api.post("/admin/app-releases", body, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(`Build ${form.build} liegt am Server.`);
      setForm({ version: "", build: "", notes: "", min_build: "", set_current: true, file: null });
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const patch = async (row, changes, success) => {
    try {
      await api.patch(`/admin/app-releases/${row.build}`, changes);
      toast.success(success);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const remove = async (row) => {
    if (!await confirm({ title: `Build ${row.build} löschen?`, description: "Die APK wird vom Server entfernt; das GitHub-Release bleibt.", confirmLabel: "Löschen" })) return;
    try {
      await api.delete(`/admin/app-releases/${row.build}`);
      toast.success(`Build ${row.build} entfernt.`);
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  const setMinBuild = async (row) => {
    const value = window.prompt(`Ab welchem Build ist das Update Pflicht? (0 = keine Pflicht)`, String(row.min_build || 0));
    if (value === null) return;
    const min = Number(value);
    if (!Number.isInteger(min) || min < 0) return toast.error("Bitte eine ganze Zahl eingeben.");
    await patch(row, { min_build: min }, min ? `Pflicht ab Build ${min}.` : "Keine Pflicht mehr.");
  };

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">LionsAPP</span>
          <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1">App-Versionen</h1>
          <p className="text-sm text-white/55 mt-2 max-w-2xl">
            Die App fragt hier nach und lädt das aktuelle Release mit ihrer Anmeldung – ohne GitHub am Handy.
            Das Release-Skript legt die APK nach dem Veröffentlichen selbst ab; von Hand geht es unten.
          </p>
        </div>
        <button type="button" onClick={load} className="inline-flex items-center gap-2 border border-white/10 bg-[#121212] px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider hover:border-[#29B6E8]/50">
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> Aktualisieren
        </button>
      </div>

      {tokenStatus ? (
        <div
          data-testid="app-release-token-status"
          className={`mb-6 flex items-start gap-3 rounded-sm border px-4 py-3 text-sm ${tokenStatus.configured ? "border-[#00FF88]/25 bg-[#00FF88]/5" : "border-[#FFD95A]/30 bg-[#FFD95A]/10"}`}
        >
          {tokenStatus.configured ? <CheckCircle2 className="w-4 h-4 text-[#00FF88] mt-0.5" /> : <Smartphone className="w-4 h-4 text-[#FFD95A] mt-0.5" />}
          <div>
            <div className="font-bold">
              Upload-Token am Server: {tokenStatus.configured ? `eingerichtet (${tokenStatus.length} Zeichen)` : "fehlt"}
            </div>
            <div className="text-white/55">
              {tokenStatus.configured
                ? "Das Release-Skript kann die APK nach dem Veröffentlichen selbst ablegen."
                : `${tokenStatus.env} in der Server-.env setzen (mindestens ${tokenStatus.min_length} Zeichen), docker-compose reicht es durch, danach update.sh. Bis dahin: APK unten von Hand hochladen.`}
            </div>
          </div>
        </div>
      ) : null}
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-x-auto mb-6">
        <table className="w-full text-sm" data-testid="app-releases-table">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
              <th className="text-left p-3">Build</th>
              <th className="text-left p-3">Version</th>
              <th className="text-right p-3">Größe</th>
              <th className="text-left p-3">Veröffentlicht</th>
              <th className="text-left p-3">Pflicht ab</th>
              <th className="text-left p-3">Status</th>
              <th className="text-right p-3">Aktionen</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.build} className="border-b border-white/5" data-testid={`app-release-${row.build}`}>
                <td className="p-3 font-display text-lg font-bold">{row.build}</td>
                <td className="p-3 font-mono text-xs">v{row.version}<div className="text-white/40 truncate max-w-[16rem]" title={row.sha256 || ""}>{row.sha256 ? `sha256 ${row.sha256.slice(0, 12)}…` : ""}</div></td>
                <td className="p-3 text-right">{formatSize(row.size)}</td>
                <td className="p-3 text-white/70">{formatTime(row.published_at)}</td>
                <td className="p-3">{row.min_build ? `Build ${row.min_build}` : "–"}</td>
                <td className="p-3">
                  {row.is_current ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-[#00FF88]"><CheckCircle2 className="w-3 h-3" /> aktuell</span>
                  ) : (
                    <button type="button" onClick={() => patch(row, { is_current: true }, `Build ${row.build} ist jetzt das aktuelle Release.`)} className="text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-[#29B6E8]">
                      als aktuell setzen
                    </button>
                  )}
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button type="button" onClick={() => setMinBuild(row)} className="text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-[#29B6E8] mr-3">Pflicht</button>
                  <a href={`/api/mobile/app-download/${row.build}`} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-white/60 hover:text-[#29B6E8] mr-3"><Download className="w-3 h-3" /> APK</a>
                  <button type="button" onClick={() => remove(row)} className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-[#FF6B61] hover:text-[#FF3B30]"><Trash2 className="w-3 h-3" /> Löschen</button>
                </td>
              </tr>
            ))}
            {!loading && !rows.length ? (
              <tr><td colSpan={7} className="p-6 text-center text-white/50"><span className="inline-flex items-center gap-2"><Smartphone className="w-4 h-4 text-[#29B6E8]" /> Noch kein Release am Server. Das nächste Release-Skript legt eines ab, oder du lädst unten eine APK hoch.</span></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <form onSubmit={upload} className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3 max-w-2xl" data-testid="app-release-form">
        <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Upload className="w-4 h-4 text-[#29B6E8]" /> APK von Hand hochladen</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Version</div>
            <input value={form.version} onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))} placeholder="0.5.0-beta" data-testid="app-release-version" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          </label>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Build</div>
            <input type="number" min="1" value={form.build} onChange={(e) => setForm((f) => ({ ...f, build: e.target.value }))} placeholder="63" data-testid="app-release-build" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          </label>
        </div>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Was ist neu (ein Punkt je Zeile)</div>
          <textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={4} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Pflicht ab Build (leer = keine Pflicht)</div>
            <input type="number" min="0" value={form.min_build} onChange={(e) => setForm((f) => ({ ...f, min_build: e.target.value }))} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.set_current} onChange={(e) => setForm((f) => ({ ...f, set_current: e.target.checked }))} className="accent-[#29B6E8]" />
            <span>Als aktuelles Release setzen</span>
          </label>
        </div>
        <label className="block">
          <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">APK</div>
          <input type="file" accept=".apk,application/vnd.android.package-archive" onChange={(e) => setForm((f) => ({ ...f, file: e.target.files?.[0] || null }))} data-testid="app-release-file" className="block w-full text-sm text-white/70" />
        </label>
        <button type="submit" disabled={busy} data-testid="app-release-submit" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm disabled:opacity-50">{busy ? "Lädt hoch …" : "Hochladen"}</button>
      </form>
    </AdminLayout>
  );
}
