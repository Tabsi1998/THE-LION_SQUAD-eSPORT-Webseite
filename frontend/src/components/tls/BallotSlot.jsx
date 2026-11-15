import { Suspense } from "react";
import { useAuth } from "@/context/AuthContext";
import { lazyPage } from "@/lib/chunkReload";

// Abstimmung live (#844) nur für angemeldete Mitglieder: Das Popup samt Abruf lädt erst, wenn jemand mit Mitgliedschaft
// angemeldet ist (#936) - vorher fragte es ohnehin nichts ab (BallotPopup: active = user && isClubMember).
const BallotPopup = lazyPage(() => import("./BallotPopup").then((module) => ({ default: module.BallotPopup })));

export function BallotSlot() {
  const { user, isClubMember } = useAuth();
  if (!user || !isClubMember) return null;
  return (
    <Suspense fallback={null}>
      <BallotPopup />
    </Suspense>
  );
}
