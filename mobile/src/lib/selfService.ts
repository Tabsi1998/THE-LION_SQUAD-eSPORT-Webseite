// Vereinsakte in der App (#324 Teil 1, #329 Teil 2): dieselben Routen und Begriffe wie im Web.
// Reine Logik ohne React, damit sie sich ohne Gerät prüfen lässt.

export type IdentityState = {
  available?: boolean;
  status?: "none" | "bound" | "revoked" | string;
  capabilities?: string[];
  capability_labels?: string[];
  linked_at?: string | null;
  revoked_at?: string | null;
};

export type SelfProfile = {
  member_id?: number;
  ref?: string;
  firstname?: string;
  lastname?: string;
  birth?: string;
  address?: string;
  zip?: string;
  town?: string;
  country_code?: string;
  phone?: string;
  phone_mobile?: string;
  email?: string;
  member_type?: string;
  status?: string;
  version?: string;
  direct?: string[];
  exit?: { status: "planned" | "done" | string; reason?: string; notice_day?: string; last_day?: string } | null;
};

export type SelfRequest = {
  external_id: string;
  kind: "change" | "exit" | string;
  changes?: Record<string, string> | null;
  status?: string | null;
  status_label?: string | null;
  reason?: string | null;
  received_at?: string | null;
  notice_day?: string | null;
  last_day?: string | null;
  wished_last_day?: string | null;
  wished_too_early?: boolean;
};

export type SelfService = {
  available?: boolean;
  reason?: string;
  text?: string;
  profile?: SelfProfile | null;
  changeable?: string[];
  requests?: SelfRequest[];
};

export const SELF_FIELD_LABELS: Record<string, string> = {
  address: "Straße und Hausnummer", zip: "PLZ", town: "Ort", country_code: "Land (Kürzel, z. B. AT)",
  phone: "Telefon", phone_mobile: "Mobil", email: "E-Mail",
};

export function fieldLabel(key: string): string {
  return SELF_FIELD_LABELS[key] || key;
}

/** Nur, was sich gegenüber dem Profil wirklich geändert hat - das geht mit dem gesehenen Stand raus. */
export function changedFields(profile: SelfProfile, draft: Record<string, string>, changeable: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of changeable) {
    if (!(key in draft)) continue;
    const value = String(draft[key] ?? "");
    const current = String((profile as Record<string, unknown>)[key] ?? "");
    if (value !== current) out[key] = value;
  }
  return out;
}

function day(value?: string | null): string {
  if (!value) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : String(value);
}

/** Eine Einreichung in einem Satz - wie im Web. */
export function selfRequestLine(row: SelfRequest): string {
  if (row.kind === "exit") {
    return `Austritt erklärt${row.notice_day ? ` am ${day(row.notice_day)}` : ""} – letzter Tag ${day(row.last_day)}${row.wished_too_early ? " (Wunschdatum lag vor der Kündigungsfrist)" : ""}`;
  }
  const changes = Object.entries(row.changes || {}).map(([key, value]) => `${fieldLabel(key)}: ${value}`).join(", ");
  return `Änderung: ${changes}`;
}

/** Der Satz zum geplanten Austritt im Profil. */
export function exitLine(profile: SelfProfile): string {
  const exit = profile.exit;
  if (!exit) return "";
  return `Austritt ${exit.status === "done" ? "vollzogen" : "geplant"}: letzter Tag der Mitgliedschaft ${day(exit.last_day)}${exit.notice_day ? ` (Eingang ${day(exit.notice_day)})` : ""}.`;
}

/** Ein Wunschdatum muss JJJJ-MM-TT sein - sonst schickt die App es gar nicht erst. */
export function validWishedDay(value: string): boolean {
  return value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value);
}
