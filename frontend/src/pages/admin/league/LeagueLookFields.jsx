// Gestaltung der Liga in der Verwaltung (#2107): Emblem, Banner mit Fokuspunkt (Desktop und Handy), Akzentfarbe und
// Gewinne. Bilder nur über „Hochladen“ oder die Mediathek - der Server prüft und lehnt fremde Adressen ab. Leer heißt
// beim Emblem und Banner der Season „wie die Liga“, bei den Gewinnen einer Liga N „wie die Season“.
import { useState } from "react";
import { Monitor, Plus, Smartphone, Trash2 } from "lucide-react";
import { ImageUpload } from "@/components/tls/ImageUpload";
import { FieldLabel, TextField } from "@/components/tls/FormFields";
import { resolveMediaUrl } from "@/lib/api";
import { LeagueEmblem } from "@/components/tls/league/public/LeagueLook";
import { DEFAULT_FOCUS, accentProblem, accentStyle, bannerFocus, contrastRatio, PAGE_BACKGROUND } from "@/lib/leagueLook";
import "@/components/tls/league/public/league.css";

const CLUB_COLOR = "#29B6E8";
const ICON_DANGER = "p-1.5 text-white/50 hover:text-live focus-visible:outline focus-visible:outline-1 focus-visible:outline-[#29B6E8] rounded-sm";

/** Emblem: quadratisch über den Logo-Upload (SVG wird bereinigt, PNG/WebP neu kodiert); Vorschau groß und klein. */
export function EmblemField({ value, onChange, inherited = "", inheritedLabel = "", accent, testId }) {
  const shown = value || inherited;
  return (
    <FieldLabel label="Emblem" hint="Quadratisch, am besten SVG oder PNG mit durchsichtigem Hintergrund.">
      <ImageUpload value={value} onChange={onChange} testId={testId} variant="square" crop="square" endpoint="/uploads/logo" allowLibrary logo logoPreview={false} />
      <div className="mt-2 flex items-end gap-3" style={accentStyle(accent)} data-testid={`${testId}-sizes`}>
        <LeagueEmblem src={shown} size={72} />
        <LeagueEmblem src={shown} size={40} />
        <LeagueEmblem src={shown} size={24} />
        <span className="text-[11px] text-white/50">
          {value ? "Ligaseite, Übersicht, Teamseite, Spielseite" : inherited ? inheritedLabel : "Ohne Emblem steht das Liga-Zeichen."}
        </span>
      </div>
    </FieldLabel>
  );
}

const TARGETS = [
  ["desktop", "Desktop", Monitor, "x", "y"],
  ["mobile", "Handy", Smartphone, "mobile_x", "mobile_y"],
];

/** Banner mit Fokuspunkt je Zuschnitt: ins Bild klicken setzt den Punkt für den gewählten Zuschnitt; darunter beide
 *  Zuschnitte so, wie die Ligaseite sie zeigt (Desktop 3 : 1, Handy 4 : 3) - mit dem Emblem davor. */
export function BannerField({ url, focus, onChange, inherited = null, inheritedLabel = "", emblem = "", accent, testId }) {
  const [target, setTarget] = useState("desktop");
  const current = { ...DEFAULT_FOCUS, ...(focus || {}) };
  const shown = url ? { url, ...current } : inherited;
  const [, , , keyX, keyY] = TARGETS.find(([key]) => key === target);
  const pick = (event) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const x = Math.round(((event.clientX - box.left) / box.width) * 100);
    const y = Math.round(((event.clientY - box.top) / box.height) * 100);
    onChange(url, { ...current, [keyX]: Math.min(100, Math.max(0, x)), [keyY]: Math.min(100, Math.max(0, y)) });
  };
  return (
    <FieldLabel label="Banner" hint="Breitformat wie beim Event-Banner (16 : 9 reicht). Wie es zugeschnitten wird, zeigt die Vorschau.">
      <ImageUpload value={url} onChange={(next) => onChange(next, next ? current : null)} testId={testId} variant="wide" allowLibrary />
      {url ? (
        <div className="mt-3 space-y-2" data-testid={`${testId}-focus`}>
          <div className="flex flex-wrap items-center gap-2 text-xs text-white/60" role="group" aria-label="Fokuspunkt für">
            <span>Fokuspunkt für</span>
            {TARGETS.map(([key, label, Icon]) => (
              <button key={key} type="button" onClick={() => setTarget(key)} aria-pressed={target === key} data-testid={`${testId}-target-${key}`}
                className={`tls-btn ${target === key ? "tls-btn--secondary" : "tls-btn--quiet"} inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider`}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" /> {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={pick} className="relative block w-full max-w-md overflow-hidden rounded-sm border border-white/10 cursor-crosshair"
            aria-label={`Fokuspunkt ${target === "desktop" ? "Desktop" : "Handy"} setzen`} data-testid={`${testId}-pick`}>
            <img src={resolveMediaUrl(url)} alt="" className="block h-auto w-full" />
            {TARGETS.map(([key, , , x, y]) => (
              <span key={key} aria-hidden="true" data-active={target === key ? "true" : "false"}
                className={`pointer-events-none absolute -ml-2 -mt-2 h-4 w-4 rounded-full border-2 ${target === key ? "border-white bg-[#29B6E8]/70" : "border-white/50 bg-white/10"}`}
                style={{ left: `${current[x]}%`, top: `${current[y]}%` }} />
            ))}
          </button>
          <p className="text-[11px] text-white/45">Dieser Punkt bleibt beim Zuschneiden immer sichtbar ({current[keyX]} % / {current[keyY]} %).</p>
        </div>
      ) : null}
      {shown ? <BannerPreview banner={shown} emblem={emblem} accent={accent} testId={`${testId}-crops`} /> : null}
      {!url && inherited ? <p className="mt-1.5 text-xs text-white/55" data-testid={`${testId}-inherited`}>{inheritedLabel}</p> : null}
    </FieldLabel>
  );
}

function BannerPreview({ banner, emblem, accent, testId }) {
  const focus = bannerFocus(banner);
  const frame = (ratio, position, label, width) => (
    <figure className="min-w-0" style={{ width }}>
      <div className="relative overflow-hidden rounded-sm border border-white/10" style={{ aspectRatio: ratio }}>
        <img src={resolveMediaUrl(banner.url)} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: position }} />
        <span className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black/70" aria-hidden="true" />
        <span className="absolute bottom-1.5 left-1.5"><LeagueEmblem src={emblem} size={22} /></span>
      </div>
      <figcaption className="mt-1 text-[10px] uppercase tracking-wider text-white/45">{label}</figcaption>
    </figure>
  );
  return (
    <div className="mt-3 flex flex-wrap items-start gap-3" style={accentStyle(accent)} data-testid={testId}>
      {frame("3 / 1", focus["--league-focus-desktop"], "Desktop", "min(100%, 18rem)")}
      {frame("4 / 3", focus["--league-focus-mobile"], "Handy", "min(100%, 8rem)")}
    </div>
  );
}

/** Akzentfarbe: Farbwähler und Wert, Kontrast gleich sichtbar; leer heißt Vereinsfarbe. */
export function AccentField({ value, onChange, testId = "league-accent" }) {
  const problem = accentProblem(value);
  const color = value && !problem ? value : CLUB_COLOR;
  const ratio = /^#?[0-9a-f]{6}$/i.test(value || "") ? contrastRatio(value, PAGE_BACKGROUND) : null;
  return (
    <FieldLabel label="Akzentfarbe" hint="Für Kopf, Zeichen und Abzeichen der Ligaseite. Leer: die Vereinsfarbe.">
      <div className="flex flex-wrap items-center gap-2">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(value || "") ? value : CLUB_COLOR} onChange={(event) => onChange(event.target.value.toUpperCase())}
          aria-label="Akzentfarbe wählen" className="h-9 w-12 cursor-pointer rounded-sm border border-white/10 bg-transparent" data-testid={`${testId}-picker`} />
        <TextField label="" value={value || ""} onChange={(next) => onChange(next.trim())} placeholder="leer = Vereinsfarbe" maxLength={7} testId={testId} className="w-36" />
        {value ? (
          <button type="button" onClick={() => onChange("")} className="tls-btn tls-btn--quiet rounded-sm px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider" data-testid={`${testId}-reset`}>
            Vereinsfarbe
          </button>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs" style={accentStyle(color)} data-testid={`${testId}-preview`}>
        <span className="tls-league-accent font-bold uppercase tracking-[0.2em]">Spieltag 3</span>
        <span className="rounded-sm px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
          style={{ background: `rgb(${accentStyle(color)["--league-accent-rgb"]})`, color: accentStyle(color)["--league-on-accent"] }}>Abzeichen</span>
        {ratio ? <span className={problem ? "text-warn" : "text-white/50"}>Kontrast {ratio.toFixed(1).replace(".", ",")} : 1</span> : null}
      </div>
      {problem ? <p className="mt-1 text-xs text-warn" role="alert" data-testid={`${testId}-problem`}>{problem}</p> : null}
    </FieldLabel>
  );
}

/** Gewinne: Platz → Preis, optional mit Bild (etwa der Pokal). Reine Anzeige auf der Ligaseite. */
export function PrizeEditor({ rows, onChange, testId = "prizes", emptyHint }) {
  const update = (index, key, value) => onChange(rows.map((row, at) => (at === index ? { ...row, [key]: value } : row)));
  const nextPlace = String(Math.max(0, ...rows.map((row) => Number(row.place) || 0)) + 1);
  return (
    <div className="space-y-2" data-testid={testId}>
      <div className="text-[11px] font-bold uppercase tracking-widest text-white/60">Gewinne – um was gespielt wird</div>
      {rows.length ? rows.map((row, index) => (
        <div key={index} className="rounded-sm border border-white/10 bg-[#0A0A0A] p-3 space-y-2" data-testid={`${testId}-row-${index}`}>
          <div className="grid grid-cols-[5rem_1fr_auto] items-end gap-2">
            <TextField label="Platz" type="number" min={1} max={64} value={row.place} onChange={(value) => update(index, "place", value)} testId={`${testId}-place-${index}`} />
            <TextField label="Preis" maxLength={160} value={row.text} onChange={(value) => update(index, "text", value)} placeholder="z. B. Pokal und Trikot" testId={`${testId}-text-${index}`} />
            <button type="button" onClick={() => onChange(rows.filter((_, at) => at !== index))} aria-label={`Platz ${row.place || index + 1} entfernen`}
              className={`${ICON_DANGER} mb-1.5`} data-testid={`${testId}-remove-${index}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <ImageUpload value={row.image_url} onChange={(url) => update(index, "image_url", url || "")} label="Bild (freiwillig)" testId={`${testId}-image-${index}`} variant="square" allowLibrary />
        </div>
      )) : <p className="text-xs text-white/50">{emptyHint || "Noch keine Gewinne."}</p>}
      <button type="button" onClick={() => onChange([...rows, { place: nextPlace, text: "", image_url: "" }])} data-testid={`${testId}-add`}
        className="tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Platz {nextPlace} hinzufügen
      </button>
    </div>
  );
}
