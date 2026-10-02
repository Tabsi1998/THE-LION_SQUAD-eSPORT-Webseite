"""Der Nikolausstiefel (Jahreszeiten II S8, X3 #736).

Am 6. Dezember liegt für jede angemeldete Person ein Sticker im Stiefel - einer je Person und Jahr, aus dem
Saison-Paket „Vom Nikolaus“ (``services/stickers.py``). Welcher, sagt der Zufall aus Person und Jahr; wer aus früheren
Jahren schon welche hat, bekommt einen, den er noch nicht hat. Danach steht er im Chat unter „Vom Nikolaus“.

Ob der Nikolaus gerade da ist, entscheidet dieselbe Rechnung wie für Web und App (``seasons.active`` mit den
Einstellungen aus dem Admin): ausgeschaltet kein Stiefel, erzwungen auch an einem anderen Tag. Ist das Paket im Admin
abgeschaltet, bleibt der Stiefel leer - der Gruß kommt trotzdem.
"""
from __future__ import annotations

from services import season_stickers

SEASON = "nikolaus"
season_year = season_stickers.season_year


def pick_sticker(stickers: list[dict], user_id: str, year: int, owned: set[str]) -> dict:
    """Ein Sticker für diese Person in diesem Jahr - zuerst einer, den sie noch nicht hat (``season_stickers``)."""
    return season_stickers.pick_sticker(stickers, SEASON, user_id, year, owned)


async def boot_state(db, user: dict, season: dict | None) -> dict:
    """Was der Stiefel für diese Person gerade ist: da oder nicht, schon geöffnet, und was drin war."""
    if not season:
        return {"active": False, "opened": False, "sticker": None}
    year = season_year(season)
    state = await season_stickers.gift_state(db, SEASON, user["id"], year)
    return {"active": True, "year": year, "opened": state["given"], "sticker": state["sticker"]}


def preview_open(user: dict, season: dict) -> dict:
    """Vorschau (nur mit Token, nur für diese Person): der Stiefel geht auf und zeigt den Sticker, den sie bekäme -
    ohne etwas zu vergeben oder zu speichern; beliebig oft."""
    return season_stickers.preview_gift(SEASON, user["id"], season_year(season))


async def open_boot(db, user: dict, season: dict) -> dict:
    """Den Stiefel öffnen: beim ersten Mal im Jahr ein neuer Sticker (``new``), danach derselbe noch einmal. Im Admin
    abgeschaltetes Paket: der Stiefel bleibt leer."""
    return await season_stickers.give(db, SEASON, user["id"], season_year(season))
