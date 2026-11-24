// Liga im Discord je Season (#1642): Spieltag-Zusammenfassung je Staffel und Saisonende-Meldung - an/aus, ein Kanal für beides, wie lange
// auf fehlende Ergebnisse gewartet wird und wie viele Plätze der Tabellenausschnitt zeigt. Eigener Kasten mit eigenem Speichern im Reiter
// „Termine“ (Sprungmarke `#discord`). Ohne Einstellung ist alles aus. Ändern darf „Season konfigurieren“ (der Server prüft). Wählbar
// sind nur die freigegebenen Kanäle (Nr. 234): die öffentlichen „Kanäle je Zweck“ unter Verbindungen → Discord. Dazu die Hinweise zu
// Meldungen, deren Zustellung unklar ist (nie von selbst wiederholt) oder die aufgegeben wurden - je Hinweis „Noch einmal senden“
// (Nr. 239), nachdem die Leitung im Kanal nachgesehen hat. Die Hinweise laden live nach (K5), ohne das Formular zu überschreiben.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { FormGrid, FormSection } from "@/components/tls/AdminForm";
import { CheckField, SelectField, TextField } from "@/components/tls/FormFields";
import { api, formatApiError } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";

const REFRESH_MS = 60000;
const RELEASE_CONFIRM = "Ich habe im Kanal nachgesehen, die Meldung fehlt";

/** Die Eingabe als Werte für den Server: Schalter an/aus, Zahlen ganz; ein leeres Zahlenfeld nimmt die Vorgabe. */
export function discordPayload(form) {
  const number = (value) => (value === "" || value == null ? null : Number.parseInt(String(value), 10));
  return {
    matchday: Boolean(form.matchday), season_end: Boolean(form.season_end), late: Boolean(form.late),
    channel_id: String(form.channel_id || "").trim(), wait_hours: number(form.wait_hours), table_rows: number(form.table_rows),
  };
}

/** Die freigegebenen Kanäle zur Wahl, je mit Zweck - ein gespeicherter, der nicht (mehr) freigegeben ist, bleibt sichtbar. */
export function channelOptions(channels, chosen) {
  const rows = [["", "– kein Kanal –"]];
  if (chosen && !(channels || []).some((channel) => channel.id === chosen)) rows.push([chosen, `Kanal ${chosen} (nicht freigegeben)`]);
  for (const channel of channels || []) {
    const where = channel.category ? `${channel.category} › ` : "";
    const name = channel.name ? `${where}#${channel.name}` : `Kanal ${channel.id}`;
    const purpose = channel.purpose ? `${channel.purpose} · ` : "";
    rows.push([channel.id, `${purpose}${name}${channel.can_send ? "" : " (Bot darf dort nicht schreiben)"}`]);
  }
  return rows;
}

const PLACE = "Verbindungen → Discord → Kanäle je Zweck";

export function SeasonDiscordPanel({ seasonId, canEdit = true }) {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [releasing, setReleasing] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get(`/admin/leagues/seasons/${seasonId}/discord`).then(({ data }) => {
      if (!alive || !data?.settings) return;
      setState(data);
      setForm({ ...data.settings });
    }).catch((failure) => alive && setError(formatApiError(failure.response?.data?.detail) || "Discord-Einstellung konnte nicht geladen werden."));
    return () => { alive = false; };
  }, [seasonId]);
  // Live (K5): nur der Stand vom Server (Hinweise, Kanäle) - das Formular bleibt, wie die Leitung es gerade bearbeitet.
  const refresh = useCallback(async () => {
    try {
      const { data } = await api.get(`/admin/leagues/seasons/${seasonId}/discord`);
      if (data?.settings) setState(data);
    } catch {
      // Beim nächsten Mal wieder - ein fehlgeschlagenes Nachladen ändert nichts am Kasten.
    }
  }, [seasonId]);
  useLiveRefresh(refresh, ["leagues"], { fallbackMs: REFRESH_MS });

  if (!form) return error ? <p className="text-sm text-warn" role="alert" data-testid="season-discord-error">{error}</p> : null;
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const release = async () => {
    if (!releasing?.confirmed) return;
    setReleasing((current) => ({ ...current, busy: true }));
    setError("");
    try {
      const { data } = await api.post(`/admin/leagues/seasons/${seasonId}/discord/release`, { key: releasing.key, confirm: true });
      setState(data);
      setReleasing(null);
      toast.success("Freigegeben – die Meldung geht mit dem nächsten Lauf hinaus (spätestens in 15 Minuten), genau einmal.");
    } catch (failure) {
      setReleasing(null);
      setError(formatApiError(failure.response?.data?.detail) || "Die Meldung konnte nicht freigegeben werden.");
      if (failure.response?.status === 409 || failure.response?.status === 404) await refresh();
    }
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const { data } = await api.put(`/admin/leagues/seasons/${seasonId}/discord`, discordPayload(form));
      setState(data);
      setForm({ ...data.settings });
      toast.success(data.settings.matchday || data.settings.season_end ? "Discord-Meldungen gespeichert." : "Discord-Meldungen aus.");
    } catch (failure) {
      setError(formatApiError(failure.response?.data?.detail) || "Discord-Einstellung konnte nicht gespeichert werden.");
    } finally {
      setSaving(false);
    }
  };
  const anyOn = form.matchday || form.season_end;
  const listed = (state?.channels || []).length > 0;
  const problems = state?.problems || [];
  const notApproved = state?.channel_approved === false && Boolean(form.channel_id) && form.channel_id === state?.settings?.channel_id;

  return (
    <FormSection title="Discord" testId="season-discord"
      hint="Meldungen im Discord des Vereins: nach jedem Spieltag eine Zusammenfassung je Staffel, am Ende der Season Meister, Auf- und Absteiger mit Link zur Season-Seite. Ohne Einstellung ist alles aus.">
      {state && !state.public ? (
        <p className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white" role="note" data-testid="season-discord-hidden">
          Diese Season ist nicht öffentlich – solange geht nichts hinaus, auch wenn es eingeschaltet ist.
        </p>
      ) : null}
      {!canEdit ? (
        <p className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-white/75" data-testid="season-discord-readonly">
          Nur lesen: Ändern darf, wer für diese Liga „Season konfigurieren“ hat.
        </p>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-sm border border-white/10 bg-white/[0.02] p-3">
          <CheckField label="Spieltag-Zusammenfassung" checked={form.matchday} onChange={(value) => set("matchday", value)} disabled={!canEdit}
            testId="season-discord-matchday" className="min-h-[44px]"
            hint="Je Staffel: Ergebnisse und Tabellenausschnitt, sobald alle Spiele des Spieltags gewertet sind. Gilt ab dem laufenden Spieltag – frühere gehen nicht nachträglich hinaus." />
          <div className="mt-2 space-y-3 pl-6">
            <FormGrid cols={2}>
              <TextField label="Warten auf Ergebnisse (Stunden nach Ende der Spielwoche)" type="number" min={0} max={336} value={form.wait_hours ?? ""}
                onChange={(value) => set("wait_hours", value)} hint="Vorgabe 48" disabled={!canEdit || !form.matchday} testId="season-discord-wait" />
              <TextField label="Plätze im Tabellenausschnitt" type="number" min={0} max={20} value={form.table_rows ?? ""}
                onChange={(value) => set("table_rows", value)} hint="Vorgabe 5 · 0 = ohne Tabelle" disabled={!canEdit || !form.matchday} testId="season-discord-rows" />
            </FormGrid>
            <CheckField label="Nach der Wartezeit trotzdem melden" checked={form.late} onChange={(value) => set("late", value)}
              disabled={!canEdit || !form.matchday} testId="season-discord-late"
              hint="Mit „x Spiele offen“. Aus: der Spieltag geht erst hinaus, wenn alles gewertet ist." />
          </div>
        </div>
        <div className="rounded-sm border border-white/10 bg-white/[0.02] p-3">
          <CheckField label="Saisonende-Meldung" checked={form.season_end} onChange={(value) => set("season_end", value)} disabled={!canEdit}
            testId="season-discord-end" className="min-h-[44px]"
            hint="Einmal, sobald alle Staffeln abgeschlossen sind: Meister, je Liga N die Auf- und Absteiger, Link zur Season-Seite." />
        </div>
      </div>
      <FormGrid cols={2}>
        <SelectField label="Kanal" value={form.channel_id || ""} onChange={(value) => set("channel_id", value)} options={channelOptions(state?.channels, form.channel_id)}
          disabled={!canEdit} testId="season-discord-channel"
          hint={`Ein Kanal für beide Meldungen – kein Rückfall auf einen anderen. Zur Wahl stehen die freigegebenen Kanäle (${PLACE}).${state?.channels_text ? ` ${state.channels_text}` : ""}`} />
      </FormGrid>
      {!listed ? (
        <p className="rounded-sm border border-white/15 bg-white/[0.03] px-3 py-2 text-sm text-white/80" role="note" data-testid="season-discord-no-channels">
          Noch kein Kanal freigegeben. Freigeben unter <a className="underline underline-offset-2" href="/admin/integrations/discord">{PLACE}</a> (Community, News oder Events und Turniere).
        </p>
      ) : null}
      {notApproved ? (
        <p className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white" role="note" data-testid="season-discord-not-approved">
          Der gespeicherte Kanal ist nicht freigegeben – solange geht nichts hinaus. Bitte einen freigegebenen Kanal wählen.
        </p>
      ) : null}
      {problems.length ? (
        <div className="rounded-sm border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-white" role="note" data-testid="season-discord-problems">
          <p className="font-bold">Meldungen, die du prüfen solltest</p>
          <ul className="mt-1 space-y-1">
            {problems.map((row) => (
              <li key={row.key || `${row.kind}-${row.label}-${row.at}`} className="space-y-2">
                <p><span className="font-semibold">{row.label}:</span> {row.text}</p>
                {canEdit && row.key && releasing?.key !== row.key ? (
                  <button type="button" onClick={() => setReleasing({ key: row.key, confirmed: false })} data-testid={`season-discord-release-${row.key}`}
                    className="tls-btn tls-btn--secondary min-h-11 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">
                    Noch einmal senden
                  </button>
                ) : null}
                {canEdit && row.key && releasing?.key === row.key ? (
                  <div className="space-y-2 rounded-sm border border-white/15 bg-black/20 p-2" data-testid="season-discord-release-box">
                    <CheckField label={RELEASE_CONFIRM} checked={releasing.confirmed} onChange={(value) => setReleasing((current) => ({ ...current, confirmed: Boolean(value) }))}
                      testId="season-discord-release-confirm" className="min-h-[44px]"
                      hint="Erst nachsehen: Steht sie doch im Kanal, nicht freigeben – sonst steht sie zweimal da." />
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={release} disabled={!releasing.confirmed || releasing.busy} data-testid="season-discord-release-go"
                        className="tls-btn tls-btn--primary min-h-11 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-40">
                        {releasing.busy ? "Gebe frei …" : "Freigeben"}
                      </button>
                      <button type="button" onClick={() => setReleasing(null)} data-testid="season-discord-release-cancel"
                        className="tls-btn tls-btn--secondary min-h-11 rounded-sm px-3 py-2 text-xs font-bold uppercase tracking-wider">
                        Abbrechen
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {anyOn && !String(form.channel_id || "").trim() ? <p className="text-sm text-warn" data-testid="season-discord-channel-missing">Bitte einen Kanal wählen – ohne Kanal geht nichts hinaus.</p> : null}
      {error ? <p className="text-sm text-warn" role="alert" data-testid="season-discord-error">{error}</p> : null}
      {canEdit ? (
        <button type="button" onClick={save} disabled={saving} data-testid="season-discord-save"
          className="tls-btn tls-btn--primary min-h-11 rounded-sm px-4 py-2 text-xs font-bold uppercase tracking-wider disabled:opacity-50">
          {saving ? "Speichere …" : "Discord speichern"}
        </button>
      ) : null}
    </FormSection>
  );
}
