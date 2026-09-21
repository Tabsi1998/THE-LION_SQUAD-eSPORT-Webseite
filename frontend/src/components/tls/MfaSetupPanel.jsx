import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";

// Zwei-Faktor ist freiwillig - außer für den Adminbereich (#348). Ob er Pflicht ist, sagt der
// Server (`required_for_admin`): Ein Bereich kann auch aus einer Freigabe, einem Vorstandsposten
// oder einer Dolibarr-Funktion kommen, nicht nur aus der Rolle.
export function MfaSetupPanel({ onChanged, highlight = false }) {
  const [status, setStatus] = useState(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState(null);
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/auth/mfa/status");
      setStatus(data);
    } catch {}
  }, []);
  useEffect(() => { load(); }, [load]);
  const required = !!status?.required_for_admin;

  const begin = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/mfa/setup", { current_password: password });
      setSetup(data);
      setPassword("");
      setCode("");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail) || "MFA-Einrichtung fehlgeschlagen.");
    } finally { setBusy(false); }
  };

  const enable = async () => {
    setBusy(true);
    try {
      const { data } = await api.post("/auth/mfa/enable", { code });
      setRecoveryCodes(data.recovery_codes || []);
      setSetup(null);
      setCode("");
      await load();
      await onChanged?.();
      toast.success("MFA aktiviert. Speichere jetzt die Wiederherstellungscodes.");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail) || "Code ist ungültig.");
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true);
    try {
      await api.post("/auth/mfa/disable", { current_password: password, code });
      setPassword("");
      setCode("");
      await onChanged?.();
      toast.success("MFA deaktiviert. Bitte melde dich neu an.");
      window.location.assign("/login");
    } catch (error) {
      toast.error(formatApiError(error.response?.data?.detail) || "MFA konnte nicht deaktiviert werden.");
    } finally { setBusy(false); }
  };

  const copyRecoveryCodes = async () => {
    await navigator.clipboard.writeText(recoveryCodes.join("\n"));
    toast.success("Wiederherstellungscodes kopiert.");
  };

  return (
    <div className={`border rounded-sm p-5 space-y-4 ${required || highlight ? "border-[#FFD700]/40 bg-[#FFD700]/5" : "border-white/10 bg-[#0A0A0A]"}`} data-testid="profile-mfa-panel">
      <div>
        <h3 className="font-heading font-black uppercase">Zwei-Faktor-Anmeldung</h3>
        <p className="text-xs text-white/55 mt-1" data-testid="profile-mfa-intro">
          {required
            ? "Für deinen Adminbereich Pflicht. Du brauchst eine Authenticator-App (z. B. Google Authenticator, Aegis, 2FAS); die Einmalcodes bewahrst du offline auf."
            : "Freiwillig. Beim Anmelden fragt die Seite dann zusätzlich nach einem Code aus deiner Authenticator-App. Ein Passkey schützt dein Konto genauso gut und ist bequemer."}
        </p>
      </div>
      {recoveryCodes.length > 0 ? (
        <div className="space-y-3">
          <div className="text-sm text-[#FFD700] font-bold">Diese Codes werden nur einmal angezeigt.</div>
          <pre className="grid grid-cols-2 gap-2 bg-black/40 border border-white/10 p-4 text-center text-sm tracking-wider select-all">{recoveryCodes.join("\n")}</pre>
          <button type="button" onClick={copyRecoveryCodes} className="px-4 py-2 bg-[#FFD700] text-black text-xs font-bold uppercase rounded-sm">Codes kopieren</button>
        </div>
      ) : status?.enabled ? (
        <div className="space-y-3">
          <p className="text-sm text-[#00FF88]">MFA ist aktiviert · {status.recovery_codes_remaining} Wiederherstellungscodes verbleiben.</p>
          {required && !status.session_verified && <p className="text-xs text-[#FFD700]">Melde dich einmal neu an, um den Adminbereich freizuschalten.</p>}
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Aktuelles Passwort" autoComplete="current-password" className="w-full bg-black/40 border border-white/10 px-3 py-2.5" />
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="MFA- oder Wiederherstellungscode" autoComplete="one-time-code" className="w-full bg-black/40 border border-white/10 px-3 py-2.5" />
          <button type="button" disabled={busy || !password || !code} onClick={disable} className="px-4 py-2 border border-[#FF3B30]/50 text-[#FF6B6B] text-xs font-bold uppercase disabled:opacity-40">MFA deaktivieren</button>
        </div>
      ) : setup ? (
        <div className="space-y-4">
          <div className="bg-white p-3 w-fit"><QRCodeSVG value={setup.provisioning_uri} size={180} level="M" /></div>
          <div><div className="text-xs text-white/45">Manueller Schlüssel</div><code className="text-sm break-all select-all">{setup.secret}</code></div>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Sechsstelliger Code" inputMode="numeric" autoComplete="one-time-code" className="w-full bg-black/40 border border-white/10 px-3 py-2.5" />
          <button type="button" disabled={busy || !code} onClick={enable} className="px-4 py-2 bg-[#29B6E8] text-black text-xs font-bold uppercase disabled:opacity-40">MFA bestätigen</button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className={`text-sm ${required ? "text-[#FFD700]" : "text-white/60"}`}>{required ? "Noch nicht eingerichtet. Bis dahin bleibt dein Adminbereich gesperrt." : "Noch nicht eingerichtet."}</p>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Aktuelles Passwort" autoComplete="current-password" className="w-full bg-black/40 border border-white/10 px-3 py-2.5" />
          <button type="button" disabled={busy || !password} onClick={begin} className="px-4 py-2 bg-[#FFD700] text-black text-xs font-bold uppercase disabled:opacity-40">MFA einrichten</button>
        </div>
      )}
    </div>
  );
}
