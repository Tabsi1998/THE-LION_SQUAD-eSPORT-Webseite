import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Package, RefreshCw, ShoppingBag, XOctagon,
} from "lucide-react";
import { AdminLayout } from "@/components/tls/AdminLayout";
import { api, formatRequestError } from "@/lib/api";
import { formatCents, parseEuro } from "@/lib/billing";
import { viennaDateTime } from "@/lib/vienna";
import ShopTabs from "./ShopTabs";

// Produktverwaltung (#1707) mit Katalogabgleich (#1709) - Verwaltung → Finanzen → Shop → Produkte. Geführt in fünf
// Schritten: Produkt wählen, Farben und Größen, Designs je Platzierung, Preise, Prüfen und veröffentlichen. Jede Änderung
// braucht einen Grund (Protokoll). Was erlaubt ist, entscheidet der Server - die Seite zeigt seine Prüfung und seine
// Texte. Maße immer in Zoll und cm; Printful rechnet in Zoll.

const BASE = "/admin/shop/products";
const CM_PER_INCH = 2.54;
const INPUT = "mt-1 w-full min-h-10 bg-black/40 border border-white/15 rounded-sm px-3 text-sm placeholder:text-white/35 focus:border-brand outline-none disabled:opacity-50";
const CHIP = "min-h-10 px-3 text-sm border rounded-sm transition-colors duration-150 disabled:opacity-40 inline-flex items-center gap-2";

const VISIBILITY_HINTS = {
  public: "Alle mit Website-Konto – nie mit Personalisierung.",
  members: "Nur Mitglieder mit aktiver Mitgliedschaft.",
  hidden: "Nicht im Shop: Gewinne, Vereinsbestellungen.",
};
const STATUS_TONES = {
  draft: "border-white/20 text-white/70",
  reviewed: "border-honor/50 text-honor",
  active: "border-ok/50 bg-ok/10 text-ok",
  archived: "border-white/15 text-white/45",
};
const STEPS = [
  { key: "product", label: "Produkt wählen", checks: ["printful"] },
  { key: "offer", label: "Farben und Größen", checks: ["offer", "stock"] },
  { key: "designs", label: "Designs je Platzierung", checks: ["placements", "files", "personalization"] },
  { key: "prices", label: "Preise", checks: ["prices"] },
  { key: "publish", label: "Prüfen und veröffentlichen", checks: ["mockup"] },
];

function number(value, digits) {
  return String(Number(Number(value).toFixed(digits))).replace(".", ",");
}

export function inches(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "–";
  return `${number(value, 2)} Zoll (${number(value * CM_PER_INCH, 1)} cm)`;
}

function parseNumber(text) {
  const value = Number(String(text ?? "").trim().replace(",", "."));
  return String(text ?? "").trim() && Number.isFinite(value) ? value : Number.NaN;
}

function money(cents) {
  return cents === null || cents === undefined ? "–" : formatCents(cents);
}

// ---------------------------------------------------------------- Bausteine

function Section({ title, icon: Icon, children, testId, aside }) {
  return (
    <section className="border border-white/10 bg-surface-1 rounded-sm p-4 space-y-3" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-white/70 inline-flex items-center gap-2">
          {Icon && <Icon className="w-3.5 h-3.5 text-white/50" aria-hidden="true" />} {title}
        </h2>
        {aside}
      </div>
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

// Grund und Knopf gehören zusammen: ohne Grund (mind. 3 Zeichen) bleibt der Knopf gesperrt.
function ReasonedButton({ id, label, busy, disabled, onSubmit, variant = "primary", hint }) {
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 3 && !disabled && !busy;
  return (
    <form className="space-y-1" data-testid={`${id}-form`} onSubmit={async (event) => {
      event.preventDefault();
      if (!ready) return;
      if (await onSubmit(reason.trim())) setReason("");
    }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={`${id}-reason`}>Grund</label>
        <input id={`${id}-reason`} value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500}
          placeholder="Grund (kommt ins Protokoll)" disabled={busy} className={`${INPUT} mt-0 flex-1`} data-testid={`${id}-reason`} />
        <button type="submit" disabled={!ready} data-testid={`${id}-submit`}
          className={`tls-btn tls-btn--${variant} min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-40 whitespace-nowrap`}>
          {busy ? "Läuft …" : label}
        </button>
      </div>
      {hint && <p className="text-xs text-white/50">{hint}</p>}
    </form>
  );
}

function StatusBadge({ status, labels, testId }) {
  return (
    <span className={`inline-flex items-center border rounded-sm px-2 py-0.5 text-xs font-bold uppercase tracking-wider ${STATUS_TONES[status] || STATUS_TONES.draft}`} data-testid={testId}>
      {labels?.[status] || status}
    </span>
  );
}

function CheckIcon({ state }) {
  if (state === "ok") return <CheckCircle2 className="w-4 h-4 text-ok shrink-0" aria-label="bestanden" />;
  if (state === "open") return <CircleDashed className="w-4 h-4 text-honor shrink-0" aria-label="offen" />;
  return <XOctagon className="w-4 h-4 text-warn shrink-0" aria-label="fehlt" />;
}

function ChoiceGroup({ label, options, value, onChange, testId, disabledKeys = [] }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2" data-testid={testId}>
      {options.map((option) => {
        const disabled = disabledKeys.includes(option.value);
        return (
          <button key={option.value} type="button" role="radio" aria-checked={value === option.value} disabled={disabled}
            onClick={() => onChange(option.value)} title={option.hint}
            className={`${CHIP} ${value === option.value ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
            data-testid={`${testId}-${option.value}`}>
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Shell({ children }) {
  return (
    <AdminLayout>
      <div>
        <h1 className="font-heading text-3xl font-black uppercase inline-flex items-center gap-3"><ShoppingBag className="w-7 h-7 text-honor" aria-hidden="true" /> Shop</h1>
        <ShopTabs />
      </div>
      <div className="mt-6 space-y-4 max-w-5xl">{children}</div>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------- Liste und Anlegen

function NewProductForm({ labels, onCreated }) {
  const [title, setTitle] = useState("");
  const [visibility, setVisibility] = useState("members");
  const [personalization, setPersonalization] = useState("none");
  const [busy, setBusy] = useState(false);
  const isPublic = visibility === "public";
  return (
    <div className="space-y-3">
      <Field label="Titel">
        <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={INPUT} placeholder="z. B. Vereinsshirt schwarz" data-testid="shop-new-title" />
      </Field>
      <div className="space-y-1">
        <div className="text-sm text-white/70">Sichtbarkeit</div>
        <ChoiceGroup label="Sichtbarkeit" testId="shop-new-visibility" value={visibility}
          onChange={(next) => { setVisibility(next); if (next === "public") setPersonalization("none"); }}
          options={["public", "members", "hidden"].map((key) => ({ value: key, label: labels.visibilities[key], hint: VISIBILITY_HINTS[key] }))} />
        <p className="text-xs text-white/45">{VISIBILITY_HINTS[visibility]}</p>
      </div>
      <div className="space-y-1">
        <div className="text-sm text-white/70">Personalisierung</div>
        <ChoiceGroup label="Personalisierung" testId="shop-new-personalization" value={personalization} onChange={setPersonalization}
          disabledKeys={isPublic ? ["gamertag", "member_number", "both"] : []}
          options={["none", "gamertag", "member_number", "both"].map((key) => ({ value: key, label: labels.personalizations[key] }))} />
        {isPublic && <p className="text-xs text-white/50" data-testid="shop-new-public-hint">Öffentliche Produkte haben keine Personalisierung.</p>}
      </div>
      <ReasonedButton id="shop-new" label="Produkt anlegen" busy={busy} disabled={!title.trim()} onSubmit={async (reason) => {
        setBusy(true);
        try {
          const { data } = await api.post(BASE, { title: title.trim(), visibility, personalization, reason });
          toast.success("Produkt als Entwurf angelegt.");
          onCreated(data.product);
          return true;
        } catch (failure) {
          toast.error(formatRequestError(failure, "Das Produkt ließ sich nicht anlegen."));
          return false;
        } finally {
          setBusy(false);
        }
      }} />
    </div>
  );
}

function ProductList() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.get(BASE).then(({ data: next }) => setData(next))
      .catch((failure) => setError(formatRequestError(failure, "Die Produkte lassen sich gerade nicht laden.")));
  }, []);
  if (error) return <Shell><div className="border border-warn/40 bg-warn/10 rounded-sm p-4 text-sm" data-testid="shop-products-error">{error}</div></Shell>;
  if (!data) return <Shell><div className="text-sm text-white/45" role="status">Lade Produkte …</div></Shell>;
  const { labels } = data;
  return (
    <Shell>
      <p className="text-sm text-white/60 max-w-2xl">
        Ein Produkt entsteht in fünf Schritten: Printful-Produkt wählen, Farben und Größen, Designs je Platzierung, Preise, Prüfen und Veröffentlichen. Mitglieder zahlen den Selbstkostenpreis.
      </p>
      <Section title="Produkte" icon={Package} testId="shop-products">
        {data.overview.length === 0 ? (
          <p className="text-sm text-white/55" data-testid="shop-products-empty">Noch keine Produkte. Lege unten das erste an.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {data.overview.map((row) => (
              <li key={row.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid={`shop-product-${row.slug}`}>
                <div className="flex-1 min-w-[12rem]">
                  <Link to={`${BASE}/${row.id}`} className="font-bold hover:text-brand focus-visible:text-brand outline-none">{row.title}</Link>
                  <div className="text-xs text-white/55 mt-0.5">
                    {labels.visibilities[row.visibility]} · Personalisierung: {labels.personalizations[row.personalization]}
                    {row.printful_name ? ` · ${row.printful_name}` : " · noch kein Printful-Produkt"}
                    {row.variants ? ` · ${row.variants} Varianten` : ""}
                  </div>
                </div>
                {row.blocked > 0 && <span className="text-xs text-warn inline-flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />{row.blocked} gesperrt</span>}
                {row.price_warnings > 0 && <span className="text-xs text-warn inline-flex items-center gap-1" data-testid={`shop-product-${row.slug}-warnings`}><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />{row.price_warnings} Preiswarnung{row.price_warnings === 1 ? "" : "en"}</span>}
                <StatusBadge status={row.status} labels={labels.statuses} />
                <Link to={`${BASE}/${row.id}`} className="tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center">Bearbeiten</Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Neues Produkt" icon={ShoppingBag} testId="shop-new">
        <NewProductForm labels={labels} onCreated={(product) => navigate(`${BASE}/${product.id}`)} />
      </Section>
    </Shell>
  );
}

// ---------------------------------------------------------------- Schritt 1: Produkt wählen

function BasicsForm({ view, busy, run }) {
  const { product, labels } = view;
  const [title, setTitle] = useState(product.title);
  const [description, setDescription] = useState(product.description || "");
  const [visibility, setVisibility] = useState(product.visibility);
  const [personalization, setPersonalization] = useState(product.personalization || "none");
  useEffect(() => {
    setTitle(product.title);
    setDescription(product.description || "");
    setVisibility(product.visibility);
    setPersonalization(product.personalization || "none");
  }, [product.title, product.description, product.visibility, product.personalization]);
  const changes = {};
  if (title.trim() !== product.title) changes.title = title.trim();
  if ((description.trim() || null) !== (product.description || null)) changes.description = description.trim();
  if (visibility !== product.visibility) changes.visibility = visibility;
  if (personalization !== (product.personalization || "none")) changes.personalization = personalization;
  const conflict = visibility === "public" && personalization !== "none";
  return (
    <div className="space-y-3" data-testid="shop-basics">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Titel"><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} className={INPUT} data-testid="shop-basics-title" /></Field>
        <Field label="Beschreibung" hint="Nur Text, ohne Formatierung - der Server bereinigt Zeilen und Leerzeichen.">
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} rows={3} className={`${INPUT} py-2`} data-testid="shop-basics-description" />
        </Field>
      </div>
      <div className="space-y-1">
        <div className="text-sm text-white/70">Sichtbarkeit</div>
        <ChoiceGroup label="Sichtbarkeit" testId="shop-basics-visibility" value={visibility} onChange={setVisibility}
          options={["public", "members", "hidden"].map((key) => ({ value: key, label: labels.visibilities[key], hint: VISIBILITY_HINTS[key] }))} />
      </div>
      <div className="space-y-1">
        <div className="text-sm text-white/70">Personalisierung</div>
        <ChoiceGroup label="Personalisierung" testId="shop-basics-personalization" value={personalization} onChange={setPersonalization}
          options={["none", "gamertag", "member_number", "both"].map((key) => ({ value: key, label: labels.personalizations[key] }))} />
      </div>
      {conflict && <p className="text-xs text-warn" data-testid="shop-basics-conflict">Öffentlich und Personalisierung schließen sich aus – der Server lehnt das ab.</p>}
      <ReasonedButton id="shop-basics" label="Grunddaten speichern" busy={busy === "basics"} disabled={!Object.keys(changes).length || !title.trim()}
        onSubmit={(reason) => run("basics", () => api.patch(`${BASE}/${product.id}`, { ...changes, reason }), "Grunddaten gespeichert.", { reload: true })} />
    </div>
  );
}

function PrintfulStep({ view, busy, run }) {
  const { product } = view;
  const printful = product.printful;
  const [numberText, setNumberText] = useState(printful ? String(printful.product_id) : "");
  const parsed = /^\d{1,8}$/.test(numberText.trim()) ? Number(numberText.trim()) : null;
  return (
    <div className="space-y-3" data-testid="shop-step-printful">
      <Field label="Printful-Produktnummer" hint="Die Nummer des Katalogprodukts (nicht einer Variante). Printful bietet in seiner Schnittstelle keine Textsuche – die Nummer steht im Printful-Katalog beim Produkt.">
        <input value={numberText} onChange={(event) => setNumberText(event.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" maxLength={8} className={`${INPUT} tabular-nums max-w-xs`} data-testid="shop-printful-number" />
      </Field>
      <ReasonedButton id="shop-printful" label={printful ? "Neu laden" : "Bei Printful laden"} busy={busy === "printful"} disabled={!parsed || !view.editable}
        hint={printful && parsed && parsed !== printful.product_id ? "Ein anderes Printful-Produkt setzt Farben und Größen zurück." : null}
        onSubmit={(reason) => run("printful", () => api.post(`${BASE}/${product.id}/printful`, { printful_product_id: parsed, reason }), "Printful-Produkt geladen.")} />
      {printful && (
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 border-t border-white/10 pt-3" data-testid="shop-printful-loaded">
          <div><dt className="text-white/50 text-xs">Produkt</dt><dd className="font-bold">{printful.name} <span className="text-white/50 font-normal tabular-nums">Nr. {printful.product_id}</span></dd></div>
          <div><dt className="text-white/50 text-xs">Geladen</dt><dd>{viennaDateTime(printful.loaded_at)}{printful.is_discontinued ? <span className="text-warn"> · bei Printful eingestellt</span> : ""}</dd></div>
          <div><dt className="text-white/50 text-xs">Farben · Größen · Varianten</dt><dd className="tabular-nums">{printful.colors.length} · {printful.sizes.length} · {printful.variants.length}</dd></div>
          <div><dt className="text-white/50 text-xs">Techniken</dt><dd>{printful.techniques.join(", ") || "–"}</dd></div>
          <div className="sm:col-span-2"><dt className="text-white/50 text-xs">Druckflächen</dt>
            <dd className="flex flex-wrap gap-2 mt-1">{printful.placements.map((row) => (
              <span key={`${row.placement}-${row.technique}`} className="border border-white/15 rounded-sm px-2 py-0.5 text-xs">{row.placement} ({row.technique}) · {inches(row.width_in)} × {inches(row.height_in)}</span>
            ))}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Schritt 2: Farben und Größen

function OfferStep({ view, busy, run }) {
  const { product } = view;
  const printful = product.printful;
  const offer = product.offer || { colors: [], sizes: [] };
  const [colors, setColors] = useState(offer.colors);
  const [sizes, setSizes] = useState(offer.sizes);
  const [technique, setTechnique] = useState(product.technique || printful?.default_technique || printful?.techniques?.[0] || "");
  useEffect(() => { setColors(offer.colors); setSizes(offer.sizes); }, [offer.colors, offer.sizes]);
  if (!printful) return <p className="text-sm text-white/55" data-testid="shop-step-offer">Zuerst in Schritt 1 das Printful-Produkt laden.</p>;
  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);
  const count = printful.variants.filter((row) => colors.includes(row.color) && sizes.includes(row.size)).length;
  const tooMany = count > view.limits.max_variants;
  const offered = view.variants.filter((row) => row.active);
  return (
    <div className="space-y-4" data-testid="shop-step-offer">
      {printful.techniques.length > 1 && (
        <div className="space-y-1">
          <div className="text-sm text-white/70">Drucktechnik</div>
          <ChoiceGroup label="Drucktechnik" testId="shop-offer-technique" value={technique} onChange={setTechnique}
            options={printful.techniques.map((key) => ({ value: key, label: key }))} />
        </div>
      )}
      <div className="space-y-1">
        <div className="text-sm text-white/70">Farben</div>
        <div className="flex flex-wrap gap-2">
          {printful.colors.map((color) => (
            <button key={color.name} type="button" aria-pressed={colors.includes(color.name)} onClick={() => toggle(colors, setColors, color.name)}
              className={`${CHIP} ${colors.includes(color.name) ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`} data-testid={`shop-offer-color-${color.name}`}>
              <span className="w-4 h-4 rounded-sm border border-white/25" style={{ backgroundColor: color.code }} aria-hidden="true" /> {color.name}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-sm text-white/70">Größen</div>
        <div className="flex flex-wrap gap-2">
          {printful.sizes.map((size) => (
            <button key={size} type="button" aria-pressed={sizes.includes(size)} onClick={() => toggle(sizes, setSizes, size)}
              className={`${CHIP} min-w-12 justify-center ${sizes.includes(size) ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`} data-testid={`shop-offer-size-${size}`}>
              {size}
            </button>
          ))}
        </div>
      </div>
      <p className={`text-xs ${tooMany ? "text-warn" : "text-white/55"}`} data-testid="shop-offer-count">
        {count} Varianten{tooMany ? ` – höchstens ${view.limits.max_variants}` : ""}. Einkaufspreise holt die Website nur für diese – je Variante ein Aufruf bei Printful (höchstens 120 pro Minute).
      </p>
      <ReasonedButton id="shop-offer" label="Speichern und Preise laden" busy={busy === "offer"} disabled={!count || tooMany || !technique || !view.editable}
        onSubmit={(reason) => run("offer", () => api.put(`${BASE}/${product.id}/offer`, { technique, colors, sizes, reason }), "Farben und Größen gespeichert, Preise geladen.")} />
      {offered.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="shop-offer-variants">
            <thead><tr className="text-left text-xs text-white/50"><th className="py-1 pr-3 font-normal">Variante</th><th className="py-1 pr-3 font-normal">Printful-Variante</th><th className="py-1 pr-3 font-normal">Lager</th><th className="py-1 font-normal text-right">Einkauf</th></tr></thead>
            <tbody>
              {offered.map((row) => (
                <tr key={row.id} className="border-t border-white/10" data-testid={`shop-variant-${row.sku}`}>
                  <td className="py-1.5 pr-3">{row.label}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-white/60">{row.printful_variant_id ?? "–"}</td>
                  <td className={`py-1.5 pr-3 ${row.blocked_reason || row.in_stock === false ? "text-warn" : row.in_stock ? "text-ok" : "text-white/50"}`}>
                    {row.blocked_reason || (row.in_stock ? "lieferbar" : row.in_stock === false ? "nicht lieferbar" : "unbekannt")}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{money(row.base_cost_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Schritt 3: Platzierungen und Designs

function placementDraft(view) {
  const stored = Object.fromEntries(view.placements.map((row) => [row.key, row]));
  return Object.fromEntries(view.available_placements.map((row) => {
    const current = stored[row.key];
    const position = current?.position || row.default_position;
    return [row.key, {
      use: !!current, kind: current?.kind || "design",
      position: Object.fromEntries(Object.entries(position).map(([name, value]) => [name, number(value, 3)])),
    }];
  }));
}

function PlacementsForm({ view, busy, run }) {
  const { product, labels } = view;
  const [draft, setDraft] = useState(() => placementDraft(view));
  const [included, setIncluded] = useState(view.included_placement || "");
  useEffect(() => { setDraft(placementDraft(view)); setIncluded(view.included_placement || ""); }, [view]);
  const personalization = product.personalization || "none";
  const kinds = ["design", ...(["gamertag", "both"].includes(personalization) ? ["gamertag"] : []), ...(["member_number", "both"].includes(personalization) ? ["member_number"] : [])];
  const used = view.available_placements.filter((row) => draft[row.key]?.use);
  const printfulUsed = [...new Set(used.map((row) => row.printful_placement))];
  const payload = used.map((row) => ({
    key: row.key, kind: draft[row.key].kind,
    position: Object.fromEntries(Object.entries(draft[row.key].position).map(([name, value]) => [name, parseNumber(value)])),
  }));
  const valid = payload.length > 0 && payload.every((row) => Object.values(row.position).every((value) => Number.isFinite(value) && value >= 0));
  const update = (key, patch) => setDraft((now) => ({ ...now, [key]: { ...now[key], ...patch } }));
  const includedValue = printfulUsed.includes(included) ? included : (printfulUsed.includes("front") ? "front" : printfulUsed[0] || null);
  return (
    <div className="space-y-3" data-testid="shop-placements-form">
      <p className="text-xs text-white/55">Positionen sind eine Vorlage im Druckbereich, von vorne gesehen, gemessen von links oben. „Brust rechts vom Träger aus“ liegt von vorne gesehen links. Breite und Höhe sind der Rahmen; das Motiv behält sein Seitenverhältnis.</p>
      <ul className="space-y-3">
        {view.available_placements.map((row) => {
          const state = draft[row.key];
          return (
            <li key={row.key} className="border border-white/10 rounded-sm p-3 bg-black/20" data-testid={`shop-placement-row-${row.key}`}>
              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-sm font-bold min-h-10 cursor-pointer">
                  <input type="checkbox" checked={state.use} onChange={(event) => update(row.key, { use: event.target.checked })} className="w-4 h-4 accent-brand" data-testid={`shop-placement-use-${row.key}`} />
                  {row.label}
                </label>
                <span className="text-xs text-white/50">Printful: {row.printful_placement} · Bereich {row.area_text.width_in || "–"} × {row.area_text.height_in || "–"}</span>
              </div>
              {state.use && (
                <div className="mt-2 space-y-2">
                  <ChoiceGroup label={`Art von ${row.label}`} testId={`shop-placement-kind-${row.key}`} value={state.kind} onChange={(kind) => update(row.key, { kind })}
                    options={kinds.map((kind) => ({ value: kind, label: labels.kinds[kind] }))} />
                  <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                    {[["left_in", "Links"], ["top_in", "Oben"], ["width_in", "Breite"], ["height_in", "Höhe"]].map(([name, label]) => {
                      const value = parseNumber(state.position[name]);
                      return (
                        <Field key={name} label={`${label} (Zoll)`} hint={Number.isFinite(value) ? `= ${number(value * CM_PER_INCH, 1)} cm` : "Zahl in Zoll"}>
                          <input value={state.position[name]} inputMode="decimal" className={`${INPUT} tabular-nums`}
                            onChange={(event) => update(row.key, { position: { ...state.position, [name]: event.target.value } })}
                            data-testid={`shop-placement-${row.key}-${name}`} />
                        </Field>
                      );
                    })}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {printfulUsed.length > 1 && (
        <div className="space-y-1">
          <div className="text-sm text-white/70">Im Grundpreis von Printful enthalten</div>
          <ChoiceGroup label="Im Grundpreis enthalten" testId="shop-placement-included" value={includedValue} onChange={setIncluded}
            options={printfulUsed.map((key) => ({ value: key, label: key }))} />
          <p className="text-xs text-white/45">Jede weitere Druckfläche kostet ihren Aufpreis (etwa die Rückseite). Mit der Kostenschätzung im Testentwurf (#2062) gegenprüfen.</p>
        </div>
      )}
      <ReasonedButton id="shop-placements" label="Platzierungen speichern" busy={busy === "placements"} disabled={!valid || !view.editable}
        onSubmit={(reason) => run("placements", () => api.put(`${BASE}/${product.id}/placements`, { placements: payload, included_placement: includedValue, reason }), "Platzierungen gespeichert.")} />
    </div>
  );
}

const LEVEL_TEXT = { good: "gut", snug: "knapp", too_low: "reicht nicht", missing: "fehlt", unknown: "ohne Maße" };

function DesignMatrix({ view, busy, run }) {
  const { product } = view;
  const colors = product.offer?.colors || [];
  const rows = view.placements.filter((row) => row.kind === "design");
  const initial = () => Object.fromEntries(rows.flatMap((row) => colors.map((color) => [`${row.key}|${color}`, row.designs[color]?.design_key || ""])));
  const [choice, setChoice] = useState(initial);
  useEffect(() => { setChoice(initial()); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!rows.length || !colors.length) {
    return <p className="text-sm text-white/55" data-testid="shop-designs-matrix">Erst Farben (Schritt 2) und Platzierungen mit Design wählen.</p>;
  }
  const changes = rows.flatMap((row) => colors.map((color) => {
    const now = choice[`${row.key}|${color}`] || null;
    const before = row.designs[color]?.design_key || null;
    return now === before ? null : { placement: row.key, color, design_key: now };
  })).filter(Boolean);
  const takeSuggestions = () => setChoice((now) => {
    const next = { ...now };
    for (const item of view.design_suggestions) if (!next[`${item.placement}|${item.color}`]) next[`${item.placement}|${item.color}`] = item.design_key;
    return next;
  });
  return (
    <div className="space-y-3" data-testid="shop-designs-matrix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-white/55">Je Platzierung und Farbe ein Design aus dem Reiter „Designs“. Ohne gültige Datei für eine angebotene Farbe lässt sich nichts veröffentlichen.</p>
        <button type="button" onClick={takeSuggestions} className="tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm" data-testid="shop-designs-suggest">Vorschläge übernehmen</button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-white/50"><th className="py-1 pr-3 font-normal">Platzierung</th>{colors.map((color) => <th key={color} className="py-1 pr-3 font-normal">{color}</th>)}</tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="border-t border-white/10 align-top">
                <td className="py-2 pr-3">
                  <div className="font-bold">{row.label}</div>
                  <div className="text-xs text-white/50">{row.position_text.width} breit{row.included ? "" : ` · Aufpreis ${money(row.surcharge_cents)}`}</div>
                </td>
                {colors.map((color) => {
                  const key = `${row.key}|${color}`;
                  const cell = row.designs[color];
                  const suggestion = row.suggestions[color];
                  const options = view.design_options[row.key] || [];
                  return (
                    <td key={color} className="py-2 pr-3 min-w-[11rem]">
                      <label className="sr-only" htmlFor={`shop-design-${key}`}>{row.label}, {color}</label>
                      <select id={`shop-design-${key}`} value={choice[key] || ""} onChange={(event) => setChoice((now) => ({ ...now, [key]: event.target.value }))}
                        className={`${INPUT} mt-0`} data-testid={`shop-design-cell-${row.key}-${color}`}>
                        <option value="">– kein Design –</option>
                        {options.map((option) => <option key={option.design_key} value={option.design_key}>{option.title}{option.design_key === suggestion ? " (Vorschlag)" : ""}</option>)}
                      </select>
                      {cell && (choice[key] || "") === cell.design_key && (
                        <div className={`text-xs mt-1 ${["good", "snug"].includes(cell.level) ? "text-ok" : "text-warn"}`} title={cell.text}>v{cell.version ?? "–"} · {LEVEL_TEXT[cell.level] || cell.level}</div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.placements.some((row) => row.kind !== "design") && (
        <p className="text-xs text-white/55" data-testid="shop-designs-placeholders">
          {view.placements.filter((row) => row.kind !== "design").map((row) => `${row.label}: ${row.kind_label}`).join(" · ")}
        </p>
      )}
      <ReasonedButton id="shop-designs" label="Designs speichern" busy={busy === "designs"} disabled={!changes.length || !view.editable}
        onSubmit={(reason) => run("designs", () => api.put(`${BASE}/${product.id}/designs`, { assignments: changes, reason }), "Designs gespeichert.")} />
    </div>
  );
}

// ---------------------------------------------------------------- Schritt 4: Preise

function MarkupForm({ view, busy, run }) {
  const { pricing, product } = view;
  const [own, setOwn] = useState(pricing.source === "product");
  const [amount, setAmount] = useState(pricing.product_markup_cents === null ? "" : (pricing.product_markup_cents / 100).toFixed(2).replace(".", ","));
  const cents = own ? parseEuro(amount) : null;
  const valid = !own || (cents !== null && cents <= 10000);
  const changed = own ? cents !== pricing.product_markup_cents : pricing.product_markup_cents !== null;
  return (
    <div className="space-y-2" data-testid="shop-markup">
      <div className="text-sm text-white/70">Aufschlag für den öffentlichen Preis</div>
      <ChoiceGroup label="Aufschlag" testId="shop-markup-source" value={own ? "product" : "general"} onChange={(value) => setOwn(value === "product")}
        options={[{ value: "general", label: `Allgemeiner Aufschlag (${money(pricing.general_markup_cents)})` }, { value: "product", label: "Eigener Aufschlag" }]} />
      {own && (
        <Field label="Eigener Aufschlag je Artikel (Euro)" hint="Ersetzt den allgemeinen Aufschlag – er kommt nicht dazu. 0 heißt: öffentlich zum Selbstkostenpreis.">
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" className={`${INPUT} tabular-nums max-w-xs`} data-testid="shop-markup-amount" />
        </Field>
      )}
      <ReasonedButton id="shop-markup" label="Aufschlag speichern" busy={busy === "markup"} disabled={!valid || !changed}
        onSubmit={(reason) => run("markup", () => api.patch(`${BASE}/${product.id}`, { markup_cents: cents, reason }), "Aufschlag gespeichert.", { reload: true })} />
    </div>
  );
}

function PricesStep({ view, busy, run }) {
  const offered = view.variants.filter((row) => row.active);
  const warnings = offered.filter((row) => row.price_warning);
  if (!offered.length) return <p className="text-sm text-white/55" data-testid="shop-step-prices">Erst Farben und Größen wählen (Schritt 2).</p>;
  return (
    <div className="space-y-4" data-testid="shop-step-prices">
      <p className="text-xs text-white/55">Mitglieder zahlen den Selbstkostenpreis: Einkauf der Variante plus Aufpreis jeder weiteren Druckfläche, ohne Aufschlag. Der öffentliche Preis ist ein Vorschlag aus Einkauf plus Aufschlag – entscheiden tun die Finanzen. Versand kommt bei der Bestellung dazu.</p>
      {warnings.length > 0 && (
        <div className="border border-warn/40 bg-warn/10 rounded-sm p-3 text-sm" role="alert" data-testid="shop-price-warnings">
          <div className="font-bold inline-flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-warn" aria-hidden="true" /> Printful hat Preise geändert</div>
          <ul className="mt-1 text-xs space-y-0.5">
            {warnings.map((row) => <li key={row.id}>{row.label}: {money(row.price_warning.before_cents)} → {money(row.price_warning.after_cents)} (seit {viennaDateTime(row.price_warning.at)})</li>)}
          </ul>
          <p className="text-xs text-white/60 mt-1">Bestehende Bestellungen bleiben unverändert. Neue Preise gelten erst nach „Preise übernehmen“.</p>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums" data-testid="shop-prices-table">
          <thead><tr className="text-left text-xs text-white/50">
            <th className="py-1 pr-3 font-normal">Variante</th><th className="py-1 pr-3 font-normal text-right">Einkauf</th><th className="py-1 pr-3 font-normal text-right">Selbstkosten</th>
            <th className="py-1 pr-3 font-normal text-right">Mitglieder</th><th className="py-1 font-normal text-right">Öffentlich</th>
          </tr></thead>
          <tbody>
            {offered.map((row) => (
              <tr key={row.id} className="border-t border-white/10" data-testid={`shop-price-${row.sku}`}>
                <td className="py-1.5 pr-3">{row.label}</td>
                <td className="py-1.5 pr-3 text-right text-white/60">{money(row.base_cost_cents)}</td>
                <td className="py-1.5 pr-3 text-right">{money(row.cost_cents)}</td>
                <td className={`py-1.5 pr-3 text-right font-bold ${row.price_cents !== row.cost_cents ? "text-warn" : ""}`}>{row.price_cents === null ? "nicht übernommen" : money(row.price_cents)}</td>
                <td className="py-1.5 text-right">{money(row.price_cents === null ? row.suggested_public_cents : row.public_price_cents)}{row.price_cents === null ? " (Vorschlag)" : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ReasonedButton id="shop-prices" label="Preise übernehmen" busy={busy === "prices"} disabled={view.product.status === "archived"}
        hint="Übernimmt die Selbstkosten als Mitgliederpreis und beendet Preiswarnungen."
        onSubmit={(reason) => run("prices", () => api.post(`${BASE}/${view.product.id}/prices/accept`, { reason }), "Preise übernommen.")} />
      <MarkupForm key={`${view.pricing.source}-${view.pricing.product_markup_cents}`} view={view} busy={busy} run={run} />
    </div>
  );
}

// ---------------------------------------------------------------- Schritt 5: Prüfen und Stand

const STATUS_ACTIONS = {
  reviewed: { label: "Als geprüft markieren", variant: "primary" },
  active: { label: "Veröffentlichen", variant: "primary" },
  draft: { label: "Zurück auf Entwurf", variant: "secondary" },
  archived: { label: "Archivieren", variant: "quiet" },
};

function PublishStep({ view, busy, run }) {
  const { check, product } = view;
  return (
    <div className="space-y-4" data-testid="shop-step-publish">
      <ul className="space-y-2" data-testid="shop-check">
        {check.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2 text-sm" data-testid={`shop-check-${item.key}`} data-state={item.state}>
            <CheckIcon state={item.state} />
            <div><div className="font-bold">{item.label}{!item.for_review && <span className="ml-2 text-xs font-normal text-white/50">vor dem Veröffentlichen</span>}</div><div className="text-xs text-white/60">{item.detail}</div></div>
          </li>
        ))}
      </ul>
      <div className="space-y-3 border-t border-white/10 pt-3">
        {view.transitions.map((status) => {
          const action = STATUS_ACTIONS[status];
          const blocked = (status === "reviewed" && !check.review_ready) || (status === "active" && !check.publish_ready);
          const label = status === "draft" && product.status === "archived" ? "Wieder als Entwurf öffnen" : status === "draft" && product.status === "active" ? "Zurückziehen" : action.label;
          return (
            <div key={status} data-testid={`shop-status-${status}`}>
              <ReasonedButton id={`shop-status-${status}`} label={label} variant={action.variant} busy={busy === `status-${status}`} disabled={blocked}
                hint={blocked ? (status === "active" ? "Erst wenn alle Punkte bestanden sind – auch die Mockup-Prüfung (#1710)." : "Erst wenn alle Punkte außer den Mockups bestanden sind.") : null}
                onSubmit={(reason) => run(`status-${status}`, () => api.post(`${BASE}/${product.id}/status`, { status, reason }), `Stand: ${view.labels.statuses[status]}.`)} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Editor

function stepState(step, view) {
  const items = view.check.items.filter((item) => step.checks.includes(item.key));
  if (items.every((item) => item.ok)) return "ok";
  return items.some((item) => item.state === "open") && items.every((item) => item.ok || item.state === "open") ? "open" : "failed";
}

function SyncLine({ view, busy, run }) {
  const sync = view.sync;
  if (!view.product.printful) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs" data-testid="shop-sync">
      <span className={sync && !sync.ok ? "text-warn" : "text-white/60"}>
        {!sync ? "Noch nicht abgeglichen."
          : sync.ok ? `Abgleich ${viennaDateTime(sync.at)}: ${sync.detail}`
            : `Abgleich gescheitert (${viennaDateTime(sync.at)}): ${sync.detail} Stand vom ${sync.last_ok_at ? viennaDateTime(sync.last_ok_at) : "–"}.`}
      </span>
      <button type="button" disabled={busy === "sync"} onClick={() => run("sync", () => api.post(`${BASE}/${view.product.id}/sync`, {}), (next) => (next.result?.ok ? "Mit Printful abgeglichen." : "Printful nicht erreichbar – letzter Stand bleibt."))}
        className="tls-btn tls-btn--secondary min-h-9 px-3 text-xs font-bold uppercase tracking-wider rounded-sm inline-flex items-center gap-1.5 disabled:opacity-40" data-testid="shop-sync-run">
        <RefreshCw className={`w-3.5 h-3.5 ${busy === "sync" ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" /> Mit Printful abgleichen
      </button>
    </div>
  );
}

function ProductEditor({ productId }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [step, setStep] = useState("product");

  const load = useCallback(() => api.get(`${BASE}/${productId}`).then(({ data }) => { setView(data); setError(""); })
    .catch((failure) => setError(formatRequestError(failure, "Das Produkt lässt sich gerade nicht laden."))), [productId]);
  useEffect(() => { load(); }, [load]);

  const run = useCallback(async (key, request, success, { reload = false } = {}) => {
    setBusy(key);
    try {
      const { data } = await request();
      if (reload) await load(); else setView(data);
      toast.success(typeof success === "function" ? success(data) : success);
      return true;
    } catch (failure) {
      toast.error(formatRequestError(failure, "Das hat nicht geklappt."));
      return false;
    } finally {
      setBusy("");
    }
  }, [load]);

  const states = useMemo(() => (view ? Object.fromEntries(STEPS.map((item) => [item.key, stepState(item, view)])) : {}), [view]);
  if (error) return <Shell><div className="border border-warn/40 bg-warn/10 rounded-sm p-4 text-sm" data-testid="shop-product-error">{error}</div></Shell>;
  if (!view) return <Shell><div className="text-sm text-white/45" role="status">Lade Produkt …</div></Shell>;
  const { product, labels } = view;
  const current = STEPS.findIndex((item) => item.key === step);
  return (
    <Shell>
      <Link to={BASE} className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white min-h-8"><ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Alle Produkte</Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-bold" data-testid="shop-product-title">{product.title}</h2>
        <StatusBadge status={product.status} labels={labels.statuses} testId="shop-product-status" />
        <span className="text-xs text-white/55">{labels.visibilities[product.visibility]} · Personalisierung: {labels.personalizations[product.personalization || "none"]}</span>
      </div>
      {!view.editable && <p className="text-xs text-honor" data-testid="shop-product-locked">{product.status === "active" ? "Veröffentlicht: zum Ändern des Aufbaus erst zurückziehen (Schritt 5)." : "Archiviert: bleibt für Bestellungen lesbar. Zum Ändern wieder als Entwurf öffnen."}</p>}
      <SyncLine view={view} busy={busy} run={run} />

      <nav aria-label="Schritte" data-testid="shop-steps">
        <ol className="grid gap-2 sm:grid-cols-5">
          {STEPS.map((item, index) => (
            <li key={item.key}>
              <button type="button" onClick={() => setStep(item.key)} aria-current={step === item.key ? "step" : undefined}
                className={`w-full min-h-12 text-left px-3 py-2 border rounded-sm text-sm transition-colors duration-150 inline-flex items-center gap-2 ${step === item.key ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/30"}`}
                data-testid={`shop-step-${item.key}`} data-state={states[item.key]}>
                <CheckIcon state={states[item.key]} />
                <span><span className="text-white/45 tabular-nums mr-1">{index + 1}.</span>{item.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {step === "product" && (
        <>
          <Section title="Grunddaten" icon={Package} testId="shop-section-basics"><BasicsForm view={view} busy={busy} run={run} /></Section>
          <Section title="Printful-Produkt" icon={ShoppingBag} testId="shop-section-printful"><PrintfulStep view={view} busy={busy} run={run} /></Section>
        </>
      )}
      {step === "offer" && <Section title="Farben und Größen" testId="shop-section-offer"><OfferStep view={view} busy={busy} run={run} /></Section>}
      {step === "designs" && (
        <>
          <Section title="Platzierungen" testId="shop-section-placements">
            {view.available_placements.length ? <PlacementsForm view={view} busy={busy} run={run} /> : <p className="text-sm text-white/55">Zuerst in Schritt 1 das Printful-Produkt laden.</p>}
          </Section>
          <Section title="Designs je Platzierung und Farbe" testId="shop-section-designs"><DesignMatrix view={view} busy={busy} run={run} /></Section>
        </>
      )}
      {step === "prices" && <Section title="Preise" testId="shop-section-prices"><PricesStep view={view} busy={busy} run={run} /></Section>}
      {step === "publish" && <Section title="Prüfen und veröffentlichen" testId="shop-section-publish"><PublishStep view={view} busy={busy} run={run} /></Section>}

      <div className="flex justify-between gap-2">
        <button type="button" disabled={current <= 0} onClick={() => setStep(STEPS[current - 1].key)} className="tls-btn tls-btn--quiet min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-30" data-testid="shop-step-back">Zurück</button>
        <button type="button" disabled={current >= STEPS.length - 1} onClick={() => setStep(STEPS[current + 1].key)} className="tls-btn tls-btn--secondary min-h-10 px-4 text-xs font-bold uppercase tracking-wider rounded-sm disabled:opacity-30" data-testid="shop-step-next">Weiter</button>
      </div>
    </Shell>
  );
}

export default function AdminShopProductsPage() {
  const { productId } = useParams();
  return productId ? <ProductEditor key={productId} productId={productId} /> : <ProductList />;
}
