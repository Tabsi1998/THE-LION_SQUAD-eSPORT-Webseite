import type { NewsResult, NewsSignup } from "./lib/newsCards";

export type User = {
  id: string;
  email: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
  discord_name?: string | null;
  game_ids?: Record<string, Record<string, string>>;
  role?: string;
  user_type?: string;
  is_club_member?: boolean;
  is_tournament_staff?: boolean;
  /** Bereiche der Verwaltung (#287) - „club“ zeigt den Einlass (#845). Der Server prüft jede Antwort selbst. */
  areas?: string[];
  membership?: Record<string, unknown> | null;
  newsletter_consent?: boolean;
  notification_preferences?: Record<string, boolean>;
  seasonal_decorations?: "on" | "subtle" | "off";  // Saisonale Deko für mich (#632)
  consent_required?: boolean;
  required_privacy_policy_version?: string;
  required_terms_version?: string;
};

export type AuthResponse = {
  user: User;
  access_token: string;
  refresh_token: string;
  token_type: "bearer";
};

// Startgeld (#319): was die Website öffentlich über den Preis sagt - keine Dolibarr-Nummern.
export type TournamentOffer = {
  enabled: boolean;
  currency?: string;
  positions: Array<{ key: string; label: string; description?: string | null; amount_cents: number; basis: string; optional?: boolean }>;
};

export type TournamentPrice = {
  total_cents: number;
  currency?: string;
  billing_status?: string;
  invoice_ref?: string | null;
  invoice_status?: string | null;
  payment_state?: string | null;
  payer_user_id?: string | null;
};

// Eine Event-Anmeldung, wie der Server sie zeigt (#396, #397): E-Mail, Notiz und Preis stehen nur
// an der eigenen Anmeldung und in der Sicht der Verwaltung.
export type EventRegistration = {
  id?: string;
  user_id?: string | null;
  display_name?: string | null;
  status?: string;
  companion_count?: number;
  seat_count?: number;
  note?: string | null;
  internal_note?: string | null;
  email?: string | null;
  price?: TournamentPrice | null;
  created_at?: string | null;
  // Ob die eigene Anmeldung noch zurückgezogen werden kann (#1223): bis zum Beginn, nicht nach dem Check-in.
  can_cancel?: boolean;
};

export type Tournament = {
  id: string;
  title: string;
  slug: string;
  // Darf diese Person hier Ergebnisse eintragen (Turnierleitung oder Helfer mit Ergebnis-Recht)? Der Server sagt es.
  can_manage_results?: boolean;
  status?: string;
  game_name?: string;
  // Spiel des Turniers - mit ihm gibt es einen Map-Pool (#1616).
  game_id?: string | null;
  game?: {
    name?: string;
    display_name?: string;
    logo_url?: string | null;
    cover_url?: string | null;
    slug?: string;
    identity_game_name?: string;
    identity_game_slug?: string;
    effective_player_id_fields?: Array<{ key: string; label?: string; required?: boolean; help_text?: string }>;
    player_id_fields?: Array<{ key: string; label?: string; required?: boolean; help_text?: string }>;
  };
  // Das Event als Klammer (#1182): zu welchem Event das Turnier gehört.
  event_id?: string | null;
  event?: { id?: string; name?: string; location?: string; start_date?: string | null } | null;
  description?: string | null;
  platform?: string | null;
  max_participants?: number | null;
  participant_count?: number;
  // Länge der Warteliste (#1941) - nur die Zahl; ältere Server schicken sie nicht.
  waitlist_count?: number | null;
  check_in_closed_at?: string | null;
  format_label?: string;
  public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  start_date?: string | null;
  end_date?: string | null;
  completed_at?: string | null;
  results_published_at?: string | null;
  updated_at?: string | null;
  registration_enabled?: boolean;
  registration_open_from?: string | null;
  registration_open_until?: string | null;
  check_in_from?: string | null;
  check_in_until?: string | null;
  // Vor Ort (#1135) checkt die Turnierleitung ein - kein Knopf „Jetzt einchecken“, sondern der Hinweis.
  event_mode?: "online" | "local" | "hybrid" | string | null;
  self_checkin?: boolean;
  is_invite_only?: boolean;
  block_club_member_registration?: boolean;
  /** Turnier nur mit Event-Anmeldung (#875) - `event_gate` sagt, zu welchem Event und ob die ansehende Person dort angemeldet ist. */
  requires_event_registration?: boolean;
  event_gate?: { required: boolean; event: { id: string; name?: string | null; slug?: string | null }; registered: boolean; team_need: number } | null;
  team_mode?: string;
  team_size?: number;
  offer?: TournamentOffer | null;
  show_chat?: boolean;
  banner_url?: string | null;
  format?: string;
  // Weiterkommen in vier Modi (#1590): der Server liest auch den alten Schalter und liefert immer den Modus.
  advancement_mode?: "fixed" | "draw_round" | "draw_show" | "instant" | null;
  randomize_advancement_rounds?: boolean | null;
  participants?: string[];
  matches?: Match[];
  standings?: Array<{ rank: number; name: string; points?: number; result?: string }>;
  rules?: string[] | string;
  prize_pool?: string | null;
  prize_places?: Array<{ group?: string | null; place?: number | string; label?: string; value?: string }> | null;
  prizes?: string[];
  my_registration?: { id?: string; status?: string; display_name?: string | null; ingame_name?: string | null; team_id?: string | null; user_id?: string | null } | null;
  // Event-Seite als Startpunkt (#1183): der eigene Stand (auch mit dem Team) und der Tag des Events.
  my_status?: { state?: string; label: string; team_name?: string | null } | null;
  event_day?: { index: number; count: number; label?: string; date?: string } | null;
};

export type Team = {
  id: string;
  name: string;
  tag?: string;
  description?: string | null;
  logo_url?: string | null;
  banner_url?: string | null;
  discord_link?: string | null;
  join_code?: string | null;
  is_public?: boolean;
  is_member?: boolean;
  member_count?: number;
  squad_count?: number;
  leader?: { id: string; username?: string; display_name?: string; avatar_url?: string | null };
  leader_id?: string | null;
  co_leader_ids?: string[];
  member_ids?: string[];
  can_manage?: boolean;
  // Was die Person am Team darf (#1479) - der Server rechnet es mit denselben Regeln wie die Aktionen, für Admin-Rollen
  // also nur mit bestätigter Zwei-Faktor-Anmeldung. `admin_needs_second_factor`: nur die fehlt.
  can_remove_members?: boolean;
  can_dissolve?: boolean;
  admin_needs_second_factor?: boolean;
  my_role?: string;
  // Team-Farbe (#1347): einer der acht Schlüssel aus lib/teamColors oder „auto“ (Farbe des Spiels).
  color?: string | null;
  members?: Array<{ id: string; name?: string; username?: string; display_name?: string; role?: string; avatar_url?: string | null; achievements?: string[] }>;
  squads?: TeamSquad[];
};

export type TeamSquad = {
  id?: string;
  team_id?: string;
  name: string;
  description?: string | null;
  tournament_id?: string | null;
  season_id?: string | null;
  game_id?: string | null;
  game?: string | null;
  record?: string | null;
  member_ids?: string[];
  members?: Array<{ id: string; username?: string; display_name?: string; avatar_url?: string | null }>;
  status?: "active" | "archived" | string;
};

export type TeamInvite = {
  id: string;
  team_id: string;
  user_id: string;
  status?: string;
  created_at?: string;
  team?: Pick<Team, "id" | "name" | "tag" | "logo_url"> | null;
  inviter?: { id?: string; username?: string; display_name?: string; avatar_url?: string | null } | null;
};

export type Match = {
  id: string;
  collection?: "matches" | "matches_v2" | string;
  status?: string;
  scheduled_at?: string | null;
  tournament_id?: string | null;
  tournament_title?: string | null;
  tournament_slug?: string | null;
  opponent_name?: string | null;
  participant_names?: string[];
  participant_count?: number;
  round?: number | string | null;
  round_name?: string | null;
  match_key?: string | null;
  station_id?: string | null;
  station_label?: string | null;
  // Station im Klartext vom Server (#1220): „Station 3 · Switch 2“.
  station_text?: string | null;
  is_own_match?: boolean;
  can_submit_result?: boolean;
  needs_result?: boolean;
  // In Klärung (#1134): ein Dispute liegt vor - die Turnierleitung entscheidet.
  disputed?: boolean;
  // Was für die eigene Seite zu tun ist (#1139): Ergebnis melden oder bestätigen.
  report_task?: "report" | "confirm" | null;
};

export type Achievement = {
  code: string;
  name: string;
  tier: string;
  points: number;
  accent: string;
};

// Vereinsreferenzen aus /api/references: Typen in lib/references.ts (#1945, ClubReference).

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
  // public | community | members | internal - der Server liefert nur, was die Person sehen darf (#342)
  visibility?: string | null;
  // Mehrere Standorte (#203); ein Event mit einem Ort hat genau einen Eintrag aus den Feldern oben.
  locations?: EventLocation[];
  // Mehrtägig (#884): die Tage mit fertigen Texten vom Server - null bei einem Tag.
  schedule?: EventSchedule | null;
  banner_url?: string | null;
  public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  has_registration?: boolean;
  registration_url?: string | null;
  registration_opens_at?: string | null;
  registration_closes_at?: string | null;
  allow_companions?: boolean;
  max_companions_per_registration?: number | null;
  own_registration?: EventRegistration | null;
  // Kosten am Event (#396) - dieselbe Form wie das Startgeld am Turnier, ohne Dolibarr-Nummern.
  offer?: TournamentOffer | null;
  // Teilnehmer (#397): "staff" mit Status und Begleitpersonen, "public" nur Namen, "none" gar nicht.
  registrations?: EventRegistration[];
  participant_view?: "staff" | "public" | "none";
  can_check_in?: boolean;
  content_embeds?: ContentEmbed[];
  // Kopfbild (#1273) und Fakten-Kasten (#1346).
  banner?: { url: string; kind: "photo" | "logo"; focus_x?: number; focus_y?: number } | null;
  bring_along?: string[];
  highlights?: Array<{ icon: string; text: string }>;
  map_query?: string | null;
  address?: string | null;
  postal_code?: string | null;
  is_online?: boolean;
  is_hybrid?: boolean;
};

export type EventScheduleDay = {
  index: number;
  date: string;
  label: string;
  time_label: string;
  start: string;
  end: string;
  door?: string | null;
  title?: string | null;
  location_key?: string | null;
  location_name?: string | null;
  start_at: string;
  end_at: string;
  door_at?: string | null;
  ends_next_day?: boolean;
  state: "past" | "running" | "next" | "upcoming";
};

export type EventSchedule = {
  multi_day: boolean;
  count: number;
  label: string;
  range_label: string;
  days: EventScheduleDay[];
  now: { state: "before" | "running" | "break" | "after"; day_index?: number | null; text: string };
  next_at?: string | null;
};

export type EventLocation = {
  key?: string;
  name?: string | null;
  address_line?: string | null;
  map_query?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  door_time?: string | null;
  max_participants?: number | null;
  note?: string | null;
};

export type NewsPost = {
  id: string;
  title: string;
  slug?: string;
  excerpt?: string;
  summary?: string;
  content?: string;
  body?: string;
  category?: string;
  visibility?: string | null;
  banner_url?: string | null;
  published_at?: string | null;
  created_at?: string | null;
  pinned?: boolean;
  // Stand der Anmeldung je verknüpftem Turnier bzw. Event (#1912, vom Server wie im Web) für die Anmelde-Karten.
  linked_events?: Array<ClubEvent & { signup?: NewsSignup | null }>;
  linked_f1_challenges?: F1Challenge[];
  linked_tournaments?: Array<Tournament & { signup?: NewsSignup | null }>;
  content_embeds?: ContentEmbed[];
  mentioned_users?: PublicUser[];
  // Ergebnis-News (#1912): Sieger des verknüpften Turniers, nur wenn der Server ihn mitliefert.
  result?: NewsResult | null;
};

export type ContentEmbed = {
  token: string;
  kind: "event" | "fastlap" | "tournament" | string;
  ref: string;
  item?: {
    id?: string;
    slug?: string;
    title?: string;
    name?: string;
    description?: string | null;
    start_date?: string | null;
    status?: string;
    banner_url?: string | null;
    track_image_url?: string | null;
    track?: { id?: string; slug?: string; name?: string; image_url?: string | null } | null;
    location?: string | null;
    public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  } | null;
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

export type DashboardSeason = {
  id: string;
  slug?: string | null;
  name?: string | null;
  participant_count?: number | null;
  my_rank?: number | null;
  my_points?: number | null;
  leader?: { display_name?: string | null; points?: number | null } | null;
};

export type MobileDashboardData = {
  me: {
    tournaments: Tournament[];
    events: ClubEvent[];
    matches: Match[];
    staff_matches: Match[];
    actions: DashboardAction[];
  };
  public: {
    tournaments: Tournament[];
    events: ClubEvent[];
  };
  news: NewsPost[];
  streams: LiveStream[];
  season?: DashboardSeason | null;
  stats: {
    my_tournaments: number;
    my_events: number;
    open_matches: number;
    staff_matches: number;
    open_actions: number;
    news: number;
    public_tournaments: number;
    public_events: number;
    live_streams: number;
  };
};

export type LiveStream = {
  user_id?: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  twitch_login?: string | null;
  title?: string | null;
  game_name?: string | null;
  viewer_count?: number;
  thumbnail_url?: string | null;
  stream_url?: string | null;
  public_profile_url?: string | null;
  member_profile?: {
    id?: string;
    slug?: string;
    display_name?: string | null;
    gamertag?: string | null;
    photo_url?: string | null;
  } | null;
};

export type PersonalReferenceItem = {
  id: string;
  kind: "tournament" | "fastlap" | string;
  title: string;
  subtitle?: string | null;
  rank?: number | null;
  points?: number | null;
  status?: string | null;
  date?: string | null;
  target_id?: string | null;
  banner_url?: string | null;
  participant_count?: number | null;
  time_ms?: number | null;
  time_str?: string | null;
};

export type PersonalReferenceData = {
  items: PersonalReferenceItem[];
  stats: {
    total: number;
    tournaments: number;
    fastlaps: number;
    wins: number;
    podiums: number;
  };
};

export type PrizePickup = {
  id: string;
  status?: string | null;
  place?: number | string | null;
  place_label?: string | null;
  prize_label?: string | null;
  prize_value?: string | null;
  pickup_deadline?: string | null;
  ready_at?: string | null;
  picked_up_at?: string | null;
  source_type?: "tournament" | "fastlap" | string | null;
  source_url?: string | null;
  tournament_id?: string | null;
  tournament_title?: string | null;
  tournament_slug?: string | null;
  fastlap_challenge_id?: string | null;
  fastlap_challenge_title?: string | null;
  fastlap_challenge_slug?: string | null;
  fastlap_source_label?: string | null;
  fastlap_track_name?: string | null;
  // Verlosung (#641): ein Gewinn aus dem Adventkalender - „Türchen 12“ statt einem Platz.
  season_source_label?: string | null;
  recipient_type?: "user" | "team" | string | null;
  recipient_label?: string | null;
};

export type F1Track = {
  id: string;
  name?: string;
  country?: string | null;
  image_url?: string | null;
  order_index?: number;
  // Plausible Zeiten je Strecke (#1584) - leer heißt Standard (20 Sekunden bis 10 Minuten).
  min_plausible_ms?: number | null;
  max_plausible_ms?: number | null;
};

export type F1Challenge = {
  id: string;
  // Das Event als Klammer (#1182): zu welchem Event die Fast Lap gehört.
  event_id?: string | null;
  // Event-Seite als Startpunkt (#1183): der eigene Stand (auch mit dem Team) und der Tag des Events.
  my_status?: { state?: string; label: string; team_name?: string | null } | null;
  event_day?: { index: number; count: number; label?: string; date?: string } | null;
  slug?: string;
  title: string;
  description?: string | null;
  status?: string;
  public_phase?: { countdown_kind?: string | null; label?: string; state?: string; target_at?: string | null };
  online_registration_enabled?: boolean;
  registration_enabled?: boolean;
  registration_open_from?: string | null;
  registration_open_until?: string | null;
  block_club_member_results?: boolean;
  allow_club_reference_times?: boolean;
  show_club_reference_times?: boolean;
  start_date?: string | null;
  end_date?: string | null;
  banner_url?: string | null;
  vehicle?: string | null;
  weather?: string | null;
  platform?: string | null;
  prize_places?: Array<{ group?: string | null; place?: number | string; label?: string; value?: string }> | null;
  prize_pool?: string | null;
  participant_count?: number;
  track_count?: number;
  tracks?: F1Track[];
  can_manage_times?: boolean;
};

export type F1LeaderboardEntry = {
  // Gäste ohne Konto (#1585): keine user_id, dafür guest_id und participant_id „guest-…“.
  user_id: string | null;
  guest_id?: string | null;
  participant_id?: string;
  is_guest?: boolean;
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  time_ms?: number;
  time_str?: string;
  raw_time_ms?: number;
  penalty_seconds?: number;
  attempts?: number;
  rank?: number;
  gap_str?: string;
  points?: number;
};

export type F1LeaderboardPayload = {
  challenge: F1Challenge;
  track?: F1Track | null;
  entries: F1LeaderboardEntry[];
  club_reference_entries?: F1LeaderboardEntry[];
  club_reference_public?: boolean;
  // Versuche je Person und Strecke (#1585), null = unbegrenzt.
  max_attempts?: number | null;
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

export type PublicUser = {
  id: string;
  username?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  role?: string;
  is_club_member?: boolean;
  can_message?: boolean;
  message_hint?: string;
};

export type ChatAttachment = {
  id: string;
  kind: "image" | "video";
  mime?: string | null;
  size?: number | null;
  width?: number | null;
  height?: number | null;
  url: string;
  poster_url?: string | null;
  // Bildprüfung (#415): pending/review lädt nur beim Absender, blocked ist ein Platzhalter.
  scan_state?: "pending" | "safe" | "review" | "blocked" | "failed" | null;
};

export type ChatSticker = {
  id: string;
  pack_id?: string;
  name: string;
  url: string;
  width?: number | null;
  height?: number | null;
};

export type ChatMessage = {
  id: string;
  message: string;
  created_at?: string;
  user_id?: string;
  sender_id?: string;
  recipient_id?: string;
  author?: PublicUser | null;
  sender?: PublicUser | null;
  recipient?: PublicUser | null;
  read_at?: string | null;
  attachments?: ChatAttachment[];
  sticker?: ChatSticker | null;
  // Wortfilter (#417): „held“ sieht nur der Absender, „rejected“ ebenso; der Server liefert nie mehr.
  moderation?: { state: "held" | "flagged" | "released" | "rejected" } | null;
};

export type DirectConversation = {
  user: PublicUser;
  latest_message?: ChatMessage;
  unread_count?: number;
  can_send?: boolean;
  message_hint?: string;
};

export type DirectThread = {
  user: PublicUser;
  can_send?: boolean;
  message_hint?: string;
  messages: ChatMessage[];
};

export type UserNotification = {
  id: string;
  kind?: string;
  title: string;
  body?: string;
  url?: string;
  read?: boolean;
  created_at?: string;
  meta?: Record<string, unknown>;
};
