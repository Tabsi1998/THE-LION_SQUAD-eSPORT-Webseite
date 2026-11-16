import { useEffect, useState } from "react";

// Schmaler Bildschirm (unter 768 px, Tailwind „md“): Listen zeigen dort Karten statt einer Tabelle zum Wischen (#1384).
// Nur eine der beiden Formen steht im DOM - Suche, Vorlesen und Tests finden jeden Eintrag einmal. Ohne matchMedia
// (Server, alte Umgebung) gilt „breit“.
const QUERY = "(max-width: 767px)";

function narrowNow() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(QUERY).matches;
}

export function useNarrowScreen() {
  const [narrow, setNarrow] = useState(narrowNow);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const media = window.matchMedia(QUERY);
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return narrow;
}
