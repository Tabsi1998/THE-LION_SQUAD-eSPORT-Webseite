import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, FileImage, Plus, Ruler, ShoppingBag, Trash2, Type } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError, resolveMediaUrl } from "@/lib/api";
import { viennaDateTime } from "@/lib/vienna";
import ShopTabs from "./ShopTabs";

// Gamertag-Druckdatei (#1711) - Verwaltung → Finanzen → Shop → Gamertag. Der Server prüft und rendert den Namen als PNG
// mit Transparenz; hier stehen Regeln und Maße (mit Grund, Protokoll) und ein Test-Gamertag mit Live-Vorschau auf
// dunklem und hellem Shirt. Eine Testdatei bekommt Prüfsumme und Adresse für den Testentwurf an Printful (#2062).

const BASE = "/admin/shop/gamertag";
const PREVIEW_DELAY_MS = 350;
const CM_PER_INCH = 2.54;
const INPUT = "mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 text-sm placeholder:text-white/35 focus:border-brand outline-none disabled:opacity-50";
const SHIRTS = [
  { key: "dark", label: "Dunkles Shirt", className: "bg-black" },
  { key: "light", label: "Helles Shirt", className: "bg-white" },
];
function number(value, digits) {
  return String(Number(Number(value).toFixed(digits))).replace(".", ",");
}

export function inches(value) {
  return `${number(value, 2)} Zoll (${number(value * CM_PER_INCH, 1)} cm)`;
}

const NUMBER_FIELDS = [
  { key: "text_height_in", label: "Texthöhe (Zoll)", inch: true },
  { key: "min_text_height_in", label: "Verkleinern bis (Zoll)", inch: true },
  { key: "max_width_in", label: "Höchstbreite (Zoll)", inch: true },
  { key: "dpi", label: "Auflösung (DPI)" },
  { key: "min_length", label: "Mindestlänge (Zeichen)" },
  { key: "max_length", label: "Höchstlänge (Zeichen)" },
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

function ReasonInput({ id, value, onChange, disabled }) {
  return (
    <>
      <label className="sr-only" htmlFor={id}>Grund (optional)</label>
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} maxLength={500} disabled={disabled}
        placeholder="Grund (optional, kommt ins Protokoll)" className={`${INPUT} mt-0 flex-1`} data-testid={id} />
    </>
  );
}

function Swatch({ hex }) {
  // Der Farbwert kommt aus den Regeln (Daten), nicht aus dem Quelltext.
  return <span className="inline-block w-3.5 h-3.5 rounded-full border border-white/30" style={{ backgroundColor: hex }} aria-hidden="true" />;
}

function ColorPicker({ colors, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Farbe des Namens">
      {colors.map((color) => (
        <button key={color.key} type="button" role="radio" aria-checked={value === color.key} onClick={() => onChange(color.key)}
          className={`min-h-9 px-3 text-xs border rounded-sm inline-flex items-center gap-2 transition-colors duration-150 ${value === color.key ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
          data-testid={`shop-gamertag-color-${color.key}`}>
          <Swatch hex={color.hex} /> {color.label}
          {color.garment_colors?.length > 0 && <span className="text-white/45">· {color.garment_colors.join(", ")}</span>}
        </button>
      ))}
    </div>
  );
}

function copy(url) {
  if (!navigator.clipboard?.writeText) {
    toast.error("Kopieren geht in diesem Browser nicht.");
    return;
  }
  navigator.clipboard.writeText(url).then(() => toast.success("Adresse für Printful kopiert."), () => toast.error("Kopieren hat nicht geklappt."));
}

function fullUrl(file) {
  return file.public_url?.startsWith("http") ? file.public_url : resolveMediaUrl(file.public_path);
}

function TestName({ data, onStored }) {
  const [text, setText] = useState("");
  const [color, setColor] = useState(data.rules.default_color);
  const [result, setResult] = useState(null);
  const [refused, setRefused] = useState("");
  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const latest = useRef(0);

  // Live-Vorschau: kurz nach dem Tippen fragt die Seite den Server - nur die jüngste Antwort zählt.
  useEffect(() => {
    if (!text.trim()) {
      setResult(null);
      setRefused("");
      return undefined;
    }
    const ticket = ++latest.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const { data: next } = await api.post(`${BASE}/preview`, { text, color });
        if (ticket !== latest.current) return;
        setResult(next);
        setRefused("");
      } catch (failure) {
        if (ticket !== latest.current) return;
        setResult(null);
        setRefused(formatRequestError(failure, "Die Vorschau ging gerade nicht."));
      } finally {
        if (ticket === latest.current) setLoading(false);
      }
    }, PREVIEW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text, color, data.rules]);

  const ready = !!result && !saving;
  const save = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setSaving(true);
    try {
      const { data: next } = await api.post(`${BASE}/test-files`, { text, color, reason: reason.trim() });
      toast.success(next.created ? "Testdatei gespeichert." : "Diese Datei gab es schon - dieselbe Adresse.");
      setReason("");
      onStored(next);
    } catch (failure) {
      toast.error(formatRequestError(failure, "Das hat nicht geklappt."));
    } finally {
      setSaving(false);
    }
  };

  const meta = result?.meta;
  return (
    <form className="space-y-3" onSubmit={save}>
      <Field label="Test-Gamertag" hint={`Erlaubt: ${data.allowed_text}; ${data.rules.min_length} bis ${data.rules.max_length} Zeichen. Bitte erfundene Namen.`}>
        <input value={text} onChange={(event) => setText(event.target.value)} maxLength={200} autoComplete="off"
          placeholder="z. B. Testname" className={INPUT} data-testid="shop-gamertag-text" />
      </Field>
      <ColorPicker colors={data.rules.colors} value={color} onChange={setColor} />

      <div className="grid gap-3 sm:grid-cols-2" aria-live="polite">
        {SHIRTS.map((shirt) => (
          <figure key={shirt.key} className="space-y-1" data-testid={`shop-gamertag-shirt-${shirt.key}`}>
            <div className={`rounded-sm border border-white/10 grid place-items-center h-28 p-3 overflow-hidden ${shirt.className}`}>
              {result
                ? <img src={result.image} alt={`Vorschau der Druckdatei auf ${shirt.label.toLowerCase()}`} className="max-w-full max-h-full object-contain" />
                : <FileImage className="w-8 h-8 text-white/30" aria-hidden="true" />}
            </div>
            <figcaption className="text-xs text-white/50">{shirt.label}</figcaption>
          </figure>
        ))}
      </div>
      {loading && <p className="text-xs text-white/45" role="status">Vorschau wird gerendert …</p>}
      {refused && (
        <p className="border border-warn/40 bg-warn/10 rounded-sm p-3 text-sm text-warn inline-flex gap-2" role="alert" data-testid="shop-gamertag-refused">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> Abgelehnt: {refused}
        </p>
      )}
      {meta && (
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2" data-testid="shop-gamertag-measures">
          <div><dt className="text-white/50 text-xs">Texthöhe</dt><dd className="tabular-nums">{meta.measures.text_height}</dd></div>
          <div><dt className="text-white/50 text-xs">Breite des Namens</dt><dd className="tabular-nums">{meta.measures.text_width} von {meta.measures.max_width}</dd></div>
          <div><dt className="text-white/50 text-xs">Druckdatei</dt><dd className="tabular-nums">{meta.width_px} × {meta.height_px} px · {meta.dpi} DPI · {meta.measures.canvas}</dd></div>
          <div><dt className="text-white/50 text-xs">Anker (Mitte des Löwen)</dt><dd className="tabular-nums">{inches(meta.anchor_y_in)} von oben</dd></div>
        </dl>
      )}
      {meta?.notice && <p className="text-xs text-warn" data-testid="shop-gamertag-notice">{meta.notice}</p>}
      {(result?.warnings || []).map((warning) => <p key={warning} className="text-xs text-warn" data-testid="shop-gamertag-warning">{warning}</p>)}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ReasonInput id="shop-gamertag-file-reason" value={reason} onChange={setReason} disabled={saving} />
        <button type="submit" disabled={!ready} className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40" data-testid="shop-gamertag-save-file">
          {saving ? "Speichert …" : "Als Testdatei speichern"}
        </button>
      </div>
    </form>
  );
}

function ColorRows({ colors, onChange }) {
  const set = (index, key, value) => onChange(colors.map((color, at) => (at === index ? { ...color, [key]: value } : color)));
  return (
    <div className="space-y-2">
      {colors.map((color, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[8rem_10rem_7rem_1fr_auto] sm:items-end" data-testid={`shop-gamertag-color-row-${index}`}>
          <Field label="Kennung"><input value={color.key} onChange={(event) => set(index, "key", event.target.value.trim())} maxLength={30} className={INPUT} /></Field>
          <Field label="Bezeichnung"><input value={color.label} onChange={(event) => set(index, "label", event.target.value)} maxLength={40} className={INPUT} /></Field>
          <Field label="Farbwert"><input value={color.hex} onChange={(event) => set(index, "hex", event.target.value.trim())} maxLength={7} placeholder="#RRGGBB" className={`${INPUT} font-mono`} /></Field>
          <Field label="Für Shirtfarben (Komma)"><input value={color.garment_text ?? (color.garment_colors || []).join(", ")} onChange={(event) => set(index, "garment_text", event.target.value)} maxLength={400} className={INPUT} /></Field>
          <button type="button" onClick={() => onChange(colors.filter((_, at) => at !== index))} disabled={colors.length <= 1}
            className="tls-btn tls-btn--quiet min-h-10 px-3 rounded-sm disabled:opacity-40 inline-flex items-center justify-center" aria-label={`Farbe ${color.label || index + 1} entfernen`}>
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...colors, { key: "", label: "", hex: "", garment_colors: [] }])}
        className="tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5" data-testid="shop-gamertag-color-add">
        <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Farbe
      </button>
    </div>
  );
}

function toPayload(values) {
  const out = { ...values };
  for (const field of NUMBER_FIELDS) out[field.key] = Number(String(values[field.key]).replace(",", "."));
  out.colors = values.colors.map(({ garment_text, ...color }) => ({
    ...color,
    garment_colors: garment_text === undefined ? color.garment_colors || [] : garment_text.split(",").map((item) => item.trim()).filter(Boolean),
  }));
  return out;
}

function RulesForm({ data, busy, onSave }) {
  const [values, setValues] = useState(data.rules);
  const [reason, setReason] = useState("");
  useEffect(() => setValues(data.rules), [data.rules]);
  const set = (key, value) => setValues((now) => ({ ...now, [key]: value }));
  const payload = toPayload(values);
  const numbersValid = NUMBER_FIELDS.every((field) => Number.isFinite(payload[field.key]) && payload[field.key] > 0);
  const ready = numbersValid && !busy;
  const select = (key, label, options) => (
    <Field label={label}>
      <select value={values[key]} onChange={(event) => set(key, event.target.value)} className={INPUT} data-testid={`shop-gamertag-rule-${key}`}>
        {options.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
      </select>
    </Field>
  );

  return (
    <form className="space-y-3" onSubmit={async (event) => {
      event.preventDefault();
      if (!ready) return;
      if (await onSave({ ...payload, reason: reason.trim() })) setReason("");
    }}>
      <div className="grid gap-3 sm:grid-cols-3">
        {select("font", "Schrift", data.fonts)}
        {select("height_mode", "Texthöhe gemessen an", data.height_modes)}
        {select("align", "Ausrichtung", data.aligns)}
        {NUMBER_FIELDS.map((field) => {
          const value = payload[field.key];
          return (
            <Field key={field.key} label={field.label} hint={field.inch && Number.isFinite(value) ? `= ${number(value * CM_PER_INCH, 1)} cm` : null}>
              <input value={values[field.key]} onChange={(event) => set(field.key, event.target.value)} inputMode="decimal"
                className={`${INPUT} tabular-nums`} data-testid={`shop-gamertag-rule-${field.key}`} />
            </Field>
          );
        })}
        <Field label="Zusätzlich erlaubte Zeichen" hint="Buchstaben A–Z und Ziffern gehen immer; Emojis nie.">
          <input value={values.allowed_chars} onChange={(event) => set("allowed_chars", event.target.value)} maxLength={60} className={`${INPUT} font-mono`} data-testid="shop-gamertag-rule-allowed_chars" />
        </Field>
        {select("default_color", "Vorgabefarbe", values.colors.map((color) => ({ key: color.key, label: color.label || color.key })))}
        <label className="flex items-center gap-2 text-sm min-h-10 sm:mt-6">
          <input type="checkbox" checked={values.block_flagged} onChange={(event) => set("block_flagged", event.target.checked)} className="w-4 h-4 accent-brand" data-testid="shop-gamertag-rule-block_flagged" />
          Auch „nur markierte“ Wörter des Wortfilters ablehnen
        </label>
      </div>
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-white/60 mb-2">Farben des Namens je Shirtfarbe</h3>
        <ColorRows colors={values.colors} onChange={(colors) => set("colors", colors)} />
      </div>
      {!numbersValid && <p className="text-xs text-warn" data-testid="shop-gamertag-rules-invalid">Maße und Längen als Zahlen größer 0.</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <ReasonInput id="shop-gamertag-rules-reason" value={reason} onChange={setReason} disabled={busy} />
        <button type="submit" disabled={!ready} className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40" data-testid="shop-gamertag-rules-save">
          {busy ? "Speichert …" : "Regeln speichern"}
        </button>
      </div>
    </form>
  );
}

export default function AdminShopGamertagPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(BASE).then(({ data: next }) => { setData(next); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Die Gamertag-Regeln lassen sich gerade nicht laden.")));
  }, []);

  const saveRules = useCallback(async (body) => {
    setBusy(true);
    try {
      const { data: next } = await api.put(`${BASE}/rules`, body);
      setData(next);
      toast.success(next.changed.length ? "Regeln gespeichert." : "Nichts geändert.");
      return true;
    } catch (failure) {
      toast.error(formatRequestError(failure, "Das hat nicht geklappt."));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  if (error) {
    return <AdminLayout><div className="border border-warn/40 bg-warn/10 rounded-sm p-4 text-sm" data-testid="shop-gamertag-error">{error}</div></AdminLayout>;
  }
  if (!data) return <AdminLayout><div className="text-sm text-white/45" role="status">Lade Gamertag-Regeln …</div></AdminLayout>;

  return (
    <AdminLayout>
      <div>
        <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><ShoppingBag className="w-7 h-7 text-honor" aria-hidden="true" /> Shop</h1>
        <ShopTabs />
        <p className="mt-4 text-sm text-white/60 max-w-2xl">
          Der Gamertag wird auf dem Server als PNG mit durchsichtigem Hintergrund erzeugt - dieselbe Datei für den Testentwurf und jede Bestellung.
          Jeder Name hat dieselbe Leinwand ({data.canvas.size}, {data.canvas.dpi} DPI); die senkrechte Mitte der Großbuchstaben liegt bei {inches(data.canvas.anchor_y_in)} von oben und kommt auf die Mitte des Löwen.
        </p>
      </div>

      <div className="mt-6 space-y-4 max-w-4xl">
        <Section title="Test-Gamertag" icon={Type} testId="shop-gamertag-test">
          <TestName data={data} onStored={setData} />
        </Section>

        <Section title="Testdateien" icon={FileImage} testId="shop-gamertag-files">
          {data.test_files.length === 0
            ? <p className="text-sm text-white/55">Noch keine Testdatei.</p>
            : (
              <ul className="space-y-1.5">
                {data.test_files.map((file) => (
                  <li key={file.sha256} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/70" data-testid={`shop-gamertag-file-${file.sha256_short}`}>
                    <Swatch hex={file.color_hex} />
                    <code className="font-mono" title={file.sha256}>{file.sha256_short}…</code>
                    <span className="tabular-nums">{file.measures.text_height} · {file.width_px} × {file.height_px} px · {file.dpi} DPI</span>
                    {file.scaled && <span className="text-warn">verkleinert</span>}
                    <span>{viennaDateTime(file.last_used_at)}</span>
                    <button type="button" onClick={() => copy(fullUrl(file))} className="tls-btn tls-btn--quiet min-h-8 px-2 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5" data-testid={`shop-gamertag-file-${file.sha256_short}-copy`}>
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Adresse für Printful
                    </button>
                  </li>
                ))}
              </ul>
            )}
          <p className="text-xs text-white/45">Testdateien, die 30 Tage niemand benutzt und keine Bestellung braucht, dürfen später weg (nur vermerkt, nichts wird gelöscht).</p>
        </Section>

        <Section title="Regeln und Maße" icon={Ruler} testId="shop-gamertag-rules">
          <p className="text-xs text-white/55">
            Printful rechnet in Zoll; 1 Zoll = 2,54 cm. Passt ein Name nicht in die Höchstbreite, wird er bis zur Mindesthöhe verkleinert, sonst abgelehnt. Platzierung: {data.placement.label}, Druckbereich {data.placement.area_width} × {data.placement.area_height}.
          </p>
          <RulesForm data={data} busy={busy} onSave={saveRules} />
        </Section>
      </div>
    </AdminLayout>
  );
}
