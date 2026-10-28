import { Pencil, Trash2, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useConfirm, usePrompt } from "@/components/tls/ConfirmDialog";

// Gästeliste (#2112): Gäste umbenennen - etwa, wenn jemand seinen Namen nicht mehr zeigen will - und doppelt angelegte
// oder nie gefahrene Gäste löschen. Mit Zeiten bleibt ein Gast stehen; nach der Veröffentlichung braucht das Umbenennen
// eine Begründung (wie jede Korrektur).
export function FastLapGuestsPanel({ guests, locked, onChanged }) {
  const confirm = useConfirm();
  const prompt = usePrompt();

  const rename = async (guest) => {
    const name = await prompt({
      title: "Gast umbenennen",
      description: "Der neue Name steht in Rangliste und Urkunde. Will der Gast nicht genannt werden, z. B. „Gast 3“ eintragen.",
      defaultValue: guest.display_name || "",
      placeholder: "Anzeigename",
      confirmLabel: "Umbenennen",
      required: true,
      multiline: false,
    });
    const text = typeof name === "string" ? name.trim() : "";
    if (!text || text === guest.display_name) return;
    let body = { display_name: text };
    if (locked) {
      const reason = await prompt({
        title: "Begründung nötig",
        description: "Die Ergebnisse sind veröffentlicht. Umbenennen geht nur mit Begründung (mind. 10 Zeichen) - sie steht im Protokoll.",
        placeholder: "z. B. Gast möchte nicht namentlich genannt werden",
        confirmLabel: "Mit Begründung speichern",
        required: true,
      });
      const why = typeof reason === "string" ? reason.trim() : "";
      if (!why) return;
      body = { ...body, change_reason: why };
    }
    try {
      await api.patch(`/f1/guests/${guest.id}`, body);
      toast.success("Gast umbenannt.");
      onChanged?.();
    } catch (error) {
      toast.error(formatRequestError(error, "Der Gast konnte nicht umbenannt werden."));
    }
  };

  const remove = async (guest) => {
    if (!await confirm({
      title: "Gast löschen?",
      description: `${guest.display_name || "Der Gast"} hat noch keine Zeiten und wird aus der Challenge und aus „Am Start / Als Nächstes“ entfernt.`,
      confirmLabel: "Gast löschen",
      tone: "danger",
    })) return;
    try {
      await api.delete(`/f1/guests/${guest.id}`);
      toast.success("Gast gelöscht.");
      onChanged?.();
    } catch (error) {
      toast.error(formatRequestError(error, "Der Gast konnte nicht gelöscht werden."));
    }
  };

  if (!guests?.length) return null;

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-5 mt-6" data-testid="f1-guests-panel" aria-labelledby="f1-guests-title">
      <h2 id="f1-guests-title" className="font-heading font-bold uppercase mb-1 text-lg">Gäste</h2>
      <p className="text-xs text-white/50 mb-3">Fahrer ohne Konto. Löschen geht nur, solange ein Gast keine Zeiten hat.</p>
      <ul className="space-y-1">
        {guests.map((guest) => (
          <li key={guest.id} data-testid={`f1-guest-${guest.id}`} className="flex items-center justify-between gap-3 border border-white/5 rounded-sm px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <UserRound className="w-4 h-4 shrink-0 text-white/40" aria-hidden="true" />
              <span className="text-sm text-white truncate">{guest.display_name}</span>
              {guest.linked_user_id && <span className="text-[9px] font-bold uppercase tracking-widest text-[#29B6E8] border border-[#29B6E8]/40 rounded-sm px-1">Verknüpft</span>}
              {!guest.has_times && <span className="text-[10px] text-white/40">ohne Zeiten</span>}
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button type="button" onClick={() => rename(guest)} data-testid={`f1-guest-rename-${guest.id}`} aria-label={`${guest.display_name} umbenennen`} title="Umbenennen" className="p-2 text-white/40 hover:text-[#29B6E8]">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {!guest.has_times && (
                <button type="button" onClick={() => remove(guest)} data-testid={`f1-guest-delete-${guest.id}`} aria-label={`${guest.display_name} löschen`} title="Gast löschen" className="p-2 text-white/40 hover:text-live">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
