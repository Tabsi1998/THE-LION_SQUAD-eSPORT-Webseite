import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, Copy, ExternalLink, FileImage, Ruler, ShoppingBag, Upload, XOctagon } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError, resolveMediaUrl, uploadApi } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";
import ShopTabs from "./ShopTabs";

// Designs und Druckdateien des Vereins (#1708) - Verwaltung → Finanzen → Shop → Designs. Nur die Finanzen laden hoch,
// immer mit Grund (Protokoll). Der Server kodiert jede Datei neu, prüft sie gegen den Druckbereich der Platzierung und
// legt sie als neue Version mit eigener Adresse für Printful ab; alte Versionen bleiben. Maße immer in Zoll und cm.

const BASE = "/admin/shop/designs";
const CM_PER_INCH = 2.54;

function number(value, digits) {
  return String(Number(Number(value).toFixed(digits))).replace(".", ",");
}

export function inches(value) {
  return `${number(value, 2)} Zoll (${number(value * CM_PER_INCH, 1)} cm)`;
}

const LEVELS = {
  good: { label: "Gut", icon: CheckCircle2, className: "border-ok/40 bg-ok/10 text-ok" },
  snug: { label: "Knapp", icon: AlertTriangle, className: "border-warn/40 text-warn" },
  too_low: { label: "Reicht nicht", icon: XOctagon, className: "border-warn bg-warn/15 text-warn" },
  unknown: { label: "Ohne Maße", icon: AlertTriangle, className: "border-white/20 text-white/60" },
};

// Karo zeigt Transparenz; dazu dunkles und helles Shirt, um weiße und schwarze Logos zu prüfen.
const BACKDROPS = [
  { key: "checker", label: "Karo" },
  { key: "dark", label: "Dunkles Shirt" },
  { key: "light", label: "Helles Shirt" },
];
const CHECKER = {
  backgroundColor: "rgb(255 255 255 / 0.06)",
  backgroundImage: "conic-gradient(rgb(255 255 255 / 0.16) 25%, transparent 0 50%, rgb(255 255 255 / 0.16) 0 75%, transparent 0)",
  backgroundSize: "16px 16px",
};

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

function ReasonInput({ id, value, onChange, disabled }) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>Grund</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} maxLength={500} disabled={disabled}
        placeholder="Grund (kommt ins Protokoll)" className={`${INPUT} mt-0 flex-1`} data-testid={id} />
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

function Preview({ version, title, backdrop }) {
  const surface = backdrop === "dark" ? "bg-black" : backdrop === "light" ? "bg-white" : "";
  return (
    <div className={`aspect-square w-full max-w-[11rem] rounded-sm border border-white/10 grid place-items-center overflow-hidden ${surface}`}
      style={backdrop === "checker" ? CHECKER : undefined} data-backdrop={backdrop} data-testid="shop-design-preview">
      {version?.public_path
        ? <img src={resolveMediaUrl(version.public_path)} alt={`Druckdatei ${title}, Version ${version.version}`} className="max-w-full max-h-full object-contain p-2" loading="lazy" />
        : <FileImage className="w-8 h-8 text-white/30" aria-label="keine öffentliche Datei" />}
    </div>
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
  const ready = valid && reason.trim().length >= 3 && !busy;
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
          <button type="button" onClick={start} className="tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid={`shop-placement-${spec.key}-edit`}>
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

function UploadForm({ designs, placements, limits, busy, preset, onUpload }) {
  const [key, setKey] = useState(preset || designs[0]?.design_key || "");
  const [isNew, setIsNew] = useState(designs.length === 0);
  const [title, setTitle] = useState("");
  const [placement, setPlacement] = useState("front_right");
  const [colors, setColors] = useState("");
  const [file, setFile] = useState(null);
  const [pixels, setPixels] = useState(null);
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (preset) { setKey(preset); setIsNew(false); }
  }, [preset]);

  // Vorschau der Prüfung schon vor dem Hochladen - entscheiden tut der Server.
  useEffect(() => {
    setPixels(null);
    if (!file || typeof URL.createObjectURL !== "function") return undefined;
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
  const ready = !busy && !!file && reason.trim().length >= 3 && keyValid && (!isNew || title.trim().length > 0);

  const submit = async (event) => {
    event.preventDefault();
    if (!ready) return;
    const form = new FormData();
    form.append("file", file);
    form.append("design_key", key);
    form.append("reason", reason.trim());
    if (isNew) {
      form.append("title", title.trim());
      form.append("placement", placement);
      form.append("garment_colors", colors);
    }
    if (await onUpload(form)) {
      setFile(null);
      setReason("");
      setIsNew(false);
      event.target.reset();
    }
  };

  return (
    <form className="space-y-3" onSubmit={submit} data-testid="shop-design-upload">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Design">
        {[{ value: false, label: "Neue Version eines Designs" }, { value: true, label: "Neues Design" }].map((option) => (
          <button key={option.label} type="button" role="radio" aria-checked={isNew === option.value} disabled={!option.value && designs.length === 0}
            onClick={() => { setIsNew(option.value); setKey(option.value ? "" : designs[0]?.design_key || ""); }}
            className={`min-h-10 px-3 text-sm border rounded-sm transition-colors duration-150 disabled:opacity-40 ${isNew === option.value ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
            data-testid={`shop-design-mode-${option.value ? "new" : "version"}`}>
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
          <Field label="Für Shirtfarben" hint="Durch Komma getrennt, wie an den Varianten (z. B. Schwarz, Navy). Je Platzierung gehört eine Farbe zu einem Design.">
            <input value={colors} onChange={(event) => setColors(event.target.value)} maxLength={1000} className={INPUT} data-testid="shop-design-colors" />
          </Field>
        </div>
      ) : (
        <Field label="Design">
          <select value={key} onChange={(event) => setKey(event.target.value)} className={INPUT} data-testid="shop-design-select">
            {designs.map((item) => <option key={item.design_key} value={item.design_key}>{item.title} ({item.design_key}) – {item.placement_label}</option>)}
          </select>
        </Field>
      )}
      <Field label={`Datei (${limits.formats.join(" oder ")}, höchstens ${limits.max_mb} MB)`}
        hint={spec ? `${spec.label}: Druckbreite ${spec.print_width}, nötig mind. ${spec.min_width_px} px Breite (${spec.min_dpi} DPI).` : null}>
        <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" onChange={(event) => setFile(event.target.files?.[0] || null)}
          className={`${INPUT} py-2 file:mr-3 file:border-0 file:bg-white/10 file:text-white file:px-3 file:py-1 file:rounded-sm`} data-testid="shop-design-file" />
      </Field>
      {pixels && spec && (
        <p className={`text-xs ${dpi >= spec.min_dpi ? "text-ok" : "text-warn"}`} data-testid="shop-design-precheck">
          {pixels.width} × {pixels.height} px: bei {inches(spec.print_width_in)} Breite {Math.floor(dpi)} DPI – {dpi >= spec.min_dpi ? "reicht" : `zu wenig, nötig sind ${spec.min_dpi}`}.
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ReasonInput id="shop-design-reason" value={reason} onChange={setReason} disabled={busy} />
        <button type="submit" disabled={!ready} className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40 inline-flex items-center gap-2" data-testid="shop-design-submit">
          <Upload className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? "Lädt hoch …" : "Hochladen und prüfen"}
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
        className="tls-btn tls-btn--quiet min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid={`shop-design-${design.design_key}-colors-edit`}>
        Farben ändern
      </button>
    );
  }
  const ready = reason.trim().length >= 3 && !busy;
  return (
    <form className="w-full space-y-2" onSubmit={async (event) => {
      event.preventDefault();
      if (!ready) return;
      const list = colors.split(",").map((item) => item.trim()).filter(Boolean);
      if (await onSave(design.design_key, list, reason.trim())) setOpen(false);
    }}>
      <Field label="Shirtfarben (durch Komma getrennt)">
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

function copyAddress(version) {
  const url = version.public_url?.startsWith("http") ? version.public_url : resolveMediaUrl(version.public_path);
  if (!navigator.clipboard?.writeText) {
    toast.error("Kopieren geht in diesem Browser nicht.");
    return;
  }
  navigator.clipboard.writeText(url).then(() => toast.success(`Adresse von Version ${version.version} kopiert.`), () => toast.error("Kopieren hat nicht geklappt."));
}

function DesignCard({ design, backdrop, busy, onColors, onNewVersion }) {
  const latest = design.latest;
  return (
    <li className="border border-white/10 rounded-sm p-3 bg-black/20" data-testid={`shop-design-${design.design_key}`}>
      <div className="flex flex-col gap-4 sm:flex-row">
        <Preview version={latest} title={design.title} backdrop={backdrop} />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h3 className="text-base font-bold">{design.title}</h3>
            <code className="text-xs text-white/50">{design.design_key}</code>
            <span className="text-xs text-white/60">{design.placement_label}</span>
          </div>
          {latest ? (
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid={`shop-design-${design.design_key}-latest`}>
              <div><dt className="text-white/50 text-xs">Version</dt><dd>v{latest.version} · {viennaDateTime(latest.created_at)}{latest.created_by ? ` · ${latest.created_by}` : ""}</dd></div>
              <div><dt className="text-white/50 text-xs">Prüfsumme (SHA-256)</dt><dd><code className="font-mono text-xs" title={latest.sha256}>{latest.sha256_short}…</code></dd></div>
              <div><dt className="text-white/50 text-xs">Maße im Druck</dt><dd className="tabular-nums">{latest.print_size || "–"}</dd></div>
              <div><dt className="text-white/50 text-xs">Pixel</dt><dd className="tabular-nums">{latest.width_px} × {latest.height_px} px{latest.has_alpha ? " · durchsichtig" : " · ohne Transparenz"}</dd></div>
              <div className="sm:col-span-2"><dt className="sr-only">Auflösung</dt><dd className="flex flex-wrap items-center gap-2"><Light check={latest.check} testId={`shop-design-${design.design_key}-light`} /><span className="text-xs text-white/60">{latest.check?.text}</span></dd></div>
            </dl>
          ) : <p className="text-sm text-white/55">Noch keine Datei.</p>}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-white/50 text-xs">Für Shirtfarben:</span>
            {(design.garment_colors || []).length
              ? design.garment_colors.map((color) => <span key={color} className="border border-white/15 rounded-sm px-2 py-0.5 text-xs" data-testid="shop-design-color">{color}</span>)
              : <span className="text-xs text-warn">keine zugeordnet</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => onNewVersion(design.design_key)} disabled={busy}
              className="tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40" data-testid={`shop-design-${design.design_key}-new-version`}>
              Neue Version
            </button>
            {latest?.public && (
              <button type="button" onClick={() => copyAddress(latest)} className="tls-btn tls-btn--quiet min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5" data-testid={`shop-design-${design.design_key}-copy`}>
                <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Adresse für Printful
              </button>
            )}
            <ColorEditor design={design} busy={busy} onSave={onColors} />
          </div>
        </div>
      </div>
      {design.versions.length > 0 && (
        <details className="mt-3 border-t border-white/10 pt-2 group">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white min-h-8 inline-flex items-center" data-testid={`shop-design-${design.design_key}-history`}>
            Versionsverlauf ({design.versions.length})
          </summary>
          <ol className="mt-2 space-y-1.5">
            {design.versions.map((version) => (
              <li key={version.version} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70" data-testid={`shop-design-${design.design_key}-v${version.version}`}>
                <b className="text-white">v{version.version}</b>
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

export default function AdminShopDesignsPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [backdrop, setBackdrop] = useState("checker");
  const [preset, setPreset] = useState("");

  useEffect(() => {
    api.get(BASE).then(({ data: next }) => { setData(next); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Die Designs lassen sich gerade nicht laden.")));
  }, []);

  const run = useCallback(async (key, request, success) => {
    setBusy(key);
    try {
      const { data: next } = await request();
      setData(next);
      toast.success(typeof success === "function" ? success(next) : success);
      for (const warning of next.uploaded?.warnings || []) toast.warning(warning);
      return true;
    } catch (failure) {
      toast.error(formatRequestError(failure, "Das hat nicht geklappt."));
      return false;
    } finally {
      setBusy("");
    }
  }, []);

  const placements = useMemo(() => data?.placements || [], [data]);

  if (error) {
    return <AdminLayout><div className="border border-warn/40 bg-warn/10 rounded-sm p-4 text-sm" data-testid="shop-designs-error">{error}</div></AdminLayout>;
  }
  if (!data) return <AdminLayout><div className="text-sm text-white/45" role="status">Lade Designs …</div></AdminLayout>;

  return (
    <AdminLayout>
      <div>
        <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><ShoppingBag className="w-7 h-7 text-honor" aria-hidden="true" /> Shop</h1>
        <ShopTabs />
        <p className="mt-4 text-sm text-white/60 max-w-2xl">
          Druckdateien des Vereins. Jede Datei wird neu kodiert (ohne Metadaten), gegen den Druckbereich ihrer Platzierung geprüft und als neue Version mit eigener Adresse für Printful abgelegt. Ältere Versionen bleiben für ihre Bestellungen.
        </p>
      </div>

      <div className="mt-6 space-y-4 max-w-4xl">
        <Section title="Designs" icon={FileImage} testId="shop-designs">
          <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Hintergrund der Vorschau">
            {BACKDROPS.map((item) => (
              <button key={item.key} type="button" role="radio" aria-checked={backdrop === item.key} onClick={() => setBackdrop(item.key)}
                className={`min-h-9 px-3 text-xs border rounded-sm transition-colors duration-150 ${backdrop === item.key ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
                data-testid={`shop-design-backdrop-${item.key}`}>
                {item.label}
              </button>
            ))}
          </div>
          {data.designs.length === 0
            ? <p className="text-sm text-white/55" data-testid="shop-designs-empty">Noch keine Designs. Lade unten die erste Druckdatei hoch.</p>
            : (
              <ul className="space-y-3">
                {data.designs.map((design) => (
                  <DesignCard key={design.design_key} design={design} backdrop={backdrop} busy={!!busy}
                    onNewVersion={(key) => { setPreset(key); document.getElementById("shop-design-upload-section")?.scrollIntoView?.({ behavior: "smooth", block: "start" }); }}
                    onColors={(key, colors, reason) => run("colors", () => api.patch(`${BASE}/${key}`, { garment_colors: colors, reason }), "Farben gespeichert.")} />
                ))}
              </ul>
            )}
        </Section>

        <div id="shop-design-upload-section">
          <Section title="Druckdatei hochladen" icon={Upload} testId="shop-design-upload-section">
            <UploadForm designs={data.designs} placements={placements} limits={data.limits} busy={busy === "upload"} preset={preset}
              onUpload={(form) => run("upload", () => uploadApi.post(`${BASE}/upload`, form), (next) => `Version ${next.uploaded.version} von ${next.uploaded.design_key} gespeichert.`)} />
          </Section>
        </div>

        <Section title="Druckbereiche je Platzierung" icon={Ruler} testId="shop-placements">
          <p className="text-xs text-white/55">Printful rechnet in Zoll; 1 Zoll = 2,54 cm. Die Ampel der Designs rechnet mit diesen Werten, jede Version behält die Maße, mit denen sie geprüft wurde.</p>
          <ul className="space-y-3">
            {placements.map((spec) => (
              <PlacementRow key={spec.key} spec={spec} busy={busy === `placement-${spec.key}`}
                onSave={(key, values, reason) => run(`placement-${key}`, () => api.put(`${BASE}/placements/${key}`, { ...values, reason }), "Druckbereich gespeichert.")} />
            ))}
          </ul>
        </Section>
      </div>
    </AdminLayout>
  );
}
