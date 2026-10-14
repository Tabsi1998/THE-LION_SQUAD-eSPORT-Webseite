// Disqualifikation und Austritt (#1553): zwei Knöpfe in der Teilnehmerliste der Turnierverwaltung. Der erste Klick
// holt den Umbauplan vom Server (`POST /registrations/{id}/removal` ohne Kennung) und zeigt ihn in Worten - „E: Lena
// kommt kampflos weiter.“ -, der zweite bestätigt ihn mit der Kennung des Vorschlags. Abbrechen lehnt den Vorschlag ab,
// damit er nicht am Turnier liegen bleibt. Nur für Strukturrollen (`can_manage_structure`), nur während das Turnier
// läuft, nur für Personen, die noch dabei sind.
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";

const ACTIVE_TOURNAMENT_STATUSES = new Set(["check_in", "live", "paused"]);
const REMOVABLE_REGISTRATION_STATUSES = new Set(["approved", "checked_in"]);

const KIND_LABELS = {
  withdrawn: { button: "Austritt", confirm: "Austritt eintragen", busy: "Wird eingetragen …" },
  disqualified: { button: "Disqualifizieren", confirm: "Disqualifizieren", busy: "Wird disqualifiziert …" },
};
const OP_LABELS = {
  walkover: "Kampflos",
  forfeit: "Wertung",
  slot_cleared: "Platz frei",
  annulled: "Annulliert",
  cancelled: "Entfällt",
  readvanced: "Rückt nach",
};
const OP_FALLBACK = {
  walkover: "Der Gegner kommt kampflos weiter.",
  forfeit: "Das Spiel wird kampflos verloren gewertet.",
  slot_cleared: "Der Platz wird frei.",
  annulled: "Das Spiel wird annulliert.",
  cancelled: "Das Spiel entfällt.",
  readvanced: "Der Nächstplatzierte rückt nach.",
};

export function registrationName(registration) {
  return registration?.display_name || registration?.user?.display_name || registration?.ingame_name || "Diese Person";
}

export function headline(kind, name) {
  return kind === "withdrawn" ? `Austritt von ${name} eintragen?` : `${name} disqualifizieren?`;
}

export function ParticipantRemovalActions({ tournament, registration, onDone, compact = false }) {
  const [plan, setPlan] = useState(null);
  const [kind, setKind] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState("");
  const reasonId = useId();
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!plan) return undefined;
    confirmRef.current?.focus();
    // Escape schließt und lehnt ab - wie „Abbrechen“.
    const onKey = (event) => {
      if (event.key === "Escape") cancelRef.current?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [plan]);

  if (!tournament?.can_manage_structure || !ACTIVE_TOURNAMENT_STATUSES.has(String(tournament?.status || ""))) return null;
  if (!REMOVABLE_REGISTRATION_STATUSES.has(String(registration?.status || ""))) return null;

  const url = `/tournaments/${tournament.id}/registrations/${registration.id}/removal`;
  const name = registrationName(registration);

  const propose = async (nextKind) => {
    setBusy(nextKind);
    try {
      const { data } = await api.post(url, { kind: nextKind, reason: null });
      if (data?.idempotent_replay && !data?.plan) {
        toast.message(`${name} ist schon ${nextKind === "withdrawn" ? "ausgetreten" : "disqualifiziert"}.`);
        onDone?.();
        return;
      }
      setKind(nextKind);
      setReason("");
      setPlan(data?.plan || { id: null, ops: [], summary: "" });
    } catch (error) {
      toast.error(formatRequestError(error, "Der Umbauplan konnte nicht berechnet werden."));
    } finally {
      setBusy("");
    }
  };

  const confirm = async () => {
    if (!plan?.id) return;
    setBusy("confirm");
    try {
      await api.post(url, { kind, plan_id: plan.id, reason: reason.trim() || null });
      toast.success(kind === "withdrawn" ? `Austritt von ${name} eingetragen.` : `${name} wurde disqualifiziert.`);
      setPlan(null);
      onDone?.();
    } catch (error) {
      toast.error(formatRequestError(error, "Der Umbau konnte nicht angewendet werden."));
      // Ein veralteter Vorschlag (409) liegt neu berechnet am Turnier - die Seite lädt neu, der Dialog geht zu.
      setPlan(null);
      onDone?.();
    } finally {
      setBusy("");
    }
  };

  const cancel = async () => {
    const planId = plan?.id;
    setPlan(null);
    if (!planId) return;
    try {
      await api.post(`${url}/reject`, { plan_id: planId });
    } catch {
      // Ein liegen gebliebener Vorschlag stört nicht: der nächste Klick ersetzt ihn.
    }
  };
  cancelRef.current = cancel;

  const buttonClass = compact
    ? "px-2 py-2 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase disabled:opacity-50"
    : "px-2 py-1 border border-[#FF3B30]/40 text-[#FF3B30] rounded-sm text-[10px] font-bold uppercase disabled:opacity-50";
  const ops = Array.isArray(plan?.ops) ? plan.ops.filter(Boolean) : [];
  const labels = KIND_LABELS[kind] || KIND_LABELS.withdrawn;

  return (
    <>
      <button type="button" onClick={() => propose("disqualified")} disabled={!!busy} data-testid={`admin-reg-disqualify-${registration.id}`} className={buttonClass}>
        {busy === "disqualified" ? "Prüft …" : KIND_LABELS.disqualified.button}
      </button>
      <button type="button" onClick={() => propose("withdrawn")} disabled={!!busy} data-testid={`admin-reg-withdraw-${registration.id}`} className={buttonClass.replace("border-[#FF3B30]/40 text-[#FF3B30]", "border-white/20 text-white/70")}>
        {busy === "withdrawn" ? "Prüft …" : KIND_LABELS.withdrawn.button}
      </button>
      {plan ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${reasonId}-title`}
            data-testid="admin-reg-removal-dialog"
            className="flex max-h-[90vh] w-full max-w-lg min-w-0 flex-col rounded-sm border border-white/10 bg-[#121212] shadow-xl"
          >
            <div className="shrink-0 border-b border-white/10 p-4">
              <h2 id={`${reasonId}-title`} className="font-heading text-base font-bold uppercase text-white break-words [overflow-wrap:anywhere]">
                {headline(kind, name)}
              </h2>
              <p className="mt-1 text-xs text-white/60">
                {kind === "withdrawn"
                  ? "Die Person scheidet aus. Was mit ihren Spielen passiert, steht hier - erst mit „Austritt eintragen“ wird es wirksam."
                  : "Die Person scheidet aus. Was mit ihren Spielen passiert, steht hier - erst mit „Disqualifizieren“ wird es wirksam."}
              </p>
            </div>
            <div data-testid="admin-reg-removal-ops" className="min-h-0 flex-1 overflow-y-auto p-4 text-sm text-white/85">
              {plan.summary ? <p className="mb-3 break-words [overflow-wrap:anywhere]">{plan.summary}</p> : null}
              {ops.length > 0 ? (
                <ul className="space-y-1">
                  {ops.map((op, index) => (
                    <li key={index} data-testid="admin-reg-removal-op" className="flex min-w-0 gap-2 break-words">
                      <span className="mt-0.5 w-20 shrink-0 text-[10px] font-bold uppercase tracking-wider text-white/45">{OP_LABELS[op.kind] || "Umbau"}</span>
                      <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{op.text || OP_FALLBACK[op.kind] || "Umbau"}</span>
                    </li>
                  ))}
                </ul>
              ) : !plan.summary ? (
                <p className="text-white/60">Kein offenes Spiel betroffen - nur der Status der Anmeldung ändert sich.</p>
              ) : null}
            </div>
            <div className="shrink-0 space-y-3 border-t border-white/10 p-4">
              <label className="block text-xs text-white/60">
                <span className="mb-1 block font-bold uppercase tracking-wider">Grund</span>
                <input
                  id={reasonId}
                  aria-label="Grund"
                  value={reason}
                  maxLength={300}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="freiwillig, steht in der Nachricht an die Person"
                  className="w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-[#29B6E8]/60 focus:outline-none"
                />
              </label>
              <div className="flex flex-wrap justify-end gap-2">
                <button type="button" onClick={cancel} disabled={busy === "confirm"} data-testid="admin-reg-removal-cancel" className="tls-btn tls-btn--quiet rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
                  Abbrechen
                </button>
                <button ref={confirmRef} type="button" onClick={confirm} disabled={!!busy || !plan.id} data-testid="admin-reg-removal-confirm" className="tls-btn tls-btn--danger rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider">
                  {busy === "confirm" ? labels.busy : labels.confirm}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
