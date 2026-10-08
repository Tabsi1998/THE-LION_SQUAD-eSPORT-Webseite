import { useEffect } from "react";
import { WifiOff } from "lucide-react";
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
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{label} · neu laden, sobald das Netz wieder da ist</span>
    </div>
  );
}
