import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Eye, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api, formatApiError } from "@/lib/api";
import { useLiveRefresh } from "@/hooks/useLiveRefresh";
import { SeasonsWeatherCard } from "./SeasonsWeatherCard";
import { asInstant, viennaDate, viennaDateTime } from "@/lib/vienna";

// Jahreszeiten (#632/#633): Halloween, Advent, Weihnachten, Silvester, Fasching, Geburtstag, Ostern - alles
// an einem Ort. Ein Hauptschalter, je Saison Ein/Aus, automatisch nach Datum oder erzwungen (bis wann),
// Stärke, Kanäle, Texte mit Vorgaben, und „Vorschau 60 Sekunden“ nur für die eigene Sitzung.

export const PREVIEW_STORAGE_KEY = "tls-season-preview";
export const INTENSITY_LABELS = { subtle: "dezent", normal: "normal", full: "voll" };
export const MODE_LABELS = { auto: "automatisch nach Datum", force_on: "jetzt an", force_off: "aus" };
export const CHANNEL_LABELS = { web: "Website", app: "App" };
export const TEXT_LABELS = { greeting: "Gruß", farewell: "Abschied am 6. Jänner" };
// Adventkalender und Ostereiersuche schalten Redaktion und Vereinsverwaltung auf ihrer eigenen Seite (#1360) - hier
// stehen sie nur zum Lesen, damit das System den Gesamtstand sieht.
export const MANAGED_ELSEWHERE = { advent_calendar: { to: "/admin/advent", page: "Adventkalender" }, easter_hunt: { to: "/admin/ostern", page: "Ostereiersuche" } };

export function dateText(value, { withTime = true } = {}) {
  if (!value) return "–";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return withTime
    ? viennaDateTime(date, { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : viennaDate(date, { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", year: "numeric" });
}

// Ein Satz je Saison: läuft gerade, erzwungen, nächstes Fenster, oder was fehlt.
export function stateText(season) {
  if (season.needs_founded_on) return "Braucht das Gründungsdatum unter Verein → Über uns.";
  if (!season.enabled) return "Ausgeschaltet.";
  if (season.active_now) return season.forced ? "Läuft gerade – erzwungen." : `Läuft gerade (${season.phase}).`;
  if (season.mode === "force_off") return season.until ? `Aus bis ${dateText(season.until)}.` : "Aus, bis du wieder auf automatisch stellst.";
  if (!season.next_start) return "Kein Termin gefunden.";
  return `Nächstes Mal ${dateText(season.next_start, { withTime: false })} bis ${dateText(season.next_end, { withTime: false })}.`;
}

/** Was gerade wirklich läuft (für den Satz zum Wetter): nichts, solange der Hauptschalter aus ist. */
export function runningSeasons(data) {
  if (!data || !data.enabled) return [];
  return (data.seasons || []).filter((season) => season.active_now).map((season) => ({ key: season.key, effective: season.intensity || "normal" }));
}

// Für das Eingabefeld: in der Zeit des Geräts - so zeigt der Browser das Feld.
export function toLocalInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function rememberPreview(token, seconds) {
  try {
    sessionStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify({ token, expires: Date.now() + seconds * 1000 }));
  } catch {
    // Kein sessionStorage (privates Fenster): die Vorschau geht dann nur über die Antwort des Servers.
  }
  // Die Bühne liest das Token sofort neu - ohne Neuladen, auch hier im Admin.
  try {
    window.dispatchEvent(new CustomEvent("tls:season-preview"));
  } catch {
    // Alte Umgebung ohne CustomEvent: der nächste Tab-Wechsel oder das nächste Laden holt die Vorschau.
  }
}

function ManagedSeasonCard({ season }) {
  const place = MANAGED_ELSEWHERE[season.key];
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4" data-testid={`season-${season.key}`}>
      <div className="font-heading font-bold uppercase inline-flex items-center gap-2">
        {season.label}
        {season.active_now && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[#00FF88]/15 text-[#00FF88] tracking-wider">läuft</span>}
      </div>
      <p className="mt-1 text-sm text-white/75" data-testid={`season-${season.key}-managed`}>
        {season.enabled ? "An" : "Aus"} – gepflegt unter <Link to={place.to} className="text-[#29B6E8] hover:underline">{place.page}</Link>.
      </p>
      <p className="mt-1 text-xs text-white/50" data-testid={`season-${season.key}-state`}>{stateText(season)}</p>
    </div>
  );
}

function SeasonCard({ season, busy, onSave, onPreview }) {
  const [texts, setTexts] = useState(null);
  const [previewAt, setPreviewAt] = useState("");
  const draft = texts ?? season.texts;
  const dirty = texts !== null && Object.keys(draft).some((name) => draft[name] !== season.texts[name]);
  const textNames = Object.keys(season.defaults || {});
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3" data-testid={`season-${season.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-heading font-bold uppercase inline-flex items-center gap-2">
            {season.label}
            {season.active_now && <span className="text-[10px] px-1.5 py-0.5 rounded-sm bg-[#00FF88]/15 text-[#00FF88] tracking-wider" data-testid={`season-${season.key}-live`}>läuft</span>}
          </div>
          <p className="mt-1 text-xs text-white/50 max-w-2xl">{season.description}</p>
          <p className="mt-1 text-xs text-white/70" data-testid={`season-${season.key}-state`}>{stateText(season)}</p>
        </div>
        <label className="flex items-center gap-2 text-sm shrink-0">
          <input type="checkbox" checked={!!season.enabled} disabled={busy} onChange={(e) => onSave({ enabled: e.target.checked }, e.target.checked ? `${season.label} an.` : `${season.label} aus.`)} className="accent-[#29B6E8]" data-testid={`season-${season.key}-enabled`} />
          <span>An</span>
        </label>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <label className="space-y-1">
          <span className="block text-white/45 uppercase tracking-wider text-[10px]">Modus</span>
          <select value={season.mode} disabled={busy || !season.enabled} onChange={(e) => onSave({ mode: e.target.value }, `${season.label}: ${MODE_LABELS[e.target.value]}.`)} className="w-full bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" data-testid={`season-${season.key}-mode`}>
            {Object.entries(MODE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-white/45 uppercase tracking-wider text-[10px]">Bis (bei jetzt an / aus)</span>
          <input type="datetime-local" value={toLocalInput(season.until)} disabled={busy || season.mode === "auto"} onChange={(e) => onSave({ until: e.target.value || "" }, e.target.value ? `Gilt bis ${dateText(e.target.value)}.` : "Ohne Ende, bis du umstellst.")} className="w-full bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" data-testid={`season-${season.key}-until`} />
        </label>
        <label className="space-y-1">
          <span className="block text-white/45 uppercase tracking-wider text-[10px]">Stärke</span>
          <select value={season.intensity} disabled={busy} onChange={(e) => onSave({ intensity: e.target.value }, `${season.label}: ${INTENSITY_LABELS[e.target.value]}.`)} className="w-full bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" data-testid={`season-${season.key}-intensity`}>
            {Object.entries(INTENSITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="space-y-1">
          <span className="block text-white/45 uppercase tracking-wider text-[10px]">Wo</span>
          <div className="flex gap-3 py-1.5">
            {Object.entries(CHANNEL_LABELS).filter(([value]) => !season.supported_channels || season.supported_channels.includes(value)).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1.5">
                <input type="checkbox" checked={season.channels.includes(value)} disabled={busy} onChange={(e) => {
                  const next = e.target.checked ? [...season.channels, value] : season.channels.filter((c) => c !== value);
                  onSave({ channels: next }, next.length ? `${season.label}: ${next.map((c) => CHANNEL_LABELS[c]).join(" und ")}.` : `${season.label} läuft nirgends – schalte Website oder App ein.`);
                }} className="accent-[#29B6E8]" data-testid={`season-${season.key}-channel-${value}`} />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
      {textNames.length > 0 && (
        <div className="grid sm:grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
          <div className="space-y-2">
            {textNames.map((name) => (
              <label key={name} className="block text-xs space-y-1">
                <span className="block text-white/45 uppercase tracking-wider text-[10px]">{TEXT_LABELS[name] || name}</span>
                <input value={draft[name] || ""} maxLength={200} placeholder={season.defaults[name]} onChange={(e) => setTexts({ ...draft, [name]: e.target.value })} className="w-full bg-[#0A0A0A] border border-white/10 px-3 py-2 rounded-sm text-sm" data-testid={`season-${season.key}-text-${name}`} />
              </label>
            ))}
            <p className="text-[11px] text-white/40">Leer = Vorgabe. {season.key === "club_birthday" ? "{years} wird durch die Jahre ersetzt." : ""}</p>
          </div>
          <button type="button" onClick={() => onSave({ texts: draft }, "Texte gespeichert.", () => setTexts(null))} disabled={busy || !dirty} data-testid={`season-${season.key}-text-save`} className="px-3 py-2 bg-[#29B6E8] text-black text-[10px] font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">Texte speichern</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
        <button type="button" onClick={() => onPreview(previewAt)} disabled={busy} data-testid={`season-${season.key}-preview`} className="px-3 py-1.5 border border-white/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
          <Eye className="w-3 h-3" /> Vorschau 60 Sekunden
        </button>
        {season.key !== "weather" && (
          <label className="flex items-center gap-2 text-[11px] text-white/50">
            <span>zu dieser Zeit</span>
            <input type="datetime-local" value={previewAt} onChange={(e) => setPreviewAt(e.target.value)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1 rounded-sm text-xs" data-testid={`season-${season.key}-preview-at`} />
          </label>
        )}
        <span className="text-[11px] text-white/40">Nur du siehst sie – sofort, in diesem Tab.</span>
        {season.key === "advent_calendar" && (
          <Link to="/admin/advent" data-testid="season-advent_calendar-doors" className="ml-auto px-3 py-1.5 border border-[#e9c46a]/50 text-[#e9c46a] text-[10px] font-bold uppercase tracking-wider rounded-sm hover:bg-[#e9c46a]/10">Türchen pflegen</Link>
        )}
        {season.key === "easter_hunt" && (
          // Wie „Türchen pflegen“ (#858): die Eier versteckt man an genau einer Stelle, dorthin führt der Knopf.
          <Link to="/admin/ostern" data-testid="season-easter_hunt-eggs" className="ml-auto px-3 py-1.5 border border-[#9be15d]/50 text-[#9be15d] text-[10px] font-bold uppercase tracking-wider rounded-sm hover:bg-[#9be15d]/10">Ostereier verstecken</Link>
        )}
      </div>
    </div>
  );
}

export function SeasonsSettings() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [calendarYear, setCalendarYear] = useState(null);
  const [calendar, setCalendar] = useState(null);

  const load = useCallback(async () => {
    try {
      const { data: result } = await api.get("/settings/seasons");
      setData(result);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLiveRefresh(load, ["settings"], { fallbackMs: 0 });

  const save = async (patch, message, after) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: result } = await api.put("/settings/seasons", patch);
      setData(result);
      if (message) toast.success(message);
      if (after) after();
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };
  const preview = async (key, at) => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: result } = await api.post(`/settings/seasons/${key}/preview`, at ? { at } : {});
      rememberPreview(result.token, result.seconds || 60);
      toast.success(`Vorschau läuft ${result.seconds || 60} Sekunden – hier und auf jeder Seite in diesem Tab.`);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };
  const refreshWeather = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { data: result } = await api.post("/settings/seasons/weather/refresh");
      setData(result);
      toast.success(result.weather?.stale ? "Abruf fehlgeschlagen – es gilt der letzte Stand oder die Vorgabe." : "Wetter abgerufen.");
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };
  const loadCalendar = async (year) => {
    try {
      const { data: result } = await api.get(`/seasonal/calendar?year=${year}`);
      setCalendar(result.items || []);
      setCalendarYear(year);
    } catch (err) {
      toast.error(formatApiError(err.response?.data?.detail));
    }
  };

  if (!data) {
    return loadError ? <div className="text-xs text-[#FF6B6B]" data-testid="seasons-error">Der Stand der Jahreszeiten konnte nicht geladen werden.</div> : null;
  }
  const year = calendarYear ?? new Date(data.now).getFullYear();
  const rows = calendar ?? data.calendar ?? [];
  return (
    <div className="space-y-4" data-testid="seasons-settings">
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><Sparkles className="w-4 h-4 text-[#29B6E8]" /> Saisonale Deko</div>
          <p className="mt-1 text-xs text-white/50 max-w-2xl">
            Halloween, Advent und Weihnachten, Silvester, Fasching, Vereinsgeburtstag und Ostern schalten sich nach Datum von selbst ein und aus (Zeitzone Wien; Ostern und die Adventsonntage werden berechnet).
            Hier stellst du je Saison ein, ob, wie stark und wo. Jede Person kann die Deko für sich auf dezent oder aus stellen; bei „Bewegung reduzieren“ bleibt alles ruhig.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm shrink-0">
          <input type="checkbox" checked={!!data.enabled} disabled={busy} onChange={(e) => save({ enabled: e.target.checked }, e.target.checked ? "Saisonale Deko an." : "Saisonale Deko aus – nirgends mehr zu sehen, Einstellungen bleiben.")} className="accent-[#29B6E8]" data-testid="seasons-enabled" />
          <span>Saisonale Deko</span>
        </label>
      </div>
      <SeasonsWeatherCard
        weather={data.weather}
        location={data.location}
        seasons={runningSeasons(data)}
        season={data.seasons.find((season) => season.key === "weather") || null}
        busy={busy}
        onSave={(location) => save({ location }, "Vereinsort gespeichert – das Wetter kommt beim nächsten Abruf.")}
        onRefresh={refreshWeather}
        onSeasonSave={(patch, message) => save({ seasons: { weather: patch } }, message)}
        onPreview={() => preview("weather")}
      />
      <div className={`grid gap-4 ${data.enabled ? "" : "opacity-60"}`}>
        {data.seasons.filter((season) => !season.always).map((season) => (
          MANAGED_ELSEWHERE[season.key]
            ? <ManagedSeasonCard key={season.key} season={season} />
            : <SeasonCard key={season.key} season={season} busy={busy} onSave={(patch, message, after) => save({ seasons: { [season.key]: patch } }, message, after)} onPreview={(at) => preview(season.key, at)} />
        ))}
      </div>
      <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3" data-testid="seasons-calendar">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><CalendarDays className="w-4 h-4 text-[#29B6E8]" /> Kalender {year}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => loadCalendar(year - 1)} className="px-2 py-1 border border-white/20 text-[10px] uppercase tracking-wider rounded-sm" data-testid="seasons-calendar-prev">{year - 1}</button>
            <button type="button" onClick={() => loadCalendar(year + 1)} className="px-2 py-1 border border-white/20 text-[10px] uppercase tracking-wider rounded-sm" data-testid="seasons-calendar-next">{year + 1}</button>
          </div>
        </div>
        <div className="border border-white/5 rounded-sm divide-y divide-white/5 text-xs">
          {rows.map((row) => (
            <div key={`${row.key}-${row.phase}-${row.start}`} className="flex flex-wrap justify-between gap-2 px-3 py-2">
              <span>{row.label} <span className="text-white/40">({row.phase})</span></span>
              <span className="text-white/70">{dateText(row.start)} – {dateText(row.end)}</span>
            </div>
          ))}
          {rows.length === 0 && <div className="px-3 py-2 text-white/40">Keine Termine in diesem Jahr.</div>}
        </div>
        {!data.founded_on && <p className="text-[11px] text-white/40">Der Vereinsgeburtstag erscheint, sobald unter Verein → Über uns ein Gründungsdatum steht.</p>}
      </div>
    </div>
  );
}
