"""Teilnehmer externer Serien - gemeinsam für Zuordnung (#1743) und Eintragen (#1744).

- ``build_index`` lädt einmal je Anfrage alles, was Vorschläge und das Wiedererkennen über Aliase brauchen
  (``series_identity.IdentityIndex``): Vereinsprofile, Aliase der Namen, Spiel-IDs aus den Konten und frühere
  Startnummern der Spur. ``with_ids=False`` reicht fürs bloße Wiedererkennen.
- ``new_participant`` legt einen Teilnehmer „offen“ an - außer ein bestätigter Alias (gleicher Name, gleiches Spiel)
  ordnet ihn sofort zu.
- ``remove_unused_new`` nimmt Teilnehmer zurück, die nur ein verworfener Entwurf angelegt hat: nur, wenn sie noch
  offen sind (keine Zuordnung, kein Alias) und in keinem Ergebnisblatt der Saison vorkommen.
"""
from __future__ import annotations

from models import new_id, now_utc
from services import series_identity


def clean(value) -> str:
    return " ".join(str(value or "").split())


async def series_game_id(db, series: dict) -> str | None:
    lineage = await db.reference_lineages.find_one({"id": series.get("lineage_id")}, {"_id": 0, "game_id": 1}) or {}
    return lineage.get("game_id")


# ---------------------------------------------------------------- Index für Vorschläge
async def club_profiles(db) -> dict[str, dict]:
    rows = await db.club_member_profiles.find(
        {"is_active": {"$ne": False}},
        {"_id": 0, "id": 1, "user_id": 1, "display_name": 1, "gamertag": 1},
    ).to_list(None)
    return {row["id"]: row for row in rows if row.get("id")}


def profile_name(row: dict) -> str:
    return row.get("display_name") or row.get("gamertag") or "Mitglied"


async def _game_slugs(db, game_id: str | None) -> tuple[list[str], dict[str, str]]:
    """Slugs des Spiels (samt Grundspiel einer Edition) und die Bezeichnungen seiner Spieler-ID-Felder."""
    if not game_id:
        return [], {}
    game = await db.games.find_one({"id": game_id}, {"_id": 0}) or {}
    games = [game]
    if game.get("parent_game_id"):
        games.append(await db.games.find_one({"id": game["parent_game_id"]}, {"_id": 0}) or {})
    labels: dict[str, str] = {}
    for item in games:
        for spec in item.get("player_id_fields") or []:
            if isinstance(spec, dict) and spec.get("key"):
                labels.setdefault(spec["key"], spec.get("label") or spec["key"])
    return [item["slug"] for item in games if item.get("slug")], labels


async def _account_ids(db, profiles: dict[str, dict], game_id: str | None) -> list[dict]:
    """Kennungen aus den Konten mit Vereinsprofil: je Spiel (Reiter „Gaming“) und die Plattform-Kennungen. Ohne Spiel
    der Spur zählen die Kennungen aller Spiele."""
    profile_of = {row["user_id"]: pid for pid, row in profiles.items() if row.get("user_id")}
    if not profile_of:
        return []
    slugs, labels = await _game_slugs(db, game_id)
    fields = {"_id": 0, "id": 1, "game_ids": 1, **{key: 1 for key, _ in series_identity.PLATFORM_IDS}}
    out = []
    async for user in db.users.find({"id": {"$in": list(profile_of)}}, fields):
        pid = profile_of.get(user.get("id"))
        for key, label in series_identity.PLATFORM_IDS:
            if isinstance(user.get(key), str) and user[key].strip():
                out.append({"profile_id": pid, "value": user[key], "label": label})
        per_game = user.get("game_ids") or {}
        chosen = [per_game.get(slug) for slug in slugs] if game_id else list(per_game.values())
        for values in chosen:
            if not isinstance(values, dict):
                continue
            for key, value in values.items():
                if isinstance(value, str) and value.strip():
                    out.append({"profile_id": pid, "value": value, "label": labels.get(key) or "Spiel-ID"})
    return out


async def _start_numbers(db, series: dict) -> list[dict]:
    """Startnummern verknüpfter Mitglieder aus den anderen Saisons derselben Spur - nur als Hinweis."""
    others = await db.reference_series.find(
        {"lineage_id": series.get("lineage_id"), "id": {"$ne": series["id"]}}, {"_id": 0, "id": 1, "season": 1},
    ).to_list(None)
    season_of = {row["id"]: row.get("season") for row in others}
    if not season_of:
        return []
    rows = await db.reference_participants.find(
        {"series_id": {"$in": list(season_of)}, "link": "member", "profile_id": {"$ne": None},
         "start_number": {"$nin": [None, ""]}},
        {"_id": 0, "series_id": 1, "profile_id": 1, "start_number": 1},
    ).to_list(None)
    return [{"profile_id": row["profile_id"], "start_number": row["start_number"],
             "season": season_of.get(row["series_id"])} for row in rows]


async def _aliases(db, names: list[str]) -> list[dict]:
    keys = sorted({key for name in names for key in series_identity.name_keys(name)})
    if not keys:
        return []
    return await db.reference_aliases.find({"name_normalized": {"$in": keys}}, {"_id": 0}).to_list(None)


async def build_index(db, series: dict, names: list[str], *, with_ids: bool = True) -> series_identity.IdentityIndex:
    """Index für die Namen ``names``. ``with_ids=False`` reicht fürs bloße Wiedererkennen über Aliase."""
    profiles = await club_profiles(db)
    game_id = await series_game_id(db, series)
    profile_names = [{"profile_id": pid, "value": value} for pid, row in profiles.items()
                     for value in dict.fromkeys(filter(None, (row.get("display_name"), row.get("gamertag"))))]
    return series_identity.IdentityIndex(
        profiles={pid: profile_name(row) for pid, row in profiles.items()},
        aliases=await _aliases(db, names),
        game_ids=await _account_ids(db, profiles, game_id) if with_ids else [],
        start_numbers=await _start_numbers(db, series) if with_ids else [],
        game_id=game_id,
        profile_names=profile_names,
    )


def link_fields(alias: dict) -> dict:
    member = alias.get("target") == "member"
    return {"link": "member" if member else "guest", "profile_id": alias.get("profile_id") if member else None,
            "guest_name": None if member else alias.get("guest_name"), "is_club_member": member}


async def new_participant(db, series: dict, index: series_identity.IdentityIndex, fields: dict, me: dict) -> dict:
    now = now_utc().isoformat()
    name = clean(fields["name"])
    doc = {
        "id": new_id(), "series_id": series["id"], "name": name,
        "name_normalized": series_identity.normalize_name(name),
        "start_number": clean(fields.get("start_number")) or None,
        "default_team": clean(fields.get("default_team")) or None,
        "kind": fields.get("kind") or "person", "name_hidden": bool(fields.get("name_hidden")),
        "link": "external", "profile_id": None, "guest_name": None, "is_club_member": False,
        "link_status": "open", "link_source": None, "alias_id": None, "decided_at": None, "decided_by": None,
        "created_at": now, "created_by": me["id"], "updated_at": now, "updated_by": me["id"],
    }
    alias = series_identity.exact_alias(index, name)
    if alias:
        doc.update({**link_fields(alias), "link_status": "decided", "link_source": "alias", "alias_id": alias.get("id"),
                    "decided_at": now, "decided_by": me["id"]})
    await db.reference_participants.insert_one(dict(doc))
    return doc


# ---------------------------------------------------------------- Zurücknehmen
def sheet_participant_ids(sheet: dict) -> set[str]:
    """Alle Teilnehmer, die ein Ergebnisblatt nennt - im Blatt und im Entwurf daneben: Zeilen, Aufstellungen und
    offizielle Werte."""
    found: set[str] = set()
    for source in (sheet, sheet.get("pending_draft") or {}):
        found |= {row.get("participant_id") for row in source.get("rows") or []}
        found |= {pid for match in source.get("matches") or [] for pid in match.get("lineup") or []}
        found |= set(source.get("official_totals") or {})
    found.discard(None)
    return found


async def remove_unused_new(db, series_id: str, candidate_ids) -> list[dict]:
    """Teilnehmer aus ``candidate_ids`` wieder entfernen, wenn sie noch offen sind (keine Zuordnung, kein Alias) und in
    keinem Ergebnisblatt der Saison vorkommen - auch nicht in einem Entwurf daneben. Liefert die entfernten
    (Kennung und Name, fürs Protokoll)."""
    wanted = sorted({pid for pid in candidate_ids or [] if pid})
    if not wanted:
        return []
    query = {"series_id": series_id, "id": {"$in": wanted}, "link_status": "open", "alias_id": None}
    rows = await db.reference_participants.find(query, {"_id": 0, "id": 1, "name": 1}).to_list(None)
    if not rows:
        return []
    used: set[str] = set()
    async for sheet in db.reference_round_results.find({"series_id": series_id}, {"_id": 0}):
        used |= sheet_participant_ids(sheet)
    gone = [row for row in rows if row["id"] not in used]
    if gone:
        await db.reference_participants.delete_many({**query, "id": {"$in": [row["id"] for row in gone]}})
    return gone
