import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { KeyRound, Lock, Power, ShoppingBag, Truck, Users } from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError } from "@/lib/api";
import { formatCents, parseEuro } from "@/lib/billing";
import { viennaDateTime } from "@/lib/vienna";
import ShopTabs from "./ShopTabs";

// Shop (#1706): Stufe, Notschalter, Preise, Printful-Zugang und Status - Verwaltung → Finanzen → Shop. Stufen statt
// „Aus/Vorschau/Live“ (Entscheidung Obmann 27.10.2026). Jede Änderung braucht einen Grund und steht im Protokoll der
// Adminaktionen; „Öffentlich“ und „Steuer geklärt“ schaltet nur der Superadmin, den Zugang hinterlegt nur System.
// Preise und Rechte entscheidet der Server - die Seite zeigt nur, was er erlaubt.

const BASE = "/admin/shop/config";
const KEY_STATES = { ok: "hinterlegt", missing: "kein Schlüssel", unreadable: "nicht lesbar" };
// Toleranz bei Preisänderung vor dem Auslösen (#2135) - Vorgabe 0,50 €, falls der Server sie (noch) nicht liefert.
const DEFAULT_TOLERANCE_CENTS = 50;

// Leer → null (keine Angabe), sonst Cent; Unsinn → NaN (der Knopf bleibt dann gesperrt).
function centsFromInput(text) {
  if (!String(text ?? "").trim()) return null;
  const cents = parseEuro(text);
  return cents === null ? Number.NaN : cents;
}

function centsToInput(cents) {
  return cents === null || cents === undefined ? "" : (cents / 100).toFixed(2).replace(".", ",");
}

function Section({ title, icon: Icon, children, testId }) {
  return (
    <section className="border border-white/10 bg-[#121212] rounded-sm p-4 space-y-3" data-testid={testId}>
      <h2 className="text-xs font-bold uppercase tracking-wider text-white/70 inline-flex items-center gap-2">
        {Icon && <Icon className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />} {title}
      </h2>
      {children}
    </section>
  );
}

const REASON_HINT = "Bitte kurz einen Grund angeben – er kommt ins Protokoll.";

// Grund und Knopf gehören zusammen. Der Grund ist optional (Entscheidung Obmann 27.10.2026) - Pflicht (`required`) nur
// bei kritischen Schritten: Steuer freigeben, „Öffentlich“, Notschalter einschalten, Schlüssel entfernen. Der Knopf
// bleibt klickbar und sagt, was fehlt - statt still nichts zu tun; fehlt oben etwas, nennt `blockedHint` es.
export function ReasonedButton({ id, label, busy, disabled, blockedHint, onSubmit, required = false, variant = "primary", placeholder }) {
  const [reason, setReason] = useState("");
  const [hint, setHint] = useState("");
  const input = useRef(null);
  const complete = (!required || reason.trim().length >= 3) && !disabled;
  const text = placeholder || (required ? "Grund (Pflicht, kommt ins Protokoll)" : "Grund (optional, kommt ins Protokoll)");
  return (
    <form className="flex flex-col gap-1.5" data-testid={`${id}-form`} noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        if (disabled) {
          setHint(blockedHint || "Oben fehlt noch etwas.");
          return;
        }
        if (required && reason.trim().length < 3) {
          setHint(REASON_HINT);
          input.current?.focus();
          return;
        }
        setHint("");
        if (await onSubmit(reason.trim())) setReason("");
      }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={`${id}-reason`}>{required ? "Grund (Pflicht)" : "Grund (optional)"}</label>
        <input id={`${id}-reason`} ref={input} value={reason} maxLength={500} required={required} aria-required={required ? "true" : undefined}
          aria-invalid={hint === REASON_HINT ? "true" : undefined} aria-describedby={hint ? `${id}-hint` : undefined}
          onChange={(event) => { setReason(event.target.value); if (hint) setHint(""); }}
          placeholder={text} disabled={busy}
          className={`min-h-10 flex-1 bg-black/40 border rounded-sm px-3 text-sm placeholder:text-white/45 focus:border-brand outline-none disabled:opacity-50 ${hint === REASON_HINT ? "border-warn" : "border-white/15"}`}
          data-testid={`${id}-reason`} />
        <button type="submit" disabled={!!busy} aria-disabled={!complete}
          className={`tls-btn tls-btn--${variant} min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm transition-opacity ${complete ? "" : "opacity-60"}`}
          data-testid={`${id}-submit`}>
          {busy ? "Speichert …" : label}
        </button>
      </div>
      {hint ? <p id={`${id}-hint`} role="alert" className="text-xs text-warn" data-testid={`${id}-hint`}>{hint}</p> : null}
    </form>
  );
}

function StatusTile({ label, value, tone = "quiet", testId }) {
  const tones = { ok: "text-ok", warn: "text-warn", quiet: "text-white/70", honor: "text-honor" };
  return (
    <div className="border border-white/10 bg-black/30 rounded-sm px-3 py-2" data-testid={testId}>
      <div className="text-[10px] uppercase tracking-wider text-white/45">{label}</div>
      <div className={`text-sm font-bold ${tones[tone] || tones.quiet}`}>{value}</div>
    </div>
  );
}

export default function AdminShopPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [stage, setStage] = useState(null);
  const [markup, setMarkup] = useState("");
  const [fallback, setFallback] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [tolerance, setTolerance] = useState("");
  const [apiKey, setApiKey] = useState("");

  const take = useCallback((next) => {
    setData(next);
    setStage(next.config.stage);
    setMarkup(centsToInput(next.config.public_markup_cents));
    setFallback(centsToInput(next.config.fallback_shipping_cents));
    setMinPrice(centsToInput(next.config.min_price_cents));
    setTolerance(centsToInput(next.config.price_tolerance_cents ?? DEFAULT_TOLERANCE_CENTS));
  }, []);

  useEffect(() => {
    api.get(BASE).then(({ data: next }) => { take(next); setError(""); })
      .catch((failure) => setError(formatRequestError(failure, "Die Shop-Einstellungen lassen sich gerade nicht laden.")));
  }, [take]);

  const run = async (key, request, success) => {
    setBusy(key);
    try {
      const { data: next } = await request();
      take(next);
      toast.success(typeof success === "function" ? success(next) : success);
      return true;
    } catch (failure) {
      toast.error(formatRequestError(failure, "Das hat nicht geklappt."));
      return false;
    } finally {
      setBusy("");
    }
  };

  if (error) {
    return <AdminLayout><div className="border border-warn/40 bg-warn/10 rounded-sm p-4 text-sm" data-testid="shop-config-error">{error}</div></AdminLayout>;
  }
  if (!data) return <AdminLayout><div className="text-sm text-white/45" role="status">Lade Shop-Einstellungen …</div></AdminLayout>;

  const { config, stages, rights } = data;
  const key = config.printful_key || {};
  const lastTest = config.printful_last_test;
  const markupCents = centsFromInput(markup);
  const fallbackCents = centsFromInput(fallback);
  const minPriceCents = centsFromInput(minPrice);
  const minPriceChanged = minPriceCents !== config.min_price_cents;
  const toleranceCents = centsFromInput(tolerance);
  const toleranceLimit = data.limits.price_tolerance_cents ?? 10000;
  const toleranceChanged = toleranceCents !== (config.price_tolerance_cents ?? DEFAULT_TOLERANCE_CENTS);
  const pricesValid = Number.isInteger(markupCents) && markupCents <= data.limits.public_markup_cents
    && (fallbackCents === null || (Number.isInteger(fallbackCents) && fallbackCents >= 1 && fallbackCents <= data.limits.fallback_shipping_cents))
    && Number.isInteger(minPriceCents) && minPriceCents >= 1 && minPriceCents <= data.limits.min_price_cents
    && Number.isInteger(toleranceCents) && toleranceCents >= 0 && toleranceCents <= toleranceLimit;
  const pricesChanged = markupCents !== config.public_markup_cents || fallbackCents !== config.fallback_shipping_cents || minPriceChanged || toleranceChanged;
  const stageOf = (value) => stages.find((item) => item.key === value);

  return (
    <AdminLayout>
      <div>
        <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><ShoppingBag className="w-7 h-7 text-honor" aria-hidden="true" /> Shop</h1>
        <ShopTabs />
        <p className="mt-4 text-sm text-white/60 max-w-2xl">
          Wer den Vereinsshop sieht, ob Bestellungen an Printful gehen, Preise und der Zugang zu Printful. Jede Änderung braucht einen Grund und steht im Protokoll der Adminaktionen.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4 max-w-4xl" data-testid="shop-status">
        <StatusTile label="Stufe" value={stageOf(config.stage)?.label || config.stage} tone={config.stage === "off" ? "quiet" : "ok"} testId="shop-status-stage" />
        <StatusTile label="An Printful senden" value={config.orders_to_printful ? "an" : "aus"} tone={config.orders_to_printful ? "ok" : "quiet"} testId="shop-status-switch" />
        <StatusTile label="Printful-Schlüssel" value={KEY_STATES[key.state] || key.state} tone={key.state === "ok" ? "ok" : key.state === "unreadable" ? "warn" : "quiet"} testId="shop-status-key" />
        <StatusTile label="Steuer geklärt" value={config.tax_cleared ? "ja" : "noch nicht"} tone={config.tax_cleared ? "ok" : "quiet"} testId="shop-status-tax" />
      </div>

      <div className="mt-6 space-y-4 max-w-4xl">
        <Section title="Sichtbarkeit" icon={Users} testId="shop-stage">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Stufe">
            {stages.map((item) => {
              const selected = stage === item.key;
              return (
                <button key={item.key} type="button" role="radio" aria-checked={selected} disabled={item.locked || !!busy}
                  onClick={() => setStage(item.key)}
                  className={`text-left border rounded-sm px-3 py-2.5 transition-colors duration-150 disabled:cursor-not-allowed ${selected ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"} ${item.locked ? "opacity-60" : ""}`}
                  data-testid={`shop-stage-${item.key}`}>
                  <span className="flex items-center gap-2 text-sm font-bold">
                    {item.locked && <Lock className="w-3.5 h-3.5 text-warn" aria-hidden="true" />}
                    {item.label}
                    {config.stage === item.key && <span className="text-[10px] uppercase tracking-wider text-ok">aktiv</span>}
                  </span>
                  <span className="block text-xs text-white/55 mt-0.5">{item.hint}</span>
                  {item.locked && item.lock_reason && <span className="block text-xs text-warn mt-1" data-testid={`shop-stage-${item.key}-lock`}>{item.lock_reason}</span>}
                </button>
              );
            })}
          </div>
          {stage !== config.stage && (
            <div className="space-y-2" data-testid="shop-stage-change">
              <div className="text-sm text-white/70">Von <b>{stageOf(config.stage)?.label}</b> auf <b>{stageOf(stage)?.label}</b> umstellen:</div>
              <ReasonedButton id="shop-stage-save" label="Stufe speichern" busy={busy === "stage"} required={stage === "public"}
                onSubmit={(reason) => run("stage", () => api.patch(BASE, { stage, reason }), (next) => `Stufe jetzt: ${next.config.stage_label}.`)} />
            </div>
          )}
        </Section>

        <Section title="Steuer geklärt (#1701)" icon={Lock} testId="shop-tax">
          <p className="text-sm text-white/65" data-testid="shop-tax-state">
            {config.tax_cleared
              ? <>Freigegeben von {config.tax_cleared.by} am {viennaDateTime(config.tax_cleared.at)}{config.tax_cleared.reason ? ` – „${config.tax_cleared.reason}“` : ""}.</>
              : "Noch nicht freigegeben. Solange bleibt „Öffentlich“ gesperrt."}
          </p>
          {rights.can_set_tax
            ? <ReasonedButton id="shop-tax-toggle" label={config.tax_cleared ? "Freigabe zurücknehmen" : "Steuer als geklärt freigeben"}
                variant={config.tax_cleared ? "secondary" : "primary"} busy={busy === "tax"} required
                onSubmit={(reason) => run("tax", () => api.put(`${BASE}/tax-clearance`, { cleared: !config.tax_cleared, reason }),
                  config.tax_cleared ? "Freigabe zurückgenommen." : "Steuer als geklärt freigegeben.")} />
            : <p className="text-xs text-white/45">Diese Freigabe setzt nur der Superadmin.</p>}
        </Section>

        <Section title="Notschalter: Bestellungen an Printful senden" icon={Power} testId="shop-switch">
          <p className="text-sm text-white/65" data-testid="shop-switch-state">
            {config.orders_to_printful
              ? "An: bezahlte und freigegebene Bestellungen dürfen an Printful gehen."
              : "Aus: nichts geht an Printful. Bestellungen warten."}{" "}
            Der Schalter gilt unabhängig von der Stufe.
          </p>
          {!config.orders_to_printful && key.state !== "ok" && <p className="text-xs text-warn" data-testid="shop-switch-needs-key">Erst den Printful-Schlüssel hinterlegen.</p>}
          <ReasonedButton id="shop-switch-toggle" label={config.orders_to_printful ? "Ausschalten" : "Einschalten"}
            variant={config.orders_to_printful ? "danger" : "primary"} busy={busy === "switch"} required={!config.orders_to_printful}
            disabled={!config.orders_to_printful && key.state !== "ok"}
            blockedHint="Erst unten beim Printful-Zugang den Schlüssel hinterlegen."
            onSubmit={(reason) => run("switch", () => api.patch(BASE, { orders_to_printful: !config.orders_to_printful, reason }),
              config.orders_to_printful ? "Notschalter aus: nichts geht an Printful." : "Bestellungen gehen an Printful.")} />
        </Section>

        <Section title="Preise und Versand" icon={Truck} testId="shop-prices">
          <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            <div><dt className="text-white/50 text-xs">Mitglieder</dt><dd data-testid="shop-member-price">Printful brutto: was der Verein an Printful zahlt (Ware, Versand, Steuer), Aufschlag {formatCents(config.member_markup_cents)}</dd></div>
            <div><dt className="text-white/50 text-xs">Versandland</dt><dd data-testid="shop-countries">{config.shipping_countries.join(", ")} (Österreich) – weitere erst nach der Steuerklärung</dd></div>
          </dl>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="text-white/70">Öffentlicher Aufschlag je Artikel (€)</span>
              <input value={markup} onChange={(event) => setMarkup(event.target.value)} inputMode="decimal" placeholder="0,00"
                className="mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 tabular-nums focus:border-brand outline-none" data-testid="shop-markup" />
              <span className="block text-xs text-white/45 mt-1">Nur bei öffentlichen Käufen. Hat ein Produkt einen eigenen Aufschlag, ersetzt der diesen.</span>
            </label>
            <label className="block text-sm">
              <span className="text-white/70">Ersatzpauschale Versand (€)</span>
              <input value={fallback} onChange={(event) => setFallback(event.target.value)} inputMode="decimal" placeholder="leer = keine"
                className="mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 tabular-nums focus:border-brand outline-none" data-testid="shop-fallback" />
              <span className="block text-xs text-white/45 mt-1">Gilt, wenn Printful den Versand nicht schätzen kann. Leer: dann wird nicht bestellt.</span>
            </label>
            <label className="block text-sm">
              <span className="text-white/70">Mindestpreis je Artikel (€)</span>
              <input value={minPrice} onChange={(event) => setMinPrice(event.target.value)} inputMode="decimal" placeholder="1,00"
                className="mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 tabular-nums focus:border-brand outline-none" data-testid="shop-min-price" />
              <span className="block text-xs text-white/45 mt-1">Kein Verkaufspreis darunter – auch nicht 0 €. Die Prüfung vor dem Veröffentlichen hält sich daran.</span>
            </label>
            <label className="block text-sm">
              <span className="text-white/70">Toleranz bei Preisänderung (€)</span>
              <input value={tolerance} onChange={(event) => setTolerance(event.target.value)} inputMode="decimal" placeholder="0,50"
                className="mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 tabular-nums focus:border-brand outline-none" data-testid="shop-price-tolerance" />
              <span className="block text-xs text-white/45 mt-1">Vor dem Auslösen schätzt Printful neu. Ist es um mehr als diesen Betrag teurer, geht die Bestellung nicht automatisch hinaus, sondern an die Leitung („Preis geändert“). Günstiger: Die Differenz bleibt beim Verein.</span>
            </label>
          </div>
          {!pricesValid && <p className="text-xs text-warn" data-testid="shop-prices-invalid">Beträge in Euro, z. B. 3,50 – Aufschlag bis {formatCents(data.limits.public_markup_cents)}, Pauschale 0,01 bis {formatCents(data.limits.fallback_shipping_cents)}, Mindestpreis 0,01 bis {formatCents(data.limits.min_price_cents)}, Toleranz 0 bis {formatCents(toleranceLimit)}.</p>}
          <ReasonedButton id="shop-prices-save" label="Preise speichern" busy={busy === "prices"} disabled={!pricesValid || !pricesChanged}
            blockedHint={!pricesValid ? "Erst gültige Beträge eintragen (0 bis 100 €)." : "Es hat sich noch nichts geändert."}
            onSubmit={(reason) => run("prices", () => api.patch(BASE, { public_markup_cents: markupCents, fallback_shipping_cents: fallbackCents, ...(minPriceChanged ? { min_price_cents: minPriceCents } : {}), ...(toleranceChanged ? { price_tolerance_cents: toleranceCents } : {}), reason }), "Preise gespeichert.")} />
        </Section>

        <Section title="Printful-Zugang" icon={KeyRound} testId="shop-access">
          <p className="text-sm text-white/65" data-testid="shop-key-state">
            {key.state === "ok" && <>Schlüssel hinterlegt seit {viennaDateTime(key.saved_at)}{key.saved_by ? ` von ${key.saved_by}` : ""}. Er wird nie wieder angezeigt.</>}
            {key.state === "missing" && "Kein Schlüssel hinterlegt."}
            {key.state === "unreadable" && <span className="text-warn">Schlüssel {key.detail}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={key.state !== "ok" || !!busy}
              onClick={() => run("test", () => api.post(`${BASE}/printful-test`), (next) => next.result?.detail || "Getestet.")}
              className="tls-btn tls-btn--secondary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40" data-testid="shop-key-test">
              {busy === "test" ? "Teste …" : "Verbindung testen"}
            </button>
            {lastTest && (
              <span className={`text-xs ${lastTest.ok ? "text-ok" : "text-warn"}`} data-testid="shop-key-last-test">
                {viennaDateTime(lastTest.at)}: {lastTest.detail}
              </span>
            )}
          </div>
          <p className="text-xs text-white/45">Der Test liest nur (Liste der Stores) und schickt nie eine Bestellung.</p>
          {rights.can_edit_access ? (
            <div className="space-y-2 border-t border-white/10 pt-3">
              <label className="block text-sm">
                <span className="text-white/70">{key.state === "missing" ? "API-Schlüssel hinterlegen" : "Neuen API-Schlüssel hinterlegen"}</span>
                <input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)}
                  className="mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 focus:border-brand outline-none" data-testid="shop-key-input" />
              </label>
              <ReasonedButton id="shop-key-save" label="Schlüssel speichern" busy={busy === "key"} disabled={apiKey.trim().length < 20}
                blockedHint="Erst den Printful-Token oben ins Schlüssel-Feld einfügen (mindestens 20 Zeichen)."
                onSubmit={async (reason) => {
                  const done = await run("key", () => api.put(`${BASE}/printful-key`, { api_key: apiKey, reason }), "Schlüssel verschlüsselt gespeichert.");
                  if (done) setApiKey("");
                  return done;
                }} />
              {key.state !== "missing" && (
                <ReasonedButton id="shop-key-remove" label="Schlüssel entfernen" variant="danger" busy={busy === "remove"} required
                  onSubmit={(reason) => run("remove", () => api.post(`${BASE}/printful-key/remove`, { reason }), "Schlüssel entfernt – Notschalter ist aus.")} />
              )}
            </div>
          ) : (
            <p className="text-xs text-white/45" data-testid="shop-key-system-only">Den Zugang hinterlegt, wer den Bereich „System“ hat (Club-Admin, Superadmin).</p>
          )}
        </Section>
      </div>
    </AdminLayout>
  );
}
