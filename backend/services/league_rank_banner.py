"""Rankingbanner (Nr. 60, #2425): ein Live-Bild 1200×300 mit Platz und Bilanz eines Teams in einer Season - zum Einbinden in Discord
oder auf Streams. Fester Link je Team und Season: ``/api/leagues/<liga>/<season>/teams/<team>/banner.png``; ``<team>`` ist das Co-Team
der Anmeldung (``squad_id``), ohne Co-Team das Hauptteam (``team_id``).

Öffentlich nur, was Gäste auf der Ligaseite sehen: die Season (``league_service.visible_season`` ohne Person - öffentlich, nicht
archiviert), eine aktive Liga N und die Staffel als Turnier (die Regel der Turnierseite reicht die Route herein). Auf dem Bild stehen
nur Team, Liga, Season, Liga N, Staffel, Platz und Bilanz - keine Personen, kein Kader; eine Einzel-Liga hat kein Rankingbanner.

Zeichnen und Merken wie das Teilen-Bild der Belohnungen (``reward_share``): Pillow über ``share_image``, der Speicher
``share_image_cache.share_images`` (Fingerabdruck aus den Daten, fünf Minuten), ``Cache-Control`` über ``PUBLIC_IMAGE_PATH``.
"""
from __future__ import annotations

from PIL import ImageDraw

from services import share_image
from services.league_page import PUBLIC_REGISTRATION_STATUSES
from services.league_scope import ONLY_LEAGUE

WIDTH, HEIGHT = 1200, 300
ENTRY_LIMIT = 12


def banner_path(league_slug: str, season_slug: str, ref: str) -> str:
    return f"/api/leagues/{league_slug}/{season_slug}/teams/{ref}/banner.png"


def banner_ref(registration: dict) -> str | None:
    """Wofür das Bild steht: das Co-Team, sonst das Hauptteam - ohne Team (Einzel-Liga) nichts."""
    if not registration.get("team_id"):
        return None
    return registration.get("squad_id") or registration["team_id"]


async def _public_staffel(db, tournament: dict, season_id: str, hidden) -> dict | None:
    """Die aktive Liga N der Staffel - nur, wenn Gäste die Staffel als Turnier sehen."""
    context = tournament.get("league_context") or {}
    if context.get("season_id") != season_id:
        return None
    division = await db.league_divisions.find_one({"id": context.get("division_id"), "season_id": season_id, "status": "active"}, {"_id": 0})
    if not division or (hidden and await hidden(db, tournament, None)):
        return None
    return division


async def _staffeln(db, season_id: str) -> list[dict]:
    return await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE}, {"_id": 0}).to_list(200)


async def find_entry(db, league_slug: str, season_slug: str, ref: str, *, hidden) -> dict | None:
    """``{league, season, division, tournament, registration}`` der Anmeldung hinter dem Link - ``None``, wenn Gäste sie nicht sehen."""
    from services import league_service as leagues

    try:
        league, season = await leagues.visible_season(db, league_slug, season_slug, None)
    except leagues.LeagueProblem:
        return None
    staffeln = {row["id"]: row for row in await _staffeln(db, season["id"])}
    if not staffeln:
        return None
    candidates = await db.tournament_registrations.find(
        {"tournament_id": {"$in": list(staffeln)}, "status": {"$in": list(PUBLIC_REGISTRATION_STATUSES)},
         "team_id": {"$type": "string"}, "$or": [{"squad_id": ref}, {"team_id": ref}]}, {"_id": 0}).to_list(20)
    found = []
    for registration in candidates:
        tournament = staffeln[registration["tournament_id"]]
        division = await _public_staffel(db, tournament, season["id"], hidden)
        if division:
            found.append({"league": league, "season": season, "division": division, "tournament": tournament, "registration": registration})
    if not found:
        return None
    # Zuerst das Co-Team selbst; steht nur das Hauptteam im Link, zählt sein Co-Team in der höchsten Liga N.
    found.sort(key=lambda row: (0 if row["registration"].get("squad_id") == ref else 1, int(row["division"].get("level") or 99)))
    return found[0]


def _record(row: dict | None, rules: dict | None, rows: list[dict]) -> dict:
    row = row or {}
    draws = bool((rules or {}).get("allow_draws", True)) or any(int(other.get("drawn") or 0) for other in rows)
    return {"played": int(row.get("played") or 0), "won": int(row.get("won") or 0), "drawn": int(row.get("drawn") or 0),
            "lost": int(row.get("lost") or 0), "points": row.get("points") if isinstance(row.get("points"), (int, float)) else 0,
            "draws": draws}


async def payload(db, league_slug: str, season_slug: str, ref: str, *, hidden, rows_of) -> dict | None:
    """Was das Bild zeigt - ``None`` (404), wenn Season, Liga N, Staffel oder Team für Gäste nicht sichtbar sind. ``rows_of(tournament)``:
    die Tabelle der Staffel, wie Gäste sie sehen (die Route reicht sie herein)."""
    from services.league_service import division_label
    from services.league_table import public_rules

    entry = await find_entry(db, league_slug, season_slug, ref, hidden=hidden)
    if not entry:
        return None
    tournament, registration = entry["tournament"], entry["registration"]
    rows = await rows_of(tournament) or []
    row = next((item for item in rows if item.get("registration_id") == registration["id"]), None)
    record = _record(row, public_rules(tournament), rows)
    branding = await db.settings.find_one({"id": "branding"}, {"_id": 0, "club_name": 1}) or {}
    name = (row or {}).get("display_name") or registration.get("display_name") or registration.get("team_name") or "Team"
    return {
        "team": name, "initials": share_image.initials(name),
        "league": entry["league"].get("name") or "Liga", "season": entry["season"].get("name") or "Season",
        "division": division_label(entry["division"]), "staffel": (tournament.get("league_context") or {}).get("staffel"),
        "rank": int(row["rank"]) if row and record["played"] and row.get("rank") else None, "teams": len(rows),
        "record": record, "final": tournament.get("status") in ("completed", "archived"),
        "accent": entry["league"].get("accent_color") or share_image.CYAN,
        "club_name": branding.get("club_name") or "THE LION SQUAD",
    }


async def entries_for_team(db, team_id: str, *, hidden=None) -> list[dict]:
    """Je Season, die Gäste sehen und in der das Team spielt, der feste Link des Rankingbanners - für „Rankingbanner kopieren“ an der
    Teamseite. Neueste Season zuerst, ohne Personen."""
    from services import league_service as leagues

    registrations = await db.tournament_registrations.find(
        {"team_id": team_id, "status": {"$in": list(PUBLIC_REGISTRATION_STATUSES)}}, {"_id": 0}).to_list(500)
    if not registrations:
        return []
    tournaments = {row["id"]: row for row in await db.tournaments.find(
        {"id": {"$in": sorted({row["tournament_id"] for row in registrations})}, **ONLY_LEAGUE}, {"_id": 0}).to_list(500)}
    out: dict[str, dict] = {}
    seasons: dict[str, tuple | None] = {}
    for registration in registrations:
        tournament = tournaments.get(registration.get("tournament_id"))
        ref = banner_ref(registration)
        if not tournament or not ref:
            continue
        season_id = (tournament.get("league_context") or {}).get("season_id")
        if season_id not in seasons:
            season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0}) if season_id else None
            league = await db.leagues.find_one({"id": season.get("league_id"), "status": "active"}, {"_id": 0}) if season else None
            visible = bool(league) and season.get("status") != "archived" and await leagues.can_see_season(None, season)
            seasons[season_id] = (league, season) if visible else None
        if not seasons[season_id]:
            continue
        league, season = seasons[season_id]
        division = await _public_staffel(db, tournament, season_id, hidden)
        if not division:
            continue
        key = f"{season_id}:{ref}"
        out[key] = {
            "key": key, "league": league.get("name"), "season": season.get("name"), "division": leagues.division_label(division),
            "staffel": (tournament.get("league_context") or {}).get("staffel"), "name": registration.get("display_name") or registration.get("squad_name"),
            "image_url": banner_path(league["slug"], season["slug"], ref), "page_url": f"/liga/{league['slug']}/{season['slug']}",
            "start_date": season.get("start_date") or "",
        }
    rows = sorted(out.values(), key=lambda row: (str(row["start_date"]), row["key"]), reverse=True)
    return [{key: value for key, value in row.items() if key != "start_date"} for row in rows[:ENTRY_LIMIT]]


# ---------------------------------------------------------------- Zeichnen

def record_text(record: dict) -> str:
    """„5 S · 1 U · 2 N“ - ohne Remis in der Liga ohne „U“."""
    parts = [f"{record.get('won', 0)} S"]
    if record.get("draws"):
        parts.append(f"{record.get('drawn', 0)} U")
    parts.append(f"{record.get('lost', 0)} N")
    return " · ".join(parts)


def points_text(record: dict) -> str:
    points = record.get("points") or 0
    value = int(points) if float(points).is_integer() else points
    return f"{value} {'Punkt' if value == 1 else 'Punkte'}"


def render(data: dict) -> bytes:
    accent = share_image.hex_color(data.get("accent"), fallback=share_image.CYAN.lstrip("#"))
    image = share_image.canvas((WIDTH, HEIGHT), accent)
    draw = ImageDraw.Draw(image)
    share_image.frame(draw, (WIDTH, HEIGHT), accent, inset=14)

    # Links der Platz groß in einem Feld der Akzentfarbe - Gold nur für Platz 1 einer abgeschlossenen Staffel.
    rank = data.get("rank")
    mark = share_image.hex_color(share_image.GOLD) if rank == 1 and data.get("final") else accent
    draw.rounded_rectangle((44, 44, 256, 256), radius=18, fill=share_image.blend(mark, 46), outline=share_image.blend(mark, 170), width=3)
    label_font = share_image.font(20)
    label = "PLATZ" if rank else "NOCH OFFEN"
    box = draw.textbbox((0, 0), label, font=label_font)
    draw.text((150 - (box[2] - box[0]) / 2 - box[0], 66), label, font=label_font, fill=mark)
    number = str(rank) if rank else "–"
    number_font = share_image.fit(draw, number, 120, 180, min_size=60)
    box = draw.textbbox((0, 0), number, font=number_font)
    draw.text((150 - (box[2] - box[0]) / 2 - box[0], 160 - (box[3] - box[1]) / 2 - box[1]), number, font=number_font, fill=(255, 255, 255, 255))
    if rank and data.get("teams"):
        of_font = share_image.font(20, bold=False)
        of_text = f"von {data['teams']}"
        box = draw.textbbox((0, 0), of_text, font=of_font)
        draw.text((150 - (box[2] - box[0]) / 2 - box[0], 222), of_text, font=of_font, fill=(255, 255, 255, 170))

    left, right = 296, WIDTH - 60
    max_width = right - left
    kicker = " · ".join(part for part in (data.get("league"), data.get("season")) if part).upper()
    kicker_font = share_image.font(22)
    draw.text((left, 50), share_image.ellipsis(draw, kicker, kicker_font, max_width), font=kicker_font, fill=accent)
    team = str(data.get("team") or "Team")
    team_font = share_image.fit(draw, team, 64, max_width, min_size=34)
    draw.text((left, 84), share_image.ellipsis(draw, team, team_font, max_width), font=team_font, fill=(255, 255, 255, 255))
    where = " · ".join(part for part in (data.get("division"), f"Staffel {data['staffel']}" if data.get("staffel") else "") if part)
    if data.get("final"):
        where = f"{where} · Endstand" if where else "Endstand"
    where_font = share_image.font(26, bold=False)
    draw.text((left, 170), share_image.ellipsis(draw, where, where_font, max_width), font=where_font, fill=(255, 255, 255, 190))

    record = data.get("record") or {}
    stats_font = share_image.font(30)
    if record.get("played"):
        x = left
        x += share_image.chip(draw, x, 214, record_text(record), stats_font, color=accent) + 14
        share_image.chip(draw, x, 214, points_text(record), stats_font, color=accent)
    else:
        draw.text((left, 222), "Noch ohne Spiel", font=stats_font, fill=(255, 255, 255, 170))
    club = str(data.get("club_name") or "THE LION SQUAD").upper()
    club_font = share_image.font(18)
    width = draw.textlength(club, font=club_font)
    draw.text((right - width, 252), club, font=club_font, fill=(255, 255, 255, 120))
    return share_image.png(image)
