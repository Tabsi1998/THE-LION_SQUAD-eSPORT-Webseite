import { useEffect, useState } from "react";
import { BellRing } from "lucide-react";
import { toast } from "sonner";
import { browserPushStatus, disableWebPush, enableWebPush, setWebPushPrivate, webPushPrivate } from "@/lib/webPush";
import { SwitchRow } from "./SwitchRow";

// „Dieser Browser“ (#1163): ob dieser Browser Meldungen bekommt, und der eine Knopf, der es ändert. Der Kanal „Browser“
// oben gilt für alle Browser des Kontos; hier geht es nur um den, in dem die Seite gerade offen ist.
const TEXT = {
  subscribed: "Dieser Browser ist angemeldet und bekommt deine Meldungen – auch bei geschlossener Website.",
  available: "Dieser Browser bekommt noch nichts. Melde ihn an, dann fragt dich der Browser einmal um Erlaubnis.",
  denied: "Dein Browser blockiert Benachrichtigungen für diese Website. Erlauben kannst du es in den Website-Einstellungen des Browsers (Symbol links neben der Adresse) – danach hier anmelden.",
  "ios-hint": "Am iPhone geht das nur mit der Website auf dem Home-Bildschirm: in Safari Teilen → „Zum Home-Bildschirm“, dann die Website von dort öffnen und hier anmelden.",
  unsupported: "Dieser Browser kann keine Benachrichtigungen empfangen.",
};

export function BrowserPushCard({ user, config, onChanged }) {
  const [status, setStatus] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [hidden, setHidden] = useState(() => webPushPrivate());

  useEffect(() => {
    let active = true;
    browserPushStatus(user)
      .then((value) => { if (active) setStatus(value); })
      .catch(() => { if (active) setStatus("unsupported"); });
    return () => { active = false; };
  }, [user]);

  const enable = async () => {
    setBusy(true);
    const result = await enableWebPush(user, config);
    setBusy(false);
    if (result.ok) {
      setStatus("subscribed");
      toast.success("Dieser Browser ist angemeldet.");
      onChanged?.();
      return;
    }
    if (result.reason === "denied") setStatus("denied");
    else if (result.reason !== "dismissed") toast.error("Das hat nicht geklappt. Lade die Seite neu und versuch es noch einmal.");
  };

  const disable = async () => {
    setBusy(true);
    await disableWebPush();
    setBusy(false);
    setStatus("available");
    toast.success("Dieser Browser bekommt keine Meldungen mehr.");
    onChanged?.();
  };

  const toggleHidden = async (value) => {
    setHidden(value);
    try {
      setHidden(await setWebPushPrivate(value));
    } catch {
      setHidden(!value);
      toast.error("Das hat nicht geklappt. Versuch es noch einmal.");
    }
  };

  const count = Number(config?.subscriptions || 0);
  return (
    <div className="border border-white/10 rounded-sm p-4 bg-[#0A0A0A]" data-testid="profile-browser-push" data-status={status}>
      <div className="flex flex-wrap sm:flex-nowrap items-start gap-3">
        <BellRing className={`w-5 h-5 mt-0.5 shrink-0 ${status === "subscribed" ? "text-[#29B6E8]" : "text-white/40"}`} aria-hidden="true" />
        <div className="min-w-0 flex-1 basis-[220px]">
          <div className="font-bold text-white">Dieser Browser</div>
          <p className="text-sm text-white/60 mt-1" data-testid="profile-browser-push-text">{status === "loading" ? "Wird geprüft …" : TEXT[status]}</p>
          {count > 0 ? (
            <p className="text-[11px] text-white/45 mt-1" data-testid="profile-browser-push-count">
              Angemeldet {count === 1 ? "ist 1 Browser" : `sind ${count} Browser`} deines Kontos. Abmelden vom Konto meldet den Browser ab.
            </p>
          ) : null}
        </div>
        {status === "available" ? (
          <button type="button" onClick={enable} disabled={busy} data-testid="profile-browser-push-enable" className="tls-btn tls-btn--primary shrink-0 ml-8 sm:ml-0 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-60">
            {busy ? "Einen Moment …" : "Browser anmelden"}
          </button>
        ) : null}
        {status === "subscribed" ? (
          <button type="button" onClick={disable} disabled={busy} data-testid="profile-browser-push-disable" className="tls-btn tls-btn--quiet shrink-0 ml-8 sm:ml-0 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-60">
            Browser abmelden
          </button>
        ) : null}
      </div>
      {status === "subscribed" ? (
        <div className="mt-3">
          <SwitchRow
            label="Inhalt verbergen"
            description="Dieser Browser zeigt nur „Neue Benachrichtigung“ – nichts vom Inhalt, etwa auf einem geteilten Rechner. Nachrichtentexte und Rechnungsbeträge stehen ohnehin nicht in der Meldung."
            checked={hidden}
            onCheckedChange={toggleHidden}
            testId="profile-browser-push-private"
          />
        </div>
      ) : null}
    </div>
  );
}
