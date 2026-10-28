import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, ExternalLink, FileImage, Info, PackageCheck, RefreshCw, Send, ShoppingBag, Trash2, XCircle } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { StepBar } from "@/components/tls/StepBar";
import { api, formatRequestError } from "@/lib/api";
import { techniqueLabel } from "@/lib/shopTechniques";
import { viennaDateTime } from "@/lib/vienna";
import ShopTabs from "./ShopTabs";

// Testentwurf an Printful (#2062) - Verwaltung → Finanzen → Shop → Testentwurf. Geführt ohne Vorwissen: Produkt,
// Variante, Test-Gamertag, Anschrift (Vereinsadresse vorbelegt), Vorschau mit genau den Daten, die gesendet werden,
// „Als Entwurf an Printful senden“ (nie bestätigt, nie bezahlt), Ergebnis mit Protokoll und Abweichungen, Löschen mit
// Bestätigung in der Seite. Ein Bestätigen gibt es hier nicht.

const BASE = "/admin/shop/test-drafts";
const INPUT = "mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 text-sm placeholder:text-white/35 focus:border-brand outline-none disabled:opacity-50";
const STEPS = [
  { key: "product", label: "Produkt" },
  { key: "variant", label: "Variante" },
  { key: "gamertag", label: "Gamertag" },
  { key: "address", label: "Anschrift" },
  { key: "preview", label: "Vorschau" },
  { key: "sent", label: "Gesendet" },
];
const ADDRESS_FIELDS = [
  { key: "name", label: "Empfänger (Verein)", max: 120 },
  { key: "street", label: "Straße und Hausnummer", max: 120 },
  { key: "street2", label: "Zusatz (optional)", max: 120 },
  { key: "zip", label: "PLZ", max: 12 },
  { key: "city", label: "Ort", max: 80 },
];
const LEVELS = {
  ok: { label: "passt", className: "text-emerald-300", icon: CheckCircle2 },
  warn: { label: "prüfen", className: "text-warn", icon: AlertTriangle },
  error: { label: "falsch übergeben", className: "text-red-400", icon: XCircle },
  open: { label: "offen", className: "text-white/50", icon: Info },
};
const KIND_LABELS = { personal: "eigene Datei mit Gamertag bzw. Nummer", base: "Grunddatei" };

export function euro(cents) {
  if (cents === null || cents === undefined) return "–";
  const negative = cents < 0;
  const value = Math.abs(cents);
  return `${negative ? "-" : ""}${Math.floor(value / 100)},${String(value % 100).padStart(2, "0")} €`;
}

function newKey() {
  if (globalThis.crypto?.randomUUID) return `testentwurf-${globalThis.crypto.randomUUID()}`;
  return `testentwurf-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

function Section({ title, icon: Icon, children, testId, step }) {
  return (
    <section className="border border-white/10 bg-surface-1 rounded-sm p-4 space-y-3 min-w-0" data-testid={testId}>
      <h2 className="text-xs font-bold uppercase tracking-wider text-white/70 inline-flex items-center gap-2">
        {step && <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand/20 text-brand text-[11px] font-black" aria-hidden="true">{step}</span>}
        {Icon && <Icon className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />} {title}
      </h2>
      {children}
    </section>
  );
}

function Level({ level }) {
  const meta = LEVELS[level] || LEVELS.open;
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-bold ${meta.className}`} data-level={level}>
      <Icon className="w-3.5 h-3.5" aria-hidden="true" /> {meta.label}
    </span>
  );
}

function Choice({ active, onClick, children, testId, disabled }) {
  return (
    <button type="button" role="radio" aria-checked={active} onClick={onClick} disabled={disabled} data-testid={testId}
      className={`min-h-10 px-3 text-sm border rounded-sm inline-flex items-center gap-2 transition-colors duration-150 disabled:opacity-40 ${active ? "border-brand bg-brand/10 text-white" : "border-white/10 text-white/75 hover:border-white/30"}`}>
      {children}
    </button>
  );
}

function ConfirmDelete({ draft, onDeleted, testId }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`${BASE}/${draft.id}/delete`);
      toast.success("Entwurf bei Printful gelöscht.");
      setAsking(false);
      onDeleted(data);
    } catch (failure) {
      toast.error(formatRequestError(failure, "Löschen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} data-testid={`${testId}-delete`}
        className="tls-btn tls-btn--secondary min-h-10 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5">
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Entwurf bei Printful löschen
      </button>
    );
  }
  return (
    <div className="tls-reveal border border-warn/40 bg-warn/10 rounded-sm p-3 space-y-2" role="alertdialog" aria-label="Entwurf löschen" data-testid={`${testId}-confirm`}>
      <p className="text-sm">
        {draft.printful_order_id
          ? `Den Entwurf ${draft.printful_order_id} bei Printful wirklich löschen?`
          : "Bei Printful nachsehen und den Entwurf - falls er angelegt wurde - löschen?"}
        {" "}Das Protokoll bleibt, die Testdateien gehen vom Netz.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={remove} disabled={busy} data-testid={`${testId}-confirm-yes`}
          className="tls-btn tls-btn--primary min-h-10 px-3 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40">
          {busy ? "Löscht …" : "Ja, löschen"}
        </button>
        <button type="button" onClick={() => setAsking(false)} disabled={busy}
          className="tls-btn tls-btn--quiet min-h-10 px-3 text-xs font-bold uppercase tracking-wider rounded-sm">Abbrechen</button>
      </div>
    </div>
  );
}

function Costs({ estimate, error }) {
  if (error) {
    return <p className="text-sm text-warn" data-testid="shop-test-draft-estimate-error">Keine Kostenschätzung: {error.text}{error.provider_detail ? ` (Printful: ${error.provider_detail})` : ""}</p>;
  }
  if (!estimate) return <p className="text-sm text-white/55">Keine Kostenschätzung.</p>;
  const tax = (estimate.vat_cents || 0) + (estimate.tax_cents || 0);
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4" data-testid="shop-test-draft-estimate">
      <div><dt className="text-white/50 text-xs">Ware</dt><dd className="tabular-nums">{euro(estimate.subtotal_cents)}</dd></div>
      <div><dt className="text-white/50 text-xs">Versand</dt><dd className="tabular-nums">{euro(estimate.shipping_cents)}</dd></div>
      <div><dt className="text-white/50 text-xs">Steuer</dt><dd className="tabular-nums">{euro(tax)}</dd></div>
      <div><dt className="text-white/50 text-xs">Gesamt</dt><dd className="tabular-nums font-bold">{euro(estimate.total_cents)}</dd></div>
    </dl>
  );
}

function Files({ files }) {
  return (
    <ul className="space-y-2" data-testid="shop-test-draft-files">
      {files.map((file) => (
        <li key={file.placement} className="border border-white/10 rounded-sm p-2 text-xs text-white/75 space-y-1 min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-bold text-white uppercase tracking-wider">{file.placement_label || file.placement}</span>
            <span>{techniqueLabel(file.technique)}</span>
            <span>{KIND_LABELS[file.kind] || file.kind}{file.version ? ` · v${file.version}` : ""}</span>
            <span className="tabular-nums">{file.width_px} × {file.height_px} px · {file.dpi} DPI</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <code className="font-mono break-all" title={file.sha256}>sha256 {file.sha256}</code>
            <a href={file.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand hover:underline">
              <FileImage className="w-3.5 h-3.5" aria-hidden="true" /> Datei ansehen
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Deviations({ draft }) {
  const rows = draft.deviations || [];
  const summary = draft.deviation_summary || {};
  return (
    <div className="space-y-2" data-testid="shop-test-draft-deviations">
      <p className="text-sm flex flex-wrap gap-x-4 gap-y-1">
        <span className="text-emerald-300">{summary.ok || 0} passen</span>
        <span className={summary.warn ? "text-warn font-bold" : "text-white/50"}>{summary.warn || 0} prüfen</span>
        <span className={summary.error ? "text-red-400 font-bold" : "text-white/50"}>{summary.error || 0} falsch übergeben</span>
      </p>
      <ul className="divide-y divide-white/5 border border-white/10 rounded-sm">
        {rows.map((row, index) => (
          <li key={`${row.label}-${index}`} className={`tls-reveal grid gap-1 p-2 text-xs sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:items-center ${row.level === "error" ? "bg-red-500/10" : row.level === "warn" ? "bg-warn/10" : ""}`}
            style={{ animationDelay: `${Math.min(index, 8) * 30}ms` }} data-testid="shop-test-draft-deviation" data-level={row.level}>
            <span className="text-white/80 font-bold">{row.label}</span>
            <span className="text-white/60 break-all min-w-0">
              gesendet: {formatValue(row.label, row.sent)} · Printful: {formatValue(row.label, row.printful)}
            </span>
            <Level level={row.level} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatValue(label, value) {
  if (value === null || value === undefined) return "–";
  if (label.startsWith("Preis:")) return euro(value);
  if (Array.isArray(value)) return value.join(", ");
  // Produktoptionen (#2158) kommen als Name → Wert, etwa „stitch_color: White“.
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key}: ${item}`).join(", ");
  return String(value);
}

// Nach einem unklaren oder hängenden Senden (Zeitüberschreitung, Abbruch): derselbe Rumpf noch einmal - der Server
// findet einen schon angelegten Entwurf über die external_id, statt einen zweiten anzulegen.
function Resend({ draft, onUpdated, testId }) {
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`${BASE}/${draft.id}/send`, { idempotency_key: newKey() });
      toast.success(`Nachgesehen: Entwurf bei Printful (Auftrag ${data.printful_order_id}).`);
      onUpdated(data);
    } catch (failure) {
      toast.error(formatRequestError(failure, "Erneut senden hat nicht geklappt."));
      try {
        const { data } = await api.get(`${BASE}/${draft.id}`);
        onUpdated(data);
      } catch {
        // Der Stand lässt sich gerade nicht lesen - die Liste lädt beim nächsten Mal neu.
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-1">
      <p className="text-xs text-warn">Ob Printful den Entwurf angelegt hat, ist offen. „Erneut senden / nachsehen“ schickt dieselben Daten; einen schon angelegten Entwurf findet Printful wieder, statt einen zweiten anzulegen.</p>
      <button type="button" onClick={resend} disabled={busy} data-testid={`${testId}-resend`}
        className="tls-btn tls-btn--secondary min-h-10 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5 disabled:opacity-40">
        <Send className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? "Sieht nach …" : "Erneut senden / nachsehen"}
      </button>
    </div>
  );
}

// Kosten und Dateien stehen bei Printful oft erst Minuten nach dem Anlegen fest (#2138): neu lesen und neu abgleichen.
function Recheck({ draft, onUpdated, testId }) {
  const [busy, setBusy] = useState(false);
  const recheck = async () => {
    setBusy(true);
    try {
      const { data } = await api.post(`${BASE}/${draft.id}/recheck`, {});
      toast.success("Bei Printful nachgesehen.");
      onUpdated(data);
    } catch (failure) {
      toast.error(formatRequestError(failure, "Nachsehen hat nicht geklappt."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" onClick={recheck} disabled={busy} data-testid={`${testId}-recheck`}
      className="tls-btn tls-btn--secondary min-h-10 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5 disabled:opacity-40">
      <RefreshCw className={`w-3.5 h-3.5 ${busy ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" /> {busy ? "Sieht nach …" : "Bei Printful nachsehen"}
    </button>
  );
}

// Wie die Antwort von Printful aufgebaut ist - ohne Werte, nur Schlüssel und Kennungen (#2138). Zum Weitergeben, wenn
// der Abgleich etwas nicht findet.
function AnswerShape({ draft, testId }) {
  const shape = draft.response?.shape;
  if (!shape || !Object.keys(shape).length) return null;
  return (
    <details className="text-xs" data-testid={`${testId}-shape`}>
      <summary className="cursor-pointer text-white/60 hover:text-white">Technische Details (Aufbau der Printful-Antwort, ohne Personendaten)</summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-sm border border-white/10 bg-black/40 p-2 text-[11px] leading-relaxed text-white/70 whitespace-pre-wrap break-all">{JSON.stringify(shape, null, 2)}</pre>
    </details>
  );
}

function Result({ draft, onDeleted, testId }) {
  return (
    <div className="space-y-3" data-testid={testId}>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div><dt className="text-white/50 text-xs">Printful-Auftrag</dt><dd className="tabular-nums font-bold" data-testid={`${testId}-order-id`}>{draft.printful_order_id ?? "–"}</dd></div>
        <div><dt className="text-white/50 text-xs">Stand</dt><dd>{draft.state_label}{draft.printful_status ? ` (Printful: ${draft.printful_status_label || draft.printful_status})` : ""}</dd></div>
        <div><dt className="text-white/50 text-xs">Gesendet</dt><dd>{draft.sent_at ? viennaDateTime(draft.sent_at) : "–"}</dd></div>
      </dl>
      {draft.dashboard_url && (
        <a href={draft.dashboard_url} target="_blank" rel="noreferrer noopener" data-testid={`${testId}-dashboard`}
          className="tls-btn tls-btn--secondary min-h-10 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5">
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Im Printful-Dashboard ansehen
        </a>
      )}
      {draft.delete_note && <p className="text-xs text-white/55">{draft.delete_note}</p>}
      {draft.last_error && (
        <p className="text-xs text-warn" data-testid={`${testId}-last-error`}>
          Letzter Fehler: {draft.last_error.text}{draft.last_error.provider_detail ? ` (Printful: ${draft.last_error.provider_detail})` : ""}
        </p>
      )}
      {draft.deviations && <Deviations draft={draft} />}
      {draft.actions?.recheck && <Recheck draft={draft} onUpdated={onDeleted} testId={testId} />}
      <AnswerShape draft={draft} testId={testId} />
      {draft.actions?.resend && <Resend draft={draft} onUpdated={onDeleted} testId={testId} />}
      {(draft.actions ? draft.actions.delete : draft.state === "sent") && <ConfirmDelete draft={draft} onDeleted={onDeleted} testId={testId} />}
    </div>
  );
}

export default function AdminShopTestDraftPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [productId, setProductId] = useState("");
  const [color, setColor] = useState("");
  const [variantId, setVariantId] = useState("");
  const [gamertag, setGamertag] = useState("");
  const [address, setAddress] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewKey, setPreviewKey] = useState("");
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState("");
  const [refused, setRefused] = useState("");

  const load = useCallback(async () => {
    try {
      const { data: next } = await api.get(BASE);
      setData(next);
      setAddress((now) => now || next.address.address);
      setError("");
    } catch (failure) {
      setError(formatRequestError(failure, "Der Testentwurf lässt sich gerade nicht laden."));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const product = useMemo(() => data?.products.find((item) => item.id === productId) || null, [data, productId]);
  const colors = useMemo(() => [...new Set((product?.variants || []).map((item) => item.color))], [product]);
  // Deutsche Bezeichnung je Printful-Farbe (#2105) - ausgewählt wird weiter über den Printful-Namen.
  const colorNames = useMemo(() => Object.fromEntries((product?.variants || []).map((item) => [item.color, item.color_label || item.color])), [product]);
  const sizes = useMemo(() => (product?.variants || []).filter((item) => item.color === color), [product, color]);
  const variant = sizes.find((item) => item.id === variantId) || null;

  // Jede Änderung an der Eingabe macht die Vorschau ungültig - gesendet wird nur, was gerade angezeigt wird.
  const reset = () => { setPreview(null); setResult(null); setRefused(""); };
  const chooseProduct = (id) => { setProductId(id); setColor(""); setVariantId(""); setGamertag(""); reset(); };
  const chooseColor = (value) => { setColor(value); setVariantId(""); reset(); };
  const chooseVariant = (id) => { setVariantId(id); reset(); };
  const setField = (key, value) => { setAddress((now) => ({ ...now, [key]: value })); reset(); };

  const addressReady = !!address && ["name", "street", "zip", "city"].every((key) => String(address[key] || "").trim());
  const gamertagReady = !product?.gamertag || !!gamertag.trim();
  const ready = !!data?.access.allowed && !!variant && gamertagReady && addressReady && !busy;
  const step = result ? 5 : preview ? 4 : !product ? 0 : !variant ? 1 : !gamertagReady ? 2 : 3;

  const makePreview = async (event) => {
    event.preventDefault();
    if (!ready) return;
    setBusy("preview");
    setRefused("");
    try {
      const body = { product_id: product.id, variant_id: variant.id, gamertag: product.gamertag ? gamertag : "",
        address: { ...address, country: "AT" } };
      const { data: next } = await api.post(`${BASE}/preview`, body);
      setPreview(next);
      setPreviewKey(newKey());
      setResult(null);
    } catch (failure) {
      setPreview(null);
      setRefused(formatRequestError(failure, "Die Vorschau ging gerade nicht."));
    } finally {
      setBusy("");
    }
  };

  const send = async () => {
    if (!preview || busy) return;
    setBusy("send");
    try {
      const { data: next } = await api.post(`${BASE}/${preview.id}/send`, { idempotency_key: previewKey });
      setResult(next);
      toast.success(`Als Entwurf an Printful gesendet (Auftrag ${next.printful_order_id}).`);
      load();
    } catch (failure) {
      toast.error(formatRequestError(failure, "Senden hat nicht geklappt."));
      // Den Stand neu holen: wieder Vorschau mit Ursache (last_error) - oder „Ausgang unklar“, dann mit „Erneut senden“.
      try {
        const { data: current } = await api.get(`${BASE}/${preview.id}`);
        if (current.state === "preview") setPreview(current);
        else {
          setResult(current);
          load();
        }
      } catch {
        // Nicht lesbar: die Vorschau bleibt stehen, der Fehler steht im Hinweis oben.
      }
    } finally {
      setBusy("");
    }
  };

  const deleted = (next) => {
    if (result?.id === next.id) setResult(next);
    load();
  };

  if (error) {
    return <AdminLayout><div className="border border-warn/40 bg-warn/10 rounded-sm p-4 text-sm" data-testid="shop-test-draft-error">{error}</div></AdminLayout>;
  }
  if (!data) return <AdminLayout><div className="text-sm text-white/45" role="status">Lade Testentwurf …</div></AdminLayout>;

  const others = data.drafts.filter((item) => item.id !== result?.id);
  return (
    <AdminLayout>
      <div className="min-w-0">
        <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><ShoppingBag className="w-7 h-7 text-honor" aria-hidden="true" /> Shop</h1>
        <ShopTabs />
        <p className="mt-4 text-sm text-white/60 max-w-2xl">
          Ein Testentwurf legt eine Bestellung nur als <strong>Entwurf</strong> bei Printful an - nie bestätigt, nie bezahlt. Danach in Printful prüfen, ob Produkt, Variante, Druckdateien, Positionen, Anschrift und Preise stimmen, und den Entwurf wieder löschen. Er zählt nicht als Bestellung, nicht im Umsatz und nicht in Dolibarr.
        </p>
      </div>

      <div className="mt-6 space-y-4 max-w-4xl min-w-0">
        {!data.access.allowed && (
          <div className="border border-warn/40 bg-warn/10 rounded-sm p-3 text-sm text-warn space-y-1" role="alert" data-testid="shop-test-draft-blocked">
            {data.access.problems.map((problem) => <p key={problem} className="inline-flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {problem}</p>)}
          </div>
        )}
        {data.access.allowed && !data.access.orders_to_printful && (
          <p className="text-xs text-white/55 inline-flex gap-2" data-testid="shop-test-draft-switch">
            <Info className="w-4 h-4 shrink-0" aria-hidden="true" /> Der Notschalter „Bestellungen an Printful senden“ ist aus - Entwürfe gehen trotzdem, weil sie nichts kosten.
          </p>
        )}

        <StepBar steps={STEPS} current={step} className="max-w-2xl" testId="shop-test-draft-steps" />

        <form className="space-y-4" onSubmit={makePreview}>
          <Section title="Produkt" step={1} testId="shop-test-draft-product">
            {data.products.length === 0
              ? <p className="text-sm text-white/55">Noch kein Produkt mit Printful-Produkt und Varianten - erst unter „Produkte“ anlegen.</p>
              : (
                <label className="block text-sm">
                  <span className="text-white/70">Welches Produkt?</span>
                  <select value={productId} onChange={(event) => chooseProduct(event.target.value)} className={INPUT} data-testid="shop-test-draft-product-select">
                    <option value="">Bitte wählen …</option>
                    {data.products.map((item) => <option key={item.id} value={item.id}>{item.title} ({item.status_label}) · {item.printful_name}</option>)}
                  </select>
                </label>
              )}
          </Section>

          {product && (
            <Section title="Variante" step={2} testId="shop-test-draft-variant">
              <div className="space-y-2">
                <p className="text-xs text-white/55">Farbe</p>
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Farbe">
                  {colors.map((value) => <Choice key={value} active={color === value} onClick={() => chooseColor(value)} testId={`shop-test-draft-color-${value}`}>{colorNames[value] || value}</Choice>)}
                </div>
              </div>
              {color && (
                <div className="space-y-2 tls-reveal">
                  <p className="text-xs text-white/55">Größe</p>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Größe">
                    {sizes.map((item) => (
                      <Choice key={item.id} active={variantId === item.id} onClick={() => chooseVariant(item.id)} testId={`shop-test-draft-size-${item.size}`}>
                        {item.size_label || item.size}{item.in_stock !== true && <AlertTriangle className="w-3.5 h-3.5 text-warn" aria-label="nicht als lieferbar gemeldet" />}
                      </Choice>
                    ))}
                  </div>
                </div>
              )}
              {variant && <p className="text-xs text-white/55 tabular-nums">Printful-Variante {variant.printful_variant_id} · Preis im Shop {euro(variant.price_cents)}</p>}
            </Section>
          )}

          {variant && (
            <Section title={product.member_number ? "Test-Gamertag und Nummer" : "Test-Gamertag"} step={3} testId="shop-test-draft-gamertag">
              {product.gamertag ? (
                <label className="block text-sm">
                  <span className="text-white/70">Erfundener Name für die Gamertag-Datei</span>
                  <input value={gamertag} onChange={(event) => { setGamertag(event.target.value); reset(); }} maxLength={200} autoComplete="off"
                    placeholder="z. B. Testname" className={INPUT} data-testid="shop-test-draft-gamertag-input" />
                  <span className="block text-xs text-white/45 mt-1">Erlaubt: {data.gamertag.allowed_text}; {data.gamertag.min_length} bis {data.gamertag.max_length} Zeichen. Bitte keine echten Namen von Mitgliedern.</span>
                </label>
              ) : <p className="text-sm text-white/55">Dieses Produkt hat kein Gamertag-Feld{product.member_number ? "." : " - hier ist nichts zu tun."}</p>}
              {product.member_number && (
                <p className="text-sm text-white/70 flex gap-2" data-testid="shop-test-draft-number">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-white/50" aria-hidden="true" />
                  <span>Vereinsnummer: gedruckt wird die Beispielnummer <strong className="tabular-nums">{product.sample_number}</strong> (die höchste Wunschnummer) - nie die Nummer eines Mitglieds. Bei echten Bestellungen kommt die Wunschnummer nur mit Einwilligung des Mitglieds in den Druck.</span>
                </p>
              )}
            </Section>
          )}

          {variant && gamertagReady && address && (
            <Section title="Anschrift" step={4} testId="shop-test-draft-address">
              {data.address.hint
                ? <p className="text-xs text-warn" data-testid="shop-test-draft-address-hint">{data.address.hint}</p>
                : <p className="text-xs text-white/55">Vorbelegt mit der Vereinsadresse aus den Rechtsangaben. Nur der Verein - keine Anschrift von Mitgliedern.</p>}
              <div className="grid gap-3 sm:grid-cols-2">
                {ADDRESS_FIELDS.map((field) => (
                  <label key={field.key} className="block text-sm min-w-0">
                    <span className="text-white/70">{field.label}</span>
                    <input value={address[field.key] || ""} onChange={(event) => setField(field.key, event.target.value)} maxLength={field.max}
                      className={INPUT} data-testid={`shop-test-draft-address-${field.key}`} />
                  </label>
                ))}
                <div className="text-sm"><span className="text-white/70">Land</span><p className="mt-1 min-h-10 flex items-center text-white/80">Österreich (AT) - Versand derzeit nur nach Österreich</p></div>
              </div>
              <button type="submit" disabled={!ready} data-testid="shop-test-draft-preview-button"
                className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40 inline-flex items-center gap-1.5">
                <PackageCheck className="w-4 h-4" aria-hidden="true" /> {busy === "preview" ? "Erzeugt Druckdateien …" : "Vorschau erstellen"}
              </button>
              <p className="text-xs text-white/45">Die Vorschau erzeugt die Druckdateien wie bei einer echten Bestellung und fragt Printful nach den Kosten - bei Printful wird dabei nichts angelegt.</p>
            </Section>
          )}
        </form>

        {refused && (
          <p className="tls-reveal border border-warn/40 bg-warn/10 rounded-sm p-3 text-sm text-warn flex gap-2" role="alert" data-testid="shop-test-draft-refused">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {refused}
          </p>
        )}

        {preview && !result && (
          <div className="tls-reveal">
            <Section title="Vorschau prüfen - genau das wird gesendet" step={5} testId="shop-test-draft-preview">
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div><dt className="text-white/50 text-xs">Position</dt><dd>1 × {preview.product_title} - {preview.variant_display || preview.variant_label} (Printful-Variante {preview.printful_variant_id})</dd></div>
                <div className="min-w-0"><dt className="text-white/50 text-xs">Externe Kennung</dt><dd className="font-mono text-xs break-all">{preview.external_id}</dd></div>
                <div><dt className="text-white/50 text-xs">Anschrift</dt><dd>{preview.recipient.name}, {preview.recipient.street}{preview.recipient.street2 ? `, ${preview.recipient.street2}` : ""}, {preview.recipient.zip} {preview.recipient.city}, {preview.recipient.country}</dd></div>
                <div><dt className="text-white/50 text-xs">Gültig bis</dt><dd>{viennaDateTime(preview.expires_at)}</dd></div>
                {preview.product_options?.length > 0 && (
                  <div data-testid="shop-test-draft-options"><dt className="text-white/50 text-xs">Produktoptionen (an Printful)</dt>
                    <dd>{preview.product_options.map((row) => `${row.label}: ${row.value_label}`).join(" · ")}</dd></div>
                )}
              </dl>
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/60">Druckdateien je Fläche</h3>
              <Files files={preview.files} />
              <h3 className="text-xs font-bold uppercase tracking-wider text-white/60">Kostenschätzung von Printful</h3>
              <Costs estimate={preview.estimate} error={preview.estimate_error} />
              <p className="text-sm flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="shop-test-draft-price-check">
                Preis im Shop {euro(preview.price_check.shop_cents)} · Ware laut Printful {euro(preview.price_check.printful_subtotal_cents)}
                <Level level={preview.price_check.level} />
              </p>
              <p className="text-sm text-white/55" data-testid="shop-test-draft-mockup">Mockup: {preview.mockup.detail}</p>
              {preview.warnings.map((warning) => <p key={warning} className="text-xs text-warn" data-testid="shop-test-draft-warning">{warning}</p>)}
              {preview.last_error && <p className="text-xs text-warn" data-testid="shop-test-draft-preview-error">Letzter Versuch: {preview.last_error.text}{preview.last_error.provider_detail ? ` (Printful: ${preview.last_error.provider_detail})` : ""}</p>}
              <button type="button" onClick={send} disabled={!!busy || !data.access.allowed} data-testid="shop-test-draft-send"
                className="tls-btn tls-btn--primary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40 inline-flex items-center gap-1.5">
                <Send className="w-4 h-4" aria-hidden="true" /> {busy === "send" ? "Sendet …" : "Als Entwurf an Printful senden"}
              </button>
              <p className="text-xs text-white/45">Wird nie bestätigt und kostet nichts. Ein Bestätigen gibt es in der Testansicht nicht.</p>
            </Section>
          </div>
        )}

        {result && (
          <div className="tls-reveal">
            <Section title="Ergebnis und Protokoll" step={6} testId="shop-test-draft-sent">
              <Result draft={result} onDeleted={deleted} testId="shop-test-draft-result" />
            </Section>
          </div>
        )}

        <Section title="Bisherige Testentwürfe" icon={PackageCheck} testId="shop-test-draft-list">
          {others.length === 0
            ? <p className="text-sm text-white/55">Noch keine{result ? " weiteren" : ""} Testentwürfe.</p>
            : (
              <ul className="space-y-3">
                {others.map((item) => (
                  <li key={item.id} className="border border-white/10 rounded-sm p-3 space-y-2 min-w-0" data-testid={`shop-test-draft-item-${item.id}`}>
                    <p className="text-sm font-bold">{item.product_title} - {item.variant_display || item.variant_label}</p>
                    <p className="text-xs text-white/55">{viennaDateTime(item.created_at)}</p>
                    <Result draft={item} onDeleted={deleted} testId={`shop-test-draft-item-${item.id}-result`} />
                  </li>
                ))}
              </ul>
            )}
          <p className="text-xs text-white/45">Höchstens {data.limits.max_open} Testentwürfe liegen gleichzeitig bei Printful; eine Vorschau gilt {data.limits.preview_minutes} Minuten.</p>
        </Section>
      </div>
    </AdminLayout>
  );
}
