import { useEffect, useState } from "react";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { usePrompt } from "@/components/tls/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

// Gast mit Konto verknüpfen (#1585): legt ein Gast später ein Konto an, ordnet die Turnierleitung ihn hier zu. Vorher
// steht, was passiert („3 Zeiten von Gast ‚Anna‘ gehen an Konto ‚…‘“), und ob die Versuchsgrenze dabei überschritten
// wird - das blockiert nicht. Nach der Veröffentlichung fragt die Seite nach einer Begründung (Protokoll, danach gleicht
// der Server Gewinne und Saisonpunkte an).

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

export function FastLapGuestLinkDialog({ guest, onClose, onLinked }) {
  const prompt = usePrompt();
  const [person, setPerson] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    if (!person) return undefined;
    let cancelled = false;
    api.get(`/f1/guests/${guest.id}/link-preview`, { params: { user_id: person.id } })
      .then(({ data }) => { if (!cancelled) setPreview(data); })
      .catch((failure) => { if (!cancelled) toast.error(formatRequestError(failure, "Die Vorschau ließ sich nicht laden.")); });
    return () => { cancelled = true; };
  }, [guest.id, person]);

  const submit = async () => {
    if (!person || !preview) return;
    let reason = {};
    if (preview.needs_reason) {
      const text = await prompt({
        title: "Begründung nötig",
        description: "Die Ergebnisse sind veröffentlicht. Verknüpfen geht nur mit Begründung (mind. 10 Zeichen) - sie steht im Protokoll, danach werden Gewinne und Saisonpunkte angeglichen.",
        placeholder: "z. B. Gast hat sich am Eventtag registriert",
        confirmLabel: "Mit Begründung verknüpfen",
        required: true,
      });
      const value = typeof text === "string" ? text.trim() : "";
      if (!value) return;
      reason = { change_reason: value };
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/f1/guests/${guest.id}/link`, { user_id: person.id, ...reason });
      toast.success(data?.already_linked ? "War schon verknüpft." : `${plural(data?.laps_moved || 0, "Zeit", "Zeiten")} gehören jetzt ${preview.account_name}.`);
      if (data?.resync_warning) toast.warning(data.resync_warning);
      onLinked?.(data);
      onClose?.();
    } catch (failure) {
      toast.error(formatRequestError(failure, "Der Gast ließ sich nicht verknüpfen."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose?.(); }}>
      <DialogContent className="bg-[#121212] border border-white/10 rounded-sm max-w-md w-[calc(100vw-2rem)] p-6 space-y-4 min-w-0" data-testid="fl-link-dialog">
        <div className="min-w-0 pr-6">
          <DialogTitle className="font-heading text-lg font-bold uppercase">Mit Konto verknüpfen</DialogTitle>
          <DialogDescription className="text-xs text-white/55 mt-1 truncate">Gast „{guest.name}“</DialogDescription>
        </div>
        <PersonPicker purpose="fastlap" value={person} onChange={setPerson} label="Konto" placeholder="Konto suchen …" testId="fl-link-person" />
        {preview && (
          <div className="border border-white/10 bg-black/30 rounded-sm p-3 text-sm space-y-1.5" data-testid="fl-link-preview" aria-live="polite">
            <div>
              {plural(preview.laps, "Zeit", "Zeiten")} von Gast „{preview.guest_name}“ gehen an Konto „{preview.account_name}“.
            </div>
            {preview.account_laps > 0 && <div className="text-white/55">Das Konto hat hier schon {plural(preview.account_laps, "Zeit", "Zeiten")} - beide werden zusammengeführt, es zählt die beste.</div>}
            {preview.over_limit?.map((row) => (
              <div key={row.track_id} className="text-honor">
                Hinweis: {row.track_name || "Strecke"}: {row.attempts} von {row.max_attempts} Versuchen - die Grenze wird überschritten, das ist erlaubt.
              </div>
            ))}
            <div className="text-white/45 text-xs">Danach zählt das Konto voll: Rangliste, Gewinne, Jahreswertung, Erfolge.</div>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="button" disabled={!preview || busy} onClick={submit} data-testid="fl-link-confirm" className="tls-btn tls-btn--primary flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-sm font-bold uppercase tracking-wider disabled:opacity-40">
            <Link2 className="w-4 h-4" /> Verknüpfen
          </button>
          <button type="button" onClick={onClose} className="tls-btn tls-btn--quiet px-4 py-2 rounded-sm font-bold uppercase tracking-wider">Abbrechen</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
