// Mindestalter (#1698, Fabians Entscheidung vom 16.11.): Vereinsmitglied ab 18, Konto ab 14 (Art. 8 DSGVO, Österreich).
// Geprüft wird beim Beitrittsantrag am Server (services/membership_age.py); hier stehen nur die Sätze dazu - eine Stelle
// für Beitritt, Antrag und Registrierung.

export const MEMBERSHIP_MIN_AGE = 18;
export const ACCOUNT_MIN_AGE = 14;

export const MEMBERSHIP_AGE_TEXT = `Vereinsmitglied wirst du ab ${MEMBERSHIP_MIN_AGE} Jahren.`;
export const ACCOUNT_AGE_TEXT = `Ein Konto kannst du ab ${ACCOUNT_MIN_AGE} Jahren anlegen. Vereinsmitglied wirst du ab ${MEMBERSHIP_MIN_AGE} Jahren.`;
export const BIRTH_MISSING_TEXT = `Geburtsdatum fehlt. ${MEMBERSHIP_AGE_TEXT}`;
