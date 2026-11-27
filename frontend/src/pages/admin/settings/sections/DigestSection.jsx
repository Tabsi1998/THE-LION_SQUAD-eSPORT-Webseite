// E-Mail → Sammel-Mail (#1662): die Vorgaben des Vereins für die Sammel-Mail - welcher Rhythmus gilt, solange jemand nichts
// selbst wählt, und wann die Mail kommt (Wiener Zeit). Daneben die Vorschau mit Beispielzeilen; verschickt wird hier nichts.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, formatRequestError } from "@/lib/api";

const RHYTHMS = [
  { key: "instant", label: "Sofort", hint: "Jede Mail einzeln, wie bisher." },
  { key: "daily", label: "Täglich", hint: "Eine Mail am Tag." },
  { key: "weekly", label: "Wöchentlich", hint: "Eine Mail in der Woche." },
];
const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
const field = "w-full min-h-11 bg-[#050505] border border-white/15 rounded-sm px-3 text-white focus:outline-none focus:border-[#29B6E8]";

export function DigestSection() {
  const [draft, setDraft] = useState(null);
  const [saved, setSaved] = useState(null);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const loadPreview = useCallback(() => {
    api.get("/settings/notification-digest/preview")
      .then(({ data }) => setPreview(data || null))
      .catch(() => setPreview({ failed: true }));
  }, []);
  useEffect(() => {
    api.get("/settings/notification-digest")
      .then(({ data }) => { setDraft(data?.settings || null); setSaved(data || null); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Die Vorgaben lassen sich gerade nicht laden.")));
    loadPreview();
  }, [loadPreview]);

  const timesValid = draft && CLOCK.test(draft.daily_time || "") && CLOCK.test(draft.weekly_time || "");
  const changed = draft && saved && JSON.stringify(draft) !== JSON.stringify(saved.settings);
  const save = async () => {
    if (!timesValid) return;
    setSaving(true);
    try {
      const { data } = await api.put("/settings/notification-digest", draft);
      setSaved(data);
      setDraft(data.settings);
      toast.success("Vorgaben der Sammel-Mail gespeichert.");
    } catch (failure) {
      toast.error(formatRequestError(failure, "Speichern hat nicht geklappt."));
    } finally {
      setSaving(false);
    }
  };
  const update = (patch) => setDraft((value) => ({ ...value, ...patch }));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] items-start" data-testid="digest-settings">
      <div className="space-y-4">
        <div className="border border-[#29B6E8]/25 bg-[#29B6E8]/5 rounded-sm p-4 tls-type-small text-white/70">
          <div className="font-bold uppercase text-[#29B6E8] mb-1">Sammel-Mail</div>
          <p>Jede Person wählt in ihren Einstellungen, ob optionale Mails sofort, täglich oder wöchentlich kommen. Hier steht, was gilt, solange sie nichts wählt, und wann die Sammel-Mail hinausgeht. Pflicht-Mails und Dringendes (Spiel in 10 Minuten, Check-in schließt, Ergebnis bestätigen) kommen immer sofort.</p>
        </div>
        {error ? <div className="border border-warn/40 bg-warn/10 text-warn rounded-sm p-4 tls-type-small" role="alert" data-testid="digest-settings-error">{error}</div> : null}
        {!draft && !error ? <div className="tls-type-small text-white/45" role="status">Lade Vorgaben …</div> : null}
        {draft ? (
          <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-5">
            <fieldset>
              <legend className="tls-type-small font-bold mb-2">Vorgabe für alle ohne eigene Wahl</legend>
              <div className="grid gap-2">
                {RHYTHMS.map((rhythm) => (
                  <label key={rhythm.key} className={`flex items-start gap-3 p-3 border rounded-sm cursor-pointer ${draft.default_rhythm === rhythm.key ? "border-[#29B6E8]/60 bg-[#29B6E8]/5" : "border-white/10"}`}>
                    <input type="radio" name="digest-default" value={rhythm.key} checked={draft.default_rhythm === rhythm.key} onChange={() => update({ default_rhythm: rhythm.key })} className="mt-1 accent-[#29B6E8]" data-testid={`digest-default-${rhythm.key}`} />
                    <span><span className="font-bold text-white block">{rhythm.label}</span><span className="tls-type-small text-white/50">{rhythm.hint}</span></span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <label className="block col-span-2 sm:col-span-1">
                <span className="tls-type-label text-white/45">Täglich um</span>
                <input type="time" step="900" value={draft.daily_time || ""} onChange={(event) => update({ daily_time: event.target.value })} className={`${field} mt-1`} data-testid="digest-daily-time" />
              </label>
              <span className="hidden sm:block" />
              <label className="block">
                <span className="tls-type-label text-white/45">Wöchentlich am</span>
                <select value={draft.weekly_weekday} onChange={(event) => update({ weekly_weekday: Number(event.target.value) })} className={`${field} mt-1`} data-testid="digest-weekday">
                  {WEEKDAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="tls-type-label text-white/45">um</span>
                <input type="time" step="900" value={draft.weekly_time || ""} onChange={(event) => update({ weekly_time: event.target.value })} className={`${field} mt-1`} data-testid="digest-weekly-time" />
              </label>
            </div>
            <p className="tls-type-small text-white/45">Wiener Zeit. Was nach dem Termin dazukommt, wartet auf den nächsten. Der Versand-Job sieht alle 10 Minuten nach.</p>
            {!timesValid ? <p className="tls-type-small text-warn" role="alert" data-testid="digest-time-error">Bitte eine Uhrzeit wie 07:00 angeben.</p> : null}
            <button type="button" onClick={save} disabled={!changed || !timesValid || saving} className="tls-btn tls-btn--primary min-h-11 px-4 rounded-sm tls-type-label disabled:opacity-50" data-testid="digest-save">
              {saving ? "Speichert …" : "Speichern"}
            </button>
          </div>
        ) : null}
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm overflow-hidden" data-testid="digest-preview">
        <div className="px-4 py-3 border-b border-white/10 flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="tls-type-label">Vorschau</div>
            <div className="tls-type-small text-white/50 break-words" data-testid="digest-preview-subject">{preview?.subject || "Betreff folgt …"}</div>
          </div>
          <button type="button" onClick={loadPreview} className="min-h-11 px-3 border border-white/15 rounded-sm tls-type-label text-white/60 hover:text-white">Neu laden</button>
        </div>
        {preview?.failed ? (
          <div className="p-4 tls-type-small text-white/60" role="alert">Die Vorschau lässt sich gerade nicht laden.</div>
        ) : preview?.html ? (
          // Ohne Skripte und ohne Formulare - nur ansehen. Die Links zeigen auf die echte Website.
          <iframe title="Vorschau der Sammel-Mail" sandbox="" srcDoc={preview.html} className="w-full h-[42rem] bg-white" data-testid="digest-preview-frame" />
        ) : (
          <div className="h-64 motion-safe:animate-pulse bg-white/[0.03]" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
