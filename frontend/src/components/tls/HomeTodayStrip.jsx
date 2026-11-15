import { Suspense, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { lazyPage } from "@/lib/chunkReload";
import { OptionalBoundary } from "@/components/tls/OptionalBoundary";
import { todayItems } from "@/lib/homeToday";

// „Heute im Einsatz“ (#1753): an Renn- und Spieltagen ein schmaler Streifen über dem Kopf der Startseite - je Saison
// mit heutigem Termin eine Karte (Serie, Saison, Runde, Uhrzeit, gemeldete Vereinsleute), die zur Serienseite mit der
// Tabelle führt. Gestaltet wie die Karten „Läuft gerade“ der Referenzen-Übersicht: goldener Chip „Heute“ mit dezentem
// Puls, Karten blenden gestaffelt ein. Mit „Bewegung reduzieren“ stehen Puls und Einblenden still (index.css,
// .tls-run-*). Steht heute nichts an oder scheitert der Abruf, gibt es den Streifen nicht - die Seite bleibt wie sie ist.
// Runde mit Läufen (#1930): statt „Rennen R3“ der heutige Lauf („R3 · Qualifying“), darunter die Lauf-Chips der Runde.
// Start-Bundle (#936): Hier steht nur der Abruf; die Karten (HomeTodayCards.jsx) laden erst, wenn heute etwas ansteht.
const HomeTodayCards = lazyPage(() => import("@/components/tls/HomeTodayCards"));

export function HomeTodayStrip() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get("/reference-series/public/running")
      .then(({ data }) => { if (alive) setItems(todayItems(data)); })
      .catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);
  if (!items.length) return null;
  return (
    // Laden die Karten nicht, bleibt es wie an Tagen ohne Termin: kein Streifen (#936).
    <OptionalBoundary quiet>
      <Suspense fallback={null}>
        <HomeTodayCards items={items} />
      </Suspense>
    </OptionalBoundary>
  );
}
