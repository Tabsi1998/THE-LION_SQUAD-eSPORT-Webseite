import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowLeftRight, CheckCircle2, Copy, ExternalLink, FileImage, Palette, Plus, Ruler, ShoppingBag, Trash2, Upload, XOctagon } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError, resolveMediaUrl, uploadApi } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";
import { ReasonedButton } from "./AdminShopPage";
import ShopTabs from "./ShopTabs";

// Motive des Vereins (#1708, #2069) - Verwaltung → Finanzen → Shop → Motive. Nur die Finanzen laden hoch; der Grund
// ist optional und kommt ins Protokoll. Ein Motiv hat eine Hauptdatei für dunkle Shirts (SVG bevorzugt, sonst PNG/JPG)
// und eine Fassung für helle Shirts: automatisch umgefärbt (Weiß → Ersatzfarbe) oder als eigene Datei. Der Server
// bereinigt jedes SVG streng, rastert es, prüft gegen den Druckbereich und legt jede Datei als neue Version mit eigener
// Adresse für Printful ab; alte Versionen bleiben. Maße immer in Zoll und cm.

const BASE = "/admin/shop/designs";
const CM_PER_INCH = 2.54;

function number(value, digits) {
  return String(Number(Number(value).toFixed(digits))).replace(".", ",");
}

export function inches(value) {
  return `${number(value, 2)} Zoll (${number(value * CM_PER_INCH, 1)} cm)`;
}

// Relative Luminanz wie im Server (services/shop_motifs.py) - nur für die Beispiele bei der Schwelle.
export function luminance(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || "").trim());
  if (!match) return null;
  const channel = (offset) => {
    const part = parseInt(match[1].slice(offset, offset + 2), 16) / 255;
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

const LEVELS = {
  good: { label: "Gut", icon: CheckCircle2, className: "border-ok/40 bg-ok/10 text-ok" },
  snug: { label: "Knapp", icon: AlertTriangle, className: "border-warn/40 text-warn" },
  too_low: { label: "Reicht nicht", icon: XOctagon, className: "border-warn bg-warn/15 text-warn" },
  unknown: { label: "Ohne Maße", icon: AlertTriangle, className: "border-white/20 text-white/60" },
};

// Wie das Motiv auf hellen Shirts aussieht (Zustand vom Server, services/shop_motifs.light_state).
const LIGHT_STATES = {
  file: { label: "Eigene Datei", tone: "border-ok/40 text-ok" },
  auto: { label: "Automatisch umgefärbt", tone: "border-ok/40 text-ok" },
  same: { label: "Hauptdatei (kein Weiß)", tone: "border-white/20 text-white/70" },
  missing: { label: "Fehlt", tone: "border-warn bg-warn/15 text-warn" },
  pending: { label: "Noch nicht erzeugt", tone: "border-warn/40 text-warn" },
  none: { label: "Noch keine Datei", tone: "border-white/20 text-white/60" },
};

const VARIANT_LABELS = { dark: "für dunkle Shirts", light: "für helle Shirts" };
const ORIGIN_LABELS = { upload: "hochgeladen", auto_light: "automatisch umgefärbt" };

// Beispiel-Shirtfarben für die Schwelle - Daten, keine Farben der Oberfläche.
const SAMPLE_SHIRTS = [
  { name: "Schwarz", hex: "#0c0c0c" },
  { name: "Navy", hex: "#1f2a44" },
  { name: "Rot", hex: "#c8102e" },
  { name: "Grau meliert", hex: "#9b9b9b" },
  { name: "Gelb", hex: "#ffc72c" },
  { name: "Weiß", hex: "#ffffff" },
];

function Section({ title, icon: Icon, children, testId }) {
  return (
    <section className="border border-white/10 bg-surface-1 rounded-sm p-4 space-y-3" data-testid={testId}>
      <h2 className="text-xs font-bold uppercase tracking-wider text-white/70 inline-flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />} {title}
      </h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block text-sm">
      <span className="text-white/70">{label}</span>
      {children}
      {hint && <span className="block text-xs text-white/45 mt-1">{hint}</span>}
    </label>
  );
}

const INPUT = "mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 text-sm placeholder:text-white/35 focus:border-brand outline-none disabled:opacity-50";
const QUIET_BUTTON = "tls-btn tls-btn--quiet min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm";
const SECONDARY_BUTTON = "tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40";

function ReasonInput({ id, value, onChange, disabled }) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>Grund (optional)</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} maxLength={500} disabled={disabled}
        placeholder="Grund (optional, kommt ins Protokoll)" className={`${INPUT} mt-0 flex-1`} data-testid={id} />
    </>
  );
}

function Light({ check, testId }) {
  const level = LEVELS[check?.level] || LEVELS.unknown;
  const Icon = level.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 border rounded-sm px-2 py-0.5 text-xs font-bold ${level.className}`} title={check?.text} data-testid={testId}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {level.label}{check?.dpi ? ` · ${Math.floor(check.dpi)} DPI` : ""}
    </span>
  );
}

// Echte Farbflächen: Schwarz bzw. Hellgrau (Rolle „silver“) wie ein Shirt.
function ShirtPreview({ version, title, shirt, testId }) {
  const dark = shirt === "dark";
  return (
    <figure className="space-y-1">
      <div className={`aspect-square w-full rounded-sm border border-white/10 grid place-items-center overflow-hidden ${dark ? "bg-black" : "bg-silver"}`}
        data-shirt={shirt} data-testid={testId}>
        {version?.public_path
          ? <img src={resolveMediaUrl(version.public_path)} alt={`${title} ${VARIANT_LABELS[shirt]}, Version ${version.version}`} className="max-w-full max-h-full object-contain p-3" loading="lazy" />
          : <FileImage className={`w-8 h-8 ${dark ? "text-white/30" : "text-black/30"}`} aria-label="keine Datei" />}
      </div>
      <figcaption className="text-xs text-white/60">Auf {dark ? "dunklem" : "hellem"} Shirt{version ? ` · v${version.version}` : ""}</figcaption>
    </figure>
  );
}

function Swatches({ colors, testId }) {
  if (!colors?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Farben im SVG" data-testid={testId}>
      {colors.map((hex) => (
        <li key={hex} className="inline-flex items-center gap-1.5 border border-white/15 rounded-sm px-1.5 py-0.5 text-xs font-mono" data-testid="shop-motif-color">
          <span className="w-3 h-3 rounded-sm border border-white/30" style={{ backgroundColor: hex }} aria-hidden="true" />
          {hex}
        </li>
      ))}
    </ul>
  );
}

function PlacementRow({ spec, busy, onSave }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState({});
  const [reason, setReason] = useState("");
  const start = () => {
    setValues({ print_width_in: spec.print_width_in, area_width_in: spec.area_width_in, area_height_in: spec.area_height_in, min_dpi: spec.min_dpi });
    setReason("");
    setOpen(true);
  };
  const parsed = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(String(value).replace(",", "."))]));
  const valid = open && Object.values(parsed).every((value) => Number.isFinite(value) && value > 0) && parsed.print_width_in <= parsed.area_width_in;
  const ready = valid && !busy;
  const field = (key, label, step) => (
    <Field label={label} hint={key === "min_dpi" ? `nötig: ${Math.ceil((parsed.print_width_in || 0) * (parsed.min_dpi || 0))} px Breite` : Number.isFinite(parsed[key]) ? `= ${number(parsed[key] * CM_PER_INCH, 1)} cm` : ""}>
      <input value={values[key] ?? ""} onChange={(event) => setValues((now) => ({ ...now, [key]: event.target.value }))}
        inputMode="decimal" step={step} className={`${INPUT} tabular-nums`} data-testid={`shop-placement-${spec.key}-${key}`} />
    </Field>
  );
  return (
    <li className="border-t border-white/10 pt-3 first:border-t-0 first:pt-0" data-testid={`shop-placement-${spec.key}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-bold">{spec.label}</div>
          <div className="text-xs text-white/60 mt-0.5">
            Druckbreite <b className="text-white/85">{spec.print_width}</b> · Bereich {spec.area_width} × {spec.area_height} · mind. {spec.min_dpi} DPI = {spec.min_width_px} px Breite
            {!spec.is_default && <span className="ml-2 text-honor">angepasst</span>}
          </div>
        </div>
        {!open && (
          <button type="button" onClick={start} className={SECONDARY_BUTTON} data-testid={`shop-placement-${spec.key}-edit`}>
            Ändern
          </button>
        )}
      </div>
      {open && (
        <form className="mt-3 space-y-3" onSubmit={async (event) => {
          event.preventDefault();
          if (!ready) return;
          if (await onSave(spec.key, parsed, reason.trim())) setOpen(false);
        }}>
          <div className="grid gap-3 sm:grid-cols-4">
            {field("print_width_in", "Druckbreite (Zoll)", 0.1)}
            {field("area_width_in", "Bereich Breite (Zoll)", 0.1)}
            {field("area_height_in", "Bereich Höhe (Zoll)", 0.1)}
            {field("min_dpi", "Mindest-DPI", 1)}
          </div>
          {!valid && <p className="text-xs text-warn" data-testid={`shop-placement-${spec.key}-invalid`}>Zahlen größer 0; die Druckbreite darf nicht breiter sein als der Bereich.</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <ReasonInput id={`shop-placement-${spec.key}-reason`} value={reason} onChange={setReason} disabled={busy} />
            <button type="submit" disabled={!ready} className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40" data-testid={`shop-placement-${spec.key}-save`}>
              {busy ? "Speichert …" : "Speichern"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="tls-btn tls-btn--quiet min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>
          </div>
        </form>
      )}
    </li>
  );
}

function isSvg(file) {
  return !!file && (file.type === "image/svg+xml" || /\.svg$/i.test(file.name || ""));
}

// Ablagefläche: ziehen und loslassen oder klicken. Das Eingabefeld bleibt ein echtes Dateifeld (Tastatur, Screenreader).
// Mit ``onFiles`` (Paar, #2084) nimmt sie auch zwei Dateien auf einmal - die Seite ordnet sie dann selbst zu.
function DropZone({ file, onFile, onFiles, accept, disabled, label, hint, testId = "shop-design" }) {
  const [over, setOver] = useState(false);
  const take = (list) => {
    const files = Array.from(list || []);
    if (onFiles && files.length >= 2) onFiles(files.slice(0, 2));
    else onFile(files[0] || null);
  };
  return (
    <label
      onDragOver={(event) => { event.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        if (event.dataTransfer?.files?.length && !disabled) take(event.dataTransfer.files);
      }}
      className={`flex flex-col items-center justify-center gap-1.5 min-h-28 border border-dashed rounded-sm px-4 py-5 text-center cursor-pointer transition-colors duration-150 focus-within:border-brand ${over ? "border-brand bg-brand/10" : "border-white/20 hover:border-white/40"}`}
      data-over={over ? "true" : "false"} data-testid={`${testId}-dropzone`}>
      <Upload className="w-5 h-5 text-white/50" aria-hidden="true" />
      {label && <span className="text-xs font-bold uppercase tracking-wider text-white/70">{label}</span>}
      <span className="text-sm">{file ? <b className="break-all">{file.name}</b> : "Datei hierher ziehen oder klicken"}</span>
      <span className="text-xs text-white/45">{hint || "SVG (am besten), PNG mit durchsichtigem Hintergrund oder JPG"}</span>
      <input type="file" accept={accept} disabled={disabled} multiple={!!onFiles} onChange={(event) => take(event.target.files)}
        className="sr-only" data-testid={`${testId}-file`} />
    </label>
  );
}

// Ampel der Paar-Prüfung (#2084) - Rot sperrt das Speichern, Gelb fragt nach.
const PAIR_LEVELS = {
  green: { label: "Passt", icon: CheckCircle2, className: "border-ok/40 bg-ok/10 text-ok" },
  yellow: { label: "Bitte prüfen", icon: AlertTriangle, className: "border-warn/40 text-warn" },
  red: { label: "Abgelehnt", icon: XOctagon, className: "border-warn bg-warn/15 text-warn" },
};

// Vorschau einer Fassung auf ihrem Shirt (gerastert vom Server), markierte Stellen darüber.
function PairPreview({ image, mark, shirt, name, testId }) {
  const dark = shirt === "dark";
  return (
    <figure className="space-y-1 min-w-0">
      <div className={`relative aspect-square w-full rounded-sm border border-white/10 grid place-items-center overflow-hidden ${dark ? "bg-black" : "bg-silver"}`}
        data-shirt={shirt} data-testid={testId}>
        {image && <img src={image} alt={`Vorschau ${VARIANT_LABELS[shirt]}${name ? `: ${name}` : ""}`} className="max-w-full max-h-full object-contain p-3" />}
        {mark && <img src={mark} alt="" aria-hidden="true" className="absolute inset-0 m-auto max-w-full max-h-full object-contain p-3 motion-safe:animate-pulse" data-testid={`${testId}-mark`} />}
      </div>
      <figcaption className="text-xs text-white/60">
        Auf {dark ? "dunklem" : "hellem"} Shirt{mark ? <span className="text-warn"> · markiert</span> : ""}
      </figcaption>
    </figure>
  );
}

function PairReport({ check, onSwap, busy }) {
  if (check.status === "checking") {
    return <p className="text-sm text-white/60" role="status" data-testid="shop-pair-checking">Prüft das Paar …</p>;
  }
  const report = check.report;
  if (!report) {
    return check.error ? (
      <div role="alert" className="flex gap-2 border border-warn/50 bg-warn/10 rounded-sm px-3 py-2 text-sm" data-testid="shop-pair-error">
        <XOctagon className="w-4 h-4 mt-0.5 shrink-0 text-warn" aria-hidden="true" />
        <span>{check.error}</span>
      </div>
    ) : null;
  }
  const level = PAIR_LEVELS[report.level] || PAIR_LEVELS.red;
  const Icon = level.icon;
  return (
    <div className="space-y-3 border border-white/10 rounded-sm p-3" data-testid="shop-pair-report" data-level={report.level}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 border rounded-sm px-2 py-0.5 text-xs font-bold ${level.className}`} data-testid="shop-pair-light">
          <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {level.label}
        </span>
        <span className="text-sm">{report.summary}</span>
      </div>
      <ul className="space-y-1" data-testid="shop-pair-checks">
        {report.checks.map((item) => {
          const tone = PAIR_LEVELS[item.level] || PAIR_LEVELS.red;
          const ItemIcon = tone.icon;
          return (
            <li key={item.key} className="flex gap-2 text-xs text-white/75" data-level={item.level} data-testid={`shop-pair-check-${item.key}`}>
              <ItemIcon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${item.level === "green" ? "text-ok" : "text-warn"}`} aria-hidden="true" />
              <span>{item.text}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap items-center gap-2 text-xs text-white/70" data-testid="shop-pair-assignment">
        <span>
          {report.swapped ? "Automatisch zugeordnet: die hellere Datei gilt für dunkle Shirts." : "Zuordnung wie gewählt."}
          {!report.swapped && report.suggest_swap ? " Die Dateien wirken vertauscht – die hellere gehört zu den dunklen Shirts." : ""}
        </span>
        <button type="button" onClick={onSwap} disabled={busy} className={`${SECONDARY_BUTTON} inline-flex items-center gap-1.5`} data-testid="shop-pair-swap">
          <ArrowLeftRight className="w-3.5 h-3.5" aria-hidden="true" /> Tauschen
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 max-w-md" data-testid="shop-pair-previews">
        <PairPreview image={report.previews?.dark} mark={report.marks?.dark} shirt="dark" name={report.files?.dark?.name} testId="shop-pair-on-dark" />
        <PairPreview image={report.previews?.light} mark={report.marks?.light} shirt="light" name={report.files?.light?.name} testId="shop-pair-on-light" />
      </div>
    </div>
  );
}

// Bestätigung bei Gelb - im Seitenlayout statt window.confirm.
function PairConfirm({ report, busy, onConfirm, onCancel }) {
  const warnings = report.checks.filter((item) => item.level === "yellow");
  return (
    <div role="alertdialog" aria-modal="false" aria-labelledby="shop-pair-confirm-title" className="space-y-3 border border-warn/50 bg-warn/10 rounded-sm p-3" data-testid="shop-pair-confirm">
      <p id="shop-pair-confirm-title" className="text-sm font-bold inline-flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-warn" aria-hidden="true" /> Trotz Warnung speichern?
      </p>
      <ul className="list-disc pl-5 space-y-1 text-sm">
        {warnings.map((item) => <li key={item.key}>{item.text}</li>)}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={onConfirm} disabled={busy} className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40" data-testid="shop-pair-confirm-yes">
          {busy ? "Speichert …" : "Trotzdem speichern"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="tls-btn tls-btn--quiet min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="shop-pair-confirm-no">
          Abbrechen
        </button>
      </div>
    </div>
  );
}

const ACCEPT = "image/svg+xml,image/png,image/jpeg,.svg,.png,.jpg,.jpeg";

// Paar (#2084): zwei Felder „für dunkle“ und „für helle Shirts“. Sind beide Dateien da, prüft der Server sofort
// (Ampel, Vorschau, Markierungen); kamen beide auf einmal, ordnet er sie selbst zu. „Tauschen“ dreht die Zuordnung.
function PairFields({ dark, light, disabled, onDark, onLight, onBoth }) {
  return (
    <div className="space-y-2" data-testid="shop-pair-fields">
      <div className="grid gap-3 sm:grid-cols-2">
        <DropZone file={dark} onFile={onDark} onFiles={onBoth} accept={ACCEPT} disabled={disabled} label="Für dunkle Shirts"
          hint="Hauptdatei – meist die Fassung „auf Schwarz“" testId="shop-pair-dark" />
        <DropZone file={light} onFile={onLight} onFiles={onBoth} accept={ACCEPT} disabled={disabled} label="Für helle Shirts"
          hint="Die Fassung „auf Weiß“" testId="shop-pair-light" />
      </div>
      <p className="text-xs text-white/45">Tipp: beide Dateien auf einmal in ein Feld ziehen oder auswählen – die Website ordnet sie selbst zu. Am besten zwei SVGs mit gleicher Zeichenfläche.</p>
    </div>
  );
}

function UploadForm({ designs, placements, limits, busy, preset, onUpload, onPairUpload }) {
  const [key, setKey] = useState(preset?.key || designs[0]?.design_key || "");
  const [isNew, setIsNew] = useState(designs.length === 0);
  const [variant, setVariant] = useState(preset?.variant || "dark");
  const [shape, setShape] = useState(preset?.mode === "pair" ? "pair" : "single");
  const [title, setTitle] = useState("");
  const [placement, setPlacement] = useState("front_right");
  const [colors, setColors] = useState("");
  const [file, setFile] = useState(null);
  const [pixels, setPixels] = useState(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState("");
  const [pairFiles, setPairFiles] = useState({ dark: null, light: null, auto: false });
  const [check, setCheck] = useState({ status: "idle", report: null, error: "" });
  const [confirming, setConfirming] = useState(false);
  const checked = useRef(null);

  useEffect(() => {
    if (preset?.key) {
      setKey(preset.key);
      setIsNew(false);
      setVariant(preset.variant || "dark");
      setShape(preset.mode === "pair" ? "pair" : "single");
    }
  }, [preset]);

  // Vorschau der Prüfung schon vor dem Hochladen - entscheiden tut der Server. Ein SVG ist scharf in jeder Größe.
  useEffect(() => {
    setPixels(null);
    if (!file || isSvg(file) || typeof URL.createObjectURL !== "function") return undefined;
    let url;
    try {
      url = URL.createObjectURL(file);
    } catch {
      return undefined; // ohne Vorschau - der Server prüft trotzdem
    }
    const probe = new Image();
    probe.onload = () => setPixels({ width: probe.naturalWidth, height: probe.naturalHeight });
    probe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const existing = designs.find((item) => item.design_key === key);
  const targetPlacement = isNew ? placement : existing?.placement;
  const spec = placements.find((item) => item.key === targetPlacement);
  const dpi = pixels && spec ? pixels.width / spec.print_width_in : null;
  const keyValid = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key) && key.length <= 60;
  const pair = shape === "pair";
  const ready = !busy && !!file && keyValid && (!isNew || title.trim().length > 0);
  const bothFiles = !!pairFiles.dark && !!pairFiles.light;
  const pairLevel = check.report?.level;
  const pairReady = !busy && bothFiles && keyValid && (!isNew || title.trim().length > 0) && check.status === "done"
    && !!pairLevel && pairLevel !== "red";

  // Sind beide Dateien da, prüft der Server sofort - nur prüfen, gespeichert wird erst mit „Paar speichern“.
  useEffect(() => {
    if (!pair || !pairFiles.dark || !pairFiles.light || !targetPlacement) return undefined;
    const done = checked.current;
    if (done && done.dark === pairFiles.dark && done.light === pairFiles.light && done.placement === targetPlacement) return undefined;
    checked.current = { dark: pairFiles.dark, light: pairFiles.light, placement: targetPlacement };
    let live = true;
    const form = new FormData();
    form.append("file_dark", pairFiles.dark);
    form.append("file_light", pairFiles.light);
    if (isNew) form.append("placement", targetPlacement);
    else form.append("design_key", key);
    form.append("auto_assign", pairFiles.auto ? "true" : "false");
    setConfirming(false);
    setCheck({ status: "checking", report: null, error: "" });
    uploadApi.post(`${BASE}/pair-check`, form).then(({ data: report }) => {
      if (!live) return;
      if (report.swapped) {
        // Der Server hat getauscht: die Felder zeigen jetzt seine Zuordnung - ohne zweite Prüfung.
        checked.current = { dark: pairFiles.light, light: pairFiles.dark, placement: targetPlacement };
        setPairFiles({ dark: pairFiles.light, light: pairFiles.dark, auto: false });
      }
      setCheck({ status: "done", report, error: "" });
    }).catch((failure) => {
      if (!live) return;
      const report = failure?.response?.data?.pair || null;
      setCheck({ status: "done", report, error: formatRequestError(failure, "Die Prüfung hat nicht geklappt.") });
    });
    return () => { live = false; };
  }, [pair, pairFiles, targetPlacement, isNew, key]);

  const setPair = (patch) => {
    setPairFiles((now) => ({ ...now, auto: false, ...patch }));
    setProblem("");
    setConfirming(false);
    if (patch.dark === null || patch.light === null) setCheck({ status: "idle", report: null, error: "" });
  };
  const swap = () => setPair({ dark: pairFiles.light, light: pairFiles.dark });

  const resetPair = () => {
    setPairFiles({ dark: null, light: null, auto: false });
    setCheck({ status: "idle", report: null, error: "" });
    setConfirming(false);
    checked.current = null;
  };

  const savePair = async (confirmed) => {
    if (!pairReady) return;
    const form = new FormData();
    form.append("file_dark", pairFiles.dark);
    form.append("file_light", pairFiles.light);
    form.append("design_key", key);
    form.append("reason", reason.trim());
    form.append("auto_assign", "false");
    form.append("confirm_warnings", confirmed ? "true" : "false");
    if (isNew) {
      form.append("title", title.trim());
      form.append("placement", placement);
      if (colors.trim()) form.append("garment_colors", colors);
    }
    setProblem("");
    const result = await onPairUpload(form);
    if (result === true) {
      resetPair();
      setReason("");
      setIsNew(false);
    } else if (typeof result === "string") {
      setProblem(result);
      setConfirming(false);
    }
  };

  const submit = async (event) => {
    event.preventDefault();
    if (pair) {
      if (!pairReady) return;
      if (pairLevel === "yellow") setConfirming(true);
      else await savePair(false);
      return;
    }
    if (!ready) return;
    const form = new FormData();
    form.append("file", file);
    form.append("design_key", key);
    form.append("reason", reason.trim());
    form.append("variant", isNew ? "dark" : variant);
    if (isNew) {
      form.append("title", title.trim());
      form.append("placement", placement);
      if (colors.trim()) form.append("garment_colors", colors);
    }
    setProblem("");
    const result = await onUpload(form);
    if (result === true) {
      setFile(null);
      setReason("");
      setIsNew(false);
      event.target.reset();
    } else if (typeof result === "string") {
      setProblem(result);
    }
  };

  return (
    <form className="space-y-3" onSubmit={submit} data-testid="shop-design-upload">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Motiv">
        {[{ value: false, label: "Neue Datei für ein Motiv" }, { value: true, label: "Neues Motiv" }].map((option) => (
          <button key={option.label} type="button" role="radio" aria-checked={isNew === option.value} disabled={!option.value && designs.length === 0}
            onClick={() => { setIsNew(option.value); setKey(option.value ? "" : designs[0]?.design_key || ""); setVariant("dark"); }}
            className={`min-h-10 px-3 text-sm border rounded-sm transition-colors duration-150 disabled:opacity-40 ${isNew === option.value ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
            data-testid={`shop-design-mode-${option.value ? "new" : "version"}`}>
            {option.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Dateien">
        {[{ value: "single", label: "Eine Datei" }, { value: "pair", label: "Als Paar (hell + dunkel)" }].map((option) => (
          <button key={option.value} type="button" role="radio" aria-checked={shape === option.value}
            onClick={() => { setShape(option.value); setProblem(""); setConfirming(false); }}
            className={`min-h-10 px-3 text-sm border rounded-sm transition-colors duration-150 ${shape === option.value ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
            data-testid={`shop-design-shape-${option.value}`}>
            {option.label}
          </button>
        ))}
      </div>
      {isNew ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Kennung" hint="Kleinbuchstaben, Ziffern, Bindestriche - steht im Dateinamen für Printful (z. B. loewe-vorne).">
            <input value={key} onChange={(event) => setKey(event.target.value.trim())} maxLength={60} className={INPUT} data-testid="shop-design-key" />
          </Field>
          <Field label="Titel">
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={INPUT} data-testid="shop-design-title" />
          </Field>
          <Field label="Platzierung">
            <select value={placement} onChange={(event) => setPlacement(event.target.value)} className={INPUT} data-testid="shop-design-placement">
              {placements.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </select>
          </Field>
          <Field label="Feste Shirtfarben (optional)" hint="Nur, wenn diese Farben immer die Hauptdatei drucken sollen. Sonst wählt die Helligkeit der Shirtfarbe die Fassung.">
            <input value={colors} onChange={(event) => setColors(event.target.value)} maxLength={1000} className={INPUT} data-testid="shop-design-colors" />
          </Field>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Motiv">
            <select value={key} onChange={(event) => setKey(event.target.value)} className={INPUT} data-testid="shop-design-select">
              {designs.map((item) => <option key={item.design_key} value={item.design_key}>{item.title} ({item.design_key}) – {item.placement_label}</option>)}
            </select>
          </Field>
          {!pair && <div className="text-sm">
            <span className="text-white/70">Fassung</span>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Fassung">
              {["dark", "light"].map((value) => (
                <button key={value} type="button" role="radio" aria-checked={variant === value} onClick={() => setVariant(value)}
                  className={`min-h-10 px-3 text-sm border rounded-sm transition-colors duration-150 ${variant === value ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
                  data-testid={`shop-design-variant-${value}`}>
                  {value === "dark" ? "Für dunkle Shirts (Hauptdatei)" : "Für helle Shirts (eigene Datei)"}
                </button>
              ))}
            </div>
          </div>}
        </div>
      )}
      {pair ? (
        <PairFields dark={pairFiles.dark} light={pairFiles.light} disabled={busy}
          onDark={(next) => setPair({ dark: next })} onLight={(next) => setPair({ light: next })}
          onBoth={([first, second]) => setPair({ dark: first, light: second, auto: true })} />
      ) : (
        <DropZone file={file} onFile={(next) => { setFile(next); setProblem(""); }} disabled={busy} accept={ACCEPT} />
      )}
      <p className="text-xs text-white/45">
        {limits.formats.join(", ")} · PNG/JPG höchstens {limits.max_mb} MB, SVG höchstens {limits.svg_max_mb} MB.
        {spec ? ` ${spec.label}: Druckbreite ${spec.print_width}, für PNG mind. ${spec.min_width_px} px Breite (${spec.min_dpi} DPI).` : ""}
      </p>
      {pair && <PairReport check={check} onSwap={swap} busy={busy || check.status === "checking"} />}
      {pair && confirming && check.report && (
        <PairConfirm report={check.report} busy={busy} onConfirm={() => savePair(true)} onCancel={() => setConfirming(false)} />
      )}
      {pair && pairLevel === "red" && (
        <p className="text-xs text-warn" data-testid="shop-pair-blocked">Speichern gesperrt – bitte die Dateien korrigieren und neu wählen.</p>
      )}
      {!pair && isSvg(file) && (
        <p className="text-xs text-white/70" data-testid="shop-design-precheck">
          SVG: der Server prüft es streng (keine Skripte, keine Pixelbilder, keine Verweise nach außen) und rastert es scharf für den Druck.
        </p>
      )}
      {!pair && pixels && spec && !isSvg(file) && (
        <p className={`text-xs ${dpi >= spec.min_dpi ? "text-ok" : "text-warn"}`} data-testid="shop-design-precheck">
          {pixels.width} × {pixels.height} px: bei {inches(spec.print_width_in)} Breite {Math.floor(dpi)} DPI – {dpi >= spec.min_dpi ? "reicht" : `zu wenig, nötig sind ${spec.min_dpi}`}.
        </p>
      )}
      {problem && (
        <div role="alert" className="flex gap-2 border border-warn/50 bg-warn/10 rounded-sm px-3 py-2 text-sm" data-testid="shop-design-upload-error">
          <XOctagon className="w-4 h-4 mt-0.5 shrink-0 text-warn" aria-hidden="true" />
          <span>{problem}</span>
        </div>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ReasonInput id="shop-design-reason" value={reason} onChange={setReason} disabled={busy} />
        <button type="submit" disabled={pair ? !pairReady || confirming : !ready} className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40 inline-flex items-center gap-2" data-testid="shop-design-submit">
          <Upload className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? "Lädt hoch …" : pair ? "Paar speichern" : "Hochladen und prüfen"}
        </button>
      </div>
    </form>
  );
}

function ColorEditor({ design, busy, onSave }) {
  const [open, setOpen] = useState(false);
  const [colors, setColors] = useState("");
  const [reason, setReason] = useState("");
  if (!open) {
    return (
      <button type="button" onClick={() => { setColors((design.garment_colors || []).join(", ")); setReason(""); setOpen(true); }}
        className={QUIET_BUTTON} data-testid={`shop-design-${design.design_key}-colors-edit`}>
        Feste Farben ändern
      </button>
    );
  }
  const ready = !busy;
  return (
    <form className="w-full space-y-2" onSubmit={async (event) => {
      event.preventDefault();
      if (!ready) return;
      const list = colors.split(",").map((item) => item.trim()).filter(Boolean);
      if (await onSave(design.design_key, list, reason.trim())) setOpen(false);
    }}>
      <Field label="Feste Shirtfarben (durch Komma getrennt) - drucken immer die Hauptdatei">
        <input value={colors} onChange={(event) => setColors(event.target.value)} maxLength={1000} className={INPUT} data-testid={`shop-design-${design.design_key}-colors`} />
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ReasonInput id={`shop-design-${design.design_key}-colors-reason`} value={reason} onChange={setReason} disabled={busy} />
        <button type="submit" disabled={!ready} className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40" data-testid={`shop-design-${design.design_key}-colors-save`}>Speichern</button>
        <button type="button" onClick={() => setOpen(false)} className="tls-btn tls-btn--quiet min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>
      </div>
    </form>
  );
}

// Ausnahmen je Shirtfarbe (#2069): diese Farbe bekommt immer die gewählte Fassung - unabhängig von der Helligkeit.
function ExceptionEditor({ design, busy, max, onSave }) {
  const [rows, setRows] = useState(null);
  const id = `shop-motif-${design.design_key}-exceptions`;
  if (rows === null) {
    return (
      <button type="button" onClick={() => setRows((design.color_variants || []).map((item) => ({ ...item })))}
        className={QUIET_BUTTON} data-testid={`${id}-edit`}>
        Ausnahmen je Farbe{design.color_variants?.length ? ` (${design.color_variants.length})` : ""}
      </button>
    );
  }
  const clean = rows.map((row) => ({ color: row.color.trim(), variant: row.variant })).filter((row) => row.color);
  const update = (index, patch) => setRows((now) => now.map((row, at) => (at === index ? { ...row, ...patch } : row)));
  return (
    <div className="w-full space-y-2 border border-white/10 rounded-sm p-3" data-testid={id}>
      <p className="text-xs text-white/55">Sonst entscheidet die Helligkeit der Shirtfarbe. Der Name muss so heißen wie die Farbe an den Varianten (z. B. Navy).</p>
      <ul className="space-y-2">
        {rows.map((row, index) => (
          <li key={index} className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor={`${id}-color-${index}`}>Shirtfarbe</label>
            <input id={`${id}-color-${index}`} value={row.color} maxLength={40} onChange={(event) => update(index, { color: event.target.value })}
              placeholder="Shirtfarbe" className={`${INPUT} mt-0 sm:flex-1`} data-testid={`${id}-color-${index}`} />
            <label className="sr-only" htmlFor={`${id}-variant-${index}`}>Fassung</label>
            <select id={`${id}-variant-${index}`} value={row.variant} onChange={(event) => update(index, { variant: event.target.value })}
              className={`${INPUT} mt-0 sm:w-56`} data-testid={`${id}-variant-${index}`}>
              <option value="dark">Fassung für dunkle Shirts</option>
              <option value="light">Fassung für helle Shirts</option>
            </select>
            <button type="button" onClick={() => setRows((now) => now.filter((_row, at) => at !== index))}
              className={`${QUIET_BUTTON} inline-flex items-center gap-1.5`} aria-label={`Ausnahme ${row.color || index + 1} entfernen`} data-testid={`${id}-remove-${index}`}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Entfernen
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={rows.length >= max} onClick={() => setRows((now) => [...now, { color: "", variant: "light" }])}
          className={`${SECONDARY_BUTTON} inline-flex items-center gap-1.5`} data-testid={`${id}-add`}>
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Farbe hinzufügen
        </button>
        <button type="button" onClick={() => setRows(null)} className={QUIET_BUTTON}>Abbrechen</button>
      </div>
      <ReasonedButton id={`${id}-save`} label="Ausnahmen speichern" busy={busy}
        onSubmit={async (reason) => {
          const saved = await onSave(design.design_key, clean, reason);
          if (saved) setRows(null);
          return saved;
        }} />
    </div>
  );
}

function copyAddress(version) {
  const url = version.public_url?.startsWith("http") ? version.public_url : resolveMediaUrl(version.public_path);
  if (!navigator.clipboard?.writeText) {
    toast.error("Kopieren geht in diesem Browser nicht.");
    return;
  }
  navigator.clipboard.writeText(url).then(() => toast.success(`Adresse von Version ${version.version} kopiert.`), () => toast.error("Kopieren hat nicht geklappt."));
}

function MotifCard({ design, busy, maxExceptions, onColors, onExceptions, onNewFile, onAutoLight }) {
  const latest = design.latest;
  const light = design.light || { state: "none" };
  const lightState = LIGHT_STATES[light.state] || LIGHT_STATES.none;
  const key = design.design_key;
  const canAuto = !!latest && (design.light_mode === "file" || ["pending", "missing"].includes(light.state));
  return (
    <li className="border border-white/10 rounded-sm p-3 bg-black/20" data-testid={`shop-design-${key}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="text-base font-bold">{design.title}</h3>
        <code className="text-xs text-white/50">{key}</code>
        <span className="text-xs text-white/60">{design.placement_label}</span>
      </div>
      <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className="grid grid-cols-2 gap-3" data-testid={`shop-motif-${key}-previews`}>
          <ShirtPreview version={latest} title={design.title} shirt="dark" testId={`shop-motif-${key}-on-dark`} />
          <ShirtPreview version={light.latest} title={design.title} shirt="light" testId={`shop-motif-${key}-on-light`} />
        </div>
        <div className="min-w-0 space-y-2">
          {latest ? (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid={`shop-design-${key}-latest`}>
              <div><dt className="text-white/50 text-xs">Hauptdatei</dt><dd>v{latest.version} · {viennaDateTime(latest.created_at)}{latest.created_by ? ` · ${latest.created_by}` : ""}</dd></div>
              <div><dt className="text-white/50 text-xs">Format</dt><dd data-testid={`shop-motif-${key}-format`}>
                {latest.is_vector
                  ? <span className="inline-flex items-center gap-1 text-ok"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> echtes Vektor-SVG</span>
                  : `${latest.source_format || "PNG"} (Pixel)`}
              </dd></div>
              <div><dt className="text-white/50 text-xs">Maße im Druck</dt><dd className="tabular-nums">{latest.print_size || "–"}</dd></div>
              <div><dt className="text-white/50 text-xs">Druckdatei</dt><dd className="tabular-nums">{latest.width_px} × {latest.height_px} px{latest.has_alpha ? " · durchsichtig" : " · ohne Transparenz"}{latest.aspect_ratio ? ` · Seitenverhältnis ${number(latest.aspect_ratio, 3)}` : ""}</dd></div>
              <div><dt className="text-white/50 text-xs">Prüfsumme (SHA-256)</dt><dd><code className="font-mono text-xs" title={latest.sha256}>{latest.sha256_short}…</code></dd></div>
              <div><dt className="sr-only">Auflösung</dt><dd className="flex flex-wrap items-center gap-2"><Light check={latest.check} testId={`shop-design-${key}-check`} /><span className="text-xs text-white/60">{latest.check?.text}</span></dd></div>
            </dl>
          ) : <p className="text-sm text-white/55">Noch keine Datei.</p>}
          <Swatches colors={latest?.colors} testId={`shop-motif-${key}-colors`} />
          <div className="flex flex-wrap items-center gap-2 text-sm" data-testid={`shop-motif-${key}-light`}>
            <span className="text-white/50 text-xs">Für helle Shirts:</span>
            <span className={`inline-flex items-center border rounded-sm px-2 py-0.5 text-xs font-bold ${lightState.tone}`} data-state={light.state}>{lightState.label}</span>
            {light.hint && <span className="text-xs text-white/60">{light.hint}</span>}
          </div>
          {design.pair_stale && design.pair?.outdated && (
            <div role="status" className="flex flex-col gap-2 border border-warn/40 bg-warn/10 rounded-sm px-3 py-2 text-sm sm:flex-row sm:items-center" data-testid={`shop-motif-${key}-pair-stale`}>
              <span className="inline-flex items-start gap-2 flex-1">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0 text-warn" aria-hidden="true" />
                <span>
                  Nur eine Fassung wurde ersetzt: die andere ({VARIANT_LABELS[design.pair.outdated]}) ist noch Version {design.pair[`${design.pair.outdated}_version`]} – auch ersetzen?
                </span>
              </span>
              <button type="button" onClick={() => onNewFile(key, design.pair.outdated)} disabled={busy} className={SECONDARY_BUTTON} data-testid={`shop-motif-${key}-pair-stale-replace`}>
                Auch ersetzen
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white/50 text-xs">Feste Shirtfarben:</span>
            {(design.garment_colors || []).length
              ? design.garment_colors.map((color) => <span key={color} className="border border-white/15 rounded-sm px-2 py-0.5 text-xs" data-testid="shop-design-color">{color}</span>)
              : <span className="text-xs text-white/55">keine - die Helligkeit entscheidet</span>}
            {(design.color_variants || []).map((item) => (
              <span key={item.color} className="border border-brand/40 rounded-sm px-2 py-0.5 text-xs" data-testid="shop-motif-exception">{item.color} → {VARIANT_LABELS[item.variant]}</span>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onNewFile(key, "dark")} disabled={busy} className={SECONDARY_BUTTON} data-testid={`shop-design-${key}-new-version`}>
              Neue Hauptdatei
            </button>
            <button type="button" onClick={() => onNewFile(key, "light")} disabled={busy || !latest} className={SECONDARY_BUTTON} data-testid={`shop-motif-${key}-new-light`}>
              Eigene Datei für helle Shirts
            </button>
            <button type="button" onClick={() => onNewFile(key, "dark", "pair")} disabled={busy} className={SECONDARY_BUTTON} data-testid={`shop-motif-${key}-new-pair`}>
              Als Paar ersetzen
            </button>
            {latest?.public && (
              <button type="button" onClick={() => copyAddress(latest)} className={`${QUIET_BUTTON} inline-flex items-center gap-1.5`} data-testid={`shop-design-${key}-copy`}>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Adresse für Printful
              </button>
            )}
            <ColorEditor design={design} busy={busy} onSave={onColors} />
            <ExceptionEditor design={design} busy={busy} max={maxExceptions} onSave={onExceptions} />
          </div>
          {canAuto && (
            <ReasonedButton id={`shop-motif-${key}-auto`} variant="secondary" busy={busy}
              label={design.light_mode === "file" ? "Zurück auf automatisch" : "Hell-Variante erzeugen"}
              onSubmit={(reason) => onAutoLight(key, reason)} />
          )}
        </div>
      </div>
      {design.versions.length > 0 && (
        <details className="mt-3 border-t border-white/10 pt-2 group">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white min-h-8 inline-flex items-center" data-testid={`shop-design-${key}-history`}>
            Versionsverlauf ({design.versions.length})
          </summary>
          <ol className="mt-2 space-y-1.5">
            {design.versions.map((version) => (
              <li key={version.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70" data-testid={`shop-design-${key}-v${version.version}`}>
                <b className="text-white">v{version.version}</b>
                <span>{VARIANT_LABELS[version.variant] || VARIANT_LABELS.dark}</span>
                <span className="text-white/50">{ORIGIN_LABELS[version.origin] || version.origin}{version.derived_from ? ` aus v${version.derived_from}` : ""}{version.is_vector ? " · SVG" : ""}</span>
                <span>{viennaDateTime(version.created_at)}</span>
                {version.created_by && <span>{version.created_by}</span>}
                <code className="font-mono" title={version.sha256}>{version.sha256_short}…</code>
                <span className="tabular-nums">{version.print_size || "–"}</span>
                <Light check={version.check} />
                {version.public
                  ? <a href={resolveMediaUrl(version.public_path)} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand hover:underline">{version.file_name} <ExternalLink className="w-3 h-3" aria-hidden="true" /></a>
                  : <span className="text-white/45">nicht mehr öffentlich</span>}
              </li>
            ))}
          </ol>
        </details>
      )}
    </li>
  );
}

// Ersatzfarbe für helle Shirts und Helligkeits-Schwelle - mit Beispielen, welche Fassung welche Shirtfarbe bekommt.
// Schwellen der Paar-Prüfung (#2084) - im Server Anteile (0,02), hier in Prozent.
const PAIR_SETTINGS = [
  { name: "pair_aspect_tolerance", label: "Seitenverhältnis darf abweichen um (%)", hint: "Mehr Abweichung ist Rot: das Paar wird abgelehnt." },
  { name: "pair_min_overlap", label: "Umrisse decken sich mindestens zu (%)", hint: "Weniger ist Gelb: „Sind das wirklich zwei Fassungen desselben Logos?“" },
  { name: "pair_contrast_share", label: "Höchstens sehr helle bzw. dunkle Fläche (%)", hint: "Mehr Weiß in der Hell- bzw. Schwarz in der Dunkel-Fassung ist Gelb." },
];

function percent(share) {
  return String(Number((Number(share) * 100).toFixed(1))).replace(".", ",");
}

function pairInputs(settings) {
  return Object.fromEntries(PAIR_SETTINGS.filter((item) => settings[item.name] != null).map((item) => [item.name, percent(settings[item.name])]));
}

function MotifSettings({ settings, busy, onSave }) {
  const [ink, setInk] = useState(settings.light_ink);
  const [threshold, setThreshold] = useState(String(settings.threshold).replace(".", ","));
  const [pairValues, setPairValues] = useState(() => pairInputs(settings));
  useEffect(() => {
    setInk(settings.light_ink);
    setThreshold(String(settings.threshold).replace(".", ","));
    setPairValues(pairInputs(settings));
  }, [settings]);
  const parsed = Number(String(threshold).replace(",", "."));
  const { min_threshold: low, max_threshold: high } = settings.limits;
  const inkValid = /^#[0-9a-f]{6}$/i.test(ink) && ink.toLowerCase() !== "#ffffff";
  const thresholdValid = Number.isFinite(parsed) && parsed >= low && parsed <= high;
  const pairShares = Object.fromEntries(Object.entries(pairValues).map(([name, text]) => [name, Number((Number(String(text).replace(",", ".")) / 100).toFixed(4))]));
  const pairInvalid = PAIR_SETTINGS.find(({ name }) => name in pairShares && !(Number.isFinite(pairShares[name])
    && pairShares[name] >= settings.limits[`${name}_min`] && pairShares[name] <= settings.limits[`${name}_max`]));
  const pairChanged = Object.fromEntries(Object.entries(pairShares).filter(([name, value]) => value !== settings[name]));
  const changed = ink.toLowerCase() !== settings.light_ink || parsed !== settings.threshold || Object.keys(pairChanged).length > 0;
  return (
    <div className="space-y-3" data-testid="shop-motif-settings">
      <p className="text-xs text-white/55">
        Die Fassung für helle Shirts entsteht, indem Weiß ({settings.replaced_color}) durch die Ersatzfarbe ersetzt wird – alle anderen Farben bleiben. Welche Fassung eine Shirtfarbe bekommt, entscheidet ihre Helligkeit; eine Ausnahme je Farbe geht am Motiv.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Ersatzfarbe für Weiß" hint={`Vorgabe ${settings.defaults.light_ink} (sehr dunkles Grau). Eine neue Farbe erzeugt die automatischen Fassungen neu; Bestellungen behalten ihre.`}>
          <span className="mt-1 flex items-center gap-2">
            <input type="color" value={inkValid ? ink : settings.light_ink} onChange={(event) => setInk(event.target.value)} aria-label="Ersatzfarbe wählen"
              className="h-10 w-12 bg-black/40 border border-white/15 rounded-sm" data-testid="shop-motif-ink-picker" />
            <input value={ink} onChange={(event) => setInk(event.target.value.trim())} maxLength={7} className={`${INPUT} mt-0 font-mono`} data-testid="shop-motif-ink" />
          </span>
        </Field>
        <Field label="Helligkeits-Schwelle (0 = Schwarz, 1 = Weiß)" hint={`Ab diesem Wert gilt ein Shirt als hell. Vorgabe ${String(settings.defaults.threshold).replace(".", ",")}, erlaubt ${String(low).replace(".", ",")} bis ${String(high).replace(".", ",")}.`}>
          <input value={threshold} onChange={(event) => setThreshold(event.target.value)} inputMode="decimal" className={`${INPUT} tabular-nums`} data-testid="shop-motif-threshold" />
        </Field>
      </div>
      <ul className="flex flex-wrap gap-2" aria-label="Beispiele" data-testid="shop-motif-samples">
        {SAMPLE_SHIRTS.map((shirt) => {
          const variant = thresholdValid && luminance(shirt.hex) >= parsed ? "light" : "dark";
          return (
            <li key={shirt.name} className="inline-flex items-center gap-1.5 border border-white/10 rounded-sm px-2 py-1 text-xs" data-variant={variant}>
              <span className="w-3.5 h-3.5 rounded-sm border border-white/30" style={{ backgroundColor: shirt.hex }} aria-hidden="true" />
              {shirt.name} → {VARIANT_LABELS[variant]}
            </li>
          );
        })}
      </ul>
      {Object.keys(pairValues).length > 0 && (
        <fieldset className="space-y-2 border-t border-white/10 pt-3" data-testid="shop-motif-pair-settings">
          <legend className="text-xs font-bold uppercase tracking-wider text-white/60">Paar-Prüfung (hell + dunkel)</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {PAIR_SETTINGS.filter(({ name }) => name in pairValues).map(({ name, label, hint }) => (
              <Field key={name} label={label}
                hint={`${hint} Vorgabe ${percent(settings.defaults[name])} %, erlaubt ${percent(settings.limits[`${name}_min`])} bis ${percent(settings.limits[`${name}_max`])} %.`}>
                <input value={pairValues[name]} onChange={(event) => setPairValues((now) => ({ ...now, [name]: event.target.value }))}
                  inputMode="decimal" className={`${INPUT} tabular-nums`} data-testid={`shop-motif-${name}`} />
              </Field>
            ))}
          </div>
        </fieldset>
      )}
      <ReasonedButton id="shop-motif-settings-save" label="Speichern" busy={busy} disabled={!changed || !inkValid || !thresholdValid || !!pairInvalid}
        blockedHint={!inkValid ? "Ersatzfarbe als #rrggbb, nicht Weiß." : !thresholdValid ? `Schwelle von ${low} bis ${high}.`
          : pairInvalid ? `${pairInvalid.label}: von ${percent(settings.limits[`${pairInvalid.name}_min`])} bis ${percent(settings.limits[`${pairInvalid.name}_max`])}.` : "Nichts geändert."}
        onSubmit={(reason) => onSave({ light_ink: ink.toLowerCase(), threshold: parsed, ...pairChanged }, reason)} />
    </div>
  );
}

export default function AdminShopDesignsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [preset, setPreset] = useState(null);

  useEffect(() => {
    api.get(BASE).then(({ data: next }) => { setData(next); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Die Motive lassen sich gerade nicht laden.")));
  }, []);

  // Liefert true bei Erfolg, sonst den Text des Servers (für Meldungen am Formular).
  const run = useCallback(async (key, request, success) => {
    setBusy(key);
    try {
      const { data: next } = await request();
      setData(next);
      toast.success(typeof success === "function" ? success(next) : success);
      for (const warning of next.uploaded?.warnings || next.uploaded_pair?.warnings || []) toast.warning(warning);
      return true;
    } catch (failure) {
      const text = formatRequestError(failure, "Das hat nicht geklappt.");
      toast.error(text);
      return text;
    } finally {
      setBusy("");
    }
  }, []);
  const ok = useCallback(async (...args) => (await run(...args)) === true, [run]);

  const placements = useMemo(() => data?.placements || [], [data]);

  if (error) {
    return <AdminLayout><div className="border border-warn/40 bg-warn/10 rounded-sm p-4 text-sm" data-testid="shop-designs-error">{error}</div></AdminLayout>;
  }
  if (!data) return <AdminLayout><div className="text-sm text-white/45" role="status">Lade Motive …</div></AdminLayout>;

  const settings = data.motif_settings;
  return (
    <AdminLayout>
      <div>
        <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><ShoppingBag className="w-7 h-7 text-honor" aria-hidden="true" /> Shop</h1>
        <ShopTabs />
        <p className="mt-4 text-sm text-white/60 max-w-2xl">
          Motive des Vereins: eine Hauptdatei für dunkle Shirts (am besten als SVG) und eine Fassung für helle Shirts – automatisch umgefärbt oder als eigene Datei. Jede Datei wird geprüft, ohne Metadaten neu abgelegt und bekommt als neue Version eine eigene Adresse für Printful. Ältere Versionen bleiben für ihre Bestellungen.
        </p>
      </div>

      <div className="mt-6 space-y-4 max-w-5xl">
        <Section title="Motive" icon={FileImage} testId="shop-designs">
          {data.designs.length === 0
            ? <p className="text-sm text-white/55" data-testid="shop-designs-empty">Noch keine Motive. Lade unten die erste Datei hoch.</p>
            : (
              <ul className="space-y-3">
                {data.designs.map((design) => (
                  <MotifCard key={design.design_key} design={design} busy={!!busy} maxExceptions={data.limits.max_exceptions || 40}
                    onNewFile={(key, variant, mode = "single") => { setPreset({ key, variant, mode, at: Date.now() }); document.getElementById("shop-design-upload-section")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }}
                    onColors={(key, colors, reason) => ok("colors", () => api.patch(`${BASE}/${key}`, { garment_colors: colors, reason }), "Feste Farben gespeichert.")}
                    onExceptions={(key, rows, reason) => ok("exceptions", () => api.patch(`${BASE}/${key}`, { color_variants: rows, reason }), "Ausnahmen gespeichert.")}
                    onAutoLight={(key, reason) => ok("auto", () => api.post(`${BASE}/${key}/light-auto`, { reason }), (next) => (next.light?.state === "auto" ? "Fassung für helle Shirts erzeugt." : "Fassung für helle Shirts geprüft."))} />
                ))}
              </ul>
            )}
        </Section>

        <div id="shop-design-upload-section">
          <Section title="Datei hochladen" icon={Upload} testId="shop-design-upload-section">
            <UploadForm designs={data.designs} placements={placements} limits={data.limits} busy={busy === "upload"} preset={preset}
              onUpload={(form) => run("upload", () => uploadApi.post(`${BASE}/upload`, form), (next) => `Version ${next.uploaded.version} von ${next.uploaded.design_key} gespeichert.`)}
              onPairUpload={(form) => run("upload", () => uploadApi.post(`${BASE}/upload-pair`, form), (next) => `Paar von ${next.uploaded_pair.design_key} gespeichert: Version ${next.uploaded_pair.dark_version} für dunkle, Version ${next.uploaded_pair.light_version} für helle Shirts.`)} />
          </Section>
        </div>

        {settings && (
          <Section title="Helle Shirts und Paar-Prüfung: Einstellungen" icon={Palette} testId="shop-motif-settings-section">
            <MotifSettings settings={settings} busy={busy === "settings"}
              onSave={(values, reason) => ok("settings", () => api.put(`${BASE}/motif-settings`, { ...values, reason }), "Einstellungen gespeichert.")} />
          </Section>
        )}

        <Section title="Druckbereiche je Platzierung" icon={Ruler} testId="shop-placements">
          <p className="text-xs text-white/55">Printful rechnet in Zoll; 1 Zoll = 2,54 cm. Die Ampel der Motive rechnet mit diesen Werten, jede Version behält die Maße, mit denen sie geprüft wurde.</p>
          <ul className="space-y-3">
            {placements.map((spec) => (
              <PlacementRow key={spec.key} spec={spec} busy={busy === `placement-${spec.key}`}
                onSave={(key, values, reason) => ok(`placement-${key}`, () => api.put(`${BASE}/placements/${key}`, { ...values, reason }), "Druckbereich gespeichert.")} />
            ))}
          </ul>
        </Section>
      </div>
    </AdminLayout>
  );
}
