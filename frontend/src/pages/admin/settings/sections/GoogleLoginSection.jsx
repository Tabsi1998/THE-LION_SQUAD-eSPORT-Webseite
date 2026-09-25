// Einstellungen (#223): Abschnitt „Anmeldung mit Google“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { SetupGuide } from "@/components/tls/SetupGuide";
import { GOOGLE_SWITCHES } from "../shared";

export function GoogleLoginSection({ authConfig, setAuthConfig, savingAuth, testingGoogle, saveAuth, testGoogleConfig, authSwitches }) {
  return (
    <div className="max-w-2xl space-y-4" data-testid="auth-settings">
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 text-sm text-white/70">
        <div className="font-heading font-bold uppercase text-[#29B6E8] mb-1">Google</div>
        <p>Anmeldung und Registrierung mit Google über ein Google-Cloud-Projekt des Vereins; ein Client Secret ist für die Anmeldung nicht erforderlich. Die YouTube-Verknüpfung hat ihre eigene Seite unter Verbindungen → YouTube; wer sich überhaupt registrieren darf, steht unter System → Zugang.</p>
      </div>
      <SetupGuide guideKey="google_login" />
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-heading font-bold uppercase text-sm">Google Web Client ID</div>
            <p className="text-xs text-white/50 mt-1">OAuth-Client vom Typ „Webanwendung“, zum Beispiel 123….apps.googleusercontent.com.</p>
          </div>
          <span className={`text-[10px] font-bold uppercase tracking-wider ${authConfig.google_configured ? "text-[#00FF88]" : "text-[#FFD700]"}`}>
            {authConfig.google_configured ? "Konfiguriert" : "Nicht konfiguriert"}
          </span>
        </div>
        <input
          type="text"
          value={authConfig.google_client_id || ""}
          onChange={(event) => setAuthConfig((current) => ({ ...current, google_client_id: event.target.value }))}
          placeholder="123456789-abcdef.apps.googleusercontent.com"
          autoComplete="off"
          data-testid="auth-google-client-id"
          className="w-full bg-[#0A0A0A] border border-white/10 rounded-sm px-3 py-2.5 text-sm font-mono focus:border-[#29B6E8] outline-none"
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={savingAuth} onClick={() => saveAuth(authConfig)} className="px-4 py-2 bg-[#29B6E8] text-black text-xs font-bold uppercase rounded-sm disabled:opacity-50" data-testid="auth-google-save">
            Client ID speichern
          </button>
          <button type="button" disabled={testingGoogle || !authConfig.google_configured} onClick={testGoogleConfig} className="px-4 py-2 border border-white/15 text-xs font-bold uppercase rounded-sm disabled:opacity-40" data-testid="auth-google-test">
            {testingGoogle ? "Prüfe …" : "Konfiguration testen"}
          </button>
        </div>
      </div>
      {authSwitches(GOOGLE_SWITCHES)}
      <p className="text-xs text-white/40">
        Deaktivierte Optionen werden für Web und App serverseitig blockiert. Hinterlege in Google Cloud dieselbe Produktions- und Staging-Origin, die du hier verwendest.
      </p>
    </div>
  );
}
