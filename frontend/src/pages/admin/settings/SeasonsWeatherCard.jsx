import { useEffect, useState } from "react";
import { CloudSun, Eye, MapPin, RefreshCw } from "lucide-react";
import { describeWeather } from "../../../seasons/weather";
import { viennaTime } from "@/lib/vienna";

// Wetter am Vereinsort (#666): was der Server alle zehn Minuten von Open-Meteo holt (ohne Schlüssel), in Worten -
// und der Ort selbst (Breite, Länge, Name), den der Verein hier ändert. Die Deko nimmt Wind, Regen, Schnee und
// die echte Nacht daraus; fällt der Dienst aus, gilt der letzte Stand oder die Vorgabe.
// Das Wetter auf der Seite (#673) wird auch hier geschaltet - an, aus, Stärke, wo (Website, App seit #771), Vorschau:
// ein Ort für das Wetter.

export const COMPASS = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
/** Stärken für das Wetter: „dezent“ gibt es nicht - ohne Bewegung hat das Wetter nichts zu zeigen. */
export const WEATHER_INTENSITIES = { normal: "normal", full: "kräftig" };
/** Wo das Wetter läuft - dieselben Namen wie in den Karten der anderen Saisonen. */
export const WEATHER_CHANNELS = { web: "Website", app: "App" };

export function compass(degrees) {
  const index = Math.round((((Number(degrees) % 360) + 360) % 360) / 45) % 8;
  return COMPASS[index];
}

/** Wettercode von Open-Meteo in ein Wort. */
export function skyText(code) {
  if (code === null || code === undefined) return "";
  if (code === 0) return "klar";
  if (code <= 3) return "wolkig";
  if (code === 45 || code === 48) return "Nebel";
  if (code >= 51 && code <= 67) return "Regen";
  if (code >= 71 && code <= 77) return "Schnee";
  if (code >= 80 && code <= 82) return "Schauer";
  if (code === 85 || code === 86) return "Schneeschauer";
  if (code >= 95) return "Gewitter";
  return "";
}

function timeText(value) {
  if (!value) return "–";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return viennaTime(date, { timeZone: "Europe/Vienna", hour: "2-digit", minute: "2-digit" });
}

/** Ein Satz zum Wetter: Temperatur, Wind mit Richtung, Niederschlag - oder der Hinweis, dass die Vorgabe gilt. */
export function weatherText(weather) {
  if (!weather) return "Noch kein Wetter abgerufen – es gilt die Vorgabe (leichter Wind).";
  if (weather.stale) return "Kein frischer Stand – es gilt die Vorgabe (leichter Wind, kein Niederschlag).";
  const parts = [];
  if (typeof weather.temp_c === "number") parts.push(`${weather.temp_c.toLocaleString("de-AT", { maximumFractionDigits: 1 })} °C`);
  parts.push(`Wind ${Number(weather.wind_kmh || 0).toLocaleString("de-AT", { maximumFractionDigits: 0 })} km/h aus ${compass(weather.wind_dir)}`);
  const sky = skyText(weather.code);
  if (sky) parts.push(sky);
  if (weather.snow_cm > 0) parts.push(`Schnee ${Number(weather.snow_cm).toLocaleString("de-AT", { maximumFractionDigits: 1 })} cm`);
  else if (weather.rain_mm > 0) parts.push(`Regen ${Number(weather.rain_mm).toLocaleString("de-AT", { maximumFractionDigits: 1 })} mm`);
  return parts.join(", ");
}

/** Die Schalter der Saison „Wetter“: an/aus, Stärke, wo, Vorschau - die Saison läuft das ganze Jahr, deshalb ohne Datum. */
function WeatherSwitch({ season, busy, onSeasonSave, onPreview }) {
  const intensities = season.intensity === "subtle" ? { subtle: "dezent (nichts zu sehen)", ...WEATHER_INTENSITIES } : WEATHER_INTENSITIES;
  return (
    <div className="pt-3 border-t border-white/5 space-y-2" data-testid="season-weather">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={!!season.enabled} disabled={busy} onChange={(e) => onSeasonSave({ enabled: e.target.checked }, e.target.checked ? "Wetter an." : "Wetter aus.")} className="accent-[#29B6E8]" data-testid="season-weather-enabled" />
          <span>Wetter zeigen</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-white/45 uppercase tracking-wider text-[10px]">Stärke</span>
          <select value={season.intensity} disabled={busy || !season.enabled} onChange={(e) => onSeasonSave({ intensity: e.target.value }, `Wetter: ${intensities[e.target.value]}.`)} className="bg-[#0A0A0A] border border-white/10 px-2 py-1.5 rounded-sm" data-testid="season-weather-intensity">
            {Object.entries(intensities).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="flex items-center gap-3">
          <span className="text-white/45 uppercase tracking-wider text-[10px]">Wo</span>
          {Object.entries(WEATHER_CHANNELS).filter(([value]) => !season.supported_channels || season.supported_channels.includes(value)).map(([value, label]) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="checkbox" checked={(season.channels || []).includes(value)} disabled={busy || !season.enabled} onChange={(e) => {
                const current = season.channels || [];
                const next = e.target.checked ? [...current, value] : current.filter((channel) => channel !== value);
                onSeasonSave({ channels: next }, next.length ? `Wetter: ${next.map((channel) => WEATHER_CHANNELS[channel]).join(" und ")}.` : "Das Wetter läuft nirgends – schalte Website oder App ein.");
              }} className="accent-[#29B6E8]" data-testid={`season-weather-channel-${value}`} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <button type="button" onClick={onPreview} disabled={busy} data-testid="season-weather-preview" className="px-3 py-1.5 border border-white/20 text-white text-[10px] font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1 disabled:opacity-40">
          <Eye className="w-3 h-3" /> Vorschau 60 Sekunden
        </button>
      </div>
      <p className="text-[11px] text-white/40 max-w-2xl">
        Das ganze Jahr: regnet, schneit oder gewittert es am Vereinsort, zeigen es Website und App (wo angehakt) – sonst nichts. Vom 1. Advent bis Dreikönig schneit es immer, Regen wird zu Schnee.
        Die Vorschau zeigt einen Gewitterregen, auch wenn es draußen trocken ist – nur dir, sofort, in diesem Tab.
      </p>
    </div>
  );
}

export function SeasonsWeatherCard({ weather, location, busy, onSave, onRefresh, seasons = [], season = null, onSeasonSave = () => {}, onPreview = () => {} }) {
  const [form, setForm] = useState({ lat: "", lon: "", name: "" });
  useEffect(() => {
    if (location) setForm({ lat: String(location.lat ?? ""), lon: String(location.lon ?? ""), name: location.name || "" });
  }, [location]);
  const lat = Number(String(form.lat).replace(",", "."));
  const lon = Number(String(form.lon).replace(",", "."));
  const valid = Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  const changed = location && (Number(location.lat) !== lat || Number(location.lon) !== lon || (location.name || "") !== form.name.trim());
  return (
    <div className="border border-white/10 bg-[#121212] rounded-sm p-5 space-y-3" data-testid="seasons-weather">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-heading font-bold uppercase inline-flex items-center gap-2"><CloudSun className="w-4 h-4 text-[#29B6E8]" /> Wetter am Vereinsort</div>
          <p className="mt-1 text-xs text-white/50 max-w-2xl">
            Der Server holt alle zehn Minuten das Wetter für den Vereinsort (Open-Meteo, ohne Schlüssel). Die Deko nimmt daraus den Wind für Netz und Fäden,
            Regen und Schnee, wenn es wirklich regnet oder schneit (im Winter wird Regen zu Schnee), und die Nacht ab dem echten Sonnenuntergang. Fällt der Dienst aus, gilt der letzte Stand oder die Vorgabe.
          </p>
          <div className="mt-2 text-sm" data-testid="seasons-weather-text">
            <span className="text-white/85">{weather?.location || location?.name || "Innsbruck"}:</span> {weatherText(weather)}
          </div>
          <div className="mt-1 text-xs text-white/60" data-testid="seasons-weather-layer">{describeWeather({ seasons, weather })}</div>
          <div className="mt-1 text-xs text-white/45" data-testid="seasons-weather-sun">
            Sonnenaufgang {timeText(weather?.sunrise)}, Sonnenuntergang {timeText(weather?.sunset)}{weather?.night ? " – gerade Nacht" : ""}
            {weather?.fetched_at ? ` · Stand ${timeText(weather.fetched_at)}` : ""}
            {weather?.error ? ` · letzter Fehler: ${weather.error}` : ""}
          </div>
        </div>
        <button type="button" onClick={onRefresh} disabled={busy} className="inline-flex items-center gap-2 px-3 py-1.5 border border-white/20 text-[10px] uppercase tracking-wider rounded-sm hover:border-[#29B6E8] transition disabled:opacity-50" data-testid="seasons-weather-refresh">
          <RefreshCw className="w-3.5 h-3.5" /> Jetzt abrufen
        </button>
      </div>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSave({ lat, lon, name: form.name.trim() });
        }}
        data-testid="seasons-location-form"
      >
        <label className="text-xs text-white/60 flex flex-col gap-1">
          Breite
          <input value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value })} inputMode="decimal" className="w-28 bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1 text-sm text-white" data-testid="seasons-location-lat" />
        </label>
        <label className="text-xs text-white/60 flex flex-col gap-1">
          Länge
          <input value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value })} inputMode="decimal" className="w-28 bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1 text-sm text-white" data-testid="seasons-location-lon" />
        </label>
        <label className="text-xs text-white/60 flex flex-col gap-1">
          Ort
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} className="w-40 bg-[#0A0A0A] border border-white/15 rounded-sm px-2 py-1 text-sm text-white" data-testid="seasons-location-name" />
        </label>
        <button type="submit" disabled={busy || !valid || !changed} className="inline-flex items-center gap-2 px-3 py-1.5 bg-[#29B6E8] text-black text-[10px] uppercase tracking-wider font-bold rounded-sm disabled:opacity-50" data-testid="seasons-location-save">
          <MapPin className="w-3.5 h-3.5" /> Ort speichern
        </button>
        {!valid && <span className="text-xs text-[#FF6B6B]">Breite −90 bis 90, Länge −180 bis 180.</span>}
      </form>
      {season && <WeatherSwitch season={season} busy={busy} onSeasonSave={onSeasonSave} onPreview={onPreview} />}
    </div>
  );
}
