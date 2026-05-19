export type User = {
  id: string;
  email: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  role?: string;
  user_type?: string;
  is_club_member?: boolean;
  is_tournament_staff?: boolean;
  membership?: Record<string, unknown> | null;
};

export type AuthResponse = {
  user: User;
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

export type Tournament = {
  id: string;
  title: string;
  slug: string;
  status?: string;
  game_name?: string;
  game?: { name?: string; display_name?: string; logo_url?: string | null; cover_url?: string | null };
  event?: { name?: string; location?: string; start_date?: string | null } | null;
  description?: string | null;
  platform?: string | null;
  max_participants?: number | null;
  participant_count?: number;
  format_label?: string;
  public_phase?: { label?: string; state?: string; target_at?: string | null };
  start_date?: string | null;
  registration_enabled?: boolean;
  banner_url?: string | null;
  format?: string;
  participants?: string[];
  matches?: Match[];
  standings?: Array<{ rank: number; name: string; points?: number; result?: string }>;
  rules?: string[] | string;
  prize_pool?: string | null;
  prize_places?: Array<{ place?: number; label?: string; value?: string }> | null;
  prizes?: string[];
};

export type Team = {
  id: string;
  name: string;
  tag?: string;
  description?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  discord_link?: string | null;
  member_count?: number;
  squad_count?: number;
  leader?: { id: string; username?: string; display_name?: string; avatar_url?: string | null };
  members?: Array<{ id: string; name?: string; username?: string; display_name?: string; role?: string; avatar_url?: string | null; achievements?: string[] }>;
  squads?: Array<{ name: string; game: string; record: string }>;
  chat_preview?: Array<{ author: string; message: string; time: string }>;
};

export type Match = {
  id: string;
  status?: string;
  scheduled_at?: string | null;
  tournament_title?: string | null;
  opponent_name?: string | null;
};

export type Achievement = {
  code: string;
  name: string;
  tier: string;
  points: number;
  accent: string;
};

export type Reference = {
  id: string;
  title: string;
  game: string;
  placement: string;
  mode: string;
  date: string;
};

export type Sponsor = {
  id: string;
  name: string;
  tier: string;
  url?: string;
  link?: string;
  logo_url?: string | null;
  description: string;
};

export type Partner = {
  id: string;
  name: string;
  kind: string;
  url?: string;
  link?: string;
  logo_url?: string | null;
  description: string;
};

export type ClubEvent = {
  id: string;
  title: string;
  type: string;
  date: string;
  location: string;
  status: string;
};

export type MemberBenefit = {
  id: string;
  title: string;
  category: string;
  description: string;
  memberOnly: boolean;
};

export type PublicProfile = {
  id: string;
  name: string;
  username: string;
  role: string;
  games: string[];
  achievements: Achievement[];
};
