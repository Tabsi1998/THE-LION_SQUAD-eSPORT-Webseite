import { useEffect } from "react";
import { LionArt } from "./LionArt";
import { offlineLabel, useNetwork, watchBrowserNetwork } from "@/lib/network";
import { useWritePause, WRITE_PAUSE_LABEL } from "@/lib/writePause";

// Ohne Netz (#1152, wie in der App): eine schmale Leiste unter dem Kopf - „Offline · Stand 14:05“. Der zuletzt geladene
// Inhalt bleibt stehen; kommt das Netz zurück, verschwindet die Leiste von selbst.
// Dieselbe Leiste sagt während der kurzen Schreibpause fürs Backup (#1009) „gleich wieder da“ - sie verschwindet nach
// der Zeit, die der Server nennt. Offline geht vor: ohne Netz hilft der Hinweis auf die Pause nicht.

export function OfflineBar() {
  const { offline, stand } = useNetwork();
  const pause = useWritePause();
  useEffect(() => watchBrowserNetwork(), []);
  if (!offline) {
    if (!pause.active) return null;
    return (
      <div role="status" aria-live="polite" data-testid="write-pause-bar" className="tls-offline-bar">
        {/* Der schlafende Löwe: nachts kurz Pause. */}
        <LionArt art="sleep" size={24} className="shrink-0 text-honor" />
        <span>{WRITE_PAUSE_LABEL}</span>
      </div>
    );
  }
  const label = offlineLabel(stand);
  return (
    <div role="status" aria-live="polite" data-testid="offline-bar" className="tls-offline-bar">
      {/* Der Löwe mit Stecker (#1325) - derselbe wie auf der Offline-Seite. */}
      <LionArt art="offline" size={24} className="shrink-0 text-[#FFD700]" />
      <span>{label} · neu laden, sobald das Netz wieder da ist</span>
    </div>
  );
}
