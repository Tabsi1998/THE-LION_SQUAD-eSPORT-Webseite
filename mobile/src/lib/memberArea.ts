// Mitgliederbereich in der App (#340, #339, #342): dieselbe Auswahl wie im Web
// (frontend/src/lib/memberArea.js), damit Web und App dasselbe zeigen. Ohne React, damit es
// sich testen lässt. Was jemand sehen darf, entscheidet der Server – hier wird nur sortiert.

const MEMBER_LEVELS = new Set(["members", "internal"]);

type WithVisibility = { visibility?: string | null };
type EventLike = WithVisibility & { id?: string; start_date?: string | null; end_date?: string | null };
type NewsLike = WithVisibility & { id?: string };

function toTime(value?: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Ein Inhalt nur für Mitglieder oder den Vorstand – bekommt das Kennzeichen „Intern“. */
export function isInternal(item?: WithVisibility | null): boolean {
  return MEMBER_LEVELS.has(String(item?.visibility || ""));
}

export function internalLabel(item?: WithVisibility | null): string | null {
  if (item?.visibility === "internal") return "Vorstand";
  if (item?.visibility === "members") return "Intern";
  return null;
}

/** Interne Events, die noch anstehen, nach Datum. */
export function memberEvents<T extends EventLike>(events: T[] | null | undefined, now: Date = new Date()): T[] {
  const cutoff = now.getTime();
  return (Array.isArray(events) ? events : [])
    .filter((event) => isInternal(event))
    .filter((event) => {
      const start = toTime(event.start_date);
      const end = toTime(event.end_date) ?? start;
      return start === null || end === null || end >= cutoff;
    })
    .sort((a, b) => (toTime(a.start_date) ?? Infinity) - (toTime(b.start_date) ?? Infinity));
}

export function memberNews<T extends NewsLike>(posts: T[] | null | undefined, limit = 3): T[] {
  return (Array.isArray(posts) ? posts : []).filter((post) => isInternal(post)).slice(0, limit);
}

export type BoardPosition = {
  id?: string;
  is_active?: boolean;
  display_title?: string | null;
  title_male?: string | null;
  user?: { display_name?: string | null; gamertag?: string | null; username?: string | null; avatar_url?: string | null; photo_url?: string | null; slug?: string | null } | null;
};

export type BoardContact = { id: string; title: string; name: string; avatar: string; username: string | null };

/** Ansprechpartner: nur besetzte Posten, in der Reihenfolge des Vorstands. */
export function boardContacts(positions: BoardPosition[] | null | undefined, limit = 4): BoardContact[] {
  return (Array.isArray(positions) ? positions : [])
    .filter((position) => position?.user && position.is_active !== false)
    .map((position, index) => ({
      id: position.id || String(index),
      title: position.display_title || position.title_male || "",
      name: position.user?.display_name || position.user?.gamertag || position.user?.username || "",
      avatar: position.user?.avatar_url || position.user?.photo_url || "",
      username: position.user?.username || null,
    }))
    .slice(0, limit);
}

/** Filter „Alle / Verein“ in Listen (#342). */
export type ScopeFilter = "all" | "club";

export function applyScope<T extends WithVisibility>(items: T[], scope: ScopeFilter): T[] {
  return scope === "club" ? items.filter((item) => isInternal(item)) : items;
}

// ---------------------------------------------------------------- Meine Mitgliedschaft (#339)

export type FeeView = {
  required?: boolean;
  status?: string | null;
  next_due?: string | null;
  amount?: number | null;
  currency?: string;
  discount?: { kind?: string; label?: string } | null;
  payer?: string;
};

export type DolibarrView = {
  connected?: boolean;
  led_by_dolibarr?: boolean;
  as_of?: string | null;
  stale?: boolean;
  member_ref?: string | null;
  type_label?: string | null;
  paid_until?: string | null;
  membership_ends?: string | null;
  fee?: FeeView | null;
  functions?: Array<{ label?: string | null; since?: string | null }>;
  link?: { status?: string; requested_at?: string | null } | null;
} | null;

export const FEE_STATUS_LABELS: Record<string, string> = {
  paid: "bezahlt", invoiced: "Rechnung offen", due: "fällig", not_required: "kein Beitrag nötig", inactive: "ruht",
};

function formatDay(value?: string | null): string {
  if (!value) return "–";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("de-DE");
}

export function formatMoney(amount?: number | null, currency = "EUR"): string {
  if (amount === null || amount === undefined) return "–";
  try {
    return new Intl.NumberFormat("de-AT", { style: "currency", currency }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export type FeeCard = { label: string; tone: "ok" | "warn" | "info"; amount: string | null; lines: string[]; asOf: string | null; stale: boolean };

/** Dieselben Sätze wie auf der Website (frontend/src/lib/dolibarr.js, feeCard). */
export function feeCard(view: DolibarrView): FeeCard | null {
  if (!view?.led_by_dolibarr || !view.fee) return null;
  const fee = view.fee;
  const lines: string[] = [];
  if (view.paid_until) lines.push(`Bezahlt bis ${formatDay(view.paid_until)}`);
  if (fee.status === "due" || fee.status === "invoiced") {
    lines.push(fee.next_due ? `Nächster Beitrag seit ${formatDay(fee.next_due)} offen` : "Beitrag offen");
  } else if (fee.next_due && fee.status === "paid") {
    lines.push(`Nächster Beitrag ab ${formatDay(fee.next_due)}`);
  }
  if (fee.payer === "other") lines.push("Den Beitrag zahlt eine andere Person für dich (z. B. Familie).");
  if (fee.discount?.kind && fee.discount.kind !== "none" && fee.discount.label) lines.push(`Ermäßigung: ${fee.discount.label}`);
  if (view.membership_ends) lines.push(`Mitgliedschaft endet am ${formatDay(view.membership_ends)}`);
  return {
    label: FEE_STATUS_LABELS[String(fee.status)] || String(fee.status || ""),
    tone: fee.status === "due" ? "warn" : fee.status === "invoiced" ? "info" : "ok",
    amount: fee.required ? formatMoney(fee.amount, fee.currency || "EUR") : null,
    lines,
    asOf: view.as_of || null,
    stale: Boolean(view.stale),
  };
}

export const STATUS_LABELS: Record<string, string> = {
  active: "Aktives Mitglied", honorary: "Ehrenmitglied", pending: "Antrag offen", inactive: "Ruhend",
  former: "Ehemalig", blocked: "Gesperrt", none: "Keine Mitgliedschaft",
};

export const TYPE_LABELS: Record<string, string> = {
  ordinary: "Ordentlich", supporting: "Unterstützend", honorary: "Ehrenmitglied", youth: "Jugend", guest: "Gast", former: "Ehemalig",
};

/** Ob und wie „Zuordnung anfragen“ angeboten wird. */
export function linkPrompt(view: DolibarrView): "ask" | "requested" | "conflict" | null {
  if (!view?.connected || view.led_by_dolibarr) return null;
  if (view.link?.status === "requested") return "requested";
  if (view.link?.status === "conflict") return "conflict";
  if (view.link?.status === "verified") return null;
  return "ask";
}
