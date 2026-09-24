import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Link2, ShieldQuestion, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { SetupGuide } from "@/components/tls/SetupGuide";
import { PLATFORM_APPS } from "@/lib/platformLinks";

// Plattform-Konten verknüpfen (#260): je Plattform die App der Website (Client ID + Secret), die
// Rückrufadresse zum Kopieren, „prüfen“ und die Anleitung. Twitch nimmt die Helix-App aus dem
// Twitch-Reiter, Steam braucht keine App. Die Schlüssel werden verschlüsselt gespeichert und nie
// wieder angezeigt; leer lassen heißt behalten. `PlatformAppCard` steht auch auf der eigenen Seite
// je Verbindung (Admin → Verbindungen).

const CHECK_ICON = { ok: [CheckCircle2, "text-[#00FF88]"], fail: [XCircle, "text-[#FF3B30]"], warn: [ShieldQuestion, "text-[#FFD700]"] };

function SecretInput({ label, value, masked, onChange, onClear, testId, placeholder }) {
  return (
    <label className="block">
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">
        {label} {masked && <span className="text-white/40 normal-case">(aktuell gespeichert)</span>}
      </div>
      <input type="password" value={value || ""} onChange={(e) => onChange(e.target.value)} data-testid={testId} autoComplete="off" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder={masked ? "Leer lassen, um das Gespeicherte zu behalten" : placeholder} />
      {masked && <button type="button" onClick={onClear} className="mt-2 text-[10px] uppercase font-bold text-[#FF6B6B]">Gespeichertes entfernen</button>}
    </label>
  );
}

// „prüfen“: der Server testet Client ID und Secret gegen die Plattform und liest bei Discord die
// Rückrufadressen der App - so steht hier, was fehlt, statt im Profil nur „geht nicht“.
function CheckResult({ platform, result }) {
  if (!result) return null;
  return (
    <ul className="mt-2 space-y-1 text-xs" data-testid={`platform-check-result-${platform}`}>
      {result.checks.map((check) => {
        const [Icon, tone] = CHECK_ICON[check.state] || CHECK_ICON.warn;
        return (
          <li key={check.key} className="flex items-start gap-2" data-testid={`platform-check-${platform}-${check.key}`}>
            <Icon className={`w-4 h-4 shrink-0 ${tone}`} />
            <span className="text-white/75"><span className={`font-bold ${tone}`}>{check.state === "ok" ? "passt" : check.state === "fail" ? "fehlt" : "Hinweis"}</span> · {check.text}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function appReady(app, brand) {
  if (!app || app.key === "steam") return true;
  return Boolean(brand[app.idField] && (brand[app.secretField] || brand[`${app.secretField}_masked`]));
}

export function PlatformAppCard({ app, brand, setBrandField, onClearSecret, onSave = null, saving = false, guideOpen = false, showGuide = true }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);
  const isReady = appReady(app, brand);
  const runCheck = async () => {
    setChecking(true);
    try {
      const { data } = await api.post(`/settings/platform-links/${app.key}/check`);
      setResult(data);
      if (data?.ok) toast.success(`${app.label}: alles passt.`);
    } catch (error) {
      toast.error(formatRequestError(error, "Die Prüfung hat nicht geklappt."));
    } finally {
      setChecking(false);
    }
  };
  return (
    <div className="border border-white/10 rounded-sm p-3 space-y-2" data-testid={`platform-app-${app.key}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-bold text-sm">{app.label}</div>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-wider ${isReady ? "text-[#00FF88]" : app.optional ? "text-white/40" : "text-[#FFD700]"}`} data-testid={`platform-link-${app.key}-state`}>{isReady ? "bereit" : app.optional ? "optional" : "fehlt"}</span>
          <button type="button" onClick={runCheck} disabled={checking} data-testid={`platform-check-${app.key}`} className="px-3 py-1 border border-white/20 text-white/80 rounded-sm text-[10px] font-bold uppercase tracking-wider hover:border-[#29B6E8]/60 hover:text-[#29B6E8] disabled:opacity-40">
            {checking ? "Prüfe …" : "prüfen"}
          </button>
        </div>
      </div>
      {app.note && <p className="text-xs text-white/45">{app.note}</p>}
      {app.tab && !onSave ? (
        <p className="text-xs text-white/55">Client ID und Secret stehen im Reiter <Link to={app.tab} className="text-[#29B6E8] hover:text-white">{app.tabLabel}</Link>.</p>
      ) : (
        <div className="grid md:grid-cols-2 gap-3">
          {app.idField && (
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{app.idLabel || `${app.label} Client ID`}</div>
              <input value={brand[app.idField] || ""} onChange={(e) => setBrandField(app.idField, e.target.value)} data-testid={app.idField.replaceAll("_", "-")} autoComplete="off" className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm font-mono" placeholder={app.idPlaceholder || "aus der Entwickler-Konsole"} />
            </label>
          )}
          {app.secretField && (
            <SecretInput label={app.secretLabel || `${app.label} Client Secret`} value={brand[app.secretField]} masked={brand[`${app.secretField}_masked`]} onChange={(v) => setBrandField(app.secretField, v)} onClear={() => onClearSecret(app.secretField)} testId={app.secretField.replaceAll("_", "-")} placeholder={app.secretPlaceholder || "Secret eintragen"} />
          )}
        </div>
      )}
      <div className="text-[11px] text-white/45 flex flex-wrap gap-x-2">
        <span>Rückrufadresse:</span>
        <code className="text-[#29B6E8] break-all">{origin}/api/platform-links/{app.key}/callback</code>
      </div>
      <CheckResult platform={app.key} result={result} />
      {onSave && (
        <button type="button" onClick={onSave} disabled={saving} data-testid={`platform-app-save-${app.key}`} className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">{saving ? "Speichere..." : "Speichern"}</button>
      )}
      {showGuide && <SetupGuide guideKey={app.guideKey} open={guideOpen} />}
    </div>
  );
}

export function PlatformLinkSettings({ brand, setBrandField, saving, onSave, onClearSecret }) {
  const readyCount = PLATFORM_APPS.filter((app) => appReady(app, brand)).length;
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="platform-link-settings">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-heading font-bold uppercase text-sm inline-flex items-center gap-2"><Link2 className="w-4 h-4 text-[#29B6E8]" /> Konten verknüpfen</div>
          <p className="text-xs text-white/50 mt-1">Mitglieder melden sich im Profil einmal bei der Plattform an – der Eintrag wird befüllt und als „verifiziert“ markiert. Dafür braucht die Website je Plattform eine eigene App (Client ID + Secret). Jede Plattform hat auch eine eigene Seite unter <Link to="/admin/integrations/discord" className="text-[#29B6E8] hover:text-white">Admin → Verbindungen</Link>. Steam braucht keine App; PlayStation, Nintendo und EA bieten keine Anmeldung für Websites, Instagram nur für Business-Konten über eine geprüfte Meta-App.</p>
        </div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-right shrink-0" data-testid="platform-link-ready-count">
          <span className="text-[#00FF88]">{readyCount}</span><span className="text-white/40"> / {PLATFORM_APPS.length} bereit</span>
        </div>
      </div>
      <div className="grid gap-3">
        {PLATFORM_APPS.map((app) => (
          <PlatformAppCard key={app.key} app={app} brand={brand} setBrandField={setBrandField} onClearSecret={onClearSecret} />
        ))}
      </div>
      <button type="button" onClick={onSave} disabled={saving} data-testid="platform-link-save" className="px-5 py-2 bg-[#29B6E8] text-black font-bold uppercase tracking-wider rounded-sm text-xs disabled:opacity-50">{saving ? "Speichere..." : "Speichern"}</button>
    </div>
  );
}
