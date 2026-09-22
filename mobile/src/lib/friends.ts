// Freundschaften in der App (#240): dieselben Zustände wie das Web, aus
// GET /friends/status/{user_id} und GET /friends - reine Rechnung, damit sie sich testen lässt.

export type FriendUser = { id: string; username?: string; display_name?: string; avatar_url?: string | null; role?: string };

export type Relationship = {
  id?: string;
  status: string;
  incoming?: boolean;
  outgoing?: boolean;
  can_request?: boolean;
};

export type FriendRow = {
  id: string;
  status: string;
  incoming?: boolean;
  outgoing?: boolean;
  user: FriendUser | null;
  updated_at?: string;
};

export type FriendsPayload = { friends: FriendRow[]; incoming: FriendRow[]; outgoing: FriendRow[] };

export type FriendAction = "request" | "accept" | "decline" | "cancel" | "remove" | "none";

/** Was der Knopf im öffentlichen Profil zeigt und tut. */
export function friendButton(relationship: Relationship | null | undefined): { label: string; action: FriendAction; secondary?: { label: string; action: FriendAction } } {
  const status = relationship?.status || "none";
  if (status === "self" || status === "anonymous") return { label: "", action: "none" };
  if (status === "accepted") return { label: "Freunde", action: "remove" };
  if (status === "pending" && relationship?.incoming) return { label: "Anfrage annehmen", action: "accept", secondary: { label: "Ablehnen", action: "decline" } };
  if (status === "pending" && relationship?.outgoing) return { label: "Anfrage gesendet", action: "cancel" };
  if (relationship?.can_request === false && status !== "none") return { label: "", action: "none" };
  return { label: "Freund hinzufügen", action: "request" };
}

/** Pfad und Methode je Aktion - so ruft der Knopf das Backend. */
export function friendRequest(action: FriendAction, userId: string, friendshipId?: string | null): { method: "post" | "delete"; path: string } | null {
  if (action === "request") return { method: "post", path: `/friends/${userId}/request` };
  if (action === "accept" && friendshipId) return { method: "post", path: `/friends/${friendshipId}/accept` };
  if (action === "decline" && friendshipId) return { method: "post", path: `/friends/${friendshipId}/decline` };
  if (action === "cancel" || action === "remove") return { method: "delete", path: `/friends/${userId}` };
  return null;
}

export function emptyFriends(): FriendsPayload {
  return { friends: [], incoming: [], outgoing: [] };
}

export function normalizeFriends(data: Partial<FriendsPayload> | null | undefined): FriendsPayload {
  const rows = (list?: FriendRow[]) => (Array.isArray(list) ? list.filter((row) => row && row.user) : []);
  return { friends: rows(data?.friends), incoming: rows(data?.incoming), outgoing: rows(data?.outgoing) };
}

export function friendLabel(user: FriendUser | null | undefined): string {
  return user?.display_name || user?.username || "Spieler";
}
