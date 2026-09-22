// Preis- und Buchungsmodell im Web (#315, #318): dieselbe Rechnung wie der Server, nur zur
// Vorschau - was gilt, sagt der Server beim Anmelden (Snapshot). Beträge sind ganze Cent.

export const PRICE_BASES = [
  { key: "per_person", label: "je Person (mit Begleitpersonen)" },
  { key: "per_registration", label: "je Anmeldung" },
  { key: "per_team", label: "je Team" },
];

export const TAX_PROFILES = [
  { key: "none", label: "Ohne Umsatzsteuer (Verein, Kleinunternehmer)" },
  { key: "standard", label: "Normalsatz" },
  { key: "reduced", label: "Ermäßigter Satz" },
];

export function formatCents(cents, currency = "EUR") {
  const value = Number(cents || 0);
  const euros = Math.trunc(value / 100);
  const rest = Math.abs(value % 100);
  return `${euros},${String(rest).padStart(2, "0")} ${currency === "EUR" ? "€" : currency}`;
}

/** „20“ oder „20,50“ → 2050. Ungültiges → null. */
export function centsFromInput(value) {
  const text = String(value ?? "").replace(",", ".").trim();
  if (!text) return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

export function inputFromCents(cents) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2).replace(".", ",");
}

/** Vorschau der Summe für Sitze und gewählte optionale Positionen. */
export function previewQuote(offer, { seats = 1, selected = [] } = {}) {
  if (!offer?.enabled || !offer.positions?.length) return { free: true, total_cents: 0, positions: [], currency: "EUR" };
  const chosen = new Set(selected);
  const lines = offer.positions
    .filter((position) => !position.optional || chosen.has(position.key))
    .map((position) => {
      const quantity = position.basis === "per_person" ? Math.max(1, Number(seats)) : 1;
      const unit = Number(position.amount_cents || 0);
      return { key: position.key, label: position.label, basis: position.basis, quantity, unit_cents: unit, total_cents: unit * quantity, optional: Boolean(position.optional) };
    });
  return { free: false, currency: offer.currency || "EUR", positions: lines, total_cents: lines.reduce((sum, line) => sum + line.total_cents, 0) };
}

export function basisLabel(basis) {
  return PRICE_BASES.find((item) => item.key === basis)?.label || basis;
}

/** „20,00 € je Person · mit 1 Begleitperson 40,00 €“ - der Satz an der Anmeldung. */
export function offerSummary(offer, seats = 1) {
  if (!offer?.enabled) return "";
  const required = offer.positions.filter((position) => !position.optional);
  const single = previewQuote(offer, { seats: 1 });
  const parts = [`${formatCents(single.total_cents, offer.currency)} ${required.some((p) => p.basis === "per_person") ? "je Person" : "je Anmeldung"}`];
  if (seats > 1) parts.push(`mit ${seats - 1} Begleitperson${seats - 1 === 1 ? "" : "en"} ${formatCents(previewQuote(offer, { seats }).total_cents, offer.currency)}`);
  return parts.join(" · ");
}

/** Formular ↔ Server: Positionen mit Betrag als Text im Formular, als Cent zum Server. */
export function emptyPosition() {
  return { key: "", label: "", description: "", amount: "", basis: "per_person", tax_profile: "none", optional: false, dolibarr_product_id: "" };
}

export function positionsToForm(billing) {
  return (billing?.positions || []).map((position) => ({
    key: position.key || "",
    label: position.label || "",
    description: position.description || "",
    amount: inputFromCents(position.amount_cents),
    basis: position.basis || "per_person",
    tax_profile: position.tax_profile || "none",
    optional: Boolean(position.optional),
    dolibarr_product_id: position.dolibarr_product_id ?? "",
  }));
}

export function formToBilling(form) {
  const positions = (form.positions || []).map((position, index) => {
    const cents = centsFromInput(position.amount);
    return {
      key: position.key?.trim() || `pos-${index + 1}`,
      label: position.label?.trim() || "",
      description: position.description?.trim() || "",
      amount_cents: cents ?? -1,
      basis: position.basis,
      tax_profile: position.tax_profile,
      optional: Boolean(position.optional),
      dolibarr_product_id: position.dolibarr_product_id === "" || position.dolibarr_product_id === null ? null : Number(position.dolibarr_product_id),
    };
  });
  return { enabled: Boolean(form.enabled), positions, invoice_timing: form.invoice_timing || "on_confirm" };
}

/** Was im Formular noch nicht stimmt - bevor der Server es sagt. */
export function billingFormError(form) {
  if (!form.enabled) return "";
  if (!form.positions?.length) return "Abrechnung aktiv, aber keine Position eingetragen.";
  for (const [index, position] of form.positions.entries()) {
    if (!position.label?.trim()) return `Position ${index + 1}: Bezeichnung fehlt.`;
    if (!String(position.amount ?? "").trim()) return `Position „${position.label}“: Betrag fehlt.`;
    if (centsFromInput(position.amount) === null) return `Position „${position.label}“: Betrag wie 20 oder 20,50 eingeben.`;
    const productId = position.dolibarr_product_id;
    if (productId !== "" && productId !== null && productId !== undefined && !/^\d+$/.test(String(productId))) return `Position „${position.label}“: Dolibarr-Leistung ist eine Nummer.`;
  }
  if (form.positions.every((position) => position.optional)) return "Mindestens eine Position muss Pflicht sein.";
  return "";
}
