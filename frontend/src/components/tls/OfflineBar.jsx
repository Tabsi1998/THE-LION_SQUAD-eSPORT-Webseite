import { useEffect } from "react";
import { LionArt } from "./LionArt";
import { offlineLabel, useNetwork, watchBrowserNetwork } from "@/lib/network";

// Ohne Netz (#1152, wie in der App): eine schmale Leiste unter dem Kopf - „Offline · Stand 14:05“. Der zuletzt geladene
// Inhalt bleibt stehen; kommt das Netz zurück, verschwindet die Leiste von selbst.

export function OfflineBar() {
  const { offline, stand } = useNetwork();
  useEffect(() => watchBrowserNetwork(), []);
  if (!offline) return null;
  const label = offlineLabel(stand);
  return (
    <div role="status" aria-live="polite" data-testid="offline-bar" className="tls-offline-bar">
      {/* Der Löwe mit Stecker (#1325) - derselbe wie auf der Offline-Seite. */}
      <LionArt art="offline" size={24} className="shrink-0 text-[#FFD700]" />
      <span>{label} · neu laden, sobald das Netz wieder da ist</span>
    </div>
  );
}
