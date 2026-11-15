// Nachmeldungen der Season (docs/LIGA.md, B.4 „Nachmeldung nach dem Season-Start“, #2422, Entscheidung Nr. 183): Teams, die nach dem
// Start in eine Staffel mit festem Spielplan kamen. Das Zuteilen legt keine Spiele an - hier sieht die Leitung die Vorschau (Paarungen nur in
// noch offenen Spielwochen, was entfällt) und legt die Spiele mit einer Bestätigung an. Gerechnet wird auf dem Server.
import { useCallback, useEffect, useState } from "react";
import { CircleAlert } from "lucide-react";
import { toast } from "sonner";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { ConflictReasonField, OwnTeamNote, overrideMissing, overridePayload } from "@/components/tls/league/ConflictOverride";
import { FormSection } from "@/components/tls/AdminForm";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatApiError } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";

const BUTTON = "inline-flex min-h-[40px] items-center rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider disabled:opacity-50";
const WHEN = { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };
const KIND_TEXT = { bye: "Freilos des Gegners", reserve: "Reservewoche", free: "Gegner frei" };

/** Die Zeile im Panel: offen mit Knopf, erledigt mit Ergebnis. */
export function lateEntryLine(item) {
  const from = item.from_week ? `ab Woche ${item.from_week}` : "keine Spielwoche mehr offen";
  if (item.state !== "done") return `Spiele noch nicht nachgetragen · ${from}`;
  const created = item.created === 1 ? "1 Spiel nachgetragen" : `${item.created || 0} Spiele nachgetragen`;
  return item.missing ? `${created} · gegen ${item.missing} ${item.missing === 1 ? "Team" : "Teams"} kein Spiel mehr möglich` : created;
}

export function LateEntrySheet({ item, onClose, onDone }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [conflictReason, setConflictReason] = useState("");
  const url = `/admin/leagues/staffeln/${item.tournament_id}/late-entries/${item.registration_id}`;
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(url);
      setData(body);
      setError("");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Die Vorschau konnte nicht geladen werden.");
    }
  }, [url]);
  useEffect(() => { load(); }, [load]);

  const submit = async (event) => {
    event.preventDefault();
    if (!data || saving) return;
    setSaving(true);
    try {
      const { data: answer } = await api.post(url, { fingerprint: data.fingerprint, ...overridePayload(data.own_team && data.superadmin, conflictReason) });
      const count = answer.match_ids?.length || 0;
      toast.success(count ? `${count === 1 ? "1 Spiel" : `${count} Spiele`} angelegt. Beide Seiten bekommen eine Nachricht.` : "Festgehalten: keine Spiele mehr, das Team zählt ab jetzt.");
      onDone();
    } catch (failure) {
      toast.error(formatApiError(failure.response?.data?.detail));
      setSaving(false);
      // Hat sich der Spielplan geändert, steht gleich die neue Vorschau da.
      await load();
    }
  };

  const pairings = data?.pairings || [];
  const missing = data?.missing || [];
  // Befangenheit (Nr. 187): Über das eigene Team entscheidet eine andere Person, der Superadmin nur mit Grund.
  const blockedOwn = Boolean(data?.own_team && !data?.superadmin);
  const needsReason = Boolean(data?.own_team && data?.superadmin);
  return (
    <AdminSheet title="Spiele nachtragen" eyebrow={`${item.name} · Staffel ${item.staffel || ""}`.trim()} size="lg" onClose={onClose} onSubmit={submit}
      saving={saving} savingLabel="Lege an …" submitTestId="late-entry-confirm" submitDisabled={!data || blockedOwn || overrideMissing(needsReason, conflictReason)}
      submitLabel={pairings.length ? `${pairings.length === 1 ? "1 Spiel" : `${pairings.length} Spiele`} anlegen` : "Ohne Spiele bestätigen"}
      testId="late-entry-sheet">
      {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
      {!data && !error ? <p className="text-sm text-white/45" aria-busy="true">Lade Vorschau …</p> : null}
      {data ? (
        <div className="space-y-5 text-sm">
          <p className="text-white/75" data-testid="late-entry-intro">
            {data.from_week
              ? `Nachgemeldet ab Woche ${data.from_week}. Das Team spielt nur in Wochen, die noch nicht begonnen haben – gegen jedes Team höchstens ${data.legs === 2 ? "zweimal" : "einmal"}, je Woche ein Spiel. Gespielte Wochen, bestehende Spiele und Termine bleiben, wie sie sind.`
              : "Keine Spielwoche ist mehr offen. Das Team bekommt keine Spiele und steht ab jetzt mit seinem Stand in der Tabelle."}
          </p>
          {pairings.length ? (
            <section aria-labelledby="late-entry-pairings" className="space-y-2">
              <h3 id="late-entry-pairings" className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/50">Vorschlag ({pairings.length})</h3>
              <ul className="divide-y divide-white/5 rounded-sm border border-white/10 bg-[#0A0A0A]" data-testid="late-entry-pairings">
                {pairings.map((row) => (
                  <li key={`${row.matchday}-${row.opponent_id}`} className="grid gap-x-3 gap-y-1 px-3 py-2 sm:grid-cols-[7rem_1fr_auto] sm:items-baseline" data-testid={`late-entry-pairing-${row.matchday}`}>
                    <span className="text-xs font-bold uppercase tracking-wider text-[#29B6E8]">Woche {row.week}</span>
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-semibold text-white">{row.home_name}</span> <span className="text-white/50">gegen</span> <span className="font-semibold text-white">{row.away_name}</span>
                      <span className="block text-xs text-white/55">{KIND_TEXT[row.kind] || ""}{row.reason ? ` – ${row.reason}` : ""}</span>
                    </span>
                    <span className="text-xs text-white/70">{row.default_at ? `${viennaDateTime(row.default_at, WHEN)} Uhr` : "Termin festlegen"}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-white/55">Termin: der Standardtermin der Woche. Danach gehen Terminvorschläge und Verschiebung wie bei jedem Spiel.</p>
            </section>
          ) : null}
          {data.notes?.length ? (
            <ul className="space-y-1 text-xs text-white/70" data-testid="late-entry-notes">
              {data.notes.map((note) => <li key={note} className="[overflow-wrap:anywhere]">{note}</li>)}
            </ul>
          ) : null}
          {missing.length ? (
            <section aria-labelledby="late-entry-missing" className="space-y-2">
              <h3 id="late-entry-missing" className="text-[11px] font-bold uppercase tracking-[0.2em] text-warn">Entfällt ({missing.length})</h3>
              <ul className="space-y-1 text-white/80" data-testid="late-entry-missing">
                {missing.map((row) => (
                  <li key={row.opponent_id} className="flex gap-2 [overflow-wrap:anywhere]">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warn" aria-hidden="true" /> <span>{row.text}</span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-white/55">Keine offene Woche, in der beide frei sind. Nachholspiele für vergangene Wochen gibt es nicht – die Tabelle hat dann ungleiche Spielzahlen.</p>
            </section>
          ) : null}
          {blockedOwn ? <OwnTeamNote testId="late-entry-own-team" /> : null}
          {needsReason ? <ConflictReasonField value={conflictReason} onChange={setConflictReason} testId="late-entry-conflict-reason" /> : null}
        </div>
      ) : null}
    </AdminSheet>
  );
}

export function SeasonLateEntriesPanel({ seasonId, version }) {
  const [items, setItems] = useState(null);
  const [open, setOpen] = useState(null);
  const load = useCallback(async () => {
    try {
      const { data: body } = await api.get(`/admin/leagues/seasons/${seasonId}/late-entries`);
      setItems(body.items || []);
    } catch {
      setItems(null);
    }
  }, [seasonId]);
  useEffect(() => { load(); }, [load, version]);
  useApiInvalidation(load, ["leagues", "tournaments"]);

  if (!items?.length) return null;
  return (
    <div id="nachmeldungen" className="scroll-mt-24">
      <FormSection title="Nachmeldungen" testId="season-late-entries"
        hint="Teams, die nach dem Start in eine Staffel kamen. Sie spielen nur die noch offenen Spielwochen. Du siehst zuerst die Vorschau und legst die Spiele dann an.">
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.registration_id} className="flex flex-wrap items-center justify-between gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-3 py-2" data-testid={`late-entry-${item.registration_id}`}>
              <span className="min-w-0 [overflow-wrap:anywhere]">
                <span className="block font-semibold text-white">{item.name}</span>
                <span className="block text-xs text-white/60">Staffel {item.staffel} · {lateEntryLine(item)}</span>
              </span>
              {item.state !== "done" && item.active ? (
                <button type="button" onClick={() => setOpen(item)} className={`tls-btn tls-btn--primary ${BUTTON}`} data-testid={`late-entry-open-${item.registration_id}`}>Spiele nachtragen</button>
              ) : null}
            </li>
          ))}
        </ul>
      </FormSection>
      {open ? <LateEntrySheet item={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} /> : null}
    </div>
  );
}
