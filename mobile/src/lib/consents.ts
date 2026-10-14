import { formatDate } from "./format";

// Meine Einwilligungen (#1537) - dieselbe Route wie im Web: der Stand je Zweck aus der Mitgliederverwaltung, der Text
// der aktuellen Fassung und der Text der Fassung, der die Person zugestimmt hat (null, wenn die Website ihn nicht kennt).

export type ConsentRow = {
  code: string;
  label: string;
  state: "given" | "withdrawn" | "none";
  version: number;
  current_version: number;
  moment?: string | null;
  can_give: boolean;
  can_withdraw: boolean;
  text?: string | null;
  given_text?: string | null;
  text_changed: boolean;
};

export type ConsentsView = {
  available: boolean;
  reason?: string;
  text?: string;
  as_of?: string;
  consents?: ConsentRow[];
};

/** Ohne Anbindung oder ohne Zuordnung gibt es keinen Abschnitt - den Weg dorthin erklärt die Karte „Vereinsakte“. */
export const CONSENTS_HIDDEN = ["not_connected", "not_linked"];

/** Der Stand in Worten - wie im Web. */
export function consentStateLine(row: ConsentRow): string {
  const when = row.moment ? ` am ${formatDate(row.moment)}` : "";
  if (row.state === "given") return `Zugestimmt${when} (Fassung ${row.version})`;
  if (row.state === "withdrawn") return `Widerrufen${when}`;
  return "Noch nicht entschieden";
}
