// Wortliste der Verwaltung (#1367, #1378): Werte aus der Datenbank als Wörter, Zahlen in richtiger Ein- und Mehrzahl.
// Grundstock für die gemeinsame Wortliste aus #1377 - neue Wörter kommen hier dazu, nicht in die Seiten.

function asCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// „1 Vertrag“, „2 Verträge“, „0 Verträge“.
export function countWord(value, one, many) {
  const number = asCount(value);
  return `${number} ${number === 1 ? one : many}`;
}

// „1-mal angesehen“, „3-mal heruntergeladen“.
export function timesDone(value, verb) {
  return `${asCount(value)}-mal ${verb}`;
}

// Sichtbarkeit eines Dokuments als Plakette: wer es sehen darf. Farben nach Farb-Rolle (#1305, wie StatusBadge):
// Grün offen für alle, Cyan Mitglieder, Orange nur der Vorstand.
const DOCUMENT_VISIBILITY = {
  public: { label: "Alle", cls: "bg-ok/15 text-ok border-ok/50" },
  members: { label: "Mitglieder", cls: "bg-brand/15 text-brand border-brand/50" },
  internal: { label: "Vorstand", cls: "bg-warn/15 text-warn border-warn/50" },
};

export function documentVisibility(value) {
  return DOCUMENT_VISIBILITY[String(value || "").toLowerCase()] || { label: "Unbekannt", cls: "bg-white/5 text-quiet border-white/10" };
}
