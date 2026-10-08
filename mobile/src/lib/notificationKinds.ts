// Arten der Benachrichtigungen in Worten (#1296): die Glocke zeigte Rohwerte wie „TOURNAMENT_UPDATE“. Jede Art, die
// der Server anlegt (create_user_notification, Vorlagen in notification_preferences.py), hat hier ein kurzes Wort;
// Unbekanntes fällt auf das Thema (meta.category) oder den Anfang des Schlüssels zurück - nie auf den Rohwert.

const KIND_LABELS: Record<string, string> = {
  achievement: "Erfolg",
  achievement_revoked: "Erfolg entzogen",
  achievement_recap: "Wochenrückblick",
  level: "Level",
  prestige: "Prestige",
  direct_message: "Nachricht",
  team_chat_message: "Team-Chat",
  tournament_chat_message: "Turnier-Chat",
  match_chat_message: "Match-Chat",
  team_chat_mention: "Erwähnung",
  tournament_chat_mention: "Erwähnung",
  match_chat_mention: "Erwähnung",
  news_mention: "Erwähnung",
  friend_request: "Freundschaftsanfrage",
  friend_accept: "Neue Freundschaft",
  team_invite: "Team-Einladung",
  team_invite_accepted: "Team-Beitritt",
  team_role_changed: "Team-Rolle",
  team_leader_transferred: "Team-Leitung",
  team_presence_nudge: "Spieltag",
  match_reminder: "Match-Erinnerung",
  match_result: "Ergebnis",
  match_station: "Station",
  score_reported: "Ergebnis gemeldet",
  dispute_opened: "Einspruch",
  dispute_resolved: "Einspruch geklärt",
  tournament_checkin: "Check-in",
  checkin_opens_soon: "Check-in",
  checkin_reminder: "Check-in",
  checkin_closes_soon: "Check-in",
  registration_received: "Anmeldung eingegangen",
  registration_approved: "Anmeldung bestätigt",
  registration_rejected: "Anmeldung abgelehnt",
  tournament_update: "Turnier geändert",
  tournament_updates: "Turnier geändert",
  tournament_finished: "Turnier beendet",
  feedback_request: "Rückmeldung",
  prize_pending: "Gewinn",
  prize_ready: "Gewinn abholbereit",
  prize_picked_up: "Gewinn abgeholt",
  prize_expired: "Gewinn verfallen",
  f1_prize: "Gewinn",
  f1_prize_reminder: "Gewinn",
  membership_invited: "Einladung",
  membership_activated: "Mitgliedschaft",
  membership_deactivated: "Mitgliedschaft",
  membership_blocked: "Mitgliedschaft",
  membership_approve: "Mitgliedschaft",
  membership_reject: "Mitgliedschaft",
  access_link_invite: "Einladung",
  ballot_open: "Abstimmung",
  crown_gained: "Krone",
  crown_lost: "Krone",
  crown_changed: "Krone",
  moderation: "Moderation",
  invoice_ready: "Rechnung",
  helper_call: "Helfer gesucht",
  helper_reminder: "Helferdienst",
  shift: "Helferdienst",
  year_review: "Jahresrückblick",
  birthday_greeting: "Geburtstag",
  news_member: "Vereins-News",
  news_board: "Vereins-News",
  event_member: "Vereins-Event",
  event_board: "Vereins-Event",
  newsletter_news: "News",
  newsletter_event: "Event",
  admin_push_test: "Test",
  general: "Hinweis",
};

/** Themen der Einstellungen (notification_preferences.py) - wenn die Art selbst unbekannt ist. */
const CATEGORY_LABELS: Record<string, string> = {
  match_reminders: "Match",
  tournament_updates: "Turnier",
  prize_updates: "Gewinn",
  achievements: "Erfolg",
  billing_updates: "Rechnung",
  membership_updates: "Mitgliedschaft",
  birthday_greetings: "Geburtstag",
  achievement_recap: "Wochenrückblick",
  community_messages: "Nachricht",
  news_events: "News",
  club_internal: "Verein",
  helper_shifts: "Helferdienst",
};

const PREFIX_LABELS: Array<[string, string]> = [
  ["tournament", "Turnier"],
  ["match", "Match"],
  ["team", "Team"],
  ["news", "News"],
  ["event", "Event"],
  ["prize", "Gewinn"],
  ["membership", "Mitgliedschaft"],
  ["achievement", "Erfolg"],
  ["friend", "Freunde"],
];

/** Die Art einer Benachrichtigung in Worten - nie der Rohwert. */
export function notificationKindLabel(kind?: string | null, meta?: Record<string, unknown> | null): string {
  const key = String(kind || "").trim().toLowerCase();
  if (KIND_LABELS[key]) return KIND_LABELS[key];
  const category = String((meta && meta.category) || "").trim().toLowerCase();
  if (CATEGORY_LABELS[category]) return CATEGORY_LABELS[category];
  const prefix = PREFIX_LABELS.find(([start]) => key.startsWith(start));
  return prefix ? prefix[1] : "Hinweis";
}
