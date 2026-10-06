import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { enrollPasskey, passkeyError, passkeysSupported, reconcilePasskeys } from "@/lib/passkeys";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { viennaDate } from "@/lib/vienna";

export function PasskeysPanel() {
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState([]);
  const [name, setName] = useState("Mein Passkey");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const { submitting, submitOnce } = useSubmissionGuard();
  const confirm = useConfirm();

  async function load() {
    const { data } = await api.get("/auth/passkeys");
    setItems(Array.isArray(data) ? data : []);
    // Signal API (#949): was am Gerät für dieses Konto liegt, aber hier fehlt, versteckt der Passwortmanager.
    await reconcilePasskeys();
  }
  useEffect(() => {
    if (!passkeysSupported()) return;
    api.get("/auth/passkeys/status").then(async ({ data }) => {
      if (data.enabled) { setEnabled(true); await load(); }
    }).catch(() => { setFailed(true); setMessage("Passkeys konnten nicht geladen werden. Bitte die Seite erneut öffnen."); });
  }, []);

  async function perform(task, success) {
    const attempt = await submitOnce(task);
    if (!attempt.started) return;
    setPassword("");
    setFailed(Boolean(attempt.error));
    setMessage(attempt.error ? passkeyError(attempt.error) : success);
    if (!attempt.error) {
      try { await load(); } catch { setFailed(true); setMessage("Änderung gespeichert. Bitte lade die Passkey-Liste neu."); }
    }
  }

  return (
    <div className="mt-6 border border-white/10 rounded-sm p-4 space-y-4" data-testid="profile-passkeys">
      <h3 className="font-bold text-lg">Passkeys</h3>
      <p className="text-sm text-white/65">Melde dich mit Fingerabdruck, Gesichtserkennung oder Geräte-PIN an. Dein Gerät verwaltet den privaten Schlüssel. Eine eingerichtete Admin-MFA wird weiterhin abgefragt.</p>
      {!enabled ? <p className="text-sm text-white/60">Passkeys sind in diesem Browser oder für diese Website derzeit nicht verfügbar.</p> : (
        <>
          <label className="block text-sm">Bezeichnung
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} disabled={submitting}
              className="mt-1 block w-full bg-black border border-white/20 rounded-sm px-3 py-2" />
          </label>
          <label className="block text-sm">Aktuelles Passwort zur Bestätigung
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={submitting}
              className="mt-1 block w-full bg-black border border-white/20 rounded-sm px-3 py-2" />
          </label>
          <p className="text-xs text-white/60">Zum Hinzufügen oder Entfernen bestätigst du dein Passwort. Nutzt du bisher nur Google, kannst du über <Link to="/forgot-password" className="text-[#29B6E8] underline">Passwort festlegen</Link> zuerst ein Passwort einrichten.</p>
          <button type="button" disabled={submitting || !password || !name.trim()} onClick={() => perform(() => enrollPasskey(name.trim(), password), "Passkey eingerichtet. Beim nächsten Login kannst du ihn verwenden.")}
            className="tls-btn tls-btn--primary min-h-11 px-4 py-2 font-bold rounded-sm disabled:opacity-50">{submitting ? "Bitte warten …" : "Passkey hinzufügen"}</button>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="border-t border-white/10 pt-3 flex flex-wrap gap-3 items-center justify-between">
                <div><p className="text-sm font-bold">{item.name}</p><p className="text-xs text-white/55">{item.last_used_at ? `Zuletzt verwendet: ${viennaDate(item.last_used_at)}` : "Noch nicht zur Anmeldung verwendet"}</p></div>
                <button type="button" disabled={submitting || !password} className="min-h-11 px-3 text-sm text-[#FF6B62] disabled:opacity-50"
                  onClick={async () => {
                    if (!await confirm({ title: "Passkey entfernen?", description: "Dieser Passkey kann dich anschließend nicht mehr anmelden. Passwort und andere Passkeys bleiben verfügbar.", confirmText: "Entfernen", variant: "danger" })) return;
                    await perform(() => api.post(`/auth/passkeys/${encodeURIComponent(item.id)}/remove`, { current_password: password }, { skipInvalidation: true }), "Passkey entfernt.");
                  }}>Entfernen</button>
              </li>
            ))}
          </ul>
        </>
      )}
      {message && <p role="status" className={`text-sm ${failed ? "text-[#FF6B62]" : "text-[#29B6E8]"}`}>{message}</p>}
    </div>
  );
}
