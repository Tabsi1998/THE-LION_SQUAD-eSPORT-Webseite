// Einstellungen (#223): Abschnitt „Zugang (Passwort-Login, Registrierung)“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { ACCESS_SWITCHES } from "../shared";

export function AccessSection({ authSwitches }) {
  return (
    <div className="max-w-2xl space-y-4" data-testid="access-settings">
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 text-sm text-white/70">
        <div className="font-heading font-bold uppercase text-[#29B6E8] mb-1">Zugang</div>
        <p>Wer sich auf Website und App anmelden und registrieren darf. Passkeys und die Zwei-Faktor-Anmeldung sind immer möglich; die Anmeldung mit Google hat ihre eigene Seite unter Verbindungen → Google.</p>
      </div>
      {authSwitches(ACCESS_SWITCHES)}
      <p className="text-xs text-white/40">Deaktivierte Optionen werden für Web und App serverseitig blockiert.</p>
    </div>
  );
}
