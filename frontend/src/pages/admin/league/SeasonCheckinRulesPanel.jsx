// Check-in je Season (#1652, docs/LIGA.md D.2): Fenster um den Termin, Mindestzahl Anwesender, Erinnerung vor Schluss. Eigener
// Kasten mit eigenem Speichern - die Werte gelten sofort für alle nicht gesperrten Staffeln der Season, kein „Übertragen“ nötig.
// Kommt mit dem Umbau der Season-Seite in den Reiter „Spielbetrieb“.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";

const NUMBERS = ["opens_minutes_before", "closes_minutes_after", "min_present", "remind_minutes_before_close"];

/** Die Eingabe als Werte für den Server: ganze Zahlen, leer heißt Vorgabe. */
export function checkinRulesPayload(form) {
  const out = {};
  for (const key of NUMBERS) {
    if (form[key] === "" || form[key] == null) continue;
    out[key] = Number.parseInt(String(form[key]), 10);
  }
  return out;
}

export function SeasonCheckinRulesPanel({ seasonId }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/checkin-rules`).then(({ data }) => {
      if (!alive || !data?.defaults) return;
      setState(data);
      setForm({ ...(data.checkin_rules || data.defaults) });
    }).catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Check-in-Regeln konnten nicht geladen werden."));
    return () => { alive = false; };
  }, [seasonId]);

  if (!form) {
    return error ? <p className="text-sm text-warn" role="alert" data-testid="checkin-rules-error">{error}</p> : null;
  }
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/checkin-rules`, checkinRulesPayload(form));
      setState(data);
      setForm({ ...data.checkin_rules });
      toast.success(data.staffeln_updated ? `Check-in gespeichert – gilt jetzt in ${data.staffeln_updated} Staffel${data.staffeln_updated === 1 ? "" : "n"}.` : "Check-in gespeichert.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Check-in-Regeln konnten nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormSection title="Check-in vor dem Spiel" testId="season-checkin-rules"
      hint="Gilt sofort für alle Staffeln dieser Season (gesperrte nehmen es beim Übertragen mit). Regelwerk § 8: Nach dem Fenster entscheidet die Leitung, gewertet wird nie automatisch.">
      {!state?.active ? (
        <p className="rounded-sm border border-warn/30 bg-warn/5 px-3 py-2 text-sm text-white/75" data-testid="checkin-rules-inactive">
          Diese Season ist älter als der Check-in: Dort gibt es keinen Check-in und keinen Vorschlag „nicht erschienen“, bis ihr einmal speichert.
        </p>
      ) : null}
      <FormGrid cols={2}>
        <TextField label="Öffnet (Minuten vor dem Termin)" type="number" min={1} max={240} value={form.opens_minutes_before}
          onChange={(value) => set("opens_minutes_before", value)} hint="Nr. 19: Vorgabe 15" testId="checkin-rules-opens" />
        <TextField label="Schließt (Minuten nach dem Termin)" type="number" min={0} max={240} value={form.closes_minutes_after}
          onChange={(value) => set("closes_minutes_after", value)} hint="danach entscheidet die Leitung" testId="checkin-rules-closes" />
        <TextField label="Mindestens Anwesende je Seite" type="number" min={1} max={50} value={form.min_present}
          onChange={(value) => set("min_present", value)} hint="Nr. 46: nur Kader, nur spielberechtigt; Vorgabe aus Teilnehmerliste oder Teamgröße − 1" testId="checkin-rules-min" />
        <TextField label="Erinnerung vor Schluss (Minuten)" type="number" min={0} max={60} value={form.remind_minutes_before_close}
          onChange={(value) => set("remind_minutes_before_close", value)} hint="0 = keine zweite Erinnerung" testId="checkin-rules-remind" />
      </FormGrid>
      {error ? <p className="text-sm text-warn" role="alert" data-testid="checkin-rules-error">{error}</p> : null}
      <button type="button" onClick={save} disabled={saving} data-testid="checkin-rules-save"
        className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
        {saving ? "Speichere …" : "Check-in speichern"}
      </button>
    </FormSection>
  );
}
