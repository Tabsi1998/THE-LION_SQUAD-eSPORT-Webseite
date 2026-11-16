import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { OHNE_ZUGANG, faqZugangAus } from ".";
import type { FaqDarf, FaqFrage } from "./types";

// Was die Person in der FAQ sehen darf (#2449, wie useFaqZugang im Web #2448): GET /api/faq prüft am Server mit dem Konto
// der App und liefert Mitglieder- bzw. Leitungsfragen nur mit Recht. Ohne Antwort - Gast offline, ein älterer Server ohne
// /api/faq (404), ein Fehler - bleibt es beim öffentlichen Teil, ohne Meldung: nie mehr, als der Server sagt.

export type FaqZugang = { darf: FaqDarf; fragen: FaqFrage[]; geladen: boolean };

export function useFaqZugang(): FaqZugang {
  const { user } = useAuth();
  const konto = user?.id ? String(user.id) : "";
  const [zugang, setZugang] = useState<FaqZugang>({ darf: OHNE_ZUGANG, fragen: [], geladen: false });

  const load = useCallback(async (aktiv: () => boolean) => {
    try {
      const { data } = await api.get("/faq");
      if (aktiv()) setZugang({ ...faqZugangAus(data), geladen: true });
    } catch {
      if (aktiv()) setZugang({ darf: OHNE_ZUGANG, fragen: [], geladen: true });
    }
  }, []);

  // An- und Abmelden ändern, was jemand sieht: mit dem Konto neu fragen, eine ältere Antwort zählt dann nicht mehr.
  useEffect(() => {
    let aktiv = true;
    setZugang({ darf: OHNE_ZUGANG, fragen: [], geladen: false });
    void load(() => aktiv);
    return () => {
      aktiv = false;
    };
  }, [konto, load]);

  return zugang;
}
