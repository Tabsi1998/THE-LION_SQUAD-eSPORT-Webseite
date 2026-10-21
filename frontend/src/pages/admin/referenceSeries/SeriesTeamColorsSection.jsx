import { useCallback, useEffect, useMemo, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { toast } from "sonner";
import { Sparkles, X } from "lucide-react";

// Teamfarben der Saison (#1950): je Team eine Farbe für Startnummer und Teamname in der Ergebnistabelle je Runde, wie in
// den Grafiken des Veranstalters. Nur für den Vorstand und nur bei einer Rennliga. Leer heißt neutral. Liest jemand ein
// Ergebnis-Bild (#1756), merkt sich der Server die Schriftfarben als Vorschlag - übernommen wird erst hier.

const HEX = /^#[0-9a-f]{6}$/;
const NEUTRAL = "#a1a1aa";

function clean(value) {
  const text = String(value || "").trim().toLowerCase();
  return HEX.test(text) ? text : "";
}

export function SeriesTeamColorsSection({ series }) {
  const [teams, setTeams] = useState(null);
  const [draft, setDraft] = useState({});
  const [failed, setFailed] = useState("");
  const [saving, setSaving] = useState(false);
  const seriesId = series.id;
  const url = `/reference-series/admin/series/${seriesId}/team-colors`;

  const apply = useCallback((list) => {
    setTeams(list);
    setDraft(Object.fromEntries(list.map((item) => [item.team, item.color || ""])));
  }, []);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(url);
      apply(data.teams || []);
      setFailed("");
    } catch (err) {
      setFailed(formatApiError(err.response?.data?.detail) || "Teamfarben konnten nicht geladen werden.");
    }
  }, [url, apply]);
  useEffect(() => { load(); }, [load]);

  const changed = useMemo(() => (teams || []).some((item) => (draft[item.team] || "") !== (item.color || "")), [teams, draft]);
  const open = useMemo(() => (teams || []).filter((item) => item.suggestion && clean(draft[item.team]) !== item.suggestion), [teams, draft]);
  const invalid = Object.values(draft).some((value) => value && !clean(value));
  const set = (team, value) => setDraft((current) => ({ ...current, [team]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const colors = Object.fromEntries(Object.entries(draft).map(([team, value]) => [team, clean(value) || null]));
      const { data } = await api.put(url, { colors });
      apply(data.teams || []);
      toast.success("Teamfarben gespeichert.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-white/10 rounded-sm bg-[#121212] p-4" aria-labelledby="series-colors-heading" data-testid="series-team-colors">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="series-colors-heading" className="text-[11px] font-bold uppercase tracking-widest text-[#29B6E8]">Teamfarben</h2>
          <p className="mt-1 text-sm text-white/60">Startnummer und Team in der Ergebnistabelle je Runde – wie in den Grafiken des Veranstalters. Leer heißt neutral.</p>
        </div>
        {open.length > 0 && (
          <button type="button" onClick={() => setDraft((current) => ({ ...current, ...Object.fromEntries(open.map((item) => [item.team, item.suggestion])) }))}
            className="tls-btn tls-btn--secondary px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider inline-flex items-center gap-2" data-testid="series-colors-take-all">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" /> Vorschläge aus dem Bild ({open.length})
          </button>
        )}
      </div>
      {failed && <p className="mt-3 text-sm text-white/60" data-testid="series-colors-error">{failed}</p>}
      {teams && teams.length === 0 && <p className="mt-3 text-sm text-white/50" data-testid="series-colors-empty">Noch keine Teams – sie kommen mit den Teilnehmern und Ergebnissen.</p>}
      {teams && teams.length > 0 && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2" data-testid="series-colors-list">
          {teams.map((item) => {
            const value = draft[item.team] || "";
            const color = clean(value);
            const wrong = Boolean(value) && !color;
            return (
              <li key={item.team} className="flex items-center gap-2 rounded-sm border border-white/10 bg-[#0A0A0A] px-2.5 py-2" data-testid="series-colors-row">
                <input type="color" value={color || NEUTRAL} onChange={(event) => set(item.team, event.target.value)}
                  aria-label={`Farbe für ${item.team}`} className="h-8 w-9 shrink-0 cursor-pointer rounded-sm border border-white/15 bg-transparent p-0.5" data-testid="series-colors-picker" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold italic" style={{ color: color || NEUTRAL }}>{item.team}</span>
                  {item.own && <span className="tls-standing-me mt-0.5">Verein</span>}
                </span>
                <input value={value} onChange={(event) => set(item.team, event.target.value)} placeholder="neutral" maxLength={7} spellCheck={false}
                  aria-label={`Farbwert für ${item.team}`} aria-invalid={wrong || undefined}
                  className={`w-[5.5rem] shrink-0 rounded-sm border bg-[#121212] px-2 py-1.5 text-xs tabular-nums text-white ${wrong ? "border-amber-400/70" : "border-white/15"}`} data-testid="series-colors-hex" />
                {item.suggestion && item.suggestion !== color && (
                  <button type="button" onClick={() => set(item.team, item.suggestion)} title={`Vorschlag aus dem Bild: ${item.suggestion}`} aria-label={`Vorschlag aus dem Bild für ${item.team} übernehmen`}
                    className="tls-hit h-7 w-7 shrink-0 rounded-sm border border-white/20" style={{ backgroundColor: item.suggestion }} data-testid="series-colors-suggestion" />
                )}
                {value && (
                  <button type="button" onClick={() => set(item.team, "")} aria-label={`Farbe von ${item.team} entfernen`} title="Neutral"
                    className="tls-hit p-1.5 text-white/45 hover:text-white" data-testid="series-colors-clear">
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {teams && teams.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={!changed || invalid || saving} data-testid="series-colors-save"
            className="tls-btn tls-btn--primary px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50">
            Teamfarben speichern
          </button>
          {invalid && <span className="text-xs text-warn">Farbe als #rrggbb, etwa #29b6e8.</span>}
        </div>
      )}
    </section>
  );
}
