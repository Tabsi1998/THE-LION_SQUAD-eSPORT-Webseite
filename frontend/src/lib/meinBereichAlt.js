import { BEREICH, VEREIN_SEITEN, gruppe, vereinPfad } from "@/lib/meinBereich";

// Alte Adressen nach „Mein Bereich“ (#2059) - eigene Datei, damit die Zuordnung erst mit der Weiterleitung lädt und
// nicht im Start-JS steht.

// Alte Reiter von /profile und ihre Gruppe. „sessions“ war der Reiter für Geräte (seit #258 unter Sicherheit),
// „edit“ der Weg aus der App zum Bearbeiten.
const SETTINGS_TAB_GROUP = {
  basic: "profil", gaming: "profil", socials: "profil", edit: "profil",
  notifications: "benachrichtigungen",
  security: "konto", sessions: "konto", appearance: "konto", calendar: "konto", about: "konto",
  privacy: "datenschutz",
};
const TAB_ALIASES = { sessions: "security", edit: "basic" };
// Der erste Reiter einer Gruppe braucht kein ?tab= in der Adresse.
const DEFAULT_TABS = new Set(["basic", "notifications", "security", "privacy"]);
const INVOICE_KEY = /^d-\d{1,12}$/;

function joined(path, params, hash = "") {
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash || ""}`;
}

function profileTarget(params, hash) {
  const wanted = params.get("tab") || "";
  const rest = new URLSearchParams(params);
  rest.delete("tab");
  // Was keine Einstellung ist (#1150), hat seinen Ort woanders - unverändert.
  if (wanted === "teams") return "/teams";
  if (wanted === "friends") return "/players";
  if (wanted === "achievements" || wanted === "honours") return `/u/me?tab=${wanted}`;
  if (wanted === "inbox") return `/messages${params.get("to") ? `/${encodeURIComponent(params.get("to"))}` : ""}`;
  if (wanted === "invoices") {
    const invoice = params.get("invoice") || "";
    return `${BEREICH}/rechnungen${INVOICE_KEY.test(invoice) ? `?invoice=${invoice}` : ""}`;
  }
  if (wanted === "prizes") return `${BEREICH}/rechnungen?tab=gewinne`;
  const group = SETTINGS_TAB_GROUP[wanted] || "profil";
  const tab = TAB_ALIASES[wanted] || wanted;
  const next = new URLSearchParams();
  if (tab && SETTINGS_TAB_GROUP[wanted] && !DEFAULT_TABS.has(tab)) next.set("tab", tab);
  rest.forEach((value, key) => next.append(key, value));
  return joined(gruppe(group).path, next, hash);
}

const MEMBER_PAGES = Object.fromEntries(VEREIN_SEITEN.map((seite) => [seite.alt, seite.k]));

/**
 * Wohin eine alte Adresse führt - null, wenn sie nicht zu „Mein Bereich“ gehört. Suche (?invoice=, ?meeting=, ?event=,
 * ?link= …) und Anker (#versammlung, #mitgliedskarte, #dieser-browser) gehen mit.
 */
export function legacyTarget({ pathname = "", search = "", hash = "" } = {}) {
  const path = String(pathname || "").replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search || "");
  if (path === "/profile") return profileTarget(params, hash);
  if (path === "/privacy-account") return `${BEREICH}/datenschutz?tab=daten`;
  if (["/members/area", "/mitgliederbereich", "/member-area"].includes(path)) return joined(vereinPfad(), params, hash);
  if (path === "/members/membership") return joined(`${BEREICH}/mitgliedschaft`, params, hash);
  const member = path.match(/^\/members\/(meetings|helfen|documents|news|benefits)$/);
  if (member) return joined(vereinPfad(MEMBER_PAGES[member[1]]), params, hash);
  if (path === "/account/invoices") {
    const invoice = params.get("invoice") || "";
    return `${BEREICH}/rechnungen${INVOICE_KEY.test(invoice) ? `?invoice=${invoice}` : ""}`;
  }
  if (path === "/account/documents") return `${BEREICH}/rechnungen?tab=unterlagen`;
  if (path === "/my/prizes" || path === "/me/prizes") return `${BEREICH}/rechnungen?tab=gewinne`;
  if (path === "/my/penalties") return `${BEREICH}/rechnungen?tab=strafen`;
  return null;
}
