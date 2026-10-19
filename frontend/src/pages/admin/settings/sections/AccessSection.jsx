// Einstellungen (#223): Abschnitt „Zugang (Passwort-Login, Registrierung)“ – nur Darstellung; Zustand und Handler bleiben in AdminSettingsPage.
import { useEffect, useState } from "react";
import { ACCESS_SWITCHES } from "../shared";
import { BrandDateTimeField, BrandNumberField } from "./parts";

// Grenzen je Netz (#1802): Schranken wie im Backend (services/auth_settings.py) – der Server prüft sie ohnehin.
const ACCESS_LIMIT_FIELDS = [
  ["login_ip_limit_per_minute", "Anmeldungen je Minute", 10, 300],
  ["register_ip_limit_per_hour", "Registrierungen je Stunde", 3, 100],
];
const ACCESS_EVENT_LIMIT_FIELDS = [
  ["event_login_ip_limit_per_minute", "Anmeldungen je Minute", 10, 1000],
  ["event_register_ip_limit_per_hour", "Registrierungen je Stunde", 3, 500],
];
const LIMIT_KEYS = [...ACCESS_LIMIT_FIELDS, ...ACCESS_EVENT_LIMIT_FIELDS].map(([key]) => key).concat(["event_limits_from", "event_limits_until"]);

function pickLimits(config) {
  return Object.fromEntries(LIMIT_KEYS.map((key) => [key, config?.[key] ?? ""]));
}

function AccessLimitsCard({ authConfig, savingAuth, saveAuth }) {
  const [draft, setDraft] = useState(() => pickLimits(authConfig));
  // Nur wenn sich die gespeicherten Grenzen ändern, neu übernehmen - ein anderer Zugangs-Schalter lässt Eingaben stehen.
  const savedLimits = JSON.stringify(pickLimits(authConfig));
  useEffect(() => { setDraft(JSON.parse(savedLimits)); }, [savedLimits]);
  const set = (key) => (value) => setDraft((current) => ({ ...current, [key]: value }));
  const field = ([key, label, min, max]) => (
    <BrandNumberField key={key} label={`${label} (${min}–${max})`} value={draft[key]} onChange={set(key)} min={min} max={max} testId={`access-limit-${key}`} />
  );

  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-4" data-testid="access-limits">
      <div>
        <div className="font-heading font-bold uppercase text-sm">Grenze je Netz</div>
        <p className="text-xs text-white/50 mt-1">
          Wie viele Anmeldungen und Registrierungen von einer Internet-Adresse aus möglich sind. Im Vereinsheim oder in der Halle teilen sich viele Handys
          eine Adresse – dann kommen bei zu kleiner Grenze auch richtige Anmeldungen nicht durch. Der Schutz je Konto (zu viele falsche Passwörter) bleibt davon unberührt.
        </p>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">{ACCESS_LIMIT_FIELDS.map(field)}</div>
      <div className="border-t border-white/5 pt-4 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-heading font-bold uppercase text-sm">Event-Zeitraum</div>
            <p className="text-xs text-white/50 mt-1">In diesem Zeitraum (höchstens drei Tage) gelten die Event-Werte, danach von selbst wieder die normalen.</p>
          </div>
          {authConfig.event_limits_active && (
            <span className="shrink-0 whitespace-nowrap text-[10px] font-bold uppercase tracking-wider text-[#00FF88]" data-testid="access-event-active">Läuft gerade</span>
          )}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <BrandDateTimeField label="Beginn" value={draft.event_limits_from} onChange={set("event_limits_from")} testId="access-event-from" />
          <BrandDateTimeField label="Ende" value={draft.event_limits_until} onChange={set("event_limits_until")} testId="access-event-until" />
          {ACCESS_EVENT_LIMIT_FIELDS.map(field)}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={savingAuth} onClick={() => saveAuth({ ...authConfig, ...draft })} className="px-4 py-2 bg-[#29B6E8] text-black text-xs font-bold uppercase rounded-sm disabled:opacity-50" data-testid="access-limits-save">
          Grenzen speichern
        </button>
        <button type="button" disabled={savingAuth || (!draft.event_limits_from && !draft.event_limits_until)} onClick={() => saveAuth({ ...authConfig, ...draft, event_limits_from: "", event_limits_until: "" })} className="px-4 py-2 border border-white/15 text-xs font-bold uppercase rounded-sm disabled:opacity-40" data-testid="access-event-clear">
          Event-Zeitraum leeren
        </button>
      </div>
    </div>
  );
}

export function AccessSection({ authSwitches, authConfig, savingAuth, saveAuth }) {
  return (
    <div className="max-w-2xl space-y-4" data-testid="access-settings">
      <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 text-sm text-white/70">
        <div className="font-heading font-bold uppercase text-[#29B6E8] mb-1">Zugang</div>
        <p>Wer sich auf Website und App anmelden und registrieren darf. Passkeys und die Zwei-Faktor-Anmeldung sind immer möglich; die Anmeldung mit Google hat ihre eigene Seite unter Verbindungen → Google.</p>
      </div>
      {authSwitches(ACCESS_SWITCHES)}
      <p className="text-xs text-white/40">Deaktivierte Optionen werden für Web und App serverseitig blockiert.</p>
      {authConfig && saveAuth && <AccessLimitsCard authConfig={authConfig} savingAuth={savingAuth} saveAuth={saveAuth} />}
    </div>
  );
}
