import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, KeyRound, Monitor, RotateCcw, Save, Trash2, Tv } from "lucide-react";
import { toast } from "sonner";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { BrandedQRCode } from "@/components/tls/BrandedQRCode";
import { useConfirm } from "@/components/tls/ConfirmDialog";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";
import { api, formatRequestError } from "@/lib/api";
import { PLAYLIST_SECONDS, PLAYLIST_SLIDES, SLIDE_LABELS, playlistLabel } from "@/lib/tvPlaylist";
import { TV_DEFAULTS, TV_FIELDS, TV_GROUPS, TV_VIEWS, buildTvLink, fieldsForView, linkOverrides, parseTvPath, resolveTvSettings, sameTvValue, tvValueLabel } from "@/lib/tvSettings";
import { viennaDateTime } from "@/lib/vienna";

// TV & Beamer (#1110): eine Stelle für alle Bildschirme. Oben die Grundwerte - sie gelten auf jedem TV und kommen
// ohne Neuladen dort an. Darunter der Link-Baukasten: Ansicht wählen, nur die Abweichungen für diesen Bildschirm
// anhaken, Link kopieren oder als QR-Code öffnen. Der Turnierbaum-TV braucht keinen Moderatoren-Login mehr: sein Link
// trägt einen Anzeige-Schlüssel, der nur das Anschauen erlaubt und unten widerrufen wird. Die Stations-Ansicht (#1120)
// nutzt denselben Schlüssel: ein Link je Station zeigt nur, was dort läuft oder als Nächstes kommt. Meilenstein 60:
// Wiedergabeliste, Aufrufe, Zahlen, Sponsoren und Streckenwechsel als Grundwerte; die Aufruf-Tafel eines ganzen Events
// als eigene Ansicht. Was nur ein Turnier betrifft („Pause bis“, Sponsor je Runde), steht beim Turnier.

const FIELD_BOX = "border border-white/10 bg-[#0F0F0F] rounded-sm p-4";
const INPUT = "bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm";

/** Was in einer Liste von Turnieren, Events oder Challenges als Name steht. */
function titleOf(item) {
  return item?.title || item?.name || item?.id || "";
}

export default function AdminTvPage() {
  const confirm = useConfirm();
  const [payload, setPayload] = useState(null);
  const [draft, setDraft] = useState(() => resolveTvSettings(null));
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/tv/settings");
      setPayload(data);
      setDraft(resolveTvSettings(data?.settings));
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const saved = useMemo(() => resolveTvSettings(payload?.settings), [payload]);
  const changes = useMemo(() => Object.fromEntries(TV_FIELDS.filter((field) => !sameTvValue(field.key, draft[field.key], saved[field.key])).map((field) => [field.key, draft[field.key]])), [draft, saved]);
  const dirty = Object.keys(changes).length > 0;

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      const { data } = await api.put("/tv/settings", changes);
      setPayload(data);
      setDraft(resolveTvSettings(data?.settings));
      toast.success("Gespeichert – alle Bildschirme übernehmen die Grundwerte sofort, ohne Neuladen.");
    } catch (error) {
      toast.error(formatRequestError(error, "Die Grundwerte konnten nicht gespeichert werden."));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    const approved = await confirm({
      title: "Alle Grundwerte auf Standard?",
      description: "Schrift normal, Kontrast aus, kein sicherer Bereich, Pixel-Verschiebung an, Jahreszeiten an, Bewegung normal; Wiedergabeliste Baum 12 s · Live-Spiele 8 s · Aufrufe 8 s · Sponsor 6 s · Zahlen 8 s; Zeit zum Antreten 2 Minuten; Zahlen alle 10 Minuten; Sponsor-Moment alle 3 Minuten, „präsentiert von“ an, Laufband aus; Streckenwechsel 45 Sekunden; Ton aus. Links mit eigenen Abweichungen behalten ihre Abweichungen.",
      confirmLabel: "Auf Standard",
    });
    if (!approved) return;
    setBusy(true);
    try {
      const { data } = await api.delete("/tv/settings");
      setPayload(data);
      setDraft(resolveTvSettings(data?.settings));
      toast.success("Alle Grundwerte stehen wieder auf Standard.");
    } catch (error) {
      toast.error(formatRequestError(error, "Zurücksetzen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AdminLayout>
      <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-[#29B6E8]">eSports</span>
      <h1 className="font-heading text-3xl md:text-4xl font-black uppercase mt-1 flex items-center gap-3"><Tv className="w-7 h-7 text-[#29B6E8]" /> TV &amp; Beamer</h1>
      <p className="text-sm text-white/55 mt-2 max-w-3xl">
        Eine Stelle für alle Bildschirme: Turnierbaum, Station, Aufrufe, Event und Fast Lap am Fernseher oder Beamer. Die Grundwerte gelten überall und kommen ohne Neuladen am TV an.
        Ein einzelner Bildschirm darf abweichen – das steht dann in seinem Link. Was nur ein Turnier betrifft („Pause bis“, welcher Sponsor eine Runde präsentiert), stellst du beim Turnier ein.
      </p>

      <section className="mt-6 border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="tv-defaults">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-heading text-lg font-black uppercase">Grundwerte für alle Bildschirme</h2>
            <p className="mt-1 text-xs text-white/50 max-w-2xl">Voreingestellt ist die Auswahl aus der TV-Vorschau. Geändert wird erst mit „Speichern“.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={reset} disabled={busy || !payload} className="inline-flex items-center gap-2 px-3 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white disabled:opacity-40" data-testid="tv-defaults-reset">
              <RotateCcw className="w-3.5 h-3.5" /> Auf Standard
            </button>
            <button type="button" onClick={save} disabled={busy || !dirty} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-40" data-testid="tv-defaults-save">
              <Save className="w-3.5 h-3.5" /> Speichern
            </button>
          </div>
        </div>
        {loadError && <div className="mt-3 text-xs text-[#FF6B6B]" data-testid="tv-defaults-error">Die Grundwerte konnten nicht geladen werden.</div>}
        <div className="mt-4 space-y-5">
          {TV_GROUPS.map((group) => (
            <div key={group.key} data-testid={`tv-group-${group.key}`}>
              <h3 className="text-xs font-bold uppercase tracking-[0.2em] text-[#29B6E8]">{group.label}</h3>
              <p className="mt-1 text-xs text-white/45 max-w-3xl">{group.hint}</p>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {TV_FIELDS.filter((field) => field.group === group.key).map((field) => (
                  <SettingField key={field.key} field={field} value={draft[field.key]} defaultValue={TV_DEFAULTS[field.key]} disabled={busy || !payload}
                    onChange={(value) => setDraft((current) => ({ ...current, [field.key]: value }))} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <LinkBuilder defaults={saved} />
      <TvKeyList />
    </AdminLayout>
  );
}

/** Eine Zahl mit Grenzen - erst beim Verlassen des Felds wird auf die Grenzen gesetzt, damit man in Ruhe tippen kann. */
function NumberInput({ field, value, onChange, disabled, testId }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => {
    const number = Math.round(Number(text));
    const next = Number.isFinite(number) ? Math.min(field.max, Math.max(field.min, number)) : value;
    setText(String(next));
    if (next !== value) onChange(next);
  };
  return (
    <label className="inline-flex items-center gap-2 text-sm">
      <input type="number" inputMode="numeric" min={field.min} max={field.max} step={1} value={text} disabled={disabled}
        onChange={(event) => setText(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); }}
        className={`${INPUT} w-24`} data-testid={testId} aria-label={field.label} />
      <span className="text-white/60">{field.unit}</span>
      <span className="text-[10px] text-white/35">({field.min} bis {field.max})</span>
    </label>
  );
}

/**
 * Die Wiedergabeliste bearbeiten: je Folie an/aus, Sekunden und Reihenfolge. Mindestens eine Folie bleibt an.
 */
export function PlaylistEditor({ value, onChange, disabled = false, testPrefix = "tv-playlist" }) {
  const rows = useMemo(() => {
    const included = (value || []).map((entry) => ({ ...entry, on: true }));
    const missing = PLAYLIST_SLIDES.filter((slide) => !included.some((entry) => entry.slide === slide))
      .map((slide) => ({ slide, seconds: TV_DEFAULTS.playlist.find((entry) => entry.slide === slide)?.seconds || 8, on: false }));
    return [...included, ...missing];
  }, [value]);
  const emit = (next) => onChange(next.filter((row) => row.on).map((row) => ({ slide: row.slide, seconds: row.seconds })));
  const onCount = rows.filter((row) => row.on).length;
  const move = (index, step) => {
    const next = [...rows];
    const target = index + step;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    emit(next);
  };
  return (
    <div className="space-y-1.5" data-testid={testPrefix}>
      {rows.map((row, index) => (
        <div key={row.slide} className={`flex flex-wrap items-center gap-2 rounded-sm border px-2 py-1.5 ${row.on ? "border-white/15" : "border-white/5 opacity-60"}`} data-testid={`${testPrefix}-${row.slide}`}>
          <label className="inline-flex items-center gap-2 text-sm min-w-[9rem]">
            <input type="checkbox" checked={row.on} disabled={disabled || (row.on && onCount <= 1)} className="accent-[#29B6E8]" data-testid={`${testPrefix}-on-${row.slide}`}
              onChange={(event) => emit(rows.map((entry) => (entry.slide === row.slide ? { ...entry, on: event.target.checked } : entry)))} />
            {SLIDE_LABELS[row.slide]}
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-white/60">
            <input type="number" min={PLAYLIST_SECONDS.min} max={PLAYLIST_SECONDS.max} step={1} value={row.seconds} disabled={disabled || !row.on}
              className={`${INPUT} w-20 py-1`} aria-label={`${SLIDE_LABELS[row.slide]}: Sekunden`} data-testid={`${testPrefix}-seconds-${row.slide}`}
              onChange={(event) => {
                const number = Math.round(Number(event.target.value));
                if (!Number.isFinite(number)) return;
                const seconds = Math.min(PLAYLIST_SECONDS.max, Math.max(PLAYLIST_SECONDS.min, number));
                emit(rows.map((entry) => (entry.slide === row.slide ? { ...entry, seconds } : entry)));
              }} />
            Sekunden
          </label>
          <span className="ml-auto inline-flex gap-1">
            <button type="button" onClick={() => move(index, -1)} disabled={disabled || index === 0} aria-label={`${SLIDE_LABELS[row.slide]} nach oben`} className="p-1 border border-white/10 rounded-sm disabled:opacity-30" data-testid={`${testPrefix}-up-${row.slide}`}><ArrowUp className="w-3.5 h-3.5" /></button>
            <button type="button" onClick={() => move(index, 1)} disabled={disabled || index === rows.length - 1} aria-label={`${SLIDE_LABELS[row.slide]} nach unten`} className="p-1 border border-white/10 rounded-sm disabled:opacity-30" data-testid={`${testPrefix}-down-${row.slide}`}><ArrowDown className="w-3.5 h-3.5" /></button>
          </span>
        </div>
      ))}
    </div>
  );
}

function SettingField({ field, value, defaultValue, onChange, disabled }) {
  const isDefault = sameTvValue(field.key, value, defaultValue);
  return (
    <div className={`${FIELD_BOX} ${field.type === "playlist" ? "md:col-span-2" : ""}`} data-testid={`tv-setting-${field.key}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-bold text-white/90">{field.label}</div>
        <span className={`text-[10px] uppercase tracking-wider text-right ${isDefault ? "text-white/35" : "text-[#FFD700]"}`}>
          {isDefault ? "Standard" : `Standard: ${tvValueLabel(field.key, defaultValue)}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-white/50">{field.hint}</p>
      <div className="mt-3">
        {field.type === "bool" ? (
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={!!value} disabled={disabled} onChange={(event) => onChange(event.target.checked)} className="accent-[#29B6E8]" data-testid={`tv-input-${field.key}`} />
            <span>{value ? "An" : "Aus"}</span>
          </label>
        ) : field.type === "int" ? (
          <NumberInput field={field} value={value} onChange={onChange} disabled={disabled} testId={`tv-input-${field.key}`} />
        ) : field.type === "playlist" ? (
          <PlaylistEditor value={value} onChange={onChange} disabled={disabled} />
        ) : (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={field.label}>
            {field.options.map(([optionValue, optionLabel]) => (
              <button key={String(optionValue)} type="button" role="radio" aria-checked={value === optionValue} disabled={disabled} onClick={() => onChange(optionValue)}
                className={`px-3 py-1.5 rounded-sm border text-xs font-bold uppercase tracking-wider ${value === optionValue ? "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/15 text-white/60 hover:text-white"}`}
                data-testid={`tv-input-${field.key}-${optionValue}`}>
                {optionLabel}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Für die Wiedergabeliste eines einzelnen Bildschirms: fertige Varianten - „nur Aufrufe“ ist die Aufruf-Tafel eines Turniers.
const PLAYLIST_PRESETS = Object.freeze([
  ["only-calls", "Nur hier: nur Aufrufe", [{ slide: "calls", seconds: 8 }]],
  ["only-live", "Nur hier: nur Live-Spiele", [{ slide: "live", seconds: 8 }]],
  ["only-tree", "Nur hier: nur Turnierbaum", [{ slide: "tree", seconds: 12 }]],
  ["custom", "Nur hier: eigene Liste", null],
]);

/** Eine Abweichung für diesen Bildschirm: „wie Grundwert“ oder ein eigener Wert. */
function OverrideSelect({ field, value, defaultValue, onChange }) {
  if (field.type === "playlist") return <PlaylistOverride field={field} value={value} defaultValue={defaultValue} onChange={onChange} />;
  const options = field.type === "bool"
    ? [[true, "An"], [false, "Aus"]]
    : field.type === "int"
      ? [...new Set([...(field.presets || []), ...(value !== undefined ? [value] : [])])].sort((a, b) => a - b).map((number) => [number, `${number} ${field.unit}`])
      : field.options;
  const current = value === undefined ? "" : String(value);
  return (
    <label className="block" data-testid={`tv-override-${field.key}`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{field.label}</div>
      <select value={current} onChange={(event) => {
        const raw = event.target.value;
        if (raw === "") onChange(undefined);
        else onChange(options.find(([optionValue]) => String(optionValue) === raw)?.[0]);
      }} className={`w-full ${INPUT}`} data-testid={`tv-override-input-${field.key}`}>
        <option value="">Wie Grundwert ({tvValueLabel(field.key, defaultValue)})</option>
        {options.map(([optionValue, optionLabel]) => <option key={String(optionValue)} value={String(optionValue)}>Nur hier: {optionLabel}</option>)}
      </select>
    </label>
  );
}

function PlaylistOverride({ field, value, defaultValue, onChange }) {
  const preset = value === undefined ? "" : (PLAYLIST_PRESETS.find(([, , list]) => list && sameTvValue("playlist", list, value))?.[0] || "custom");
  return (
    <div className="block sm:col-span-2" data-testid={`tv-override-${field.key}`}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{field.label}</div>
      <select value={preset} onChange={(event) => {
        const choice = PLAYLIST_PRESETS.find(([key]) => key === event.target.value);
        if (!choice) onChange(undefined);
        else onChange(choice[2] ? choice[2].map((entry) => ({ ...entry })) : (value || defaultValue).map((entry) => ({ ...entry })));
      }} className={`w-full ${INPUT}`} data-testid={`tv-override-input-${field.key}`}>
        <option value="">Wie Grundwert ({playlistLabel(defaultValue)})</option>
        {PLAYLIST_PRESETS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
      {preset === "custom" ? <div className="mt-2"><PlaylistEditor value={value} onChange={onChange} testPrefix="tv-override-playlist" /></div> : null}
    </div>
  );
}

// Aus der Turnier-Bearbeitung kommt man mit ?view=bracket&target=<id> - Ansicht und Turnier stehen dann schon da.
function preset() {
  const params = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const view = TV_VIEWS.some((entry) => entry.key === params.get("view")) ? params.get("view") : "bracket";
  return { view, target: params.get("target") || "" };
}

function LinkBuilder({ defaults }) {
  const [view, setView] = useState(() => preset().view);
  const [targets, setTargets] = useState({ bracket: [], station: [], event: [], calls: [], fastlap: [] });
  const [targetId, setTargetId] = useState(() => preset().target);
  const [stationId, setStationId] = useState("");
  const [stations, setStations] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [label, setLabel] = useState("");
  const [created, setCreated] = useState(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const meta = TV_VIEWS.find((entry) => entry.key === view) || TV_VIEWS[0];
  const fields = fieldsForView(view);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      api.get("/tournaments?include_drafts=true"),
      api.get("/events?include_drafts=true"),
      api.get("/f1/challenges?include_drafts=true"),
    ]).then(([tournaments, events, challenges]) => {
      if (!active) return;
      const rows = (result) => (result.status === "fulfilled" && Array.isArray(result.value.data) ? result.value.data : []);
      setTargets({ bracket: rows(tournaments), station: rows(tournaments), event: rows(events), calls: rows(events), fastlap: rows(challenges) });
    });
    return () => {
      active = false;
    };
  }, []);

  // Die Stationen des gewählten Turniers - für die Stations-Ansicht.
  useEffect(() => {
    if (view !== "station" || !targetId) {
      setStations([]);
      return undefined;
    }
    let active = true;
    api.get(`/stations?tournament_id=${encodeURIComponent(targetId)}`)
      .then(({ data }) => { if (active) setStations(Array.isArray(data) ? data : []); })
      .catch(() => { if (active) setStations([]); });
    return () => {
      active = false;
    };
  }, [view, targetId]);

  // Der Schlüssel gehört zu genau einem Turnier: wechselt das Turnier, braucht der Link einen neuen. Turnierbaum und
  // Stationen desselben Turniers teilen sich einen Schlüssel.
  const key = meta.needsKey && created?.tournament_id === targetId ? created.token : "";
  // Nur Abweichungen, die diese Ansicht nutzt, kommen in den Link.
  const usedOverrides = Object.fromEntries(Object.entries(overrides).filter(([fieldKey]) => fields.some((field) => field.key === fieldKey)));
  const link = buildTvLink({ origin: window.location.origin, view, targetId, stationId, displayKey: key, overrides: usedOverrides });
  const ready = Boolean(link) && (!meta.needsKey || key);

  const createKey = async () => {
    if (!targetId || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post("/tv/keys", { tournament_id: targetId, label: label || "Bildschirm" });
      setCreated(data);
      toast.success("Link mit Anzeige-Schlüssel erstellt. Den Schlüssel zeigt nur diese Seite – Link jetzt kopieren oder am TV öffnen.");
    } catch (error) {
      toast.error(formatRequestError(error, "Der Link konnte nicht erstellt werden."));
    } finally {
      setBusy(false);
    }
  };

  // Einen vorhandenen Link einfügen, um seine Abweichungen zu ändern - der Schlüssel bleibt derselbe.
  const takeOver = () => {
    try {
      const url = new URL(pasted.trim(), window.location.origin);
      const found = parseTvPath(url.pathname);
      if (!found) throw new Error("kein TV-Link");
      setView(found.view);
      setTargetId(found.targetId);
      setStationId(found.stationId);
      setOverrides(linkOverrides(url.searchParams));
      const pastedKey = url.searchParams.get("key");
      const needsKey = TV_VIEWS.find((entry) => entry.key === found.view)?.needsKey;
      setCreated(needsKey && pastedKey ? { token: pastedKey, tournament_id: found.targetId, label: "" } : null);
      setPasted("");
      toast.success("Link übernommen – Abweichungen ändern, dann den neuen Link am TV öffnen.");
    } catch {
      toast.error("Das ist kein Link einer TV-Seite.");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast.success("Link kopiert.");
    } catch {
      toast.error("Kopieren ging nicht – den Link bitte markieren und kopieren.");
    }
  };

  const options = targets[view] || [];
  const viewHint = {
    bracket: "Der Turnierbaum mit Wiedergabeliste: Baum, Live-Spiele, Aufrufe, zwischendurch Sponsor und Zahlen. Vor dem Start zeigt er von selbst Anmeldung oder Check-in, in der Pause die Pause.",
    station: "Der Bildschirm an dieser Station zeigt nur, was dort läuft oder als Nächstes kommt – Durchgänge als Startaufstellung.",
    event: "Die Hallen-Tafel: Tagesplan mit „jetzt“-Linie, alle Stationen, was läuft und was als Nächstes kommt.",
    calls: "Nur die Aufrufe – über alle Turniere des Events: wer jetzt an welche Station soll, mit Countdown.",
    fastlap: "Die Rangliste mit Bestzeit-Moment. Mit fester Strecke im Link wechselt die Strecke nie.",
  }[view];
  return (
    <section className="mt-6 border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="tv-link-builder">
      <h2 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><Monitor className="w-5 h-5 text-[#29B6E8]" /> Link für einen Bildschirm</h2>
      <p className="mt-1 text-xs text-white/50 max-w-3xl">
        Ansicht wählen, nur die Abweichungen für diesen Bildschirm einstellen, Link kopieren oder den QR-Code am TV-Gerät scannen.
        Alles andere kommt aus den Grundwerten. Ändert sich eine Abweichung, den neuen Link am TV öffnen.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Ansicht">
            {TV_VIEWS.map((entry) => (
              <button key={entry.key} type="button" role="radio" aria-checked={view === entry.key} onClick={() => { setView(entry.key); setTargetId(""); setStationId(""); }}
                className={`px-3 py-1.5 rounded-sm border text-xs font-bold uppercase tracking-wider ${view === entry.key ? "border-[#29B6E8] bg-[#29B6E8]/15 text-[#29B6E8]" : "border-white/15 text-white/60 hover:text-white"}`}
                data-testid={`tv-view-${entry.key}`}>
                {entry.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-white/45" data-testid="tv-view-hint">{viewHint}</p>
          <label className="block">
            <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">{meta.target}</div>
            <select value={targetId} onChange={(event) => { setTargetId(event.target.value); setStationId(""); }} className={`w-full ${INPUT}`} data-testid="tv-target">
              <option value="">{meta.target} auswählen</option>
              {options.map((item) => <option key={item.id} value={item.id}>{titleOf(item)}</option>)}
            </select>
          </label>
          {meta.needsStation ? (
            <label className="block">
              <div className="text-[11px] font-bold uppercase tracking-widest text-white/60 mb-1.5">Station</div>
              <select value={stationId} onChange={(event) => setStationId(event.target.value)} disabled={!targetId} className={`w-full ${INPUT} disabled:opacity-50`} data-testid="tv-station">
                <option value="">{targetId && !stations.length ? "Dieses Turnier hat noch keine Stationen" : "Station auswählen"}</option>
                {stations.map((item) => <option key={item.id} value={item.id}>{item.name || item.label || item.id}</option>)}
              </select>
            </label>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <OverrideSelect key={field.key} field={field} value={overrides[field.key]} defaultValue={defaults[field.key]}
                onChange={(value) => setOverrides((current) => {
                  const next = { ...current };
                  if (value === undefined) delete next[field.key];
                  else next[field.key] = value;
                  return next;
                })} />
            ))}
          </div>
          {meta.needsKey ? (
            <div className={FIELD_BOX}>
              <div className="text-sm font-bold text-white/90 inline-flex items-center gap-2"><KeyRound className="w-4 h-4 text-[#FFD700]" /> Anzeige-Schlüssel</div>
              <p className="mt-1 text-xs text-white/50">Damit läuft der Turnierbaum (und jede Station dieses Turniers) am Hallen-PC ohne Anmeldung. Der Schlüssel erlaubt nur das Anschauen dieses einen Turniers und lässt sich unten widerrufen.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="Name des Bildschirms, z. B. Beamer Halle"
                  className={`flex-1 min-w-[12rem] ${INPUT}`} data-testid="tv-key-label" />
                <button type="button" onClick={createKey} disabled={!targetId || busy} className="inline-flex items-center gap-2 px-4 py-2 bg-[#FFD700] text-black rounded-sm text-xs uppercase tracking-wider font-bold disabled:opacity-40" data-testid="tv-key-create">
                  <KeyRound className="w-3.5 h-3.5" /> {key ? "Neuen Schlüssel" : "Link erstellen"}
                </button>
              </div>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <input value={pasted} onChange={(event) => setPasted(event.target.value)} placeholder="Vorhandenen TV-Link einfügen, um ihn zu ändern"
              className={`flex-1 min-w-[12rem] ${INPUT}`} data-testid="tv-link-paste" />
            <button type="button" onClick={takeOver} disabled={!pasted.trim()} className="px-3 py-2 border border-white/15 text-white/70 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white disabled:opacity-40" data-testid="tv-link-takeover">
              Übernehmen
            </button>
          </div>
        </div>

        <div className={`${FIELD_BOX} flex flex-col items-center justify-center gap-3 text-center`} data-testid="tv-link-result">
          {ready ? (
            <>
              <div className="bg-white p-2 rounded-sm"><BrandedQRCode value={link} size={200} /></div>
              <code className="w-full break-all text-xs text-white/70 bg-black/40 border border-white/10 rounded-sm p-2" data-testid="tv-link">{link}</code>
              <div className="flex flex-wrap justify-center gap-2">
                <button type="button" onClick={copy} className="inline-flex items-center gap-2 px-4 py-2 bg-[#29B6E8] text-black rounded-sm text-xs uppercase tracking-wider font-bold" data-testid="tv-link-copy"><Copy className="w-3.5 h-3.5" /> Link kopieren</button>
                <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 border border-white/15 text-white/80 rounded-sm text-xs uppercase tracking-wider font-bold hover:text-white" data-testid="tv-link-open"><ExternalLink className="w-3.5 h-3.5" /> Öffnen</a>
              </div>
              {Object.keys(usedOverrides).length ? (
                <p className="text-xs text-white/50">Abweichungen nur für diesen Bildschirm: {Object.entries(usedOverrides).map(([fieldKey, value]) => `${TV_FIELDS.find((field) => field.key === fieldKey)?.label} ${tvValueLabel(fieldKey, value)}`).join(", ")}.</p>
              ) : <p className="text-xs text-white/50">Keine Abweichungen – dieser Bildschirm folgt den Grundwerten.</p>}
            </>
          ) : (
            <p className="text-sm text-white/45 max-w-sm" data-testid="tv-link-missing">
              {!targetId
                ? `Erst ${meta.target === "Event" ? "ein Event" : meta.target === "Turnier" ? "ein Turnier" : "eine Fast-Lap-Challenge"} auswählen.`
                : meta.needsStation && !stationId
                  ? "Jetzt die Station auswählen."
                  : "Für den Turnierbaum erst „Link erstellen“ – der Link trägt dann den Anzeige-Schlüssel."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

function TvKeyList() {
  const confirm = useConfirm();
  const [keys, setKeys] = useState([]);
  const [error, setError] = useState(false);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/tv/keys");
      setKeys(Array.isArray(data) ? data : []);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  // Neue Schlüssel aus dem Baukasten (und von anderen Admins) erscheinen sofort.
  useApiInvalidation(load, ["tv"]);

  const revoke = async (row) => {
    const approved = await confirm({
      title: `„${row.label}“ widerrufen?`,
      description: `Der Bildschirm mit diesem Link zeigt den Turnierbaum von „${row.tournament_title}“ ab sofort nicht mehr. Ein neuer Link geht jederzeit oben im Baukasten.`,
      confirmLabel: "Widerrufen",
    });
    if (!approved) return;
    try {
      await api.delete(`/tv/keys/${row.id}`);
      toast.success("Widerrufen – der Bildschirm zeigt nichts mehr.");
      load();
    } catch (err) {
      toast.error(formatRequestError(err, "Widerrufen hat nicht geklappt."));
    }
  };

  return (
    <section className="mt-6 border border-white/10 bg-[#121212] rounded-sm p-5" data-testid="tv-keys">
      <h2 className="font-heading text-lg font-black uppercase inline-flex items-center gap-2"><KeyRound className="w-5 h-5 text-[#FFD700]" /> Aktive Anzeige-Schlüssel</h2>
      <p className="mt-1 text-xs text-white/50 max-w-3xl">Jeder Turnierbaum-Link mit Schlüssel steht hier – mit Bildschirm, Turnier und wann er zuletzt da war. Widerrufen beendet ihn sofort.</p>
      {error && <div className="mt-3 text-xs text-[#FF6B6B]">Die Schlüssel konnten nicht geladen werden.</div>}
      {!keys.length && !error ? <div className="mt-4 border border-dashed border-white/15 rounded-sm p-5 text-sm text-white/45" data-testid="tv-keys-empty">Noch keine Turnierbaum-Links mit Schlüssel.</div> : null}
      <div className="mt-4 space-y-2">
        {keys.map((row) => (
          <div key={row.id} className="flex flex-wrap items-center justify-between gap-3 border border-white/10 bg-[#0F0F0F] rounded-sm px-4 py-3" data-testid={`tv-key-${row.id}`}>
            <div className="min-w-0">
              <div className="text-sm font-bold text-white/90">{row.label}</div>
              <div className="text-xs text-white/50">{row.tournament_title} · erstellt {row.created_at ? viennaDateTime(row.created_at, { dateStyle: "short", timeStyle: "short" }) : "–"} · {row.last_used_at ? `zuletzt da ${viennaDateTime(row.last_used_at, { dateStyle: "short", timeStyle: "short" })}` : "noch nie geöffnet"} · <span data-testid={`tv-key-until-${row.id}`} className={row.expired ? "text-[#FF6B6B]" : undefined}>{row.expired ? "abgelaufen (eine Woche nach dem Turnier)" : row.expires_at ? `gilt bis ${viennaDateTime(row.expires_at, { dateStyle: "short" })}` : "gilt bis zum Widerruf"}</span></div>
            </div>
            <button type="button" onClick={() => revoke(row)} className="inline-flex items-center gap-2 px-3 py-2 border border-[#FF3B30]/40 text-[#FF6B6B] rounded-sm text-xs uppercase tracking-wider font-bold hover:bg-[#FF3B30]/10" data-testid={`tv-key-revoke-${row.id}`}>
              <Trash2 className="w-3.5 h-3.5" /> Widerrufen
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
