import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ROUND_KIND_OPTIONS, dayLabel, opponentText, roundLabel, roundPayload, roundToForm } from "@/lib/referenceCalendar";
import { COUNTRY_OPTIONS, countryName } from "@/lib/countryFlags";
import { MAX_SESSION, SESSION_CHOICES, plannedSession, sessionLabel, weekendPasteHint } from "@/lib/raceWeekend";
import { CountryFlag, VenueWithFlag } from "@/components/tls/CountryFlag";
import { NO_SCORE_OPTIONS } from "@/lib/seriesSpecialRules";
import { toast } from "sonner";

// Seitenblätter des Kalenders (#1742): Termin anlegen/bearbeiten, verschieben und eine Terminliste einfügen.
// Gerechnet und geprüft wird im Server - auch die eingefügte Liste: die Vorschau kommt vom Server, übernommen wird nur
// eine fehlerfreie Liste. Rennliga (#1930): ein Termin hat seinen Lauf (Qualifying, Sprint, Rennen …) - Termine mit
// gleichem Kürzel sind eine Runde; die Terminliste legt je Zeile alle Läufe an, die die Saison vorgibt. Team-Liga
// (#1931): je Termin Gegner, Heim/Auswärts und das Ende des Spieltags; die Liste liest „vs Team“ (Heim), „@ Team“
// (auswärts) und „13.05.–17.05.“.

const SIDE_OPTIONS = [["", "Offen"], ["home", "Heim"], ["away", "Auswärts"]];

const base = (series) => `/reference-series/admin/series/${series.id}/rounds`;

const COUNTRY_CHOICES = [["auto", "Automatisch aus der Strecke"], ["none", "Ohne Flagge"], ...COUNTRY_OPTIONS];

// Land des Termins (#1925): automatisch erkennt der Server es beim Speichern aus Strecke bzw. Titel; eine Wahl bleibt.
function countryHint(round, choice) {
  if (choice === "auto" && round?.country_auto !== false && round?.country_code) {
    return (
      <span className="inline-flex items-center gap-1.5" data-testid="round-country-detected">
        <CountryFlag code={round.country_code} size="sm" /> Erkannt: {countryName(round.country_code)}
      </span>
    );
  }
  if (choice === "auto") return "Erkannt werden Länder, Strecken und Städte – etwa Monza, Baku oder „USA (Miami)“.";
  return "Bleibt, auch wenn sich die Strecke ändert.";
}

export function RoundSheet({ series, lineage, round, rounds = [], suggestion, version, onClose, onSaved, onStale }) {
  const isNew = !round?.id;
  const racing = lineage?.kind === "racing";
  // Termin ohne Wertung mit Grund (#1960): öffentlich, unterschieden von „abgesagt“ - ein Grund nimmt ihn aus der Wertung.
  const [form, setForm] = useState(() => ({ ...roundToForm(round || {}, suggestion), no_score_reason: round?.no_score_reason || "", no_score_note: round?.no_score_note || "" }));
  const [saving, setSaving] = useState(false);
  // Rennliga (#1930): Die Wertung folgt der Vorgabe des Laufs („Ablauf je Runde“), bis jemand den Haken von Hand setzt.
  // Erst dann geht sie mit; „Wie der Ablauf“ gibt sie an die Vorgabe zurück (``counts: null``).
  const [counts, setCounts] = useState(() => (racing && (isNew || round?.counts_manual === false) ? "auto" : "manual"));
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const planned = plannedSession(series?.weekend, rounds.filter((item) => item.id !== round?.id), form.code, form.session);
  const noScore = Boolean(form.no_score_reason);
  const shownCounts = noScore ? false : counts === "auto" ? planned.counts !== false : form.counts;

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = roundPayload(form, { teamLeague: lineage?.kind === "team_league" });
      if (racing && counts === "auto") {
        if (isNew || round?.counts_manual === false) delete payload.counts;
        else payload.counts = null;
      }
      if (noScore) {
        delete payload.counts;
        payload.no_score_reason = form.no_score_reason;
        payload.no_score_note = form.no_score_note.trim() || null;
      } else if (round?.no_score_reason) {
        payload.no_score_reason = null;
      }
      // Mit dem Stand des Kalenders, den die Seite kennt - war jemand schneller, kommt 409.
      if (isNew) await api.post(base(series), { ...payload, expected_version: version });
      else await api.patch(`${base(series)}/${round.id}`, { ...payload, expected_version: version });
      toast.success("Gespeichert.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      if (err.response?.status === 409) onStale?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={isNew ? "Neuer Termin" : `${round.session ? sessionLabel(round) : roundLabel(round)} bearbeiten`} eyebrow={lineage?.title} onClose={onClose} onSubmit={save} saving={saving} submitTestId="round-save" testId="round-sheet">
      <FormGrid>
        <TextField label="Kürzel" value={form.code} onChange={(v) => set("code", v)} placeholder="R1" maxLength={20} testId="round-code"
          hint={lineage?.kind === "racing" ? "Gleiches Kürzel heißt gleiche Runde – etwa Qualifying und Rennen von R1." : undefined} />
        {lineage?.kind === "racing" && (
          <TextField label="Lauf" value={form.session} onChange={(v) => set("session", v)} suggestions={SESSION_CHOICES} maxLength={MAX_SESSION} placeholder="Rennen" testId="round-session"
            hint="Leer: Rennen. Ob der Lauf zählt, sagt der Ablauf je Runde – etwa ein Qualifying ohne Punkte nicht." />
        )}
        <TextField label="Strecke oder Ort" value={form.venue} onChange={(v) => set("venue", v)} maxLength={160} testId="round-venue" />
        <SelectField label="Land (Flagge)" value={form.country} onChange={(v) => set("country", v)} options={COUNTRY_CHOICES} testId="round-country"
          hint={countryHint(round, form.country)} />
        <TextField label="Tag" type="date" value={form.day} onChange={(v) => set("day", v)} hint="Leer: Termin noch offen." testId="round-day" />
        <TextField label="Uhrzeit" type="time" value={form.time} onChange={(v) => set("time", v)} hint="Wiener Zeit. Vorgabe ist die Standard-Uhrzeit der Saison; leer: ohne Uhrzeit." testId="round-time" />
        <SelectField label="Art" value={form.kind} onChange={(v) => set("kind", v)} options={ROUND_KIND_OPTIONS} testId="round-kind" />
        {lineage?.kind === "team_league" && (<>
          <TextField label="Gegner" value={form.opponent} onChange={(v) => set("opponent", v)} maxLength={120} testId="round-opponent" />
          <SelectField label="Heim oder auswärts" value={form.at_home} onChange={(v) => set("at_home", v)} options={SIDE_OPTIONS} testId="round-side" />
          <TextField label="Spieltag bis" type="date" value={form.day_end} onChange={(v) => set("day_end", v)} min={form.day || undefined}
            hint="Optional: letzter Tag, an dem gespielt werden kann – bis dahin fehlt kein Ergebnis." testId="round-day-end" />
        </>)}
      </FormGrid>
      <TextField label="Eigener Titel" value={form.title} onChange={(v) => set("title", v)} maxLength={160} hint="Optional, etwa „Saisonfinale“." testId="round-title" />
      <CheckField label="Zählt zur Wertung" checked={shownCounts} onChange={(v) => { setCounts("manual"); setForm((current) => ({ ...current, counts: v, ...(v ? { no_score_reason: "", no_score_note: "" } : {}) })); }} testId="round-counts"
        hint={racing && counts === "auto"
          ? "Wie der Ablauf je Runde. Ein Haken von Hand bleibt, auch wenn sich der Ablauf ändert."
          : "Aus: Die Runde steht im Kalender, geht aber nicht in die Tabelle ein."} />
      <FormGrid>
        <SelectField label="Ohne Wertung – Grund" value={form.no_score_reason} onChange={(v) => set("no_score_reason", v)} options={NO_SCORE_OPTIONS} testId="round-no-score"
          hint="Öffentlich am Termin, anders als „abgesagt“: gefahren oder angesetzt, aber nicht gewertet." />
        {noScore && <TextField label="Kurz erklärt" value={form.no_score_note} onChange={(v) => set("no_score_note", v)} maxLength={200} placeholder="Nur fünf Fahrer am Start" testId="round-no-score-note" />}
      </FormGrid>
      {racing && counts === "manual" && !noScore && (
        <button type="button" onClick={() => setCounts("auto")} data-testid="round-counts-auto"
          className="tls-btn tls-btn--quiet self-start px-3 py-1.5 rounded-sm text-[11px] font-bold uppercase tracking-wider">
          Wertung wie der Ablauf
        </button>
      )}
      <TextAreaField label="Notiz" value={form.note} onChange={(v) => set("note", v)} rows={2} hint="Nur in der Verwaltung sichtbar." testId="round-note" />
      {!isNew && series.default_time && <p className="text-xs text-white/45">Standard der Saison: {series.default_time} Uhr.</p>}
    </AdminSheet>
  );
}

export function PostponeSheet({ series, round, version, onClose, onSaved, onStale }) {
  const [day, setDay] = useState(round.club_day || "");
  const [time, setTime] = useState(round.time || series.default_time || "");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const original = round.original_club_day || round.club_day;

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      await api.post(`${base(series)}/${round.id}/postpone`, { day, time: time || null, note: note.trim() || null, expected_version: version });
      toast.success("Termin verschoben.");
      onSaved();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
      if (err.response?.status === 409) onStale?.();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminSheet title={`${roundLabel(round)} verschieben`} onClose={onClose} onSubmit={save} saving={saving} submitLabel="Verschieben" submitTestId="postpone-save" testId="postpone-sheet">
      {original && <p className="text-sm text-white/60" data-testid="postpone-original">Ursprünglich: {dayLabel(original)} – bleibt beim Termin stehen.</p>}
      <FormGrid>
        <TextField label="Neuer Tag" type="date" required value={day} onChange={setDay} testId="postpone-day" />
        <TextField label="Uhrzeit" type="time" value={time} onChange={setTime} hint="Wiener Zeit; leer: ohne Uhrzeit." testId="postpone-time" />
      </FormGrid>
      <TextField label="Grund" value={note} onChange={setNote} maxLength={300} hint="Optional, nur in der Verwaltung sichtbar." testId="postpone-note" />
    </AdminSheet>
  );
}

export function PasteSheet({ series, lineage, version, onClose, onSaved, onStale }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const ready = preview && preview.text === text && !preview.errors.length && preview.rows.length > 0;
  // Ablauf je Runde (#1930): eine Zeile kann mehrere Termine ergeben.
  const total = preview?.count ?? preview?.rows?.length ?? 0;
  const withSessions = Boolean(preview?.rows?.some((row) => (row.sessions || []).some((item) => item.session)));

  const edit = (value) => {
    setText(value);
    if (preview) setPreview(null);
  };

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      if (!ready) {
        const { data } = await api.post(`${base(series)}/paste`, { text });
        setPreview({ ...data, text });
      } else {
        const { data } = await api.post(`${base(series)}/paste`, { text, apply: true, expected_version: version });
        toast.success(`${data.created} Termine übernommen.`);
        onSaved();
      }
    } catch (err) {
      const detail = err.response?.data?.detail;
      if (detail?.errors) setPreview({ rows: [], errors: detail.errors, text });
      else toast.error(formatApiError(detail));
      if (err.response?.status === 409) onStale?.();
    } finally {
      setSaving(false);
    }
  };

  const defaults = [series.default_time && `${series.default_time} Uhr`].filter(Boolean).join(", ");
  const teamLeague = lineage?.kind === "team_league";
  const placeholder = teamLeague
    ? "ST1 · 13.05.2026 20:30 · vs Team A\nST2 · 20.05.–24.05. · @ Team B\nST3 · 27.05. · vs Team C"
    : "R1 · 05.11. · Strecke\nR2 · 12.11. 20:00 · Strecke\nR3 Strecke";
  // Ablauf der Saison (#2007): welche Läufe eine Zeile ohne Lauf anlegt - ohne Ablauf der bisherige Text.
  const weekendHint = lineage?.kind === "racing" ? weekendPasteHint(series.weekend, series.default_time) : "";
  const teamHint = teamLeague ? " Team-Liga: „vs Team“ heißt Heimspiel, „@ Team“ auswärts; „13.05.–17.05.“ ist ein Spieltag mit Zeitraum." : "";
  return (
    <AdminSheet title="Terminliste einfügen" eyebrow={lineage?.title} size="lg" onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={ready ? `${total} Termine übernehmen` : "Vorschau"} savingLabel={ready ? "Übernehme …" : "Prüfe …"} submitTestId="paste-submit" testId="paste-sheet">
      <TextAreaField label="Je Zeile ein Termin" value={text} onChange={edit} rows={8} testId="paste-text" placeholder={placeholder}
        hint={`Kürzel, Datum (TT.MM. oder TT.MM.JJJJ), optional Uhrzeit und Ort – aus dem Ort kommt die Flagge. Ohne Datum: der nächste Standard-Wochentag nach der Zeile davor. Ohne Uhrzeit: ${defaults || "ohne Uhrzeit"}.${lineage?.kind === "racing" ? " Rennliga: Eine Zeile je Runde legt alle Läufe an, die die Saison vorgibt (Ablauf je Runde); „R1 Sprint“, „R1S“ oder „R1 Q“ nur diesen Lauf." : ""}${weekendHint ? ` ${weekendHint}.` : ""}${teamHint}`} />
      {preview && preview.errors.length > 0 && (
        <div className="border border-red-400/40 bg-red-400/10 rounded-sm p-3 text-sm text-red-200 space-y-1" data-testid="paste-errors" role="alert">
          <div className="font-bold">Die Liste hat Fehler – übernommen wird erst eine fehlerfreie Liste.</div>
          <ul className="space-y-0.5">
            {preview.errors.map((error, index) => (
              <li key={index}>{error.line ? `Zeile ${error.line}: ` : ""}{error.message}{error.text ? <span className="text-red-200/60"> – „{error.text}“</span> : null}</li>
            ))}
          </ul>
        </div>
      )}
      {preview && !preview.errors.length && (
        preview.rows.length ? (
          <div className="tls-swipe pb-0" data-testid="paste-preview">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-white/45">
                  <th className="py-1.5 pr-3 font-bold">Kürzel</th>
                  <th className="py-1.5 pr-3 font-bold">Tag</th>
                  <th className="py-1.5 pr-3 font-bold">{withSessions ? "Läufe" : "Uhrzeit"}</th>
                  <th className="py-1.5 font-bold">{teamLeague ? "Gegner · Ort" : "Ort"}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className="border-t border-white/5 align-top">
                    <td className="py-1.5 pr-3 font-bold">{row.code || "–"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {dayLabel(row.day)}
                      {row.day_end && <span className="block text-[11px] text-white/60" data-testid="paste-day-end">bis {dayLabel(row.day_end)}</span>}
                      {row.derived_day && <span className="block text-[11px] text-white/45">aus dem Wochentag</span>}
                      {row.warning && <span className="block text-[11px] text-amber-300">{row.warning}</span>}
                    </td>
                    <td className="py-1.5 pr-3" data-testid="paste-sessions">
                      {withSessions ? (
                        <ul className="space-y-0.5">
                          {(row.sessions || []).map((item, index) => (
                            <li key={index} className="whitespace-nowrap">
                              <span className="font-semibold">{item.session || "Rennen"}</span>
                              <span className="text-white/55 tabular-nums">{` ${item.day !== row.day ? `${dayLabel(item.day)} ` : ""}${item.time || ""}`}</span>
                              {item.counts === false && <span className="text-[11px] text-white/45"> · zählt nicht</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (row.time || "–")}
                    </td>
                    <td className="py-1.5" data-testid="paste-venue">
                      {row.opponent && <span className="block font-semibold text-white" data-testid="paste-opponent">{opponentText(row)}</span>}
                      {row.venue ? <VenueWithFlag round={{ venue: row.venue, country_code: row.country_code }} /> : (row.opponent ? null : "–")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-white/55">Keine Termine in der Liste.</p>
      )}
    </AdminSheet>
  );
}
