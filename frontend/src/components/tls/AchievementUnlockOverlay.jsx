import { useEffect, useRef } from "react";
import { enqueueCeremony } from "@/components/achievements/ceremony/queue";

/**
 * Verträglichkeit (E8, #618): das alte Overlay nahm `tiers` entgegen und zeichnete selbst. Jetzt reicht
 * es das Paket an die Zeremonie-Warteschlange weiter (CeremonyHost zeigt es) und ruft `onClose`, sobald
 * die Zeremonie vorbei ist. Neue Stellen rufen enqueueCeremony direkt.
 */
export function AchievementUnlockOverlay({ tiers = [], onClose, heading, sub, context = null }) {
  const lastRef = useRef("");
  useEffect(() => {
    const key = (tiers || []).map((t) => t.code).join("|");
    if (!key || key === lastRef.current) return;
    lastRef.current = key;
    enqueueCeremony(tiers, { ...(context || {}), heading, sub }, { onDone: () => { lastRef.current = ""; onClose?.(); } });
  }, [tiers, onClose, heading, sub, context]);
  return null;
}
