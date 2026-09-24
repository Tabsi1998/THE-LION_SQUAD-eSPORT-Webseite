// Vereinsakte in der App (#324 Teil 1, #329 Teil 2): dieselben Routen und Begriffe wie im Web.
// Reine Logik ohne React, damit sie sich ohne Gerät prüfen lässt.

export type IdentityState = {
  available?: boolean;
  status?: "none" | "bound" | "revoked" | string;
  // "member": bestätigte Zuordnung reicht (Vereinsmodul ab 1.4.0, #531); "code": Bindung per Einladungscode.
  via?: "member" | "code" | string;
  linked?: boolean;
  member_ref?: string | null;
  module_too_old?: boolean;
  right_missing?: boolean;
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

export type WebsiteFieldOption = { code: string; label: string };

export type WebsiteField = {
  code: string;
  label: string;
  type: "text" | "textarea" | "number" | "date" | "boolean" | "select" | "multi";
  editable: boolean;
  value: unknown;
  max_length?: number;
  options?: WebsiteFieldOption[];
};

export type WebsiteProfile = {
  available?: boolean;
  reason?: string;
  text?: string;
  consent?: string;
  given?: boolean;
  fields?: WebsiteField[];
};

/** Der Wert eines Feldes als Text - Ja/Nein, Options-Bezeichnungen, Listen mit Komma. */
export function websiteFieldText(field: WebsiteField): string {
  const value = field.value;
  if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return "";
  const label = (code: unknown) => field.options?.find((o) => o.code === String(code))?.label ?? String(code);
  if (field.type === "boolean") return value ? "Ja" : "Nein";
  if (field.type === "multi" && Array.isArray(value)) return value.map(label).join(", ");
  if (field.type === "select") return label(value);
  return String(value);
}

/** Der Satz zur Sichtbarkeit - wie im Web. */
export function websiteStateLine(profile: WebsiteProfile): string {
  if (!profile.consent) return "Der Verein hat noch keine Einwilligung für das Website-Profil gewählt – dein Profil bleibt vorerst intern.";
  return profile.given
    ? "Du hast der Nennung zugestimmt: Der Verein zeigt dieses Profil im Mitgliederverzeichnis."
    : "Sichtbar wird das Profil erst, wenn du der Nennung zugestimmt hast (siehe Einwilligungen).";
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Nur änderbare Felder, deren Entwurf vom Stand abweicht - das geht als PUT raus. */
export function changedWebsiteFields(profile: WebsiteProfile, draft: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of profile.fields ?? []) {
    if (field.editable && field.code in draft && !same(draft[field.code], field.value)) out[field.code] = draft[field.code];
  }
  return out;
}
