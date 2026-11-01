import { useCallback, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { AuthFormAlert } from "@/components/tls/AuthFormFields";
import { SideSheet } from "@/components/tls/SideSheet";
import { useLoad } from "@/hooks/useLoad";
import { useSubmissionGuard } from "@/hooks/useSubmissionGuard";

// Die eigene Turnieranmeldung ändern (#2113, L-A2): Ingame-Name, IDs und Discord bis zum Check-in. Der Server sagt mit
// `can_edit`, ob es noch geht, und nennt den Grund selbst; in Liga-Staffeln (`ids_locked`) sind Name und IDs gesperrt, und
// das Blatt sagt warum. Bei Team-Anmeldungen ändert nur die Teamleitung - die Seite zeigt den Link dann gar nicht erst.

const LABEL = "mb-1.5 text-[11px] font-bold uppercase tracking-widest text-white/60";
const INPUT = "min-h-11 w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm disabled:opacity-60 disabled:cursor-not-allowed";

function EditSheet({ tournament, details, onClose, onSaved }) {
  const fields = details.fields || [];
  const locked = !!details.ids_locked;
  const [name, setName] = useState(details.ingame_name || "");
  const [discord, setDiscord] = useState(details.discord || "");
  const [ids, setIds] = useState(details.player_ids || {});
  const [error, setError] = useState("");
  const { submitting, submitOnce } = useSubmissionGuard();

  const save = async (event) => {
    event.preventDefault();
    setError("");
    const body = { discord: discord.trim() };
    if (!locked) {
      body.ingame_name = name.trim();
      if (fields.length) body.player_ids = Object.fromEntries(fields.map((field) => [field.key, String(ids[field.key] || "").trim()]));
    }
    const attempt = await submitOnce(async () => {
      await api.patch(`/tournaments/${tournament.id}/my-registration`, body);
      toast.success("Deine Angaben sind geändert.");
      await onSaved();
    });
    if (attempt.started && attempt.error) {
      const message = formatRequestError(attempt.error, "Deine Angaben konnten nicht gespeichert werden.");
      setError(message);
      toast.error(message);
    }
  };

  return (
    <SideSheet
      title="Angaben ändern"
      eyebrow={tournament.title}
      onClose={onClose}
      testId="my-registration-sheet"
      footer={(
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="tls-btn tls-btn--quiet min-h-11 rounded-sm px-4 text-xs font-bold uppercase tracking-wider" data-testid="my-registration-cancel">Abbrechen</button>
          <button type="submit" form="my-registration-form" disabled={submitting} className="tls-btn tls-btn--primary min-h-11 rounded-sm px-5 text-xs font-bold uppercase tracking-wider disabled:opacity-50" data-testid="my-registration-save">
            {submitting ? "Speichere…" : "Speichern"}
          </button>
        </div>
      )}
    >
      <form id="my-registration-form" onSubmit={save} className="space-y-4">
        <p className="text-sm text-white/60">
          {details.is_team ? "Das gilt für die Anmeldung deines Teams." : "Das gilt nur für dieses Turnier."} Dein Profil bleibt, wie es ist.
        </p>
        {locked && <p className="rounded-sm border border-[#FFD700]/35 bg-[#FFD700]/5 p-3 text-sm text-white/75" data-testid="my-registration-locked">{details.ids_locked_reason}</p>}
        <label className="block">
          <div className={LABEL}>Ingame-Name</div>
          <input value={name} onChange={(e) => { setName(e.target.value); setError(""); }} disabled={locked} required={!locked} maxLength={64} data-testid="my-registration-name" className={INPUT} />
        </label>
        {fields.map((field) => (
          <label key={field.key} className="block">
            <div className={LABEL}>{field.label}{field.required !== false ? " *" : ""}</div>
            <input
              value={ids[field.key] || ""}
              onChange={(e) => { setIds((current) => ({ ...current, [field.key]: e.target.value })); setError(""); }}
              disabled={locked}
              required={!locked && field.required !== false}
              maxLength={128}
              placeholder={field.help_text || field.label}
              data-testid={`my-registration-id-${field.key}`}
              className={INPUT}
            />
          </label>
        ))}
        <label className="block">
          <div className={LABEL}>Discord</div>
          <input value={discord} onChange={(e) => { setDiscord(e.target.value); setError(""); }} maxLength={64} placeholder="nutzername" data-testid="my-registration-discord" className={INPUT} />
        </label>
        {error && <AuthFormAlert id="my-registration-error">{error}</AuthFormAlert>}
      </form>
    </SideSheet>
  );
}

export function MyRegistrationEdit({ tournament, registration, onSaved }) {
  const [open, setOpen] = useState(false);
  // Status mit in der Kennung: nach dem Check-in fragt die Seite neu, und der Link geht weg.
  const load = useLoad(["my-registration", tournament.id, registration.id, registration.status, tournament.status], ({ signal }) => (
    api.get(`/tournaments/${tournament.id}/my-registration`, { signal }).then(({ data }) => data)
  ));
  // Stabil, sonst holte das Blatt bei jedem Tastendruck den Fokus zurück (SideSheet hängt daran).
  const close = useCallback(() => setOpen(false), []);
  const details = load.data;
  if (!details?.can_edit) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} data-testid="my-registration-edit" className="tls-hit inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/60 hover:text-[#29B6E8]">
        <Pencil className="w-3.5 h-3.5" /> Angaben ändern
      </button>
      {open && (
        <EditSheet
          tournament={tournament}
          details={details}
          onClose={close}
          onSaved={async () => {
            setOpen(false);
            await load.reload();
            await onSaved?.();
          }}
        />
      )}
    </>
  );
}

export default MyRegistrationEdit;
