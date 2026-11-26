"""User mail/notification preference helpers.

Transactional account/security mails are always allowed. Optional mail streams
are controlled per user so normal profile settings decide what gets queued.
"""
from __future__ import annotations

from typing import Any
from datetime import datetime, timezone
from zoneinfo import ZoneInfo


OPTIONAL_EMAIL_PREFERENCES = {
    # Spiele & Aufrufe (#1204): der Name der Stufen-Seite - Aufruf, Spielstart, Erinnerung, Check-in und Veto des eigenen Spiels.
    "match_reminders": {
        "label": "Spiele & Aufrufe",
        "description": "Aufruf zum Spiel, Spielstart, Erinnerungen, Check-in, Veto und Ergebnisse deiner Spiele.",
        "default": True,
    },
    "tournament_updates": {
        "label": "Turnier-Updates",
        # Liga-Meldungen und Belohnungen der Liga (E.4, F.4) laufen unter diesem Thema (#1204).
        "description": "Anmeldung, Status, Hinweise der Turnierleitung, Liga-Rundnachrichten und Belohnungen der Liga.",
        "default": True,
    },
    "prize_updates": {
        "label": "Gewinne & Abholung",
        "description": "Gewinn bereit, übergeben oder Frist abgelaufen.",
        "default": True,
    },
    # Erfolge (#568): in der App, per Push und als Gratulation vom Discord-Bot - eine E-Mail dafür gibt es nicht.
    "achievements": {
        "label": "Erfolge",
        "description": "Freigeschaltete Erfolge, Kronen und neue Level – als Gratulation.",
        "default": True,
        "channels": ["in_app", "push", "browser", "discord"],
    },
    # Rechnungen (#841): „Deine Rechnung ist da“ mit Betrag, Zahlungsziel und Link zum PDF - nur an die Person
    # selbst; Beträge gehen nie über Discord, deshalb gibt es dort keinen Schalter.
    "billing_updates": {
        "label": "Rechnungen",
        "description": "Neue Rechnung mit Betrag, Zahlungsziel und Link zum PDF in deinem Konto.",
        "default": True,
        "channels": ["in_app", "push", "browser", "email"],
    },
    "membership_updates": {
        "label": "Vereinsmitgliedschaft",
        "description": "Einladungen zum Antrag, Nummern und Vereinsvorteile. Entscheidungen über deine Mitgliedschaft bekommst du immer per Mail.",
        "default": True,
    },
    "birthday_greetings": {
        "label": "Geburtstagsgruß",
        "description": "Einmal im Jahr eine Geburtstagsmail vom Verein.",
        "default": True,
    },
    # Wochenrückblick (#622): montags eine Mail an die Person selbst - nur bei Aktivität, nur per E-Mail.
    "achievement_recap": {
        "label": "Wochenrückblick",
        "description": "Montags eine kurze Mail mit deinen XP, deinem Level und neuen Erfolgen – nur, wenn du in der Woche etwas erreicht hast.",
        "default": True,
        "channels": ["email"],
    },
    "community_messages": {
        "label": "Nachrichten & Erwähnungen",
        "description": "Direktnachrichten, Team-Chat-Erwähnungen und ähnliche Community-Hinweise.",
        "default": True,
    },
    "news_events": {
        "label": "News & Events",
        "description": "Neue Vereinsnews, neue Events und wichtige Ankündigungen.",
        "default": False,
        "requires_newsletter_consent": True,
    },
    # Vereinsintern (#342): interne Events und News für Mitglieder bzw. den Vorstand. Das ist
    # Vereinsbetrieb, kein Newsletter - deshalb standardmäßig an und ohne Newsletter-Zustimmung;
    # wer es nicht will, schaltet es in den Einstellungen ab.
    "club_internal": {
        "label": "Vereinsintern",
        "description": "Interne Events und News, die nur Mitglieder sehen.",
        "default": True,
    },
    # Helferdienste (#1197): Aufruf des Vorstands für offene Schichten und die Erinnerung am Vortag - nur Mitglieder
    # bekommen das; eine Mail dafür gibt es nicht.
    "helper_shifts": {
        "label": "Helferdienste",
        "description": "Nur für Vereinsmitglieder: Aufrufe für offene Helferschichten und die Erinnerung am Vortag.",
        "default": True,
        "channels": ["in_app", "push", "browser", "discord"],
    },
}

DELIVERY_CHANNEL_PREFERENCES = {
    "email": {
        "label": "E-Mail",
        "description": "Nur wichtige optionale Benachrichtigungen per E-Mail erhalten.",
        "default": True,
    },
    "push": {
        "label": "Push",
        "description": "Benachrichtigungen auf registrierten Mobilgeräten erhalten.",
        "default": True,
    },
    # Browser-Benachrichtigungen (#1163): wie Push, nur im Browser - an, sobald die Person im Browser zugestimmt hat. Ohne
    # angemeldeten Browser geht dort nichts hinaus, deshalb darf der Kanal von Anfang an an sein.
    "browser": {
        "label": "Browser",
        "description": "Benachrichtigungen im Browser – auch bei geschlossener Website, sobald du dort zugestimmt hast.",
        "default": True,
        "requires_link": "web_push",
    },
    "in_app": {
        "label": "In-App",
        "description": "Benachrichtigungen im Web und in der App anzeigen.",
        "default": True,
    },
    # Discord als persönlicher Kanal (#567): Direktnachricht vom Vereins-Bot, nur mit verknüpftem Konto
    # und ausdrücklichem Opt-in - deshalb Standard aus.
    "discord": {
        "label": "Discord",
        "description": "Direktnachricht vom Vereins-Bot – nur mit verknüpftem Discord-Konto.",
        "default": False,
        "requires_link": "discord",
    },
}

CHANNEL_TOPIC_SEPARATOR = ":"


TEMPLATE_CATEGORY = {
    "registration_received": "tournament_updates",
    "registration_approved": "tournament_updates",
    "registration_rejected": "tournament_updates",
    "tournament_staff": "tournament_updates",
    "checkin_closes_soon": "tournament_updates",
    "checkin_closes_soon_on_site": "tournament_updates",
    "tournament_finished": "tournament_updates",
    "event_message": "tournament_updates",
    "event_registration": "tournament_updates",
    "event_cancelled": "tournament_updates",
    "tournament_cancelled": "tournament_updates",
    "match_reminder": "match_reminders",
    "match_lead_10m": "match_reminders",
    "score_reported": "match_reminders",
    "league_notice": "match_reminders",
    "dispute_opened": "match_reminders",
    "dispute_resolved": "match_reminders",
    "prize_ready": "prize_updates",
    "prize_picked_up": "prize_updates",
    "prize_expired": "prize_updates",
    "membership_activated": "membership_updates",
    "membership_invited": "membership_updates",
    "membership_deactivated": "membership_updates",
    "membership_blocked": "membership_updates",
    "membership_approve": "membership_updates",
    "membership_reject": "membership_updates",
    "birthday_greeting": "birthday_greetings",
    "achievement_recap": "achievement_recap",
    "invoice_ready": "billing_updates",
    "direct_message": "community_messages",
    "team_chat_message": "community_messages",
    "team_chat_mention": "community_messages",
    "newsletter_news": "news_events",
    "newsletter_event": "news_events",
}

NOTIFICATION_KIND_CATEGORY = {
    "match_reminder": "match_reminders",
    "match_station": "match_reminders",
    # Aufruf beim Reservieren der Station (#1137): „Du bist dran“.
    "match_call": "match_reminders",
    "match_result": "match_reminders",
    # Team am Spieltag (#1192): „Bist du schon da?“ von der Teamleitung - wie eine Spiel-Erinnerung.
    "team_presence_nudge": "match_reminders",
    # Ergebnis melden (#1132): „bitte bestätigen“ an die Gegenseite; Streitfälle für die Turnierleitung.
    "match_report": "match_reminders",
    "match_attention": "tournament_updates",
    # Antwortfrist eines Terminvorschlags abgelaufen (#1552): an die Turnierleitung.
    "schedule_escalation": "tournament_updates",
    # Termin vorgeschlagen, Gegenvorschlag, angenommen, abgelehnt, zurückgezogen (#2110): an die andere Seite.
    "match_schedule": "match_reminders",
    # Dispute (#1134): „Dispute zu deinem Spiel“ an die Spieler; entschieden kommt als Ergebnis (match_result).
    "match_dispute": "match_reminders",
    # Turnier-Anmeldung (#1133): eingegangen, bestätigt, abgelehnt, nachgerückt - und „Turnier beendet“.
    "tournament_registration": "tournament_updates",
    "tournament_finished": "tournament_updates",
    # Absage (#2120): „Turnier abgesagt“ an alle, die noch mitspielen wollten.
    "tournament_cancelled": "tournament_updates",
    # Rundnachricht der Liga-Leitung (E.4, Nr. 153): an Captains und Vertreter oder alle Spieler einer Season, Liga N oder Staffel.
    "league_broadcast": "tournament_updates",
    # Belohnungen der Liga (F.4, Nr. 166): neu bekommen oder nach einem neuen Abschluss verloren.
    "league_reward": "tournament_updates",
    # Hinweis der Turnierleitung (#1166): „Pause bis 14:30“ an alle im Turnier bzw. Event.
    "tournament_notice": "tournament_updates",
    # Helfer-Einsatz (#2111, TA25): „Du hilfst bei diesem Turnier als …“.
    "tournament_staff": "tournament_updates",
    "match_chat_message": "community_messages",
    "match_chat_mention": "community_messages",
    "tournament_checkin": "tournament_updates",
    # Rückmeldung (#1196): „Wie war der FC 26 Cup?“ am Tag danach - Thema Turnier-Updates, auch bei Events.
    "feedback_request": "tournament_updates",
    "tournament_chat_message": "community_messages",
    "tournament_chat_mention": "community_messages",
    "team_chat_message": "community_messages",
    "team_chat_mention": "community_messages",
    "direct_message": "community_messages",
    "friend_request": "community_messages",
    "friend_accept": "community_messages",
    "team_invite": "community_messages",
    "team_invite_accepted": "community_messages",
    "team_invite_declined": "community_messages",
    "team_role_changed": "community_messages",
    "team_leader_transferred": "community_messages",
    # Wer kommt und geht, und was mit dem Team passiert (#2128, TM5, TM8, TM10).
    "team_member_removed": "community_messages",
    "team_member_left": "community_messages",
    "team_dissolved": "community_messages",
    "team_restored": "community_messages",
    "team_join_code_renewed": "community_messages",
    "f1_prize": "prize_updates",
    "f1_prize_reminder": "prize_updates",
    "prize_pending": "prize_updates",
    # Gewinn bereit, abgeholt, verfallen (#2123) - Glocke und Push neben der Mail.
    "prize_status": "prize_updates",
    "achievement": "achievements",
    # Erfolge II (#622): Prestige und Rücknahme stehen im Postfach unter „Erfolge“.
    "prestige": "achievements",
    "achievement_revoked": "achievements",
    # Neuberechnung abgeschlossen (#2340): eine Sammel-Nachricht je Person.
    "achievement_recount": "achievements",
    # Jahresrückblick (#1195): „Dein Jahr ist da“ einmal im Dezember - unter „Erfolge“.
    "year_review": "achievements",
    # Kronen und Level (#2119 ML2): gehören zu „Erfolge“ - wer das ausschaltet, bekommt sie auch nicht.
    "crown_gained": "achievements",
    "crown_changed": "achievements",
    "crown_lost": "achievements",
    "crown_onyx": "achievements",
    "level": "achievements",
    "news_mention": "news_events",
    # Öffentliche News „nur App“ (#1532): Push an alle App-Nutzer mit Zustimmung für „News & Events“.
    "news_app": "news_events",
    # Interne Inhalte nur an Berechtigte (#342): Mitglieder bzw. Vorstand.
    "news_member": "club_internal",
    "news_board": "club_internal",
    "event_member": "club_internal",
    "event_board": "club_internal",
    # Nachricht an alle Angemeldeten eines Events (#1372) - wie andere Event-Hinweise unter Turnier-Updates.
    "event_message": "tournament_updates",
    # Die eigene Event-Anmeldung (#2127): angemeldet, Warteliste, nachgerückt, von der Leitung storniert.
    "event_registration": "tournament_updates",
    # Fotos vom Event (#1185): „Die Fotos sind da“ an die Teilnehmer - wie „Wie war …?“ unter Turnier-Updates,
    # Mitglieder-Alben unter „Vereinsintern“.
    "gallery_event": "tournament_updates",
    "gallery_member": "club_internal",
    # Fotos einsenden (#1186): freigegeben oder abgelehnt - an die Person, die eingesandt hat.
    "gallery_submission": "club_internal",
    # Abstimmung offen (#844): einmal je Abstimmung, nur mit offenem Stimmrecht.
    "ballot_open": "club_internal",
    # Helferdienste (#1197): Aufruf und Erinnerung am Vortag - eigenes Thema, abschaltbar.
    "helper_call": "helper_shifts",
    "helper_reminder": "helper_shifts",
    "membership_update": "membership_updates",
    "invoice_ready": "billing_updates",
    # Benachrichtigungs-Zentrum (#1662): jede Art, die der Code erzeugt, hat ein Thema (Wächter
    # tests/test_notification_kinds_inventory_unit.py). Diese hatten bisher keins und ließen sich deshalb nicht abschalten.
    "access_link_invite": "tournament_updates",
    "tournament_heat_rebuild": "tournament_updates",
    "jersey_number": "membership_updates",
    "membership_invited": "membership_updates",
    # Turnier-Meldungen (#1209): weiter, ausgeschieden, Turnierbaum, Pause - unter „Turnier-Updates“.
    "tournament_progress": "tournament_updates",
    "tournament_bracket": "tournament_updates",
    "tournament_pause": "tournament_updates",
}

ACCOUNT_TOPIC = "account"
# „Konto & System“ (#1662) ist kein Thema zum Abschalten und steht darum nicht in ``NOTIFICATION_KIND_CATEGORY``: Rechte,
# Mitgliedschafts-Entscheidungen, Moderation, Push-Test, die Sammelmeldung nach der Ruhezeit. Wie bisher gilt dafür nur der
# Kanal-Hauptschalter - für Glocke, Sammel-Mail und Wächter haben sie trotzdem ein Thema.
ACCOUNT_KINDS: frozenset[str] = frozenset({
    "rights_change", "membership_decision", "moderation", "admin_push_test", "quiet_digest", "general",
})
# Die Namen der Themen für Glocke, Sammel-Mail und Sammelmeldung (#1662) - wie in den Einstellungen.
TOPIC_LABELS: dict[str, str] = {
    **{key: meta["label"] for key, meta in OPTIONAL_EMAIL_PREFERENCES.items()
       if key not in {"birthday_greetings", "achievement_recap"}},
    ACCOUNT_TOPIC: "Konto & System",
}

# Wichtigkeit je Art (#1662): ``urgent`` kommt auch in der Ruhezeit sofort und nie in die Sammel-Mail (die Ausnahmen der
# Ruhezeit, quiet_hours_rules.EXEMPT_KINDS, und Absagen); ``important`` verlangt meist etwas von dir; ``normal`` ist zur
# Kenntnis. Eine einzelne Meldung kann ihre Stufe in ``meta.importance`` nennen.
IMPORTANCE_LEVELS: tuple[str, ...] = ("urgent", "important", "normal")
# Absagen sind dringend (Fabian 26.11., A) - Terminänderungen eines Events tragen ``meta.importance`` (event_changes).
_URGENT = {"match_call", "match_station", "admin_push_test", "tournament_cancelled"}
_IMPORTANT = {
    "match_reminder", "match_report", "match_attention", "schedule_escalation", "match_schedule", "match_dispute",
    "team_presence_nudge", "tournament_checkin", "tournament_registration", "tournament_cancelled", "tournament_notice",
    "tournament_staff", "tournament_progress", "tournament_bracket", "tournament_pause", "tournament_heat_rebuild",
    "access_link_invite", "league_broadcast", "direct_message", "match_chat_mention", "team_chat_mention",
    "tournament_chat_mention", "team_invite", "prize_status", "prize_pending", "f1_prize", "f1_prize_reminder",
    "helper_call", "helper_reminder", "ballot_open", "invoice_ready", "membership_invited", "rights_change",
    "membership_decision", "moderation",
}
NOTIFICATION_KIND_IMPORTANCE: dict[str, str] = {
    kind: "urgent" if kind in _URGENT else "important" if kind in _IMPORTANT else "normal"
    for kind in (*NOTIFICATION_KIND_CATEGORY, *ACCOUNT_KINDS)
}


def notification_topic(kind: str, meta: dict | None = None) -> str:
    """Das Thema einer Meldung: ``meta.category``, sonst das der Art - Unbekanntes unter „Konto & System“."""
    category = (meta or {}).get("category")
    if category in TOPIC_LABELS:
        return category
    return NOTIFICATION_KIND_CATEGORY.get(str(kind or ""), ACCOUNT_TOPIC)  # ACCOUNT_KINDS und Unbekanntes


def notification_importance(kind: str, meta: dict | None = None) -> str:
    """Die Wichtigkeit einer Meldung (#1662) - ``meta.importance``, wenn bekannt, sonst die der Art."""
    meta = meta or {}
    named = meta.get("importance")
    if named in IMPORTANCE_LEVELS:
        return named
    # „Match startet jetzt“ in der Liga ist dringend - dieselbe Ausnahme wie bei der Ruhezeit (services/quiet_hours.py).
    if kind == "match_schedule" and meta.get("reason") == "checkin_started":
        return "urgent"
    return NOTIFICATION_KIND_IMPORTANCE.get(str(kind or ""), "normal")


# Rechte und Entscheidungen über die Mitgliedschaft (#2125): die Person muss es erfahren - kein Thema zum Abbestellen.
REQUIRED_NOTIFICATION_KINDS: set[str] = {"rights_change", "membership_decision"}


REQUIRED_EMAIL_TEMPLATES = {
    "registration",
    "password_reset",
    "user_invite",
    "account_banned",  # Konto gesperrt mit Grund (#1357) - nicht abbestellbar
    # Entscheidungen über die eigene Mitgliedschaft (#2125) - nicht abbestellbar.
    "membership_approve",
    "membership_reject",
    "membership_activated",
    "membership_deactivated",
    "membership_blocked",
    "test",
}


def preference_key(channel: str, topic: str) -> str:
    return f"{channel}{CHANNEL_TOPIC_SEPARATOR}{topic}"


def normalized_preferences(user: dict | None) -> dict[str, bool]:
    user = user or {}
    raw = user.get("notification_preferences") or {}
    newsletter = bool(user.get("newsletter_consent"))
    prefs: dict[str, bool] = {}
    for key, meta in DELIVERY_CHANNEL_PREFERENCES.items():
        prefs[key] = bool(raw[key]) if key in raw else bool(meta.get("default"))
    for key, meta in OPTIONAL_EMAIL_PREFERENCES.items():
        default = bool(meta.get("default"))
        if meta.get("requires_newsletter_consent"):
            default = newsletter
        prefs[key] = bool(raw[key]) if key in raw else default
        if meta.get("requires_newsletter_consent") and not newsletter:
            prefs[key] = False
    for channel in DELIVERY_CHANNEL_PREFERENCES:
        for topic, meta in OPTIONAL_EMAIL_PREFERENCES.items():
            key = preference_key(channel, topic)
            if key in raw:
                value = bool(raw[key])
            elif channel == "browser" and preference_key("push", topic) in raw:
                # Browser (#1163): solange nichts eigenes gespeichert ist, gilt das Thema wie beim Push - wer es dort
                # abgeschaltet hat, bekommt es im Browser auch nicht.
                value = bool(raw[preference_key("push", topic)])
            else:
                value = bool(prefs.get(topic, meta.get("default", True)))
            if channel == "email" and meta.get("requires_newsletter_consent") and not newsletter:
                value = False
            prefs[key] = value
    return prefs


def channel_topic_allowed(user: dict | None, channel: str, category: str | None, required: bool = False) -> bool:
    if required:
        return True
    prefs = normalized_preferences(user)
    if not prefs.get(channel, True):
        return False
    if not category:
        return True
    return bool(prefs.get(preference_key(channel, category), prefs.get(category, True)))


def email_allowed(user: dict | None, template_key: str, category: str | None = None) -> bool:
    if template_key in REQUIRED_EMAIL_TEMPLATES:
        return True
    category = category or TEMPLATE_CATEGORY.get(template_key)
    return channel_topic_allowed(user, "email", category)


def notification_allowed(user: dict | None, kind: str, category: str | None = None) -> bool:
    category = category or NOTIFICATION_KIND_CATEGORY.get(kind)
    return channel_topic_allowed(user, "in_app", category, required=kind in REQUIRED_NOTIFICATION_KINDS)


def push_allowed(user: dict | None, kind: str, category: str | None = None) -> bool:
    category = category or NOTIFICATION_KIND_CATEGORY.get(kind)
    return channel_topic_allowed(user, "push", category, required=kind in REQUIRED_NOTIFICATION_KINDS)


def browser_allowed(user: dict | None, kind: str, category: str | None = None) -> bool:
    """Browser-Benachrichtigungen (#1163): dieselben Themen wie Push, eigener Kanal „Browser“."""
    category = category or NOTIFICATION_KIND_CATEGORY.get(kind)
    return channel_topic_allowed(user, "browser", category, required=kind in REQUIRED_NOTIFICATION_KINDS)


def discord_allowed(user: dict | None, kind: str, category: str | None = None) -> bool:
    """Discord als Kanal (#567) braucht das Opt-in der Person - auch für Pflicht-Benachrichtigungen."""
    if not normalized_preferences(user).get("discord"):
        return False
    category = category or NOTIFICATION_KIND_CATEGORY.get(kind)
    return channel_topic_allowed(user, "discord", category, required=kind in REQUIRED_NOTIFICATION_KINDS)


# Drei Stufen und Themen (#1204, Fabians Wahl A): je Thema „Push“ (App und Browser, #1163), „Nur in der App“ (Glocke) oder
# „Aus“. Das ist nur eine Sicht auf die bestehenden Schalter ``in_app:<thema>``, ``push:<thema>`` und ``browser:<thema>`` -
# gespeichert wird wie bisher, eine Migration gibt es nicht. E-Mail und Discord bleiben eigene Wege („Weitere Wege“).
TOPIC_MODE_CHANNELS = ("in_app", "push", "browser")
TOPIC_MODES: dict[str, dict[str, bool]] = {
    "push": {"in_app": True, "push": True, "browser": True},
    "app": {"in_app": True, "push": False, "browser": False},
    "off": {"in_app": False, "push": False, "browser": False},
}
# Die Themen der Liste in dieser Reihenfolge; Wochenrückblick und Geburtstagsgruß sind reine Mails („Weitere Wege“).
# Neue Themen späterer Pakete reihen sich hier ein - Liga-Meldungen und Belohnungen der Liga laufen unter Turnier-Updates.
LEVEL_TOPICS: tuple[str, ...] = (
    "match_reminders", "tournament_updates", "prize_updates", "achievements", "billing_updates",
    "membership_updates", "community_messages", "news_events", "club_internal", "helper_shifts",
)
# Je Stufe die Themen per Push; alle anderen „Nur in der App“. Helferdienste sind ein Aufruf an dich - bei „Wichtiges“ per Push.
NOTIFICATION_LEVELS: dict[str, dict[str, Any]] = {
    "all": {
        "label": "Alles",
        "description": "Jedes Thema per Push – nichts verpasst.",
        "push": frozenset(LEVEL_TOPICS),
    },
    "important": {
        "label": "Wichtiges",
        "description": "Spiele, Turniere, Rechnungen, Mitgliedschaft, Nachrichten an dich und Helferdienste per Push. Der Rest liegt in der Glocke.",
        "push": frozenset({"match_reminders", "tournament_updates", "billing_updates", "membership_updates", "community_messages", "helper_shifts"}),
    },
    "few": {
        "label": "Wenig",
        "description": "Nur Spiele und Aufrufe sowie Rechnungen per Push. Alles andere liegt in der Glocke.",
        "push": frozenset({"match_reminders", "billing_updates"}),
    },
}
CUSTOM_LEVEL = "custom"
# Neue Konten starten mit „Alles“ (#1204); bestehende behalten ihre Schalter.
NEW_ACCOUNT_LEVEL = "all"


def level_modes(level: str) -> dict[str, str]:
    """Die Themen einer Stufe: ``{thema: "push" | "app"}``."""
    pushed = NOTIFICATION_LEVELS[level]["push"]
    return {topic: "push" if topic in pushed else "app" for topic in LEVEL_TOPICS}


def mode_preferences(topic: str, mode: str) -> dict[str, bool]:
    """Die Schalter eines Themas für eine Stellung - genau die drei Kanäle der Liste."""
    return {preference_key(channel, topic): value for channel, value in TOPIC_MODES[mode].items()}


def level_preferences(level: str) -> dict[str, bool]:
    """Die Schalter einer Stufe. E-Mail, Discord und die Kanal-Hauptschalter bleiben, wie sie sind."""
    prefs: dict[str, bool] = {}
    for topic, mode in level_modes(level).items():
        prefs.update(mode_preferences(topic, mode))
    return prefs


def new_account_preferences(newsletter_consent: bool = False) -> dict[str, bool]:
    """Die Schalter eines neuen Kontos: die Stufe ``NEW_ACCOUNT_LEVEL`` - nur News & Events richtet sich nach dem Haken beim
    Newsletter (Fabians Entscheidung M5): ohne Zustimmung still in der Glocke („Nur App“), mit Zustimmung per Push. Ohne
    Haken zeigt das Konto deshalb „Eigene Auswahl“ - so gewollt. Eine Einladung durch die Verwaltung hat keine Zustimmung."""
    prefs = level_preferences(NEW_ACCOUNT_LEVEL)
    if not newsletter_consent:
        prefs.update(mode_preferences("news_events", "app"))
    return prefs


def _topic_state(prefs: dict[str, bool], topic: str) -> tuple[bool, bool, bool]:
    in_app, push, browser = (bool(prefs.get(preference_key(channel, topic))) for channel in TOPIC_MODE_CHANNELS)
    return in_app, push, browser


def topic_modes(user: dict | None, prefs: dict[str, bool] | None = None) -> dict[str, str]:
    """Die Stellung je Thema aus den gespeicherten Schaltern. Alte Mischstände (Push an, Glocke aus) zeigen „Push“."""
    prefs = prefs if prefs is not None else normalized_preferences(user)
    modes: dict[str, str] = {}
    for topic in LEVEL_TOPICS:
        in_app, push, browser = _topic_state(prefs, topic)
        modes[topic] = "push" if (push or browser) else "app" if in_app else "off"
    return modes


def notification_level(user: dict | None, prefs: dict[str, bool] | None = None) -> str:
    """Die Stufe, die genau zu den Schaltern passt - sonst ``custom`` („Eigene Auswahl“)."""
    prefs = prefs if prefs is not None else normalized_preferences(user)
    exact = all(
        dict(zip(TOPIC_MODE_CHANNELS, _topic_state(prefs, topic))) in TOPIC_MODES.values()
        for topic in LEVEL_TOPICS
    )
    if not exact:
        return CUSTOM_LEVEL
    modes = topic_modes(user, prefs)
    for level in NOTIFICATION_LEVELS:
        if modes == level_modes(level):
            return level
    return CUSTOM_LEVEL


async def send_user_template(user: dict | None, template_key: str, category: str | None = None, *,
                             importance: str | None = None, **kwargs) -> dict:
    """Send a named template to a user if their preferences allow it.

    Sammel-Mail (#1662): Wer „täglich“ oder „wöchentlich“ eingestellt hat, bekommt optionale Mails gesammelt
    (services/mail_digest.py) - Pflicht und Dringendes (``importance="urgent"`` oder eine dringende Vorlage) nie. Ein
    gesammelte Mail meldet ``{"ok": True, "digest": True}``."""
    if not user or not user.get("email"):
        return {"ok": False, "skipped": True, "reason": "missing_email"}
    category = category or TEMPLATE_CATEGORY.get(template_key)
    if not email_allowed(user, template_key, category):
        return {"ok": True, "skipped": True, "reason": "preference_disabled", "category": category}
    from services import mail_digest_rules

    if user.get("id") and mail_digest_rules.collectable(template_key, importance, template_key in REQUIRED_EMAIL_TEMPLATES):
        held = await mail_digest_rules.hold(user, template_key, category, kwargs)
        if held:
            return held
    from email_service import send_template
    return await send_template(template_key, user["email"], **kwargs)


def public_preferences_payload(user: dict | None) -> dict[str, Any]:
    from services.quiet_hours_rules import EXEMPTION_TEXTS, SUGGESTED_END, SUGGESTED_START, settings_payload

    prefs = normalized_preferences(user)
    return {
        "newsletter_consent": bool((user or {}).get("newsletter_consent")),
        "preferences": prefs,
        # Stufen und Themen (#1204): die Stufe, die Stellung je Thema und was jede Stufe setzt.
        "level": notification_level(user, prefs),
        "topic_modes": topic_modes(user, prefs),
        "topics": list(LEVEL_TOPICS),
        "levels": [
            {"key": key, "label": meta["label"], "description": meta["description"], "modes": level_modes(key)}
            for key, meta in NOTIFICATION_LEVELS.items()
        ],
        # Ruhezeit (#1206): Wiener Zeit, Standard aus; beim Einschalten 22:00 bis 7:00.
        "quiet_hours": settings_payload(user),
        "quiet_hours_suggestion": {"start": SUGGESTED_START, "end": SUGGESTED_END},
        "quiet_hours_exceptions": list(EXEMPTION_TEXTS),
        "channels": [
            {"key": key, **meta} for key, meta in DELIVERY_CHANNEL_PREFERENCES.items()
        ],
        "categories": [
            {"key": key, **meta} for key, meta in OPTIONAL_EMAIL_PREFERENCES.items()
        ],
    }


async def newsletter_recipients(visibility: str = "public") -> list[dict]:
    """Return users that may receive news/event newsletters for this visibility."""
    from database import get_db
    db = get_db()
    query: dict[str, Any] = {
        "is_active": True,
        "is_banned": {"$ne": True},
        "email": {"$nin": [None, ""]},
        "newsletter_consent": True,
    }
    users = await db.users.find(
        query,
        {"_id": 0, "id": 1, "email": 1, "display_name": 1, "username": 1,
         "newsletter_consent": 1, "notification_preferences": 1},
    ).to_list(10000)
    if visibility == "members":
        memberships = await db.memberships.find(
            {"member_status": {"$in": ["active", "honorary"]}},
            {"_id": 0, "user_id": 1},
        ).to_list(10000)
        member_ids = {m["user_id"] for m in memberships}
        users = [u for u in users if u["id"] in member_ids]
    return [u for u in users if email_allowed(u, "newsletter_news", "news_events")]


async def _site_base_url() -> str:
    from database import get_db
    db = get_db()
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "domain": 1}) or {}
    domain = (branding.get("domain") or "https://lionsquad.at").strip().rstrip("/")
    if domain and not domain.startswith(("http://", "https://")):
        domain = "https://" + domain
    return domain or "https://lionsquad.at"


def _event_when(item: dict) -> str:
    from services import event_days

    lines = event_days.lines(item)
    if lines:
        return event_days.summary_text(item) + " – " + "; ".join(lines)
    return _format_de_datetime(item.get("start_date"))


def _format_de_datetime(value: Any) -> str:
    if not value:
        return ""
    try:
        dt = value if isinstance(value, datetime) else datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(ZoneInfo("Europe/Vienna")).strftime("%d.%m.%Y, %H:%M Uhr")
    except Exception:
        return ""


async def newsletter_mail_values(kind: str, item: dict) -> tuple[str, dict]:
    """Vorlage und Werte des Newsletters zu einer News oder einem Event - für den Versand und die Vorschau (#2119 ML5)."""
    base = await _site_base_url()
    preferences_url = f"{base}/profile?tab=notifications"
    slug_or_id = item.get("slug") or item.get("id")
    if kind == "news":
        return "newsletter_news", {
            "title": item.get("title") or "Neue Vereinsnews",
            "excerpt": item.get("excerpt") or "",
            "url": f"{base}/news/{slug_or_id}",
            "preferences_url": preferences_url,
        }
    return "newsletter_event", {
        "title": item.get("name") or "Neues Event",
        # Mehrtägig (#884): der Zeitraum und die Tage statt nur des Beginns.
        "when": _event_when(item),
        "location": item.get("location") or item.get("city") or "",
        "url": f"{base}/events/{slug_or_id}",
        "preferences_url": preferences_url,
    }


async def preview_newsletter(kind: str, item: dict, display_name: str) -> dict | None:
    """Die Newsletter-Mail, wie sie hinausginge - mit dem Namen der ansehenden Person als Anrede. „Nur intern“ geht
    nicht per Mail hinaus, dafür gibt es keine Vorschau."""
    if (item.get("visibility") or "public") == "internal":
        return None
    from email_service import render_named

    from services.newsletter_unsubscribe import PAGE_PATH

    template_key, values = await newsletter_mail_values(kind, item)
    # Der Abmeldelink der Vorschau führt ins Leere - ein echter würde die ansehende Person abmelden.
    values["unsubscribe_url"] = f"{await _site_base_url()}{PAGE_PATH}?token=vorschau"
    subject, html = await render_named(template_key, display_name=display_name or "Löwe", **values)
    return {"template_key": template_key, "subject": subject, "html": html}


# Gründe, aus denen ein Beitrag nie als Newsletter hinausgeht - der Versand gilt dann nicht als erledigt, sondern als
# übersprungen. „Nur App“ (#1532): die Mail führt zur Website, die den Beitrag nicht zeigt.
NEWSLETTER_SKIP_REASONS = frozenset({"internal_visibility", "not_published", "app_only"})


async def enqueue_newsletter_for_item(kind: str, item: dict, dedupe_suffix: str = "") -> dict:
    """Queue opt-in newsletter mails for a published news post or announced event."""
    if kind not in {"news", "event"}:
        return {"queued": 0, "reason": "unsupported_kind"}
    if kind == "news":
        from services.news_channels import in_channel

        if not in_channel(item, "web"):
            return {"queued": 0, "reason": "app_only"}
    visibility = item.get("visibility") or "public"
    if visibility == "internal":
        return {"queued": 0, "reason": "internal_visibility"}
    if kind == "news" and not item.get("published", True):
        return {"queued": 0, "reason": "not_published"}
    if kind == "event" and item.get("status") in {"draft", "archived", "cancelled"}:
        return {"queued": 0, "reason": "not_announced"}

    users = await newsletter_recipients(visibility)
    if not users:
        return {"queued": 0, "reason": "no_recipients"}

    template_key, common_kwargs = await newsletter_mail_values(kind, item)
    base = await _site_base_url()
    queued = 0
    from email_service import send_template
    from services.newsletter_unsubscribe import links_for, mail_headers
    for user in users:
        if not email_allowed(user, template_key, "news_events"):
            continue
        display_name = user.get("display_name") or user.get("username") or "Löwe"
        # Abbestellen mit einem Klick (#2119 ML4): Link im Text und Kopfzeilen für Gmail/Yahoo, je Person signiert.
        unsubscribe = links_for(base, user["id"])
        result = await send_template(
            template_key,
            user["email"],
            display_name=display_name,
            unsubscribe_url=unsubscribe["page"],
            mail_headers=mail_headers(unsubscribe["api"]),
            dedupe_key=f"{template_key}:{item.get('id')}:{user['id']}{dedupe_suffix}",
            mail_meta={
                "kind": "newsletter",
                "source_type": kind,
                "source_id": item.get("id"),
                "manual": bool(dedupe_suffix),
                "user_id": user["id"],
            },
            **common_kwargs,
        )
        if result.get("ok") and not result.get("deduped"):
            queued += 1
    return {"queued": queued, "recipients": len(users)}
