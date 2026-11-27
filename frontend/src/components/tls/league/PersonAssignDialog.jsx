import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AlertTriangle, Check, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";
import { useModalBehavior } from "@/hooks/useModalBehavior";

// „Spieler zuteilen“ (#1629, P1 Solo-Grundlage): In einer Solo-Staffel ist der Teilnehmer die Person selbst. Die Leitung sucht ein
// Konto nach Name und teilt es zu - derselbe Weg wie beim Co-Team (`…/squad-registrations`, hier mit `user_id`). Der Server prüft
// alles (gesperrt, schon in der Staffel, schon in einer anderen Staffel der Season, Staffel voll) und schickt die Gründe vorab mit -
// wer nicht geht, steht mit dem Grund da und ist nicht wählbar. Alter, Plattform und Spiel-ID sind nur Hinweise.

const MIN_QUERY = 2;
const SEARCH_DELAY_MS = 250;

function seatsText(data) {
  if (!data?.max_participants) return "";
  return `${data.seats_taken} von ${data.max_participants} Plätzen belegt`;
}

/** Spiel-ID der Person (#2108): fehlt sie, warnt der Dialog - das Zuteilen geht trotzdem. */
function PersonIds({ players = [], label, personId }) {
  if (!players.length) return null;
  const player = players[0];
  // Eine Person: der Name steht schon darüber - der Satz sagt nur, was die fehlende ID bedeutet.
  const warning = player.state === "banned" ? "Konto gesperrt – nicht aufstellbar."
    : player.ok ? "" : "Zuteilen geht trotzdem – aufgestellt werden kann sie erst mit der ID.";
  return (
    <span className="mt-1.5 block" data-testid={`person-assign-ids-${personId}`}>
      <span className={`inline-flex max-w-full items-center gap-1 rounded-sm border px-1.5 py-0.5 tls-type-small ${player.ok ? "border-white/10 text-white/70" : "border-warn/40 text-warn"}`}
        data-state={player.state}>
        {player.ok ? <Check className="h-3 w-3 shrink-0 text-ok" aria-hidden="true" /> : <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />}
        <span className="truncate font-mono">{player.ok ? player.text : `keine ${label || "Spiel-ID"}`}</span>
      </span>
      {warning ? <span className="mt-1 block tls-type-small text-warn break-words [overflow-wrap:anywhere]">{warning}</span> : null}
    </span>
  );
}

export function PersonAssignDialog({ tournament, onAssigned, triggerClassName = "" }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [personId, setPersonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Nur die Antwort auf die letzte Suche zählt - eine langsamere ältere überschreibt die neuere nicht.
  const latest = useRef(0);
  const search = useCallback(async (text) => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    setLoadError("");
    setLoading(true);
    try {
      const { data: body } = await api.get(`/tournaments/${tournament.id}/squad-candidates`, { params: { q: text } });
      if (ticket === latest.current) setData(body);
    } catch (err) {
      if (ticket !== latest.current) return;
      setData(null);
      setLoadError(formatRequestError(err, "Die Suche geht gerade nicht."));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [tournament.id]);

  // Gesucht wird ab zwei Zeichen, kurz nach dem letzten Tastendruck - so fragt nicht jeder Buchstabe einzeln.
  const needle = query.trim();
  useEffect(() => {
    if (!open || needle.length < MIN_QUERY) return undefined;
    const timer = window.setTimeout(() => search(needle), SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [open, needle, search]);

  // Fokus im Dialog, Tab bleibt darin, Escape schließt (nicht während des Speicherns) - wie „Co-Team zuteilen“ (#2412).
  const dialogRef = useModalBehavior(open, () => { if (!busy) setOpen(false); }, { focusContainer: true });

  const start = () => {
    setQuery("");
    setData(null);
    setPersonId("");
    setError("");
    setLoadError("");
    setOpen(true);
  };

  const people = needle.length >= MIN_QUERY ? data?.people || [] : [];
  const person = people.find((row) => row.id === personId) || null;

  const submit = async () => {
    if (!person) return;
    setBusy(true);
    setError("");
    try {
      const { data: done } = await api.post(`/tournaments/${tournament.id}/squad-registrations`, { user_id: person.id });
      toast.success(`${person.display_name} ist in der Staffel.`);
      if ((done?.ids_missing || []).length) {
        toast.warning(`${data?.id_label || "Spiel-ID"} fehlt bei ${person.display_name} – die Person hat einen Hinweis bekommen.`, { duration: 9000 });
      }
      setOpen(false);
      onAssigned?.();
    } catch (err) {
      setError(formatRequestError(err, "Die Person konnte nicht zugeteilt werden."));
      search(needle);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" onClick={start} data-testid="person-assign-open" className={triggerClassName || "tls-btn tls-btn--secondary inline-flex items-center gap-2 rounded-sm px-4 py-2 tls-type-label"}>
        <UserPlus className="h-4 w-4" aria-hidden="true" /> Spieler zuteilen
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div role="dialog" aria-modal="true" aria-labelledby={titleId} data-testid="person-assign-dialog" ref={dialogRef} tabIndex={-1}
            className="outline-none flex max-h-[90vh] w-full max-w-lg min-w-0 flex-col rounded-sm border border-white/10 bg-[#121212] shadow-xl">
            <div className="shrink-0 border-b border-white/10 p-4">
              <h2 id={titleId} className="tls-type-section text-white">Spieler zuteilen</h2>
              <p className="mt-1 tls-type-small text-white/60">In dieser Liga spielt jede Person für sich. Konto suchen und wählen.</p>
              {data && seatsText(data) ? <p className="mt-1 tls-type-small text-white/45" data-testid="person-assign-seats">{seatsText(data)}</p> : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 tls-type-small text-white/85">
              <label className="block">
                <span className="sr-only">Spieler suchen</span>
                <input value={query} onChange={(event) => { setQuery(event.target.value); setPersonId(""); setError(""); }} placeholder="Name oder Benutzername"
                  data-testid="person-assign-search" autoComplete="off"
                  className="mb-3 min-h-[44px] w-full rounded-sm border border-white/10 bg-[#0A0A0A] px-3 text-base text-white placeholder:text-white/50 focus:border-[#29B6E8]/60 focus:outline-none md:text-sm" />
              </label>
              {loadError ? (
                <div className="space-y-3">
                  <p role="alert" className="text-warn">{loadError}</p>
                  <button type="button" onClick={() => search(needle)} data-testid="person-assign-reload" className="tls-btn tls-btn--secondary min-h-[44px] rounded-sm px-4 py-2 tls-type-label">
                    Erneut suchen
                  </button>
                </div>
              ) : null}
              {needle.length < MIN_QUERY ? <p className="text-white/55" data-testid="person-assign-hint">Mindestens zwei Zeichen eingeben.</p> : null}
              {needle.length >= MIN_QUERY && loading && !data ? <p className="text-white/55" aria-busy="true">Suche …</p> : null}
              {needle.length >= MIN_QUERY && data && !people.length && !loading ? <p className="text-white/55" data-testid="person-assign-empty">Kein Konto passt zur Suche.</p> : null}
              {people.length ? (
                <fieldset className="min-w-0 space-y-2">
                  <legend className="sr-only">Person wählen</legend>
                  {people.map((row) => {
                    const blocked = row.problems.length > 0;
                    return (
                      <label key={row.id} className={`flex min-w-0 items-start gap-3 rounded-sm border bg-[#0A0A0A] p-3 ${blocked ? "border-white/5 text-quiet" : "cursor-pointer border-white/10 hover:border-white/25"}`}>
                        <input type="radio" name="person-assign" value={row.id} disabled={blocked} checked={personId === row.id} onChange={() => { setPersonId(row.id); setError(""); }}
                          className="mt-1 accent-[#29B6E8]" data-testid={`person-assign-person-${row.id}`} />
                        <span className="min-w-0 flex-1">
                          {/* Gesperrt: ruhig in der Farbe für Nebensachen, ohne zusätzliche Deckkraft - der Grund darunter bleibt gut lesbar. */}
                          <span className={`block font-bold break-words [overflow-wrap:anywhere] ${blocked ? "text-quiet" : "text-white"}`}>{row.display_name}</span>
                          {row.username && row.username !== row.display_name ? <span className="block tls-type-small text-quiet [overflow-wrap:anywhere]">@{row.username}</span> : null}
                          <PersonIds players={row.players} label={data?.id_label} personId={row.id} />
                          {row.problems.map((text) => <span key={text} className="mt-1 block tls-type-small text-warn break-words [overflow-wrap:anywhere]">{text}</span>)}
                          {!blocked && row.notes?.length ? (
                            <span className="mt-1 block tls-type-small text-warn" data-testid={`person-assign-notes-${row.id}`}>
                              {row.notes.map((text) => <span key={text} className="block break-words [overflow-wrap:anywhere]">{text}</span>)}
                            </span>
                          ) : null}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}
              {error ? <p role="alert" data-testid="person-assign-error" className="mt-3 tls-type-small text-warn break-words">{error}</p> : null}
            </div>

            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-white/10 p-4">
              <button type="button" onClick={() => setOpen(false)} disabled={busy} className="tls-btn tls-btn--quiet min-h-[44px] rounded-sm px-4 py-2 tls-type-label">
                Abbrechen
              </button>
              <button type="button" onClick={submit} disabled={busy || !person} data-testid="person-assign-confirm" className="tls-btn tls-btn--primary min-h-[44px] rounded-sm px-4 py-2 tls-type-label disabled:opacity-50">
                {busy ? "Teile zu …" : "Zuteilen"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
