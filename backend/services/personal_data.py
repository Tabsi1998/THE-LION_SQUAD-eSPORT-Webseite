"""Je Sammlung: was beim Löschen eines Kontos passiert und wo sie in der Auskunft steht (#1029, #1030).

Das ist die Liste, an der sich Löschung (``routes/dsgvo_routes.py``, ``services/account_erasure.py``) und Auskunft
(``_user_data_export``) messen lassen. ``tests/test_personal_data_map_unit.py`` sucht alle Sammlungen im Code und
verlangt jede hier - eine neue Sammlung ohne Eintrag lässt den Test scheitern. Für Betreiber steht dasselbe in
``DATA_PROTECTION.md``.

- ``PERSONAL``: Daten über eine Person. Löschung ist eine von ``DECISIONS``; ``export`` nennt die Schlüssel in der
  Auskunft. Fehlt sie dort oder bleibt sie stehen, sagt ``note`` warum.
- ``CLUB_CONTENT``: Inhalte des Vereins (Turniere, Events, News-Entwürfe, Einstellungen …). Sie tragen höchstens die
  Kennung der Person, die sie angelegt oder bearbeitet hat; der Name wird erst beim Lesen aufgelöst und heißt nach
  der Löschung „Gelöschter User“. Sie bleiben.
- ``NO_PERSON``: Technik, Zähler und Konfiguration ohne Bezug zu einer Person.
"""
from __future__ import annotations

from typing import NamedTuple

DELETED = "gelöscht"
OVERWRITTEN = "überschrieben"
DETACHED = "gelöst"
KEPT = "bleibt"
EXPIRES = "läuft ab"
DECISIONS = (DELETED, OVERWRITTEN, DETACHED, KEPT, EXPIRES)


class Entry(NamedTuple):
    erasure: str
    export: tuple[str, ...] = ()
    note: str = ""


TOKEN = "nur ein Prüfwert (Hash) für einen Link oder eine Anmeldung - für die Person ohne Aussage"
MODERATION = "Nachweis der Moderation; die Kennung zeigt danach auf „Gelöschter User“"
# Entscheidung zu #1029: diese Nachweise bleiben nach der Kontolöschung drei Jahre (``erase_after``), dann löscht sie der
# tägliche Job (``account_erasure.purge_expired_records``). Zeilen aktiver Konten laufen nicht ab.
THREE_YEARS = "drei Jahre nach der Kontolöschung endgültig gelöscht"
SPORT = "sportliche Integrität: Ergebnisse und Tabellen bleiben, ohne Namen"

PERSONAL: dict[str, Entry] = {
    # Das Konto und der Zugang
    "users": Entry(OVERWRITTEN, ("user",)),
    "refresh_tokens": Entry(DELETED, note=TOKEN),
    "auth_sessions": Entry(DELETED, ("sessions",)),
    "email_verification_tokens": Entry(DELETED, note=TOKEN),
    "password_reset_tokens": Entry(DELETED, note=TOKEN),
    "mfa_login_challenges": Entry(DELETED, note="Zwischenschritt einer Anmeldung, wenige Minuten gültig"),
    "passkeys": Entry(DELETED, ("passkeys",)),
    "passkey_challenges": Entry(DELETED, note="Zwischenschritt einer Anmeldung, wenige Minuten gültig"),
    "member_card_tokens": Entry(DELETED, note=TOKEN),
    "calendar_feed_tokens": Entry(DELETED, note=TOKEN),
    "access_links": Entry(OVERWRITTEN, ("access_links",)),
    "login_attempts": Entry(EXPIRES, note="Schutz vor dem Durchprobieren von Passwörtern; nach einer Stunde gelöscht"),
    "rate_limits": Entry(EXPIRES, note="Zähler gegen zu viele Anfragen; nach höchstens einem Tag gelöscht"),
    "consent_records": Entry(KEPT, ("consent_records",), f"Nachweis, wann welcher Fassung zugestimmt wurde; {THREE_YEARS}"),
    "consent_decisions": Entry(KEPT, ("consent_decisions",), f"Nachweis einer Einwilligung gegenüber der Mitgliederverwaltung; {THREE_YEARS}"),
    # Profil, Verknüpfungen, Geräte
    "user_socials": Entry(DELETED, ("social_accounts",)),
    "platform_links": Entry(DELETED, ("platform_links",)),
    "platform_link_flows": Entry(DELETED, note="laufende Verknüpfung, wenige Minuten gültig"),
    "platform_link_sessions": Entry(EXPIRES, note="laufende Verknüpfung ohne Kennung des Kontos, nach Minuten gelöscht"),
    "mobile_push_tokens": Entry(DELETED, ("mobile_devices",)),
    "mobile_client_logs": Entry(DELETED, ("mobile_client_logs",)),
    "notifications": Entry(DELETED, ("notifications",)),
    "chat_reads": Entry(DELETED, ("chat_reads",)),
    "document_opens": Entry(DELETED, ("document_opens",)),
    "year_review_notices": Entry(DELETED, ("year_review_notices",)),
    "feedback_receipts": Entry(DELETED, ("feedback_answered",)),
    # Freunde, Nachrichten, Moderation
    "friendships": Entry(DELETED, ("friendships",)),
    "user_blocks": Entry(DELETED, ("blocks",)),
    "direct_messages": Entry(OVERWRITTEN, ("direct_messages",)),
    "team_chat_messages": Entry(OVERWRITTEN, ("chat_messages",)),
    "match_chat_messages": Entry(OVERWRITTEN, note="steht unter chat_messages"),
    "tournament_chat_messages": Entry(OVERWRITTEN, note="steht unter chat_messages"),
    "chat_attachments": Entry(DELETED, ("chat_attachments",)),
    "user_reports": Entry(KEPT, ("moderation_reports",), f"{MODERATION}; {THREE_YEARS} (Meldungen von und über die Person)"),
    "moderation_items": Entry(OVERWRITTEN, ("moderation_items",)),
    "moderation_strikes": Entry(KEPT, ("moderation_strikes",), f"{MODERATION}; {THREE_YEARS}"),
    "moderation_sanctions": Entry(KEPT, ("moderation_sanctions",), f"{MODERATION}; {THREE_YEARS}"),
    "contact_messages": Entry(OVERWRITTEN, ("contact_messages",),
                              f"nur angemeldet geschriebene, {THREE_YEARS}; ohne Konto mit derselben Adresse nicht sicher "
                              "zuzuordnen - gezählt"),
    "email_logs": Entry(OVERWRITTEN, ("email_logs",)),
    "mail_jobs": Entry(DELETED, note="Warteschlange des Versands; was versandt wurde, steht unter email_logs"),
    # Erfolge, XP, Mitmachaktionen
    "user_xp": Entry(DELETED, ("xp",)),
    "xp_events": Entry(DELETED, ("xp_events",)),
    "user_achievements": Entry(DELETED, ("achievements",)),
    "user_achievement_stats": Entry(DELETED, ("achievement_counters",)),
    "user_signals": Entry(DELETED, ("achievement_signals",)),
    "achievement_eval_queue": Entry(DELETED, note="interne Warteschlange für die Auswertung der Erfolge"),
    "achievement_outbox": Entry(DELETED, note="interne Warteschlange für die Meldung neuer Erfolge"),
    "achievement_events": Entry(OVERWRITTEN, ("achievement_log",)),
    "user_stickers": Entry(DELETED, ("stickers",)),
    "news_reads": Entry(DELETED, ("news_reads",)),
    "stream_watches": Entry(DELETED, ("stream_watches",)),
    "advent_openings": Entry(DELETED, ("advent_openings",)),
    "easter_finds": Entry(DELETED, ("easter_finds",)),
    "easter_progress": Entry(DELETED, ("easter_progress",)),
    "season_raffle_entries": Entry(DELETED, ("raffle_entries",)),
    "season_raffles": Entry(KEPT, note="Ziehung des Vereins; der eigene Gewinn steht unter prize_pickups"),
    "crown_state": Entry(KEPT, note="Kronen der Rangliste, bei jeder Änderung neu berechnet; nur Kennungen"),
    # Discord und Streams
    "discord_activity": Entry(DELETED, ("discord_activity",)),
    "discord_guild_active": Entry(DELETED, ("discord_activity_servers",)),
    "discord_memberships": Entry(DELETED, ("discord_memberships",)),
    "live_streams": Entry(DELETED, note="Zustand nur, solange ein Stream läuft; die Sitzungen stehen unter stream_sessions"),
    "twitch_stream_sessions": Entry(DELETED, ("stream_sessions",)),
    "tournament_stream_announcements": Entry(DELETED, ("stream_announcements",)),
    "discord_stream_posts": Entry(KEPT, note="Beitrag im Discord zum Stream; ohne Namen, der Job beendet ihn mit dem Stream"),
    # Verein und Mitgliedschaft
    "memberships": Entry(OVERWRITTEN, ("membership",)),
    "membership_applications": Entry(OVERWRITTEN, ("membership_applications",)),
    "membership_invitations": Entry(DELETED, ("membership_invitations",)),
    "club_member_profiles": Entry(DETACHED, ("directory_profiles",)),
    "board_positions": Entry(DETACHED, ("board_positions",)),
    "meeting_admissions": Entry(DETACHED, ("meeting_admissions", "meeting_admissions_recorded")),
    "dolibarr_links": Entry(OVERWRITTEN, ("dolibarr_links",)),
    "dolibarr_identities": Entry(DELETED, ("dolibarr_identities",)),
    "dolibarr_honours": Entry(DELETED, ("dolibarr_honours",)),
    "dolibarr_invoice_cache": Entry(DELETED, note="Zwischenspeicher der Rechnungen aus der Mitgliederverwaltung"),
    "dolibarr_pending": Entry(KEPT, note="Abgleich mit der Mitgliederverwaltung je Mitgliedsnummer, ohne Konto"),
    "dolibarr_participations": Entry(KEPT, note="Teilnahmen in der Mitgliederakte, je Mitgliedsnummer - Sache des Vereins"),
    "billing_orders": Entry(OVERWRITTEN, ("billing_orders",)),
    "billing_customers": Entry(DELETED, ("billing_customers",)),
    "billing_cases": Entry(KEPT, note="Buchhaltungsfall zu einem Auftrag; nur Kennungen - Belege sieben Jahre"),
    # Teams, Turniere, Events, F1, Saison
    "teams": Entry(KEPT, ("teams",), "gehört dem Team; das Konto heißt in der Liste „Gelöschter User“"),
    "team_members": Entry(KEPT, ("team_memberships",), "Teamhistorie und Aufstellungen; das Konto heißt „Gelöschter User“"),
    "team_invites": Entry(DELETED, ("team_invites",)),
    "team_squads": Entry(KEPT, note="Aufstellung des Teams, nur Kennungen"),
    "tournament_registrations": Entry(OVERWRITTEN, ("tournament_registrations",)),
    "matches_v2": Entry(KEPT, ("competition_matches",), SPORT),
    "match_reports_v2": Entry(KEPT, ("match_reports",), f"Ergebnismeldung als Nachweis des Ergebnisses; {THREE_YEARS}"),
    "match_schedule_proposals": Entry(KEPT, ("schedule_proposals",), "Terminvereinbarung zum Match als Nachweis"),
    "match_commendations": Entry(KEPT, ("commendations_given",), "das GG gehört zum Match wie das Ergebnis"),
    "match_proof_photos": Entry(DELETED, ("match_proof_photos",)),
    "tournament_staff_assignments": Entry(DELETED, ("tournament_staff",)),
    "f1_staff_assignments": Entry(DELETED, ("f1_staff",)),
    "event_registrations": Entry(OVERWRITTEN, ("event_registrations",)),
    "f1_lap_times": Entry(OVERWRITTEN, ("f1_lap_times",)),
    "prize_pickups": Entry(OVERWRITTEN, ("prize_pickups",)),
    "season_points": Entry(KEPT, ("season_points",), SPORT),
    "season_standings": Entry(KEPT, ("season_standings",), SPORT),
    "season_rank_snapshots": Entry(DELETED, ("season_rank_history",)),
    # Bilder und Uploads
    "media_uploads": Entry(DELETED, ("uploads",)),
    "media_scans": Entry(DELETED, note="Prüfvermerk der Bildprüfung zu den eigenen Uploads (stehen unter uploads)"),
    "pending_file_cleanups": Entry(DELETED, note="Merkliste für Dateien, deren Löschung nachgeholt wird (#1046): Datei, "
                                                 "Kennung des gelöschten Kontos, Status, Fehlerart ohne Pfad - weg, "
                                                 "sobald die Datei weg ist"),
    "upload_events": Entry(EXPIRES, ("upload_events",), "Protokoll der Uploads mit IP-Adresse; nach 60 Tagen gelöscht"),
    "gallery_submissions": Entry(DELETED, ("gallery_submissions",)),
    "gallery_submission_quota": Entry(DELETED, note="Zähler, wie viele Fotos je Album eingesandt wurden"),
    "gallery_album_notices": Entry(DELETED, note="Merker, dass schon über neue Fotos benachrichtigt wurde"),
    "gallery_photos": Entry(OVERWRITTEN, note="Foto des Vereins; „Foto: Name“ wird entfernt, die Einsendung steht unter gallery_submissions"),
    # Protokolle
    "audit_logs": Entry(OVERWRITTEN, ("audit_trail",)),
    # Nachricht an alle Angemeldeten (#1372): Absender und Text; die Empfänger nur als Zahl. Bei der Kontolöschung wird der
    # gespeicherte Name des Absenders überschrieben; nach der Frist des Adminprotokolls gelöscht (``ops_alerts.purge_old_logs``).
    "event_messages": Entry(OVERWRITTEN, ("event_messages_sent",), "Nachricht der Turnierleitung an alle Angemeldeten eines "
                            "Events; Name des Absenders überschrieben, gelöscht nach der Frist des Adminprotokolls"),
    "news_posts": Entry(OVERWRITTEN, note="Beitrag des Vereins; der gespeicherte Name der Autorin oder des Autors wird überschrieben"),
}

CLUB_CONTENT = frozenset({
    "achievement_groups", "achievements", "advent_doors", "app_releases", "discord_guilds", "documents", "easter_eggs",
    "easter_hunts", "events", "f1_challenges", "f1_tracks", "gallery_albums", "game_servers", "helper_calls",
    "member_benefits", "references", "seasons", "settings", "site_banners", "stations", "sticker_packs", "stickers",
    "team_invite_links", "tournament_awards", "tournament_groups", "tournament_stages", "tournaments",
})

NO_PERSON = frozenset({
    "advent_views", "badges", "cms_nav", "cms_pages", "competition_write_usage", "discord_guild_stats",
    "discord_welcomes", "dolibarr_public", "email_templates", "event_message_gates", "feedback_entries", "games", "mastodon_apps",
    "meeting_admission_counts", "mutation_locks", "ops_alert_log", "ops_alert_state", "ops_check_runs", "ops_errors",
    "ops_slow_requests", "ops_vitals", "partners", "schema_migration_lock", "schema_migrations", "site_banner_stats",
    "sponsors", "sticker_builtin_packs", "user_badges", "youtube_videos",
})
