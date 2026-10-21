import { useEffect, useState } from "react";
import { api } from "./api";
import type { ClubReference, LineageItem } from "./references";

// Vereinsplatzierungen im Profil (#1945, wie das Mitgliederprofil im Web #1944): Die Referenzen des Vereins hängen am
// Vereinsprofil (Mitgliederverzeichnis), nicht am Konto. Die App findet es im eigenen Profil über den eigenen
// Verzeichniseintrag (/membership/me/directory), bei anderen über das öffentlich verknüpfte Konto in
// /membership/profiles. Dazu die Spuren (/reference-series/public/lineages) für „Saison ansehen“ und den Liga-Weg.
// Ohne Vereinsprofil, bei privatem Konto oder altem Server: null - der Reiter zeigt dann, was er heute zeigt.

export type MemberPlacements = { profileId: string; references: ClubReference[]; lineages: LineageItem[] };

type DirectoryEntry = { slug?: string | null } | null;
type PublicProfile = { id?: string; slug?: string | null; linked_account?: { username?: string | null } | null };

async function memberSlug(own: boolean, username: string): Promise<string | null> {
  if (own) {
    const { data } = await api.get<DirectoryEntry>("/membership/me/directory");
    return data?.slug || null;
  }
  const { data } = await api.get<PublicProfile[]>("/membership/profiles");
  const wanted = username.trim().toLowerCase();
  const match = (Array.isArray(data) ? data : []).find((item) => String(item?.linked_account?.username || "").trim().toLowerCase() === wanted);
  return match?.slug || null;
}

export async function loadMemberPlacements({ own, username }: { own: boolean; username: string }): Promise<MemberPlacements | null> {
  if (!username && !own) return null;
  try {
    const slug = await memberSlug(own, username);
    if (!slug) return null;
    const [{ data: profile }, lineages] = await Promise.all([
      api.get<{ id?: string; references?: ClubReference[] }>(`/membership/profiles/${encodeURIComponent(slug)}`),
      api.get<{ items?: LineageItem[] }>("/reference-series/public/lineages")
        .then(({ data }) => (Array.isArray(data?.items) ? data.items.filter((item) => item?.lineage?.slug && item?.seasons?.length) : []))
        .catch(() => [] as LineageItem[]),
    ]);
    if (!profile?.id) return null;
    return { profileId: profile.id, references: Array.isArray(profile.references) ? profile.references : [], lineages };
  } catch {
    return null;
  }
}

/** Lädt die Vereinsplatzierungen, sobald das Profil ein Vereinsmitglied ist (`enabled`). */
export function useMemberPlacements({ own, username, enabled }: { own: boolean; username: string; enabled: boolean }): MemberPlacements | null {
  const [data, setData] = useState<MemberPlacements | null>(null);
  useEffect(() => {
    if (!enabled) {
      setData(null);
      return undefined;
    }
    let alive = true;
    loadMemberPlacements({ own, username }).then((result) => { if (alive) setData(result); });
    return () => { alive = false; };
  }, [enabled, own, username]);
  return data;
}
