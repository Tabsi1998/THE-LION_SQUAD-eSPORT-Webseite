// Datenschutzhinweis für Gäste (#1665, Entscheidung Nr. 1): Konten ohne Mitgliedschaft sehen bei der Anmeldung den Platzhalter-Satz, bis
// der Superadmin genau den gespeicherten Wortlaut der Season nach der rechtlichen Prüfung freigibt. Ändert die Leitung den Text, gilt
// die Freigabe nicht mehr - der Server vergleicht den Wortlaut (``league_applications.privacy_text_for``).
import { useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatWhen } from "@/lib/datetime";


export function privacyReleaseState(season) {
  const text = season?.application_privacy_text || "";
  const release = season?.application_privacy_release || null;
  if (!text) return { state: "empty" };
  if (release?.text === text) return { state: "released", at: release.at };
  return { state: "open" };
}

export function SeasonPrivacyRelease({ season, seasonId, formText = "", onReload = null }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const { state, at } = privacyReleaseState(season);
  if (state === "empty") return null;
  const superadmin = user?.role === "superadmin";
  const unsaved = (formText || "") !== (season?.application_privacy_text || "");

  const send = async (released) => {
    setBusy(true);
    try {
      await api.put(`/admin/leagues/seasons/${seasonId}/privacy-release`, { released });
      toast.success(released ? "Hinweis für Gäste freigegeben." : "Freigabe für Gäste zurückgenommen.");
      await onReload?.();
    } catch (error) {
      toast.error(formatRequestError(error, "Die Freigabe ließ sich nicht speichern."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-sm border border-white/10 bg-white/[0.03] p-3 text-sm" data-testid="season-privacy-release" data-state={state}>
      {state === "released" ? (
        <p className="text-white/80">Für Gäste freigegeben am {formatWhen(at, { time: false, relative: false })}. Ändert sich der Text, sehen Gäste wieder den Platzhalter-Satz.</p>
      ) : (
        <p className="text-white/80">
          Gäste – Konten ohne Mitgliedschaft – sehen bei der Anmeldung den Platzhalter-Satz, bis der Superadmin diesen Text nach der
          rechtlichen Prüfung freigibt. Mitglieder sehen ihn sofort.
        </p>
      )}
      {superadmin ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={busy || unsaved} onClick={() => send(state !== "released")}
            className={`tls-btn ${state === "released" ? "tls-btn--quiet" : "tls-btn--secondary"} inline-flex min-h-[40px] items-center rounded-sm px-3 py-1.5 text-xs font-bold uppercase tracking-wider disabled:opacity-50`}
            data-testid="season-privacy-release-toggle">
            {state === "released" ? "Freigabe zurücknehmen" : "Für Gäste freigeben"}
          </button>
          {unsaved ? <span className="text-xs text-white/60">Erst den geänderten Text speichern.</span> : null}
        </div>
      ) : null}
    </div>
  );
}
