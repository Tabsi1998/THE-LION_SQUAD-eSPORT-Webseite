import { useState } from "react";
import { UserX } from "lucide-react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { TextAreaField } from "@/components/tls/FormFields";

// „Beide nicht erschienen“ in einer Liga-Staffel (E.1, #1625, Nr. 27): beide verlieren, keine Punkte, keine Maps. Die
// Leitung kann das Spiel danach neu ansetzen - es geht ohne Ergebnis zurück, den Termin setzt sie wie gewohnt.
// Rechte und Befangenheit prüft der Server (Zuständigkeit „Ergebnisse korrigieren“).

const MIN_TEXT = 5;

export function DoubleNoShowAction({ match, onDone }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const scored = Boolean(match?.double_forfeit) && match?.status === "forfeit";
  const openMatch = !match?.results?.length && !["completed", "forfeit", "cancelled"].includes(String(match?.status));
  if (!match?.tournament_id || (!scored && !openMatch)) return null;
  const url = `/admin/leagues/staffeln/${match.tournament_id}/matches/${match.id}/double-no-show`;

  const submit = async (event) => {
    event.preventDefault();
    if (text.trim().length < MIN_TEXT) {
      toast.error(`Bitte eine Begründung mit mindestens ${MIN_TEXT} Zeichen angeben.`);
      return;
    }
    setSaving(true);
    try {
      if (scored) await api.delete(url, { data: { reason: text.trim() } });
      else await api.post(url, { note: text.trim() });
      toast.success(scored ? "Spiel neu angesetzt – bitte den Termin setzen." : "Gewertet: beide nicht erschienen.");
      setOpen(false);
      setText("");
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
          submitLabel={scored ? "Neu ansetzen" : "Werten"} submitTestId="match-double-no-show-save" testId="match-double-no-show-sheet">
          <p className="text-sm text-white/65">
            {scored
              ? "Die Wertung fällt weg, das Spiel ist wieder offen. Den neuen Termin setzt du danach wie gewohnt."
              : "Beide Seiten verlieren: keine Punkte, keine Maps, je Seite ein Eintrag „nicht erschienen“. Neu ansetzen geht danach hier."}
          </p>
          <div className="mt-4">
            <TextAreaField label={scored ? "Grund" : "Begründung"} rows={3} value={text} onChange={setText} required testId="match-double-no-show-text"
              hint="Steht im Protokoll." />
          </div>
        </AdminSheet>
      ) : null}
    </>
  );
}
