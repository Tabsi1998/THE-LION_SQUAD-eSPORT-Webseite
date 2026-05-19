import type { User } from "./types";

export const LIVE_GUEST_USER_ID = "live-public-guest";

export const liveGuestUser: User = {
  id: LIVE_GUEST_USER_ID,
  email: "live@lionsquad.at",
  username: "live_public",
  display_name: "Live-Daten",
  role: "guest",
  user_type: "public_guest",
  is_club_member: false,
  is_tournament_staff: false,
  membership: null,
};

export function isGuestUser(user?: User | null) {
  return user?.id === LIVE_GUEST_USER_ID;
}
