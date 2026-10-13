import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Flag, Plus, Trophy, Unlink } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { viennaDate } from "@/lib/vienna";

// Event als Klammer in der Verwaltung (#1371): Turniere und Fast Laps gehören zum Event, wenn sie hier angelegt oder
// hinzugefügt werden - das Turnier- und das Fast-Lap-Formular verbinden nicht mehr. Neu Angelegtes übernimmt Ort, Tag,
// Partner und Discord-Einstellungen vom Event (Server: services/event_program.py).

/** Das Programm des Events vom Server: Turniere, Fast Laps, was sich hinzufügen lässt, Vorbelegung und Sponsoren. */
export function useEventProgram(eventId) {
  const [program, setProgram] = useState(null);
  const [failed, setFailed] = useState(false);
  const reload = useCallback(async () => {
    if (!eventId) return;
    try {
      const { data } = await api.get(`/events/${encodeURIComponent(eventId)}/program`);
      setProgram(data || null);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [eventId]);
  useEffect(() => { reload(); }, [reload]);
  return { program, failed, reload };
}

const KIND = {
  tournament: { icon: Trophy, list: "tournaments", label: "Turnier", plural: "Turniere", edit: (id) => `/admin/tournaments/${id}` },
  fastlap: { icon: Flag, list: "fastlaps", label: "Fast Lap", plural: "Fast Laps", edit: (id) => `/admin/f1/${id}` },
};

export function EventProgramPanel({ eventId, program, failed, reload, onEmbed }) {
  const confirm = useConfirm();
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);

  if (!eventId) {
    return (
      <p className="text-sm text-white/55" data-testid="event-program-new">
        Turniere und Fast Laps legst du hier an, sobald das Event gespeichert ist.
      </p>
    );
  }
  if (failed && !program) {
    return <p className="text-sm text-white/55" data-testid="event-program-error">Das Programm lässt sich gerade nicht laden.</p>;
  }
  if (!program) return <p className="text-sm text-white/45">Lade Programm …</p>;

  const add = async () => {
    const [kind, itemId] = choice.split(":");
    if (!kind || !itemId) return;
    setBusy(true);
    try {
      await api.post(`/events/${encodeURIComponent(eventId)}/program`, { kind, item_id: itemId });
      toast.success(`${KIND[kind].label} gehört jetzt zum Event.`);
      setChoice("");
      await reload();
    } catch (err) {
      toast.error(formatRequestError(err, "Konnte nicht hinzugefügt werden."));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (kind, item) => {
    if (!await confirm({
      title: `${KIND[kind].label} vom Event lösen?`,
      description: `„${item.title}“ bleibt bestehen, gehört dann aber nicht mehr zu diesem Event.`,
      confirmLabel: "Lösen",
    })) return;
    try {
      await api.delete(`/events/${encodeURIComponent(eventId)}/program/${kind}/${encodeURIComponent(item.id)}`);
      toast.success("Gelöst.");
      await reload();
    } catch (err) {
      toast.error(formatRequestError(err, "Konnte nicht gelöst werden."));
    }
  };

  const items = Object.keys(KIND).flatMap((kind) => (program[KIND[kind].list] || []).map((item) => ({ kind, item })));
  const candidates = program.candidates || {};
  const hasCandidates = (candidates.tournaments || []).length + (candidates.fastlaps || []).length > 0;

  return (
    <div className="space-y-3" data-testid="event-program-panel">
      {items.length === 0 ? (
        <p className="border border-dashed border-white/15 rounded-sm p-4 text-sm text-white/50" data-testid="event-program-empty">
          Noch keine Turniere oder Fast Laps in diesem Event.
        </p>
      ) : (
        <ul className="border border-white/10 rounded-sm divide-y divide-white/5 bg-[#0A0A0A]">
          {items.map(({ kind, item }) => {
            const Icon = KIND[kind].icon;
            return (
              <li key={`${kind}-${item.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5" data-testid={`event-program-item-${item.id}`}>
                <Icon className="w-4 h-4 text-[#9F7AEA] shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <Link to={KIND[kind].edit(item.id)} className="font-semibold text-sm hover:underline break-words">{item.title || "Ohne Titel"}</Link>
                  <div className="text-xs text-white/45">{[KIND[kind].label, item.start_date ? viennaDate(item.start_date) : ""].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="flex items-center gap-3 text-[11px] font-bold uppercase tracking-wider">
                  {onEmbed && (
                    <button type="button" onClick={() => onEmbed(kind, item)} className="text-[#29B6E8] hover:text-white">Ins Programm</button>
                  )}
                  <button type="button" onClick={() => remove(kind, item)} data-testid={`event-program-remove-${item.id}`} className="inline-flex items-center gap-1 text-white/55 hover:text-white">
                    <Unlink className="w-3 h-3" aria-hidden="true" /> Lösen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <Link to={`/admin/tournaments/new?event=${encodeURIComponent(eventId)}`} data-testid="event-program-new-tournament"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-[#9F7AEA] text-black font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#7C5CE0]">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Turnier in diesem Event
        </Link>
        <Link to={`/admin/f1/new?event=${encodeURIComponent(eventId)}`} data-testid="event-program-new-fastlap"
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-[#9F7AEA]/50 text-[#9F7AEA] font-bold uppercase tracking-wider text-xs rounded-sm hover:bg-[#9F7AEA]/10">
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Fast Lap
        </Link>
      </div>

      {hasCandidates && (
        <div className="flex flex-col sm:flex-row gap-2" data-testid="event-program-add">
          <label className="sr-only" htmlFor="event-program-choice">Bestehendes hinzufügen</label>
          <select id="event-program-choice" value={choice} onChange={(e) => setChoice(e.target.value)} data-testid="event-program-choice"
            className="min-w-0 flex-1 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2 text-sm">
            <option value="">Bestehendes hinzufügen …</option>
            {Object.keys(KIND).map((kind) => (candidates[KIND[kind].list] || []).length > 0 && (
              <optgroup key={kind} label={KIND[kind].plural}>
                {candidates[KIND[kind].list].map((item) => (
                  <option key={item.id} value={`${kind}:${item.id}`}>
                    {[item.title || "Ohne Titel", item.start_date ? viennaDate(item.start_date) : ""].filter(Boolean).join(" · ")}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <button type="button" onClick={add} disabled={!choice || busy} data-testid="event-program-add-submit"
            className="px-4 py-2 border border-white/15 rounded-sm text-xs font-bold uppercase tracking-wider text-white/75 hover:text-white disabled:opacity-40">
            Hinzufügen
          </button>
        </div>
      )}
      <p className="text-xs text-white/45">
        Neu Angelegtes übernimmt Ort, Tag, Partner und Discord-Einstellungen vom Event{program.event?.window ? ` (${program.event.window})` : ""}. Der Tag muss im Event liegen.
      </p>
    </div>
  );
}

/** „Gehört zu Herbst-LAN – ändern im Event“: die Zeile im Turnier- und Fast-Lap-Formular statt einer Event-Auswahl. */
export function EventMembershipLine({ eventId, events = [], testId = "event-membership" }) {
  if (!eventId) {
    return (
      <p className="text-xs text-white/50" data-testid={testId}>
        Gehört zu keinem Event. Zu einem Event kommt es im Event unter „Programm“.
      </p>
    );
  }
  const name = events.find((item) => item.id === eventId)?.name || "einem Event";
  return (
    <p className="text-sm text-white/70" data-testid={testId}>
      Gehört zu <strong className="text-white">{name}</strong> –{" "}
      <Link to={`/admin/events/${encodeURIComponent(eventId)}`} className="text-[#9F7AEA] hover:underline">ändern im Event</Link>
    </p>
  );
}
