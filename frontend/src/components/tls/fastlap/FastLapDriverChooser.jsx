import { useState } from "react";
import { UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { INPUT_CLASS } from "@/components/tls/FormFields";

// Fahrer wählen vor Ort (#1585): ein Konto über die Personensuche oder ein Gast ohne Konto (nur Anzeigename). Gäste
// stehen in der Tabelle, zählen aber nicht in Jahreswertung, Erfolgen und Gewinnen - das sagt der Hinweis unter der Wahl.
// Wert: { kind: "user" | "guest", id, name, avatar_url?, is_club_member? } oder null.

export function driverFromPerson(person) {
  return person ? { kind: "user", id: person.id, name: person.name, avatar_url: person.avatar_url || null, context: person.context || "", is_club_member: !!person.is_club_member } : null;
}

export function driverFromGuest(guest) {
  return guest ? { kind: "guest", id: guest.id, name: guest.display_name } : null;
}

export function driverFromRow(row) {
  if (!row) return null;
  return row.guest_id
    ? { kind: "guest", id: row.guest_id, name: row.display_name }
    : { kind: "user", id: row.user_id, name: row.display_name, avatar_url: row.avatar_url || null };
}

export function FastLapDriverChooser({ challengeId, guests, onGuestCreated, value, onChange, testId = "fl-driver" }) {
  const [tab, setTab] = useState(value?.kind === "guest" ? "guest" : "user");
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  // Verknüpfte Gäste (#1585) fahren als Konto weiter - sie stehen hier nicht mehr zur Wahl.
  const open = (guests || []).filter((guest) => !guest.linked_user_id);

  const createGuest = async (event) => {
    event?.preventDefault();
    const text = name.trim();
    if (!text) return;
    setSaving(true);
    try {
      const { data } = await api.post(`/f1/challenges/${challengeId}/guests`, { display_name: text });
      setName("");
      onGuestCreated?.(data);
      onChange(driverFromGuest(data));
      toast.success(`Gast „${data.display_name}“ angelegt.`);
    } catch (failure) {
      toast.error(formatRequestError(failure, "Der Gast ließ sich nicht anlegen."));
    } finally {
      setSaving(false);
    }
  };

  if (value?.kind === "guest") {
    return (
      <div data-testid={testId}>
        <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Fahrer</div>
        <div className="flex items-center gap-3 border border-honor/30 bg-honor/5 rounded-sm px-3 py-2" data-testid={`${testId}-selected`}>
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-honor border border-honor/40 rounded-sm px-1.5 py-0.5">Gast</span>
          <span className="min-w-0 flex-1 text-sm font-semibold truncate">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Anderen Fahrer wählen" className="p-1 text-white/50 hover:text-white"><X className="w-4 h-4" /></button>
        </div>
      </div>
    );
  }
  if (value) {
    return <PersonPicker purpose="fastlap" contextId={challengeId} value={value} onChange={(person) => onChange(driverFromPerson(person))} label="Fahrer" testId={testId} />;
  }

  return (
    <div data-testid={testId}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-bold uppercase tracking-widest text-white/60">Fahrer</span>
        <div className="inline-flex border border-white/10 rounded-sm overflow-hidden text-[11px] font-bold uppercase tracking-wider" role="tablist" aria-label="Konto oder Gast">
          <button type="button" role="tab" aria-selected={tab === "user"} onClick={() => setTab("user")} data-testid={`${testId}-tab-user`} className={`px-2.5 py-1 ${tab === "user" ? "bg-white/10 text-white" : "text-white/50"}`}>Konto</button>
          <button type="button" role="tab" aria-selected={tab === "guest"} onClick={() => setTab("guest")} data-testid={`${testId}-tab-guest`} className={`px-2.5 py-1 ${tab === "guest" ? "bg-white/10 text-white" : "text-white/50"}`}>Gast</button>
        </div>
      </div>
      {tab === "user" ? (
        <PersonPicker purpose="fastlap" contextId={challengeId} value={null} onChange={(person) => onChange(driverFromPerson(person))} label="" placeholder="Fahrer suchen …" testId={`${testId}-person`} />
      ) : (
        <div className="space-y-2">
          <form onSubmit={createGuest} className="flex gap-2">
            <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} placeholder="Name des Gastes, z. B. Anna K." aria-label="Name des Gastes" data-testid={`${testId}-guest-name`} className={`${INPUT_CLASS} min-w-0`} />
            <button disabled={saving || !name.trim()} data-testid={`${testId}-guest-create`} className="tls-btn tls-btn--secondary shrink-0 inline-flex items-center gap-1.5 px-3 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">
              <UserPlus className="w-3.5 h-3.5" /> Anlegen
            </button>
          </form>
          {open.length > 0 && (
            <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto" data-testid={`${testId}-guests`}>
              {open.map((guest) => (
                <button key={guest.id} type="button" onClick={() => onChange(driverFromGuest(guest))} data-testid={`${testId}-guest-${guest.id}`} className="tls-btn tls-btn--quiet max-w-full truncate px-2.5 py-1 rounded-sm text-xs">
                  {guest.display_name}
                </button>
              ))}
            </div>
          )}
          <div className="text-[11px] text-white/45">Gäste stehen in der Tabelle, aber nicht in Jahreswertung, Erfolgen und Gewinnen. Den Namen vorher fragen.</div>
        </div>
      )}
    </div>
  );
}
