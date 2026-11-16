import { NavigationContext } from "@react-navigation/native";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { api } from "../lib/api";
import { OHNE_ZUGANG, faqZugangAus } from ".";
import type { FaqDarf, FaqFrage } from "./types";

// Was die Person in der FAQ sehen darf (#2449, wie useFaqZugang im Web #2448): GET /api/faq prüft am Server mit dem Konto
// der App und liefert Mitglieder-, Helfer- bzw. Leitungsfragen nur mit Recht. Ohne Antwort - Gast offline, ein älterer
// Server ohne /api/faq (404), ein Fehler - bleibt es beim öffentlichen Teil, ohne Meldung: nie mehr, als der Server sagt.
//
// Kontowechsel: Der Stand gehört zu einem Konto. Schon im ersten Bild nach dem Wechsel zählt der alte nicht mehr, und eine
// verspätete Antwort für das alte Konto wird verworfen. Rechte ändern sich auch im selben Konto (Mitglied geworden,
// Helfer-Einsatz): Kommt die FAQ wieder nach vorn, fragt sie neu - der bisherige Stand bleibt bis zur Antwort stehen.

export type FaqZugang = { darf: FaqDarf; fragen: FaqFrage[]; geladen: boolean };
type Stand = FaqZugang & { konto: string };

const LEER: FaqZugang = Object.freeze({ darf: OHNE_ZUGANG, fragen: [], geladen: false });
/** So kurz nach einem Abruf löst das Nach-vorn-Kommen keinen zweiten aus (der erste Fokus beim Öffnen). */
export const FOKUS_RUHE_MS = 1000;

export function useFaqZugang(): FaqZugang {
  const { user } = useAuth();
  const navigation = useContext(NavigationContext);
  const konto = user?.id ? String(user.id) : "";
  const [stand, setStand] = useState<Stand>(() => ({ ...LEER, konto }));
  // Jeder Abruf bekommt eine Nummer; nur der jüngste darf den Stand setzen.
  const runde = useRef(0);
  const letzterStart = useRef(0);

  const load = useCallback(async () => {
    const meine = ++runde.current;
    letzterStart.current = Date.now();
    try {
      const { data } = await api.get("/faq");
      if (runde.current === meine) setStand({ ...faqZugangAus(data), geladen: true, konto });
    } catch {
      // Im selben Konto bleibt ein geladener Stand; sonst nur das Öffentliche.
      if (runde.current === meine) setStand((prev) => (prev.konto === konto && prev.geladen ? prev : { ...LEER, geladen: true, konto }));
    }
  }, [konto]);

  useEffect(() => {
    void load();
    return () => {
      // Neues Konto oder Screen zu: eine noch offene Antwort zählt nicht mehr.
      runde.current += 1;
    };
  }, [load]);

  // Ohne Navigation (einzelner Test) gibt es kein Nach-vorn-Kommen.
  useEffect(() => {
    if (!navigation?.addListener) return undefined;
    return navigation.addListener("focus", () => {
      if (Date.now() - letzterStart.current >= FOKUS_RUHE_MS) void load();
    });
  }, [load, navigation]);

  return stand.konto === konto ? stand : LEER;
}
