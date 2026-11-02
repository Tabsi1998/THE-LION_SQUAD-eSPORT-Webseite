import { useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField, TextField } from "@/components/tls/FormFields";
import { PersonPicker } from "@/components/tls/PersonPicker";
import { fromViennaInput, viennaDay } from "@/lib/vienna";

// Gewinn von Hand anlegen oder bearbeiten (#2112). Neu: Turnier, Empfänger und Platz - etwa ein Sonderpreis, den die
// Preisstruktur nicht kennt. Bearbeiten: Preis, Wert und Abholfrist; wer gewonnen hat, ändert sich nicht.
// Die Frist ist ein Tag; sie gilt bis zu seinem Ende (Wiener Zeit). Leer heißt: 90 Tage ab „Bereit“.
function deadlineIso(day) {
  return day ? fromViennaInput(`${day}T23:59`) : null;
}

export function PrizeFormSheet({ prize, onClose, onSaved }) {
  const editing = !!prize;
  const [tournaments, setTournaments] = useState([]);
  const [tournamentId, setTournamentId] = useState("");
  const [recipient, setRecipient] = useState(null);
  const [place, setPlace] = useState("1");
  const [label, setLabel] = useState(prize?.prize_label || "");
  const [value, setValue] = useState(prize?.prize_value || "");
  const [initialDeadline] = useState(() => viennaDay(prize?.pickup_deadline));
  const [deadline, setDeadline] = useState(initialDeadline);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editing) return;
    api.get("/tournaments?include_drafts=true&managed=true")
      .then(({ data }) => setTournaments(Array.isArray(data) ? data.filter(Boolean) : []))
      .catch(() => toast.error("Die Turniere ließen sich nicht laden."));
  }, [editing]);

  const save = async (event) => {
    event.preventDefault();
    if (!label.trim()) { toast.error("Bitte angeben, was es zu gewinnen gibt."); return; }
    setSaving(true);
    try {
      if (editing) {
        await api.patch(`/prizes/${prize.id}`, {
          prize_label: label.trim(),
          prize_value: value.trim(),
          // Nur eine geänderte Frist geht mit - sonst würde aus der Uhrzeit von „Bereit“ das Tagesende. Ein geleertes
          // Feld heißt „zurück auf den Standard“ (#2112): offen ohne Frist, bereit 90 Tage ab dem Bereitstellen.
          ...(deadline && deadline !== initialDeadline ? { pickup_deadline: deadlineIso(deadline) } : {}),
          ...(!deadline && initialDeadline ? { reset_deadline: true } : {}),
        });
        toast.success("Gewinn gespeichert.");
      } else {
        if (!tournamentId) { toast.error("Bitte das Turnier wählen."); return; }
        if (!recipient) { toast.error("Bitte suchen und wählen, wer gewonnen hat."); return; }
        const placeNumber = Number(place);
        if (!Number.isInteger(placeNumber) || placeNumber < 1) { toast.error("Platz bitte als Zahl ab 1."); return; }
        await api.post("/prizes", {
          tournament_id: tournamentId,
          user_id: recipient.id,
          place: placeNumber,
          prize_label: label.trim(),
          prize_value: value.trim(),
          pickup_deadline: deadlineIso(deadline),
        });
        toast.success("Gewinn angelegt. Mit „Bereit“ bekommt der Gewinner Bescheid.");
      }
      onSaved?.();
    } catch (error) {
      toast.error(formatApiError(error?.response?.data?.detail) || "Der Gewinn konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  const tournamentOptions = [["", "Turnier wählen …"], ...tournaments.map((row) => [row.id, row.title || row.name || row.slug || row.id])];

  return (
    <AdminSheet
      title={editing ? "Gewinn bearbeiten" : "Gewinn hinzufügen"}
      eyebrow="Gewinne"
      onClose={onClose}
      onSubmit={save}
      saving={saving}
      submitLabel={editing ? "Speichern" : "Gewinn anlegen"}
      submitTestId="prize-form-save"
      testId="prize-form-sheet"
    >
      {editing ? (
        <div className="rounded-sm border border-white/10 bg-black/20 p-3 text-sm">
          <div className="font-semibold">{prize.fastlap_challenge_title || prize.tournament_title || "Gewinn"}</div>
          <div className="text-xs text-white/50">{prize.recipient_label || prize.display_name || "—"} · Platz {prize.place}</div>
        </div>
      ) : (
        <>
          <SelectField label="Turnier" value={tournamentId} onChange={(next) => { setTournamentId(next); setRecipient(null); }} options={tournamentOptions} required testId="prize-form-tournament" />
          <PersonPicker
            purpose="tournament"
            contextId={tournamentId || null}
            value={recipient}
            onChange={setRecipient}
            label="Gewinner"
            placeholder={tournamentId ? "Namen tippen …" : "Erst das Turnier wählen"}
            disabled={!tournamentId}
            testId="prize-form-recipient"
          />
          <TextField label="Platz" type="number" min={1} max={999} value={place} onChange={setPlace} required testId="prize-form-place" hint="Bei Sonderpreisen eine freie Zahl, z. B. 7." />
        </>
      )}
      <TextField label="Preis" value={label} onChange={setLabel} required maxLength={200} placeholder="z. B. Fair-Play-Preis" testId="prize-form-label" />
      <TextField label="Wert" value={value} onChange={setValue} maxLength={200} placeholder="z. B. Gutschein 20 €" testId="prize-form-value" />
      <TextField
        label="Abholfrist"
        type="date"
        value={deadline}
        onChange={setDeadline}
        testId="prize-form-deadline"
        hint={editing
          ? "Ein Datum gilt bis zum Ende dieses Tages. Feld leeren heißt: wieder der Standard – 90 Tage ab „Bereit“."
          : "Leer lassen: 90 Tage ab „Bereit“. Ein Datum gilt bis zum Ende dieses Tages."}
      />
      {editing && prize.pickup_deadline_custom && deadline && ["pending", "ready"].includes(prize.status) && (
        <button type="button" onClick={() => setDeadline("")} data-testid="prize-form-deadline-reset" className="text-xs font-bold uppercase tracking-wider text-[#29B6E8] hover:underline">
          Frist zurück auf 90 Tage ab „Bereit“
        </button>
      )}
    </AdminSheet>
  );
}
