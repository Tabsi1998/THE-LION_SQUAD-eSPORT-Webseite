import { useCallback, useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { SelectField } from "@/components/tls/FormFields";
import { toast } from "sonner";
import { Check, UserRound, UserX } from "lucide-react";

// „Unbekannte Namen“ (#1743): die offenen Teilnehmer einer Saison, je mit Vorschlägen samt Begründung („Spiel-ID
// passt“, „Alias bestätigt am …“). Je Zeile einmal entscheiden: Mitglied bestätigen, Gast oder Extern. Mitglied und
// Gast speichern den Alias – derselbe Name wird danach in jeder Serie von selbst erkannt. Die Startnummer ist nur ein
// Hinweis und wird nie vorausgewählt.

export function preselectedProfile(suggestions = []) {
  const strong = suggestions.find((item) => item.target === "member" && item.strong);
  return strong ? strong.profile_id : "";
}

export function profileOptions(suggestions = [], profiles = []) {
  const suggested = suggestions.filter((item) => item.target === "member" && item.profile_id);
  const seen = new Set(suggested.map((item) => item.profile_id));
  return [
    ["", "Mitglied wählen …"],
    ...suggested.map((item) => [item.profile_id, `${item.label} – Vorschlag`]),
    ...profiles.filter((profile) => !seen.has(profile.id)).map((profile) => [profile.id, profile.name]),
  ];
}

function UnknownNameRow({ item, profiles, busy, onAssign }) {
  const { participant, suggestions } = item;
  const [profileId, setProfileId] = useState(() => preselectedProfile(suggestions));
  const guest = suggestions.find((entry) => entry.target === "guest");
  const testId = `unknown-${participant.id}`;
  return (
    <li className="py-3 space-y-2" data-testid={testId}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="font-bold text-white break-words">{participant.name}</span>
        <span className="text-[10px] uppercase tracking-widest text-white/45 font-bold">
          {[participant.start_number && `Nr. ${participant.start_number}`, participant.default_team].filter(Boolean).join(" · ")}
        </span>
      </div>
      {suggestions.length > 0 ? (
        <ul className="space-y-1" data-testid={`${testId}-suggestions`}>
          {suggestions.map((entry) => (
            <li key={`${entry.target}-${entry.profile_id || entry.guest_name}`} className="text-xs text-white/60">
              <span className={entry.strong ? "text-[#29B6E8] font-bold" : "text-white/75"}>{entry.target === "guest" ? `Gast: ${entry.label}` : entry.label}</span>
              <span className="text-white/45"> · {entry.reason}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-white/40" data-testid={`${testId}-none`}>Kein Vorschlag.</div>
      )}
      <div className="flex items-end gap-2 flex-wrap">
        <SelectField label="Mitglied" value={profileId} onChange={setProfileId} options={profileOptions(suggestions, profiles)} testId={`${testId}-profile`} className="flex-1 min-w-[12rem]" />
        <button type="button" disabled={busy || !profileId} onClick={() => onAssign(participant, { link: "member", profile_id: profileId })} data-testid={`${testId}-confirm`}
          className="tls-btn tls-btn--primary px-3 py-2 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> Bestätigen
        </button>
        <button type="button" disabled={busy} onClick={() => onAssign(participant, { link: "guest", guest_name: guest?.guest_name || participant.name })} data-testid={`${testId}-guest`}
          className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
          <UserRound className="w-3.5 h-3.5" /> Gast
        </button>
        <button type="button" disabled={busy} onClick={() => onAssign(participant, { link: "external" })} data-testid={`${testId}-external`}
          className="tls-btn tls-btn--quiet px-3 py-2 rounded-sm text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5 disabled:opacity-50">
          <UserX className="w-3.5 h-3.5" /> Extern
        </button>
      </div>
    </li>
  );
}

export function UnknownNamesSheet({ series, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get(`/reference-series/admin/series/${series.id}/unknown-names`);
      setData(result);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      setData({ items: [], profiles: [] });
    }
  }, [series.id]);

  useEffect(() => { load(); }, [load]);

  const assign = async (participant, body) => {
    setBusy(true);
    try {
      await api.post(`/reference-series/admin/series/${series.id}/participants/${participant.id}/assign`, body);
      toast.success(body.link === "member" ? "Zugeordnet." : body.link === "guest" ? "Als Gast markiert." : "Als extern markiert.");
      await load();
      onChanged?.();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const items = data?.items || [];
  return (
    <AdminSheet title="Unbekannte Namen" eyebrow={series.lineage?.title} size="lg" onClose={onClose} cancelLabel="Schließen" testId="unknown-names">
      <p className="text-sm text-white/60">
        Einmal bestätigen genügt: Mitglied und Gast merkt sich die Website als Alias und erkennt den Namen danach in jeder Serie selbst.
        Gäste zählen fürs Team, aber nicht in der Vereinsstatistik. Für Externe wird nichts gespeichert.
      </p>
      {!data && <div className="text-sm text-white/40">Lädt …</div>}
      {data && items.length === 0 && <div className="text-sm text-white/50" data-testid="unknown-names-empty">Alle Namen sind zugeordnet.</div>}
      {items.length > 0 && (
        <ul className="divide-y divide-white/5" data-testid="unknown-names-list">
          {items.map((item) => <UnknownNameRow key={item.participant.id} item={item} profiles={data.profiles || []} busy={busy} onAssign={assign} />)}
        </ul>
      )}
    </AdminSheet>
  );
}
