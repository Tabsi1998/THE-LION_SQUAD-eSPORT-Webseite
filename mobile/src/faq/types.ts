// FAQ in der App (#2449): dieselben Felder wie die FAQ der Website (frontend/src/hilfe, #2448) und GET /api/faq
// (backend/services/faq_protected.py). Bilder und Schleifen der Anleitungen gibt es nur im Web - die App verlinkt dorthin.

export type FaqSichtbarkeit = "alle" | "angemeldet" | "mitglied" | "helfer" | "turnierleitung" | "turnierleitung_verwaltung";

export type FaqLink = { to: string; label: string };

export type FaqBereich = {
  id: string;
  titel: string;
  kurz: string;
  icon: string;
  rollen: string[];
  sichtbar_fuer: string;
};

export type FaqFrage = {
  id: string;
  frage: string;
  antwort: string;
  bereich: string;
  rollen: string[];
  sichtbar_fuer: string;
  haeufig?: boolean;
  link?: FaqLink;
};

export type FaqSchritt = { id: string; titel: string; text: string; hinweis?: string };

export type FaqAbschnitt = { id: string; titel: string; bereich?: string; schritte: FaqSchritt[] };

export type FaqThema = {
  slug: string;
  titel: string;
  kurz: string;
  zielgruppe?: string;
  bereich: string;
  rollen: string[];
  sichtbar_fuer: string;
  suchbegriffe?: string[];
  abschnitte: FaqAbschnitt[];
};

/** Was die Person sehen darf - sagt allein der Server (GET /api/faq). */
export type FaqDarf = {
  angemeldet: boolean;
  mitglied: boolean;
  /** Mitglied oder aktiver Helfer-Einsatz bei einem Turnier. */
  helfer: boolean;
  turnierleitung: boolean;
  turnierleitung_verwaltung: boolean;
};
