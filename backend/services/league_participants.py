"""Teilnehmerart einer Liga (#1629, P1 Solo-Grundlage; docs/LIGA.md, Abschnitt 2 und „Solo-Liga“).

Eine Liga spielt entweder mit **Co-Teams** (``participant_kind="team"``, wie seit Stufe 1) oder mit **Spielern**
(``"solo"``, 1 gegen 1). Die Art steht ab dem Anlegen fest (Fabian 27.11., F3 A) und wird gegen ``games.supports_solo``
geprüft. Fehlt das Feld an einer Liga, ist sie eine Team-Liga - so bleibt alles wie vorher.

Hier steht nur, was beide Arten unterscheidet: die Prüfung beim Anlegen, die Vorgaben einer neuen Solo-Season (S11) und die
Sätze für die Wege, die es für Spieler erst in späteren Paketen gibt („folgt“). Kein Datenbankzugriff, keine Importe aus der
Liga-Schicht - so bleibt der Import-Graph ohne Kreis.
"""
from __future__ import annotations

TEAM = "team"
SOLO = "solo"
KINDS = (TEAM, SOLO)
KIND_LABELS = {TEAM: "Co-Teams", SOLO: "Spieler (1 gegen 1)"}

# Vorgaben einer neuen Season in einer Solo-Liga (S11): jede Person spielt für sich - ein Spieler je Map, der „Kader“ ist die Person,
# beim Check-in reicht sie selbst. Das sind Vorgaben: Was die Leitung mitschickt, gilt (bis auf die Teamgröße, ``season_problem``).
SOLO_SEASON_DEFAULTS: dict = {
    "team_size": 1,
    "min_squad_size": 1,
    "max_squad_size": 1,
    "lineup_min_players": 1,
}

KIND_LOCKED = ("Die Teilnehmerart steht ab dem Anlegen fest – für Spieler statt Co-Teams (oder umgekehrt) bitte eine neue Liga "
               "anlegen.")
TEAM_SIZE_SOLO = "In einer Solo-Liga spielt jede Person für sich – die Teamgröße ist dort immer 1."
SQUAD_SIZE_SOLO = "In einer Solo-Liga ist der Kader die Person selbst – der Mindestkader ist dort immer 1."
# Wege, die es für Spieler erst in einem späteren Paket gibt (#1629, P3 und P4): gesperrt mit klarem Satz statt halb gebaut. Die
# Selbstanmeldung als Spieler gibt es seit P2.
# Das Los rechnet mit Co-Teams und Hauptteams (Geschwister-Regel) - für Spieler teilt die Leitung im Eingang zu.
DRAW_FOLLOWS = ("Das Auslosen auf mehrere Staffeln folgt für Solo-Ligen in einem späteren Ausbau – bis dahin teilst du die Spieler im "
                "Eingang einer Staffel zu.")
OPERATIONS_FOLLOW = ("Der Spielbetrieb einer Solo-Liga (Check-in, Veto, Ergebnis melden) folgt in einem späteren Ausbau – die Staffel "
                     "bleibt bis dahin im Entwurf.")
SUCCESSOR_FOLLOWS = ("Die Folge-Season mit Auf- und Abstieg und Startrechten folgt für Solo-Ligen in einem späteren Ausbau – bis dahin "
                     "eine neue Season anlegen und die Spieler zuteilen.")
# Prüfung vor der Veröffentlichung (Nr. 297): Veröffentlichen bleibt erlaubt, „Was fehlt noch?“ warnt aber, bis P3 steht.
READINESS_FOLLOWS = ("Solo-Liga: Spielbetrieb folgt – Spiele lassen sich noch nicht austragen. Veröffentlichen geht, die Staffeln "
                     "starten aber erst, wenn Check-in, Veto und Melden für Spieler fertig sind.")
WRONG_ENTRY_SOLO = "In dieser Staffel spielen Spieler, keine Co-Teams – bitte eine Person zuteilen."
WRONG_ENTRY_TEAM = "In dieser Staffel spielen Co-Teams – bitte ein Co-Team zuteilen."
# Status einer Solo-Staffel, die erst mit dem Spielbetrieb (P3) Sinn haben.
OPERATING_STATUSES = frozenset({"live", "paused", "completed", "results_published"})


def kind_of(league: dict | None) -> str:
    """Die Teilnehmerart einer Liga - ohne Feld (alle Ligen vor #1629) ``team``."""
    kind = (league or {}).get("participant_kind")
    return kind if kind in KINDS else TEAM


def is_solo(league: dict | None) -> bool:
    return kind_of(league) == SOLO


def game_allows(game: dict | None, kind: str) -> bool:
    """Darf dieses Spiel eine Liga dieser Art tragen? Team-Ligen wie bisher immer; Solo nur, wenn das Spiel Einzelspieler erlaubt
    (``supports_solo``, ohne Feld wie im Spiel-Modell: ja)."""
    if kind != SOLO:
        return True
    return (game or {}).get("supports_solo") is not False


def solo_off_problem(league_names: list[str]) -> str | None:
    """Einzelspieler am Spiel ausschalten (#1629, Nr. 296): nicht still, solange Solo-Ligen (auch archivierte) das Spiel spielen."""
    if not league_names:
        return None
    return (f"Spiel hat Solo-Ligen: {', '.join(league_names)}. Einzelspieler bleiben erlaubt, solange eine Solo-Liga dieses Spiel "
            "spielt – auch eine archivierte. Für Teams allein eine neue Team-Liga anlegen.")


def game_problem(game: dict | None, kind: str) -> str | None:
    if game_allows(game, kind):
        return None
    name = (game or {}).get("name") or "Dieses Spiel"
    return f"{name} ist nicht für Einzelspieler eingestellt – eine Solo-Liga geht nur mit einem Spiel, das Einzelspieler erlaubt."


def season_defaults(league: dict | None) -> dict:
    """Was eine neue Season dieser Liga über die allgemeinen Vorgaben legt - bei Team-Ligen nichts."""
    return dict(SOLO_SEASON_DEFAULTS) if is_solo(league) else {}


def season_problem(league: dict | None, settings: dict) -> str | None:
    """Werte, die es in einer Solo-Liga nicht gibt (Season oder Liga N, schon zusammengelegt). Das Anmeldefenster gibt es seit P2 wie bei
    Team-Ligen. Team-Ligen: nie etwas."""
    if not is_solo(league):
        return None
    if settings.get("team_size") is not None and int(settings["team_size"]) != 1:
        return TEAM_SIZE_SOLO
    if settings.get("min_squad_size") is not None and int(settings["min_squad_size"]) != 1:
        return SQUAD_SIZE_SOLO
    return None


def is_person_application(application: dict | None) -> bool:
    """Ein Antrag einer Person (#1629, P2): derselbe Antrag wie beim Co-Team, nur mit ``user_id`` statt Co-Team. Bleibt auch nach einer
    Kontolöschung (``user_id`` dann leer) ein Antrag einer Person - Team-Anträge tragen immer ein Co-Team."""
    return bool(application) and not application.get("squad_id")


def application_entry(application: dict | None) -> str | None:
    """Wer sich mit dem Antrag anmeldet, in der Form des Season-Schlüssels: das Co-Team oder ``user:<id>``."""
    application = application or {}
    return application.get("squad_id") or person_entry(application.get("user_id"))


def is_solo_staffel(tournament: dict | None) -> bool:
    """Eine Staffel einer Solo-Liga: Liga-Rahmen und ``team_mode="solo"`` (die Staffel übernimmt die Art beim Anlegen)."""
    tournament = tournament or {}
    return isinstance(tournament.get("league_context"), dict) and tournament.get("team_mode") == SOLO


def person_entry(user_id: str | None) -> str | None:
    """Die Kennung einer Person als Teilnehmer der Season - neben der Co-Team-Kennung im selben Season-Schlüssel
    (``<season>:user:<id>``, wie in Gesamtwertung und Moment)."""
    return f"user:{user_id}" if user_id else None
