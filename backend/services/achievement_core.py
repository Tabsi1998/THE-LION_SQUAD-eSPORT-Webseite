"""Kern der Erfolge ohne Rück-Importe (#1420): Vorfall-Typen und der Zugang zur Auswertung.

Die Auswertung selbst (``badges.evaluate_user_progress``) vergibt Stufen, schreibt XP und stellt Folge-Auswertungen in
die Warteschlange - sie steht also über der Warteschlange und den Zählern. Damit die beiden sie trotzdem aufrufen
können (Warteschlange abarbeiten, nächtlicher Abgleich), meldet badges.py sie beim Import hier an. Der Server lädt
badges.py beim Start; ohne Anmeldung gibt es einen klaren Fehler statt einer stillen Lücke.
"""
from __future__ import annotations

from typing import Awaitable, Callable
from zoneinfo import ZoneInfo

# Phase B v4.1: Vorfall-Typ -> negative Stufe (Admin, Wertung „nicht erschienen“, Streit, Abbruch).
NEGATIVE_INCIDENTS = {
    "afk":              "neg_afk",
    "no_show":          "neg_no_show",
    "ghost":            "neg_ghost",
    "rage_quit":        "neg_rage_quit",
    "controller_throw": "neg_controller_throw",
    "chat_warning":     "neg_chat_warning",
    "dispute_open":     "neg_dispute",
    "team_no_show":     "neg_team_no_show",
    "wrong_lobby":       "neg_wrong_lobby",
    "mute_master":       "neg_mute_master",
    "screenshot_missing": "neg_screenshot_missing",
    "patchday_victim":   "neg_patchday_victim",
    "cable_chaos":       "neg_cable_chaos",
    "alt_tab_champion":  "neg_alt_tab_champion",
    "rulebook_speedrun": "neg_rulebook_speedrun",
    "start_sleep":       "neg_start_sleep",
    "setup_curse":       "neg_setup_curse",
    "capslock_captain":  "neg_capslock_captain",
    "stream_muted":      "neg_stream_muted",
    "wrong_game":        "neg_wrong_game",
    "bracket_blind":     "neg_bracket_blind",
    "ping_panic":        "neg_ping_panic",
    "keyboard_gymnastics": "neg_keyboard_gymnastics",
    "controller_lowbat": "neg_controller_lowbat",
    "last_second_update": "neg_last_second_update",
    "rule_question_loop": "neg_rule_question_loop",
    "wrong_car":         "neg_wrong_car",
    "boxenfunk_chaos":   "neg_boxenfunk_chaos",
    "photo_finish_fail": "neg_photo_finish_fail",
    "lobby_tourist":     "neg_lobby_tourist",
    "capslock_strategy": "neg_capslock_strategy",
    "snack_meta":        "neg_snack_meta",
    "warmup_worldchamp": "neg_warmup_worldchamp",
    "setup_jenga":       "neg_setup_jenga",
}


# Farben der Gratulation (#568): je Level, seit Erfolge II (#611) je Material - das Level bleibt der Rückfall.
LEVEL_COLORS = {1: 0xCD7F32, 2: 0xC0C0C0, 3: 0xFFD700, 4: 0x29B6E8, 5: 0xFF3B30}
# Erfolge II (#611): Farbe je Material für Einbettungen; das alte Level bleibt als Rückfall.
MATERIAL_COLORS = {key: int(str(value["color"]).lstrip("#"), 16) for key, value in __import__("achievement_catalog").MATERIALS.items()}

# Sammlungen der Zähler (#616) und der Signale (#678) - die Mitglieder-Aktivität und die Fundstücke lesen sie mit.
VIENNA = ZoneInfo("Europe/Vienna")
STATS = "user_achievement_stats"
SIGNALS = "user_signals"
# Name → Regeln: höchstens so oft je Tag, nur in dieser Saison (wenn gesetzt), nur in diesen Phasen.
# ``live``: zählt nur im Augenblick selbst und lässt sich nicht nachmelden (Silvester um Mitternacht, App geöffnet).
# ``server``: zählt nur der Server selbst, wenn er das Ereignis geprüft hat (Türchen geöffnet) - ein Client kann es nicht melden.
SIGNAL_RULES: dict[str, dict] = {
    "halloween_pumpkin": {"per_day": 1, "season": "halloween"},
    "halloween_bats_scared": {"per_day": 30, "season": "halloween"},
    "halloween_ghosts_freed": {"per_day": 20, "season": "halloween"},
    "halloween_cat_petted": {"per_day": 10, "season": "halloween"},
    "snowflakes_clicked": {"per_day": 200, "season": "snow"},
    "online_at_new_year": {"per_day": 1, "season": "new_year", "phases": {"pre_countdown", "countdown", "show", "fade"}, "live": True},
    "konami": {"per_day": 1},
    "lost_404": {"per_day": 1},
    "logo_clicks": {"per_day": 100},
    "explorer_done": {"per_day": 1},
    "calendar_used": {"per_day": 1},
    "member_card_added": {"per_day": 1},
    "app_open": {"per_day": 1, "live": True},
    "tutorial_done": {"per_day": 1},
    "advent_door": {"per_day": 24, "season": "advent_calendar", "server": True},
    "easter_egg": {"per_day": 50, "season": "easter_hunt"},
}

Evaluator = Callable[..., Awaitable[int]]
_evaluator: Evaluator | None = None


def register_evaluator(evaluate: Evaluator) -> None:
    """Die Auswertung anmelden - badges.py tut das beim Import."""
    global _evaluator
    _evaluator = evaluate


def evaluator() -> Evaluator:
    """Die angemeldete Auswertung; ohne Anmeldung ein Fehler, bevor etwas aus der Warteschlange genommen wird."""
    if _evaluator is None:
        raise RuntimeError("Erfolge-Auswertung nicht angemeldet - badges.py wurde nicht geladen")
    return _evaluator
