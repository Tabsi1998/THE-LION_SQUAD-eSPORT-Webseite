import { Suspense, useState, useSyncExternalStore } from "react";
import { lazyPage } from "@/lib/chunkReload";
import { ceremonyQueue } from "./queue";

// Zeremonien erst bei Bedarf laden (#936): Der Host samt Erfolgs-Abzeichen, Motiven, Klängen, Sieger- und
// Belohnungs-Moment ist rund 25 KB gzip groß, gebraucht wird er nur, wenn wirklich etwas in der Warteschlange steht -
// beim anonymen Besuch praktisch nie. Die Hülle liest nur die Warteschlange; sobald dort etwas steht, lädt sie den Host
// und behält ihn. Er entscheidet wie bisher, ob und wann gezeigt wird (still im Adminbereich, „dezent“ usw.).
const CeremonyHost = lazyPage(() => import("./CeremonyHost").then((module) => ({ default: module.CeremonyHost })), { optional: true });

export function CeremonySlot({ queue = ceremonyQueue }) {
  const current = useSyncExternalStore(queue.subscribe, queue.getCurrent, () => null);
  const [needed, setNeeded] = useState(Boolean(current));
  if (current && !needed) setNeeded(true);
  if (!needed) return null;
  return (
    <Suspense fallback={null}>
      <CeremonyHost queue={queue} />
    </Suspense>
  );
}
