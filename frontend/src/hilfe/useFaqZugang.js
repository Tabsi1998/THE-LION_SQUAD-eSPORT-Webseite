import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useApiInvalidation } from "@/hooks/useApiInvalidation";

// Was die Person sehen darf (#2448): GET /api/faq prüft am Server und liefert Mitglieder- bzw. Leitungs-Fragen nur
// mit Recht. Ohne Antwort (Gast offline, Fehler) bleibt es beim öffentlichen Teil - nie mehr, als der Server sagt.

export const OHNE_ZUGANG = Object.freeze({ angemeldet: false, mitglied: false, turnierleitung: false });

function gueltigeFrage(frage) {
  return Boolean(frage && typeof frage === "object" && frage.id && frage.frage && frage.antwort && frage.bereich && frage.sichtbar_fuer);
}

/** Antwort des Servers in die Form der Seite bringen: nur bekannte Rechte, nur vollständige Fragen. */
export function faqZugangAus(data) {
  const darf = data?.darf || {};
  return {
    darf: { angemeldet: darf.angemeldet === true, mitglied: darf.mitglied === true, turnierleitung: darf.turnierleitung === true },
    fragen: Array.isArray(data?.fragen) ? data.fragen.filter(gueltigeFrage).map((frage) => ({ rollen: [], ...frage })) : [],
  };
}

export function useFaqZugang() {
  const [zugang, setZugang] = useState({ darf: OHNE_ZUGANG, fragen: [], geladen: false });

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/faq");
      setZugang({ ...faqZugangAus(data), geladen: true });
    } catch {
      setZugang({ darf: OHNE_ZUGANG, fragen: [], geladen: true });
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  // An- und Abmelden ändern, was jemand sieht.
  useApiInvalidation(load, ["auth"]);
  return zugang;
}
