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

from dataclasses import dataclass

SETTING = "privacy_members_see_internal"


@dataclass(frozen=True)
class ProfileScope:
    """Was ein Betrachter im Profil sieht: ``self`` alles, ``members`` dazu Internes, das er selbst sehen darf,
    ``public`` nur Öffentliches. ``viewer`` nur bei ``members`` - für die Sichtbarkeitsstufen des einzelnen Eintrags."""

    mode: str
    viewer: dict | None = None

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
        return ProfileScope("members", viewer)
    return PUBLIC


async def sees_tournament(scope: ProfileScope, tournament: dict | None) -> bool:
    """Ein Turnier in den Referenzen bzw. als Weg: für Gäste die Regel von ``tournament_hidden_reason`` ohne Person."""
    if not tournament:
        return False
    if scope.everything:
        return True
    if tournament.get("status") == "draft" or tournament.get("is_public") is False:
        return False
    from services.visibility import user_can_see

    return await user_can_see(scope.viewer, tournament.get("visibility") or "public")


async def sees_challenge(scope: ProfileScope, challenge: dict | None) -> bool:
    if not challenge:
        return False
    if scope.everything:
        return True
    if challenge.get("status") == "draft":
        return False
    from services.visibility import user_can_see

    return await user_can_see(scope.viewer, challenge.get("visibility") or "public")


async def tournament_is_internal(tournament: dict | None) -> bool:
    return not await sees_tournament(PUBLIC, tournament)


async def challenge_is_internal(challenge: dict | None) -> bool:
    return not await sees_challenge(PUBLIC, challenge)
