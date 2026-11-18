"""Vereinsinterne Erfolge im Profil (#2516): eine Regel für Referenzen und Trophäen, in Web und App gleich.

„Intern“ ist, was ein Gast nicht sähe: ein Turnier, das nicht öffentlich sichtbar ist (``visibility`` nicht ``public``
oder ``is_public: false``), eine Fast-Lap-Challenge mit Sichtbarkeit unter „öffentlich“, eine Trophäe aus so einem
Turnier oder einer Season, die Gäste nicht sehen. Solche Einträge tragen ``internal: true``.

Wer sieht Internes im Profil einer Person:

- die Person selbst - immer, auch mit ausgeschaltetem Schalter;
- angemeldete Vereinsmitglieder (``sees_member_content``: aktive Mitgliedschaft oder Bereich Vereinsverwaltung bzw.
  System, wie bei „Nur Mitglieder“), solange die Person den Schalter „Vereinsinterne Erfolge zeigen“
  (``privacy_members_see_internal``) nicht ausgeschaltet hat. Auch dann nur, was das Mitglied selbst sehen dürfte:
  keine Turniere „Intern“ (Vereinsverwaltung) ohne diesen Bereich und keine Turniere, die nicht auf Public-Seiten stehen;
- alle anderen (Gäste, angemeldete Nicht-Mitglieder) sehen nur Öffentliches, auch nicht per Schalter.

Ohne gespeichertes Feld gilt der Schalter als an - keine Migration.
"""
from __future__ import annotations

from dataclasses import dataclass, field

SETTING = "privacy_members_see_internal"


@dataclass(frozen=True)
class ProfileScope:
    """Was ein Betrachter im Profil sieht: ``self`` alles, ``members`` dazu Internes, das er selbst sehen darf,
    ``public`` nur Öffentliches. ``viewer`` nur bei ``members`` - für die Sichtbarkeitsstufen des einzelnen Eintrags.

    ``memo``: je Aufruf einmal je Sichtbarkeitsstufe, Season bzw. Liga entschieden (wie ``visibility.filter_visible``) - die
    Bereiche einer Person brauchen Datenbank-Abfragen, und vierzig interne Turniere sollen sie nicht vierzigmal stellen. Je
    Anfrage ein neuer Scope (``scope_for``); ``SELF`` und ``PUBLIC`` fragen nie nach einer Person und merken sich nichts."""

    mode: str
    viewer: dict | None = None
    memo: dict = field(default_factory=dict, compare=False, hash=False, repr=False)

    @property
    def everything(self) -> bool:
        return self.mode == "self"


SELF = ProfileScope("self")
PUBLIC = ProfileScope("public")


def members_see_internal(owner: dict | None) -> bool:
    """Der Schalter der Person - ohne Feld an."""
    return (owner or {}).get(SETTING) is not False


async def scope_for(viewer: dict | None, owner: dict | None) -> ProfileScope:
    """Die eine Entscheidung je Betrachter. ``viewer`` ist die angemeldete Person der Anfrage (oder ``None``); wer
    „So sehen dich andere“ nutzt, übergibt ``None``."""
    if not owner or not owner.get("id"):
        return PUBLIC
    if viewer and viewer.get("id") == owner["id"]:
        return SELF
    if not viewer or not members_see_internal(owner):
        return PUBLIC
    from services.visibility import sees_member_content

    if await sees_member_content(viewer):
        return members_scope(viewer, member=True)
    return PUBLIC


def members_scope(viewer: dict, *, member: bool | None = None) -> ProfileScope:
    """Ein neuer Scope für ein Mitglied - ``member=True``, wenn ``sees_member_content`` schon entschieden ist: Die Stufe
    „members“ ist genau diese Frage und wird dann nicht noch einmal gestellt."""
    scope = ProfileScope("members", viewer)
    if member is not None:
        scope.memo[("level", "members")] = member
    return scope


async def viewer_sees_level(scope: ProfileScope, visibility: str | None) -> bool:
    """``user_can_see`` des Betrachters für eine Stufe - je Scope einmal je Stufe."""
    from services.visibility import user_can_see

    level = visibility or "public"
    if scope.viewer is None:
        return await user_can_see(None, level)  # ohne Person keine Abfrage
    key = ("level", level)
    if key not in scope.memo:
        scope.memo[key] = await user_can_see(scope.viewer, level)
    return scope.memo[key]


async def sees_tournament(scope: ProfileScope, tournament: dict | None) -> bool:
    """Ein Turnier in den Referenzen bzw. als Weg: für Gäste die Regel von ``tournament_hidden_reason`` ohne Person."""
    if not tournament:
        return False
    if scope.everything:
        return True
    if tournament.get("status") == "draft" or tournament.get("is_public") is False:
        return False
    return await viewer_sees_level(scope, tournament.get("visibility"))


async def sees_challenge(scope: ProfileScope, challenge: dict | None) -> bool:
    if not challenge:
        return False
    if scope.everything:
        return True
    if challenge.get("status") == "draft":
        return False
    return await viewer_sees_level(scope, challenge.get("visibility"))


def public_season(season: dict | None) -> bool:
    """Sieht ein Gast die Season? Wie ``league_service.can_see_season`` ohne Person, dazu nie archiviert."""
    return bool(season) and season.get("status") != "archived" and season.get("visibility") == "public"


async def sees_season(scope: ProfileScope, season: dict | None) -> bool:
    """Eine Liga-Season im Profil (Trophäen, Liga-Historie, Gesamtwertung - #2516, #2521): die Person selbst jede nicht archivierte,
    Gäste ``public_season``, ein Vereinsmitglied dazu „Nur Mitglieder“ - je Stufe einmal (``scope.memo``).

    **Liga-Rechte zählen hier nicht** (Fabian, 18.11.): Eine Season „Nur Liga-Leitung“ oder „Aus“ sieht im Profil nur die Person selbst,
    auch Liga-Leitung und Admins nicht - in der Liga-Verwaltung sehen sie weiter alles. Das ist bewusst enger als
    ``league_service.can_see_season`` (Season-Seite); ``opens_season_page`` bildet jene nach, nur für den Link. Eine **archivierte**
    Season zählt nie. tests/test_season_rule_parity_flow.py prüft beide Regeln über alle Betrachter."""
    if not season or season.get("status") == "archived":
        return False
    if scope.everything:
        return True
    visibility = season.get("visibility") or "off"
    if visibility == "public":
        return True
    if scope.viewer is None or visibility != "members":
        return False
    return await viewer_sees_level(scope, "members")


async def opens_season_page(viewer: dict | None, season: dict | None, memo: dict) -> bool:
    """Darf ``viewer`` die Season-Seite öffnen? Genau ``league_service.can_see_season`` (Liga-Rechte, „Nur Mitglieder“), hier ohne
    ``league_service`` (Import-Graph der Erfolge, tests/test_import_cycles_unit.py) - je Liga und Stufe einmal in ``memo``. Das Profil
    zeigt eine Season, die die Person nicht öffnen darf (ihre eigene „Aus“ oder „Nur Liga-Leitung“), ohne Link (#2521)."""
    visibility = (season or {}).get("visibility") or "off"
    if visibility == "public":
        return True
    if not season or not viewer or visibility not in ("members", "admins"):
        return False
    league_key = ("league", season.get("league_id"))
    if league_key not in memo:
        from services.league_permissions import ANY, can

        memo[league_key] = await can(viewer, ANY, season.get("league_id"))
    if memo[league_key]:
        return True
    if visibility != "members":
        return False
    if ("level", "members") not in memo:
        from services.visibility import user_can_see

        memo[("level", "members")] = await user_can_see(viewer, "members")
    return memo[("level", "members")]


async def sees_listed_tournament(scope: ProfileScope, tournament: dict | None) -> bool:
    """Ein Turnier in einer Liste des Profils (Teilnahmen, Liga-Staffeln - #2521): wie ``sees_tournament``, aber ein Entwurf nie, auch
    nicht für die Person selbst - er ist nicht intern, sondern noch nicht veröffentlicht."""
    return bool(tournament) and tournament.get("status") != "draft" and await sees_tournament(scope, tournament)


async def sees_listed_challenge(scope: ProfileScope, challenge: dict | None) -> bool:
    """Eine Fast-Lap-Challenge im Profil (Bestzeiten, Referenzen): ein Entwurf nie, auch nicht für die Person selbst (#2521)."""
    return bool(challenge) and challenge.get("status") != "draft" and await sees_challenge(scope, challenge)


async def tournament_is_internal(tournament: dict | None) -> bool:
    return not await sees_tournament(PUBLIC, tournament)


async def challenge_is_internal(challenge: dict | None) -> bool:
    return not await sees_challenge(PUBLIC, challenge)
