import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, formatApiError } from "@/lib/api";
import { Logo } from "@/components/tls/Logo";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { releaseReferrer } from "@/lib/referrerGuard";
import { ShortCaps } from "@/components/tls/ShortCaps";

// Zurück auf Einzelmails (#1662, Fabian 26.11.): der Link aus der Sammel-Mail führt hierher. Umgestellt wird erst mit dem
// Knopf - Linkvorschauen und Virenscanner öffnen den Link, ohne etwas auszulösen. Kein Login nötig; der Schlüssel taugt nur
// hierfür (backend/services/mail_digest_link.py) und ändert nur den Rhythmus der Mails.

export default function DigestInstantPage() {
  useDocumentTitle("Zurück auf Einzelmails", "Mails von THE LION SQUAD wieder einzeln bekommen.", { robots: "noindex, nofollow" });
  const [params, setParams] = useSearchParams();
  // Den Schlüssel einmal lesen und dann aus der Adresse nehmen (Verlauf, Lesezeichen, Weitergeben); er geht im Body hinaus.
  const [token] = useState(() => params.get("token") || "");
  useEffect(() => {
    if (!params.has("token")) {
      // Der Schlüssel ist aus der Adresse: „no-referrer“ wieder freigeben, damit es bei Navigation in der App nicht stehen bleibt.
      releaseReferrer();
      return;
    }
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("token");
      return next;
    }, { replace: true });
  }, [params, setParams]);
  useEffect(() => () => { releaseReferrer(); }, []);
  const [status, setStatus] = useState(token ? "ready" : "missing");
  const [message, setMessage] = useState("");

  const confirm = async () => {
    setStatus("busy");
    try {
      const { data } = await api.post("/settings/notification-digest/instant", { token });
      setStatus("done");
      setMessage(data?.already ? "Das war schon so eingestellt – deine Mails kommen einzeln." : "Erledigt – jede Mail kommt wieder einzeln, sobald etwas passiert.");
    } catch (error) {
      setStatus("error");
      setMessage(formatApiError(error.response?.data?.detail) || "Das hat nicht geklappt. Versuch es später noch einmal.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0A0A0A] text-white flex items-center justify-center p-4 sm:p-6 bg-grid">
      <div className="w-full max-w-md border border-white/10 rounded-sm bg-[#121212] p-6 sm:p-10" data-testid="digest-instant">
        <div className="flex justify-center mb-8"><Logo size="xl" /></div>
        <h1 className="tls-wrap tls-type-title text-center"><ShortCaps>Zurück auf Einzelmails</ShortCaps></h1>
        {status === "missing" ? (
          <div className="mt-6">
            <AuthFormAlert id="digest-instant-missing">Im Link fehlt der Schlüssel. Öffne den Link aus der Mail noch einmal – oder stell den Rhythmus im Profil unter Benachrichtigungen → E-Mail um.</AuthFormAlert>
          </div>
        ) : null}
        {status === "ready" || status === "busy" ? (
          <>
            <p className="tls-type-body text-white/65 text-center mt-3">Statt der Sammel-Mail bekommst du jede Mail wieder einzeln, sobald etwas passiert. Welche Themen per Mail kommen, bleibt, wie es ist.</p>
            <button type="button" onClick={confirm} disabled={status === "busy"} className="tls-btn tls-btn--primary mt-6 w-full py-3 font-bold uppercase tracking-wider rounded-sm disabled:opacity-50" data-testid="digest-instant-confirm">
              {status === "busy" ? "Stelle um …" : "Einzelmails bekommen"}
            </button>
          </>
        ) : null}
        {status === "done" ? (
          <div className="mt-6 space-y-3">
            <AuthFormAlert id="digest-instant-done" tone="success">{message}</AuthFormAlert>
            <p className="tls-type-body text-white/60">Doch lieber gesammelt? Im Profil unter Benachrichtigungen → E-Mail stellst du Täglich oder Wöchentlich jederzeit wieder ein.</p>
          </div>
        ) : null}
        {status === "error" ? (
          <div className="mt-6"><AuthFormAlert id="digest-instant-error">{message}</AuthFormAlert></div>
        ) : null}
        <div className="mt-6 tls-type-small text-center"><Link to="/" className="text-white/50 hover:text-[#29B6E8]">Zur Startseite</Link></div>
      </div>
    </div>
  );
}
