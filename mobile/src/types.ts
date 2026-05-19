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
  my_registration?: { id?: string; status?: string; display_name?: string | null; ingame_name?: string | null; team_id?: string | null } | null;
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
  tournament_id?: string | null;
  tournament_title?: string | null;
  opponent_name?: string | null;
  round?: number | string | null;
  round_name?: string | null;
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
  name?: string;
  slug?: string;
  type?: string;
  event_type?: string;
  date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  location?: string | null;
  city?: string | null;
  country?: string | null;
  status?: string;
  banner_url?: string | null;
  public_phase?: { label?: string; state?: string; target_at?: string | null };
  has_registration?: boolean;
  own_registration?: { id?: string; status?: string; display_name?: string | null; companion_count?: number } | null;
};

export type NewsPost = {
  id: string;
  title: string;
  slug?: string;
  excerpt?: string;
  summary?: string;
  category?: string;
  banner_url?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  pinned?: boolean;
};

export type DashboardAction = {
  id: string;
  type: string;
  label: string;
  detail?: string | null;
  target_type?: "tournament" | "event" | "match" | string;
  target_id?: string | null;
  priority?: number;
};

export type MobileDashboardData = {
  me: {
    tournaments: Tournament[];
    events: ClubEvent[];
    matches: Match[];
    actions: DashboardAction[];
  };
  public: {
    tournaments: Tournament[];
    events: ClubEvent[];
  };
  news: NewsPost[];
  stats: {
    my_tournaments: number;
    my_events: number;
    open_matches: number;
    open_actions: number;
    news: number;
    public_tournaments: number;
    public_events: number;
  };
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
