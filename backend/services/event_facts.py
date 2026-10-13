"""Event-Seite als Startpunkt (#1183, #1273, #1346): Fakten, Highlights, Kopfbild und der eigene Stand je Turnier.

- „Mitbringen“: eine Zeile je Punkt, höchstens ``BRING_ALONG_MAX`` Zeilen zu je ``BRING_ALONG_LENGTH`` Zeichen.
- Highlights: bis zu ``HIGHLIGHTS_MAX`` Kacheln aus einem Symbol der festen Liste und einem kurzen Text - statt
  Emoji-Überschriften im Text. Web und App kennen dieselben Symbole (``HIGHLIGHT_ICONS``).
- Kopfbild: ein Bild, zwei Orte (Event-Seite und Event-Karte). Ein Foto füllt das Banner (mit Fokuspunkt), ein Logo
  steht klein auf einer Fläche. Ob es Foto oder Logo ist, sagt die Verwaltung („banner_style“) - oder der Server
  schätzt es beim Speichern aus dem Bild (durchsichtige Flächen oder wenige Farben = Logo).
- Eigener Stand: je Turnier und Fast Lap, ob die Person dabei ist - selbst angemeldet oder mit einem ihrer Teams.
"""
from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path
from urllib.parse import urlparse

from PIL import Image, UnidentifiedImageError

from storage import PUBLIC_UPLOAD_DIR

logger = logging.getLogger("tls.event_facts")

BRING_ALONG_MAX = 8
BRING_ALONG_LENGTH = 80
HIGHLIGHTS_MAX = 6
HIGHLIGHT_TEXT_LENGTH = 60
# Die feste Liste der Symbole (Schlüssel → Wort für Vorleseprogramme); Web und App haben je ein Bild dazu.
HIGHLIGHT_ICONS = {
    "gamepad": "Zocken",
    "trophy": "Turnier",
    "flag": "Rennen",
    "monitor": "Stationen",
    "vr": "Virtual Reality",
    "retro": "Retro",
    "music": "Musik",
    "food": "Essen",
    "drink": "Getränke",
    "wifi": "WLAN",
    "gift": "Preise",
    "users": "Treffen",
    "camera": "Fotos",
    "star": "Besonderes",
}
BANNER_STYLES = ("auto", "photo", "logo")

ACTIVE_TOURNAMENT_STATES = ("pending", "approved", "checked_in", "waitlist")
OWN_STATE_LABELS = {
    "approved": "Du bist dabei",
    "checked_in": "Eingecheckt",
    "pending": "Wartet auf Freigabe",
    "waitlist": "Warteliste",
}


class FactsError(ValueError):
    pass


def _clean(value) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_bring_along(raw) -> list[str]:
    """Die Zeilen von „Mitbringen“ - leere fallen weg; zu viele oder zu lange lehnt der Server mit Satz ab."""
    if raw is None:
        return []
    items = raw if isinstance(raw, list) else str(raw).splitlines()
    lines = [_clean(item) for item in items if _clean(item)]
    if len(lines) > BRING_ALONG_MAX:
        raise FactsError(f"„Mitbringen“ hat höchstens {BRING_ALONG_MAX} Zeilen.")
    for line in lines:
        if len(line) > BRING_ALONG_LENGTH:
            raise FactsError(f"Eine Zeile bei „Mitbringen“ hat höchstens {BRING_ALONG_LENGTH} Zeichen.")
    return lines


def normalize_highlights(raw) -> list[dict]:
    """Highlights als Kacheln: Symbol aus der festen Liste und ein kurzer Text."""
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise FactsError("Highlights kommen als Liste.")
    out = []
    for entry in raw:
        if hasattr(entry, "model_dump"):
            entry = entry.model_dump()
        if not isinstance(entry, dict):
            raise FactsError("Ein Highlight braucht Symbol und Text.")
        text = _clean(entry.get("text"))
        if not text:
            continue
        icon = str(entry.get("icon") or "").strip()
        if icon not in HIGHLIGHT_ICONS:
            raise FactsError("Dieses Symbol gibt es für Highlights nicht.")
        if len(text) > HIGHLIGHT_TEXT_LENGTH:
            raise FactsError(f"Ein Highlight hat höchstens {HIGHLIGHT_TEXT_LENGTH} Zeichen.")
        out.append({"icon": icon, "text": text})
    if len(out) > HIGHLIGHTS_MAX:
        raise FactsError(f"Höchstens {HIGHLIGHTS_MAX} Highlights.")
    return out


def normalize_focus(value) -> int:
    try:
        return max(0, min(100, int(round(float(value)))))
    except (TypeError, ValueError):
        return 50


# ---------------------------------------------------------------- Kopfbild: Foto oder Logo

def _local_upload(url: str | None) -> Path | None:
    """Der Pfad eines eigenen Uploads (/api/static/uploads/…) - fremde Adressen und Ausbrüche gibt es nicht."""
    path = urlparse(str(url or "")).path
    prefix = "/api/static/uploads/"
    if not path.startswith(prefix):
        return None
    name = path[len(prefix):]
    if not name or ".." in name.split("/"):
        return None
    root = PUBLIC_UPLOAD_DIR.resolve()
    candidate = (root / name).resolve()
    return candidate if candidate.is_relative_to(root) and candidate.is_file() else None


def _guess_kind(path: Path) -> str:
    """Logo, wenn das Bild durchsichtige Flächen oder nur wenige Farben hat - sonst Foto."""
    if path.suffix.lower() == ".svg":
        return "logo"
    try:
        with Image.open(path) as image:
            image.seek(0)
            if image.mode in ("RGBA", "LA", "PA") or "transparency" in image.info:
                low, _high = image.convert("RGBA").getchannel("A").getextrema()
                if low < 250:
                    return "logo"
            colors = image.convert("RGB").resize((48, 48)).getcolors(48 * 48)
            if colors is not None and len(colors) <= 48:
                return "logo"
    except (OSError, ValueError, UnidentifiedImageError, Image.DecompressionBombError):
        return "photo"
    return "photo"


async def banner_kind(url: str | None) -> str | None:
    """„photo“ oder „logo“ für ein eigenes Bild; für fremde Adressen nichts (die Seite zeigt sie wie ein Foto)."""
    path = _local_upload(url)
    if not path:
        return None
    return await asyncio.to_thread(_guess_kind, path)


def banner_view(event: dict) -> dict | None:
    """Wie das Kopfbild steht: Art (Wahl der Verwaltung vor der Schätzung) und Fokuspunkt."""
    if not event.get("banner_url"):
        return None
    style = event.get("banner_style") if event.get("banner_style") in BANNER_STYLES else "auto"
    kind = style if style != "auto" else (event.get("banner_kind") or "photo")
    return {"url": event["banner_url"], "kind": kind, "focus_x": normalize_focus(event.get("banner_focus_x", 50)),
            "focus_y": normalize_focus(event.get("banner_focus_y", 50))}


# ---------------------------------------------------------------- Eigener Stand je Turnier und Fast Lap

async def team_ids(db, user_id: str) -> list[str]:
    """Die Teams der Person - aus der Mitgliederliste des Teams und aus ``team_members``."""
    ids = {row.get("team_id") async for row in db.team_members.find({"user_id": user_id}, {"_id": 0, "team_id": 1})}
    ids |= {row.get("id") async for row in db.teams.find({"member_ids": user_id}, {"_id": 0, "id": 1})}
    return [team_id for team_id in ids if team_id]


DRIVEN = {"state": "driven", "label": "Du bist gefahren", "team_name": None}


async def own_tournament_states(db, user_id: str, tournament_ids: list[str] | None = None) -> dict[str, dict]:
    """Der eigene Stand je Turnier: die eigene Anmeldung oder die eines eigenen Teams (dann mit Teamname).

    Ohne ``tournament_ids`` für alle Turniere - die Liste „Nur meine“ und der persönliche Kalender (#1189) brauchen sie.
    """
    if tournament_ids is not None and not tournament_ids:
        return {}
    teams = await team_ids(db, user_id)
    query: dict = {"status": {"$in": list(ACTIVE_TOURNAMENT_STATES)}}
    if tournament_ids is not None:
        query["tournament_id"] = {"$in": list(tournament_ids)}
    query["$or"] = [{"user_id": user_id}] + ([{"team_id": {"$in": teams}}] if teams else [])
    by_tournament: dict[str, dict] = {}
    async for reg in db.tournament_registrations.find(query, {"_id": 0, "tournament_id": 1, "status": 1, "team_id": 1, "display_name": 1, "user_id": 1}):
        current = by_tournament.get(reg["tournament_id"])
        # Die eigene Anmeldung zählt vor der des Teams; „dabei“ vor „Warteliste“.
        rank = (reg.get("user_id") == user_id and not reg.get("team_id"), reg.get("status") in ("approved", "checked_in"))
        if not current or rank > current["_rank"]:
            by_tournament[reg["tournament_id"]] = {**reg, "_rank": rank}
    team_names: dict[str, str] = {}
    wanted = [reg["team_id"] for reg in by_tournament.values() if reg.get("team_id")]
    if wanted:
        async for team in db.teams.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "name": 1}):
            team_names[team["id"]] = team.get("name") or ""
    states: dict[str, dict] = {}
    for tournament_id, reg in by_tournament.items():
        team_name = team_names.get(reg.get("team_id") or "") or (reg.get("display_name") if reg.get("team_id") else "")
        label = OWN_STATE_LABELS.get(reg.get("status"), "Angemeldet")
        states[tournament_id] = {"state": reg.get("status"), "label": label, "team_name": team_name or None}
    return states


async def driven_challenge_ids(db, user_id: str, challenge_ids: list[str] | None = None) -> set[str]:
    """Die Fast Laps, in denen die Person schon eine Zeit gefahren ist - dort ist sie dabei."""
    if challenge_ids is not None and not challenge_ids:
        return set()
    query: dict = {"user_id": user_id}
    if challenge_ids is not None:
        query["challenge_id"] = {"$in": list(challenge_ids)}
    return {row.get("challenge_id") async for row in db.f1_lap_times.find(query, {"_id": 0, "challenge_id": 1}) if row.get("challenge_id")}


async def attach_own_states(db, event: dict, user: dict | None) -> None:
    """``my_status`` an jedem Turnier und jeder Fast Lap des Events - nur für die Person selbst.

    Turnier: die eigene Anmeldung oder die eines eigenen Teams (dann mit Teamname). Fast Lap: ob die Person schon
    eine Zeit gefahren ist. Wer bei nichts dabei ist, bekommt keine Schilder.
    """
    tournaments = event.get("tournaments") or []
    challenges = event.get("f1_challenges") or []
    for item in (*tournaments, *challenges):
        item["my_status"] = None
    if not user or not (tournaments or challenges):
        return
    if tournaments:
        states = await own_tournament_states(db, user["id"], [t["id"] for t in tournaments])
        for tournament in tournaments:
            tournament["my_status"] = states.get(tournament["id"])
    if challenges:
        driven = await driven_challenge_ids(db, user["id"], [c["id"] for c in challenges])
        for challenge in challenges:
            if challenge["id"] in driven:
                challenge["my_status"] = dict(DRIVEN)
