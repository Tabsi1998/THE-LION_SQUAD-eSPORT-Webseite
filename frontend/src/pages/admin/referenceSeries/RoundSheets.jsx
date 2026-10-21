import { useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { AdminSheet } from "@/components/tls/AdminSheet";
import { FormGrid } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextAreaField, TextField } from "@/components/tls/FormFields";
import { ROUND_KIND_OPTIONS, dayLabel, roundLabel, roundPayload, roundToForm } from "@/lib/referenceCalendar";
import { COUNTRY_OPTIONS, countryName } from "@/lib/countryFlags";
import { MAX_SESSION, SESSION_CHOICES, sessionKind, sessionLabel } from "@/lib/raceWeekend";
import { CountryFlag, VenueWithFlag } from "@/components/tls/CountryFlag";
import { toast } from "sonner";

// Seitenblätter des Kalenders (#1742): Termin anlegen/bearbeiten, verschieben und eine Terminliste einfügen.
// Gerechnet und geprüft wird im Server - auch die eingefügte Liste: die Vorschau kommt vom Server, übernommen wird nur
// eine fehlerfreie Liste. Rennliga (#1930): ein Termin hat seinen Lauf (Qualifying, Sprint, Rennen …) - Termine mit
// gleichem Kürzel sind eine Runde; die Terminliste legt je Zeile alle Läufe an, die die Saison vorgibt.

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

export function RoundSheet({ series, lineage, round, suggestion, version, onClose, onSaved, onStale }) {
  const isNew = !round?.id;
  const [form, setForm] = useState(() => roundToForm(round || {}, suggestion));
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  // Ein Qualifying zählt in der Regel nicht zur Wertung (#1930) - der Haken folgt der Wahl und bleibt änderbar.
  const setSession = (value) => setForm((current) => {
    const was = sessionKind(current.session) === "qualifying";
    const now = sessionKind(value) === "qualifying";
    return { ...current, session: value, counts: was === now ? current.counts : !now };
  });

  const save = async (event) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = roundPayload(form);
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
          <TextField label="Lauf" value={form.session} onChange={setSession} suggestions={SESSION_CHOICES} maxLength={MAX_SESSION} placeholder="Rennen" testId="round-session"
            hint="Leer: Rennen. Ein Qualifying zählt nicht zur Wertung – außer der Haken unten ist gesetzt." />
        )}
        <TextField label="Strecke oder Ort" value={form.venue} onChange={(v) => set("venue", v)} maxLength={160} testId="round-venue" />
        <SelectField label="Land (Flagge)" value={form.country} onChange={(v) => set("country", v)} options={COUNTRY_CHOICES} testId="round-country"
          hint={countryHint(round, form.country)} />
        <TextField label="Tag" type="date" value={form.day} onChange={(v) => set("day", v)} hint="Leer: Termin noch offen." testId="round-day" />
        <TextField label="Uhrzeit" type="time" value={form.time} onChange={(v) => set("time", v)} hint="Wiener Zeit. Vorgabe ist die Standard-Uhrzeit der Saison; leer: ohne Uhrzeit." testId="round-time" />
        <SelectField label="Art" value={form.kind} onChange={(v) => set("kind", v)} options={ROUND_KIND_OPTIONS} testId="round-kind" />
        {lineage?.kind === "team_league" && <TextField label="Gegner" value={form.opponent} onChange={(v) => set("opponent", v)} maxLength={120} testId="round-opponent" />}
      </FormGrid>
      <TextField label="Eigener Titel" value={form.title} onChange={(v) => set("title", v)} maxLength={160} hint="Optional, etwa „Saisonfinale“." testId="round-title" />
      <CheckField label="Zählt zur Wertung" checked={form.counts} onChange={(v) => set("counts", v)} testId="round-counts" hint="Aus: Die Runde steht im Kalender, geht aber nicht in die Tabelle ein." />
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
  return (
    <AdminSheet title="Terminliste einfügen" eyebrow={lineage?.title} size="lg" onClose={onClose} onSubmit={submit} saving={saving}
      submitLabel={ready ? `${total} Termine übernehmen` : "Vorschau"} savingLabel={ready ? "Übernehme …" : "Prüfe …"} submitTestId="paste-submit" testId="paste-sheet">
      <TextAreaField label="Je Zeile ein Termin" value={text} onChange={edit} rows={8} testId="paste-text" placeholder={"R1 · 05.11. · Strecke\nR2 · 12.11. 20:00 · Strecke\nR3 Strecke"}
        hint={`Kürzel, Datum (TT.MM. oder TT.MM.JJJJ), optional Uhrzeit und Ort – aus dem Ort kommt die Flagge. Ohne Datum: der nächste Standard-Wochentag nach der Zeile davor. Ohne Uhrzeit: ${defaults || "ohne Uhrzeit"}.${lineage?.kind === "racing" ? " Rennliga: Eine Zeile je Runde legt alle Läufe an, die die Saison vorgibt (Ablauf je Runde); „R1 Sprint“, „R1S“ oder „R1 Q“ nur diesen Lauf." : ""}`} />
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
          <div className="overflow-x-auto" data-testid="paste-preview">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-white/45">
                  <th className="py-1.5 pr-3 font-bold">Kürzel</th>
                  <th className="py-1.5 pr-3 font-bold">Tag</th>
                  <th className="py-1.5 pr-3 font-bold">{withSessions ? "Läufe" : "Uhrzeit"}</th>
                  <th className="py-1.5 font-bold">Ort</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className="border-t border-white/5 align-top">
                    <td className="py-1.5 pr-3 font-bold">{row.code || "–"}</td>
                    <td className="py-1.5 pr-3 whitespace-nowrap">
                      {dayLabel(row.day)}
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
                      {row.venue ? <VenueWithFlag round={{ venue: row.venue, country_code: row.country_code }} /> : "–"}
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
