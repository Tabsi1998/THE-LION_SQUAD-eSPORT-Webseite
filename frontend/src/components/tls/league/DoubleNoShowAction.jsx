import { useState } from "react";
import { UserX } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";
import { ConflictReasonField, CONFLICT_REASON_MIN, OwnTeamNote, overrideMissing, overridePayload } from "./ConflictOverride";

// „Beide nicht erschienen“ in einer Liga-Staffel (E.1, #1625, Nr. 27): beide verlieren, keine Punkte, keine Maps. Die
// Leitung kann das Spiel danach neu ansetzen - es geht ohne Ergebnis zurück, den Termin setzt sie wie gewohnt.
// Rechte und Befangenheit prüft der Server (Zuständigkeit „Ergebnisse korrigieren“). ``conflict`` kommt von der Matchseite
// (``{kind: "involved", override}``): befangen ohne Notausnahme heißt der Satz statt des Knopfs, der Superadmin gibt einen Grund an.

const MIN_TEXT = 5;

export function DoubleNoShowAction({ match, conflict = null, onDone }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [conflictReason, setConflictReason] = useState("");
  const [saving, setSaving] = useState(false);
  const scored = Boolean(match?.double_forfeit) && match?.status === "forfeit";
  // Playoffs und Relegation (#2404, Nr. 217): Im K.-o. gibt es keine Wertung „beide verlieren“ - einmal neu ansetzen, beim zweiten
  // Mal scheiden beide aus. Das Spiel trägt die Art (`postseason`) und ob schon einmal neu angesetzt wurde (`no_show_retry`).
  const knockout = Boolean(match?.postseason);
  const retried = Boolean(match?.no_show_retry);
  // Nur vor dem Spiel - wie der Server: kein Beginn, keine Meldung, kein bereitliegendes Ergebnis.
  const openMatch = !match?.results?.length && ["pending", "ready", "scheduled"].includes(String(match?.status || "pending"))
    && !match?.started_at && !match?.reports?.length && !match?.pending_result;
  if (!match?.tournament_id || (!scored && !openMatch)) return null;
  if (conflict && !conflict.override) return <OwnTeamNote testId="match-double-no-show-own" />;
  const override = Boolean(conflict?.override);
  const url = `/admin/leagues/staffeln/${match.tournament_id}/matches/${match.id}/double-no-show`;

  const submit = async (event) => {
    event.preventDefault();
    if (text.trim().length < MIN_TEXT) {
      toast.error(`Bitte eine Begründung mit mindestens ${MIN_TEXT} Zeichen angeben.`);
      return;
    }
    if (overrideMissing(override, conflictReason)) {
      toast.error(`Bitte den Grund für die Notausnahme mit mindestens ${CONFLICT_REASON_MIN} Zeichen angeben.`);
      return;
    }
    setSaving(true);
    try {
      const extra = overridePayload(override, conflictReason);
      let step = "";
      if (scored) await api.delete(url, { data: { reason: text.trim(), ...extra } });
      else step = (await api.post(url, { note: text.trim(), ...extra }))?.data?.no_show_step || "";
      toast.success(scored ? "Spiel neu angesetzt – bitte den Termin setzen."
        : step === "retry" ? "Einmal neu angesetzt – bitte den Termin setzen. Kommt wieder niemand, scheiden beide aus."
          : knockout ? "Beide sind ausgeschieden. Der nächste Gegner kommt kampflos weiter." : "Gewertet: beide nicht erschienen.");
      setOpen(false);
      setText("");
      setConflictReason("");
      onDone?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
    setSaving(false);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid={scored ? "match-double-no-show-undo" : "match-double-no-show"}
        className="tls-btn tls-btn--quiet inline-flex min-h-[44px] items-center gap-1.5 rounded-sm px-3 py-2 text-[11px] font-bold uppercase tracking-wider">
        <UserX className="h-3.5 w-3.5" aria-hidden="true" /> {scored ? "Neu ansetzen" : "Beide nicht erschienen"}
      </button>
      {open ? (
        <AdminSheet title={scored ? "Spiel neu ansetzen" : "Beide nicht erschienen"} onClose={() => setOpen(false)} onSubmit={submit} saving={saving}
          submitLabel={scored || (knockout && !retried) ? "Neu ansetzen" : knockout ? "Beide ausscheiden lassen" : "Werten"} submitTestId="match-double-no-show-save" testId="match-double-no-show-sheet">
          <p className="text-sm text-white/65">
            {scored
              ? "Die Wertung fällt weg, das Spiel ist wieder offen. Den neuen Termin setzt du danach wie gewohnt."
              : knockout && !retried ? "In Playoffs und Relegation wird beim ersten Mal einmal neu angesetzt: Nichts wird gewertet, du setzt danach den neuen Termin. Kommt wieder niemand, scheiden beide aus."
                : knockout ? "Das Spiel wurde schon einmal neu angesetzt. Jetzt scheiden beide aus: Der nächste Gegner kommt kampflos weiter, im Finale bleibt der Titel unvergeben, in der Relegation bleibt alles, wie es ist. Das lässt sich nicht zurücknehmen."
                  : "Beide Seiten verlieren: keine Punkte, keine Maps, je Seite ein Eintrag „nicht erschienen“. Neu ansetzen geht danach hier."}
          </p>
          <div className="mt-4">
            <TextAreaField label={scored ? "Grund" : "Begründung"} rows={3} value={text} onChange={setText} required testId="match-double-no-show-text"
              hint="Steht im Protokoll." />
          </div>
          {override ? (
            <div className="mt-4">
              <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="match-double-no-show-conflict-reason" />
            </div>
          ) : null}
        </AdminSheet>
      ) : null}
    </>
  );
}
