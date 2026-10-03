"""Erfolge II, Katalog C (#614): Community, Streaming & Creator, Profil & Konto - 42 Gruppen als Daten der Stufenleiter v2.

Gleiches Muster wie Katalog A und B. Vier Gruppen aus #614 fehlen hier bewusst, weil es ihre Daten noch nicht gibt:
„Überall dabei“ (Discord-Server, braucht Discord VI), „Mitbestimmer“ (Abstimmungen liegen in Dolibarr), „Mitgestalter“
(Referenzen und Alben legt heute nur die Verwaltung an) und „Botschafter“ (Einladungslinks gibt es noch nicht) - sie
kommen, sobald die Quelle da ist. Drei Gruppen werden weiter von Hand vergeben (Helfende Hand, Mentor, Kreativgeist).
"""
from __future__ import annotations

from .catalog_a import _group

# Alte Gruppe → neue Gruppe (E1-Migration über die Zähler; Hand-Gruppen nach der alten Höhe).
REPLACED: dict[str, str] = {
    "discord_active": "discord_messages",
    "community_presence": "discord_messages",
    "event_attendance": "events_attended",
    "event_host": "events_hosted",
    "social_network": "friends",
    "mentor_path": "mentor",
    "streamer_path": "twitch_sessions",
    "stream_growth": "twitch_sessions",
    "platform_diversity": "platform_links",
    "platform_identity": "platform_links",
    "achievement_collector": "achievements_unlocked",
    "level_progression": "level_milestones",
}
# Gleicher Code wie im alten Katalog, neue Leiter (und Bedingung, wo sie messbar ist).
REDEFINED = ("community_helper", "creator_spirit", "profile_completeness", "tutorial")


def _c(*args, **kwargs):
    return _group(*args, catalog="C", **kwargs)


COMMUNITY = [
    _c("discord_linked", "Discord verbunden", "community", "Verbinde dein Discord-Konto mit der Plattform.", "Konto → Verbindungen → Discord verknüpfen.",
       "message-square", "discord", "discord_linked", [1], "Discord verbunden.", sort_order=610),
    _c("discord_messages", "Discord-Stimme", "community", "Schreib auf dem Vereins-Discord.", "Jede Nachricht auf dem Server zählt - mit verknüpftem Discord-Konto.",
       "messages-square", "speech-wave", "discord_messages", [1, 100, 500, 2000, 5000, 10000, 25000], "{n} Nachrichten auf Discord.", sort_order=611),
    _c("events_attended", "Eventgänger", "community", "Sei bei Events dabei.", "Melde dich zu Events an und check dort ein - jedes zählt einmal.",
       "calendar-check", "ticket-stub", "events_attended", [1, 5, 15, 30, 60, 100, 200], "{n} Events besucht.", sort_order=612),
    _c("events_hosted", "Gastgeber", "community", "Richte Events aus.", "Lege ein Event an und führ es bis zum Abschluss.",
       "party-popper", "host", "events_hosted_completed", [1, 5, 15, 40, 100], "{n} Events ausgerichtet.", sort_order=613),
    _c("friends", "Netzwerker", "community", "Schließ Freundschaften auf der Plattform.", "Freundschaftsanfragen senden oder annehmen - jede bestätigte Freundschaft zählt.",
       "users", "handshake", "friends_count", [1, 5, 15, 30, 60, 100, 200], "{n} Freundschaften.", sort_order=614),
    _c("community_chat", "Plauderer", "community", "Schreib in den offenen Chats.", "Nachrichten im Turnier-Chat und im Match-Chat zählen zusammen.",
       "message-circle", "speech-bubbles", "community_messages_sent", [1, 10, 50, 200, 500, 1500, 5000], "{n} Nachrichten in offenen Chats.", sort_order=615),
    _c("direct_messages", "Briefeschreiber", "community", "Schreib Direktnachrichten.", "Jede gesendete Direktnachricht zählt.",
       "mail", "envelope", "direct_messages_sent", [10, 50, 200, 500, 1500], "{n} Direktnachrichten.", sort_order=616),
    _c("news_reader", "Immer informiert", "community", "Lies die News des Vereins.", "Ein News-Beitrag, den du angemeldet öffnest, zählt einmal.",
       "newspaper", "newspaper", "news_read", [5, 25, 75, 200, 500], "{n} News gelesen.", sort_order=617),
    _c("newsletter", "Abonnent", "community", "Abonnier den Newsletter.", "Konto → Benachrichtigungen → Newsletter an.",
       "mail-check", "letter-seal", "newsletter_subscribed", [1], "Newsletter abonniert.", sort_order=618),
    _c("calendar_sub", "Kalender im Griff", "community", "Hol dir den Vereinskalender in deinen Kalender.", "Im Kalender „Abonnieren“ nutzen oder den Kalender-Link öffnen.",
       "calendar-plus", "calendar-link", "calendar_subscribed", [1], "Kalender abonniert.", sort_order=619),
    _c("gallery_uploads", "Fotograf", "community", "Lade Fotos in die Galerie.", "Jedes Foto, das du in ein Album hochlädst, zählt.",
       "camera", "camera", "gallery_uploads_approved", [1, 5, 20, 50, 150], "{n} Fotos hochgeladen.", sort_order=620),
    _c("watchdog", "Aufpasser", "community", "Melde, was nicht passt.", "Eine Meldung, die zu einer Maßnahme führt, zählt.",
       "shield-alert", "watchdog", "reports_actioned", [1, 5, 15], "{n} Meldungen mit Folgen.", sort_order=621, materials=["silver", "gold", "diamond"]),
    _c("sticker_collector", "Sticker-Sammler", "community", "Nutz viele verschiedene Sticker.", "Jeder Sticker, den du in einem Chat schickst, zählt einmal.",
       "smile", "sticker", "stickers_collected", [1, 5, 15, 40, 100], "{n} verschiedene Sticker verschickt.", sort_order=622),
    _c("login_streak", "Treue", "community", "Komm Tag für Tag vorbei.", "Jeder Tag mit Anmeldung zählt zur Serie - die längste Serie bleibt.",
       "flame", "streak", "login_streak_max", [3, 7, 14, 30, 60, 100, 365], "{n} in Folge angemeldet.", sort_order=623, unit=" Tage"),
    _c("app_user", "App-Nutzer", "community", "Nutz die LionsAPP.", "App öffnen, dranbleiben, Push einschalten.",
       "smartphone", "phone", "app_user_stage", [1, 2, 3], "", sort_order=624, materials=["silver", "gold", "diamond"],
       steps=["Die App genutzt.", "30 Tage mit der App.", "30 Tage mit der App und Push eingeschaltet."]),
    _c("community_helper", "Helfende Hand", "community", "Hilf anderen in der Community.", "Wird von der Vereinsleitung vergeben, wenn du anderen weiterhilfst.",
       "hand-helping", "helping-hand", None, [1, 3, 7, 15, 30], "{n}-mal geholfen.", sort_order=625, manual=True),
    _c("mentor", "Mentor", "community", "Begleite Neue beim Einstieg.", "Wird von der Vereinsleitung vergeben, wenn du Neue einarbeitest oder coachst.",
       "graduation-cap", "mentor", None, [1, 3, 7, 15, 30], "{n} Menschen begleitet.", sort_order=626, manual=True),
]

CREATOR = [
    _c("twitch_linked", "Twitch verbunden", "creator", "Verbinde deinen Twitch-Kanal.", "Konto → Verbindungen → Twitch verknüpfen.",
       "twitch", "twitch", "twitch_linked", [1], "Twitch verbunden.", sort_order=710),
    _c("twitch_sessions", "Streamer", "creator", "Geh mit deinem Kanal live.", "Jede erkannte Live-Session deines verknüpften Twitch-Kanals zählt.",
       "radio", "on-air", "twitch_live_sessions", [1, 5, 10, 25, 50, 100, 250], "{n} Live-Sessions.", sort_order=711),
    _c("twitch_minutes", "Sendezeit", "creator", "Sammle Sendeminuten.", "Die Minuten deiner erkannten Live-Sessions zählen zusammen.",
       "clock", "broadcast-clock", "twitch_stream_minutes", [60, 600, 3000, 6000, 15000, 30000, 60000], "{n} Minuten gesendet.", sort_order=712),
    _c("tournament_streamer", "Live im Turnier", "creator", "Streame deine eigenen Turniermatches.", "Bist du während eines eigenen Turniers live, wird dein Stream dort gezeigt - jedes Turnier zählt einmal.",
       "tv", "tournament-live", "own_tournament_streams", [1, 5, 15, 40, 100], "{n} Turniere live gestreamt.", sort_order=713),
    _c("clips", "Clip-Macher", "creator", "Erstelle Clips auf dem Vereinskanal.", "Clips, die du auf dem Vereinskanal erstellst, zählen, sobald sie geholt sind.",
       "scissors", "clip", "clips_synced", [1, 5, 15, 40, 100], "{n} Clips.", sort_order=714),
    _c("youtube_linked", "YouTube verbunden", "creator", "Verbinde deinen YouTube-Kanal.", "Konto → Verbindungen → YouTube verknüpfen.",
       "youtube", "youtube", "youtube_linked", [1], "YouTube verbunden.", sort_order=715),
    _c("tiktok_linked", "TikTok verbunden", "creator", "Verbinde dein TikTok-Profil.", "Konto → Verbindungen → TikTok verknüpfen.",
       "music-2", "tiktok", "tiktok_linked", [1], "TikTok verbunden.", sort_order=716),
    _c("creator_spirit", "Kreativgeist", "creator", "Liefer Highlights und Clips für die Community.", "Wird von der Vereinsleitung vergeben, wenn deine Inhalte den Verein zeigen.",
       "sparkles", "spark", None, [1, 3, 7, 15, 30], "{n} Beiträge für die Community.", sort_order=717, manual=True),
    _c("viewer", "Zuschauer", "creator", "Schau Streams auf der Seite.", "Ein Stream, der eine Minute offen ist, zählt einmal je Stream und Tag.",
       "eye", "eye", "streams_watched", [5, 25, 75, 200, 500], "{n} Streams geschaut.", sort_order=718),
    _c("platform_links", "Plattform-Profil", "creator", "Trag deine Plattformen ein.", "Profil → Plattformen: jede eingetragene Plattform zählt einmal.",
       "gamepad-2", "platforms", "distinct_platforms", [1, 2, 3, 4, 5, 6, 8], "{n} Plattformen im Profil.", sort_order=719),
]

PROFILE = [
    _c("profile_completeness", "Steckbrief", "profile", "Füll dein Profil aus.", "Avatar, Banner, Text, Plattformen, Links - je vollständiger, desto weiter.",
       "user-check", "profile-card", "profile_completeness", [25, 50, 75, 90, 100], "Profil zu {n} ausgefüllt.", sort_order=810, unit=" %"),
    _c("avatar_banner", "Auftritt", "profile", "Gib deinem Profil ein Gesicht.", "Avatar und Banner hochladen.",
       "image", "portrait", "avatar_and_banner", [1], "Avatar und Banner gesetzt.", sort_order=811),
    _c("passkey", "Schlüsselmeister", "profile", "Sichere dein Konto mit einem Passkey.", "Konto → Sicherheit → Passkey hinzufügen.",
       "key-round", "passkey", "passkey_registered", [1], "Passkey eingerichtet.", sort_order=812, materials=["silver"]),
    _c("email_verified", "Verifiziert", "profile", "Bestätige deine E-Mail-Adresse.", "Den Link aus der Bestätigungsmail öffnen.",
       "mail-check", "verified", "email_verified", [1], "E-Mail bestätigt.", sort_order=813, materials=["wood"]),
    _c("tutorial", "Rundgang", "profile", "Mach den Rundgang durch die Plattform.", "Beim ersten Besuch den Rundgang zu Ende gehen.",
       "compass", "compass", "onboarding_completed", [1], "Rundgang beendet.", sort_order=814, materials=["wood"]),
    _c("privacy_aware", "Datenbewusst", "profile", "Kümmere dich um deine Privatsphäre.", "Privatsphäre-Einstellungen speichern oder deinen Datenexport holen.",
       "lock", "privacy", "privacy_reviewed", [1], "Privatsphäre geprüft.", sort_order=815, materials=["iron"]),
    _c("notifications", "Auf dem Laufenden", "profile", "Stell deine Benachrichtigungen ein.", "Konto → Benachrichtigungen speichern.",
       "bell", "bell", "notification_prefs_saved", [1], "Benachrichtigungen eingestellt.", sort_order=816, materials=["iron"]),
    _c("bio_links", "Visitenkarte", "profile", "Erzähl etwas über dich.", "Profiltext und mindestens einen Social-Link eintragen.",
       "id-card", "business-card", "bio_and_socials", [1], "Profiltext und Links gesetzt.", sort_order=817),
    _c("achievements_unlocked", "Sammler", "profile", "Sammle Erfolge.", "Jede freigeschaltete Stufe zählt.",
       "trophy", "trophy-case", "achievements_unlocked", [10, 30, 75, 150, 300, 500, 750], "{n} Erfolge freigeschaltet.", sort_order=818),
    _c("categories_complete", "Kategorie-Meister", "profile", "Schließ ganze Kategorien ab.", "Alle Gruppen einer Kategorie auf die höchste Stufe bringen.",
       "layout-grid", "category-crown", "categories_completed", [1, 2, 3, 4, 5, 6, 7], "{n} Kategorien vollständig.", sort_order=819),
    _c("level_milestones", "Levelaufstieg", "profile", "Steig im Level auf.", "Punkte aus Erfolgen, Matches und Aktivität heben dein Level.",
       "arrow-up-circle", "level-up", "level", [5, 10, 20, 30, 40, 50, 60], "Level {n} erreicht.", sort_order=820),
    _c("prestige", "Prestige", "profile", "Sammle Prestige-Sterne.", "Ab Level 60 kannst du Prestige nehmen - jeder Stern zählt.",
       "star", "prestige-star", "prestige_stars", [1, 2, 3, 4, 5], "{n} Prestige-Sterne.", sort_order=821),
    _c("hidden_found", "Geheimnisträger", "profile", "Finde die geheimen Erfolge.", "Es gibt Erfolge, die nirgends stehen - wer sie findet, sammelt sie hier.",
       "eye-off", "secret", "hidden_unlocked", [1, 3, 7, 12, 15], "{n} geheime Erfolge gefunden.", sort_order=822),
    _c("anniversary", "Jubiläum", "profile", "Bleib uns über Jahre treu.", "Jedes volle Jahr seit deiner Registrierung zählt.",
       "cake", "anniversary", "account_years", [1, 2, 3, 4, 5, 7, 10], "{n} dabei.", sort_order=823, unit=" Jahre"),
    _c("birthday_login", "Geburtstagskind", "profile", "Schau an deinem Geburtstag vorbei.", "Geburtsdatum im Profil eintragen und am Geburtstag anmelden.",
       "gift", "birthday", "birthday_logins", [1, 3, 5], "{n} Geburtstage bei uns gefeiert.", sort_order=824, materials=["silver", "gold", "diamond"]),
]

GROUPS_C: list[dict] = [group for group, _tiers in COMMUNITY + CREATOR + PROFILE]
TIERS_C: list[dict] = [t for _group, tiers in COMMUNITY + CREATOR + PROFILE for t in tiers]
CONDITION_KEYS_C: tuple[str, ...] = tuple(sorted({group["condition_key"] for group in GROUPS_C if group["condition_key"]}))
