import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Download, Github, RefreshCw, Smartphone, Trash2, Upload } from "lucide-react";
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

// Kanal (#309): Pre-Release auf GitHub = Beta, Release = Release; von Hand aus der Versionsnummer.
export function channelLabel(channel) {
  return channel === "beta" ? "Beta" : "Release";
}

function ChannelBadge({ channel }) {
  const beta = channel === "beta";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border text-[10px] font-black uppercase tracking-widest ${beta ? "border-[#FFD95A]/50 text-[#FFD95A] bg-[#FFD95A]/10" : "border-[#00FF88]/40 text-[#00FF88] bg-[#00FF88]/10"}`}>
      {channelLabel(channel)}
    </span>
  );
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
  // GitHub-Abgleich (#309): der Server holt sich die Releases selbst - Token, Repo, Schalter, Stand.
  const [github, setGithub] = useState(null);
  const [githubForm, setGithubForm] = useState({ token: "", repo: "" });
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ version: "", build: "", notes: "", min_build: "", set_current: true, file: null });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, statusResult, githubResult] = await Promise.all([
        api.get("/admin/app-releases"),
        api.get("/admin/app-releases/status").catch(() => ({ data: null })),
        api.get("/admin/app-releases/github").catch(() => ({ data: null })),
      ]);
      setRows(Array.isArray(data) ? data : []);
      setTokenStatus(statusResult?.data?.upload_token || null);
      setGithub(githubResult?.data && typeof githubResult.data.github_repo === "string" ? githubResult.data : null);
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

  const saveGithub = async (changes, success = "GitHub-Einstellungen gespeichert.") => {
    try {
      const { data } = await api.patch("/admin/app-releases/github", changes);
      setGithub(data);
      setGithubForm({ token: "", repo: "" });
      toast.success(success);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };
  const saveGithubForm = async () => {
    const changes = {};
    if (githubForm.token.trim()) changes.github_token = githubForm.token.trim();
    if (githubForm.repo.trim()) changes.github_repo = githubForm.repo.trim();
    if (!Object.keys(changes).length) return toast.error("Token oder Repository eintragen.");
    await saveGithub(changes, changes.github_token ? "Token gespeichert – es bleibt beim Server." : "Repository gespeichert.");
  };
  const syncGithub = async () => {
    setSyncing(true);
    try {
      const { data } = await api.post("/admin/app-releases/github/sync");
      const imported = Array.isArray(data?.imported) ? data.imported : [];
      const errors = Array.isArray(data?.errors) ? data.errors : [];
      if (data?.settings) setGithub(data.settings);
      if (imported.length) toast.success(`${imported.length} Release(s) übernommen: ${imported.map((row) => `Build ${row.build}`).join(", ")}.`);
      else if (data?.skipped) toast.error(data.skipped);
      else if (errors.length) toast.error(errors[0]);
      else toast.success("Nichts Neues auf GitHub.");
      load();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSyncing(false);
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
      {github ? (
        <div className="mb-6 rounded-sm border border-white/10 bg-[#121212] px-4 py-4 text-sm space-y-3" data-testid="app-release-github">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-bold inline-flex items-center gap-2"><Github className="w-4 h-4 text-[#29B6E8]" /> GitHub-Releases von selbst übernehmen</div>
            <button type="button" onClick={syncGithub} disabled={syncing || !github.github_token_configured} data-testid="app-release-github-sync" className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#29B6E8] text-black rounded-sm text-[11px] font-bold uppercase tracking-wider disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} /> {syncing ? "Gleicht ab …" : "Jetzt abgleichen"}
            </button>
          </div>
          <div className="text-white/55" data-testid="app-release-github-status">
            {github.github_token_unreadable
              ? "Token gespeichert, aber mit dem aktuellen Schlüssel nicht lesbar – bitte neu eintragen."
              : github.github_token_configured
                ? `Verbunden mit ${github.github_repo}`
                : "Kein Token – ein feinkörniges GitHub-Token (nur Lesen von „Contents“ dieses Repos) eintragen, dann holt der Server jedes neue mobile-v*-Release selbst."}
            {github.github_last_checked_at ? ` · geprüft ${formatTime(github.github_last_checked_at)}` : ""}
            {github.github_last_release ? ` · letztes Release ${github.github_last_release}` : ""}
          </div>
          {github.github_last_error ? <div className="text-[#FF6B61]" data-testid="app-release-github-error">{github.github_last_error}</div> : null}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">GitHub-Token (nur Lesen)</div>
              <input type="password" autoComplete="off" value={githubForm.token} onChange={(e) => setGithubForm((f) => ({ ...f, token: e.target.value }))} placeholder={github.github_token_configured ? "gespeichert – neues Token zum Ersetzen" : "github_pat_…"} data-testid="app-release-github-token" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </label>
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Repository</div>
              <input value={githubForm.repo} onChange={(e) => setGithubForm((f) => ({ ...f, repo: e.target.value }))} placeholder={github.github_repo} data-testid="app-release-github-repo" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" />
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <button type="button" onClick={saveGithubForm} data-testid="app-release-github-save" className="px-3 py-1.5 border border-white/15 rounded-sm text-[11px] font-bold uppercase tracking-wider hover:border-[#29B6E8]/60">Speichern</button>
            {github.github_token_configured ? (
              <button type="button" onClick={() => saveGithub({ clear_github_token: true }, "Token entfernt – der Abgleich stoppt.")} data-testid="app-release-github-clear" className="text-[11px] font-bold uppercase tracking-wider text-[#FF6B61] hover:text-[#FF3B30]">Token entfernen</button>
            ) : null}
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={github.github_sync_enabled} onChange={(e) => saveGithub({ github_sync_enabled: e.target.checked }, e.target.checked ? "Abgleich alle 10 Minuten ist an." : "Abgleich ist aus – nur noch „Jetzt abgleichen“.")} data-testid="app-release-github-enabled" className="accent-[#29B6E8]" />
              <span>alle {github.sync_interval_minutes || 10} Minuten abgleichen</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={github.github_rollout_betas} onChange={(e) => saveGithub({ github_rollout_betas: e.target.checked }, e.target.checked ? "Betas werden gleich ausgerollt." : "Betas landen nur in der Liste – aktuell wird erst ein Release.")} data-testid="app-release-github-betas" className="accent-[#29B6E8]" />
              <span>Betas (Pre-Releases) gleich ausrollen</span>
            </label>
          </div>
          <div className="text-white/45 text-xs">
            Pre-Release auf GitHub = Beta, Release = Release; die App zeigt die Plakette und fragt vor dem Installieren je Art. Ohne den Beta-Haken landen Betas nur in der Liste.
            Die Prüfsumme wird gegen die .sha256-Datei des Releases geprüft; das Release-Skript bleibt als Rückfall, Doppelte werden am Build erkannt.
          </div>
        </div>
      ) : null}
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-x-auto mb-6">
        <table className="w-full text-sm" data-testid="app-releases-table">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-white/40 border-b border-white/10">
              <th className="text-left p-3">Build</th>
              <th className="text-left p-3">Version</th>
              <th className="text-left p-3">Kanal</th>
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
                <td className="p-3"><ChannelBadge channel={row.channel || (String(row.version || "").endsWith("-beta") ? "beta" : "release")} />{row.source === "github" ? <div className="text-[10px] text-white/35 mt-1">von GitHub</div> : null}</td>
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
              <tr><td colSpan={8} className="p-6 text-center text-white/50"><span className="inline-flex items-center gap-2"><Smartphone className="w-4 h-4 text-[#29B6E8]" /> Noch kein Release am Server. Das nächste Release-Skript legt eines ab, oder du lädst unten eine APK hoch.</span></td></tr>
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
