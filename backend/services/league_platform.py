"""Plattform je Season (docs/LIGA.md, B.3 „Plattform je Season“, #2270).

Die Season wählt, welches ID-Feld des Spiels die Plattform trägt (``platform_field``, ein Feld mit ``options``), welche Plattformen
erlaubt sind (``allowed_platforms``, leer = alle) und gibt Crossplay und Eingabegerät als reine Angabe an. Liga N weicht über
``overrides`` ab (``allowed_platforms``, ``crossplay``, ``input_device`` - das Feld gilt für die ganze Season). Kein Wert eines Titels
steht hier: Die Plattformen sind die Auswahlwerte am Spiel. Die Prüfung je Person steht in ``league_eligibility.status``.
"""

from __future__ import annotations

from dataclasses import dataclass

FIELD, ALLOWED, CROSSPLAY, INPUT = "platform_field", "allowed_platforms", "crossplay", "input_device"
DIVISION_KEYS = (ALLOWED, CROSSPLAY, INPUT)
SEASON_KEYS = (FIELD, *DIVISION_KEYS)
INPUT_DEVICES = {"controller": "Controller", "mouse_keyboard": "Maus und Tastatur", "both": "Controller oder Maus und Tastatur"}
MAX_ALLOWED = 30
MAX_VALUE_LENGTH = 80
NOT_ALLOWED, MISSING = "platform_not_allowed", "platform_missing"
SEASON_WHERE = "Diese Season"
EVERY_PLATFORM = "alle Plattformen"

NEEDS_FIELD = "Bitte zuerst das Feld wählen, in dem die Plattform steht – erst dann lassen sich Plattformen eingrenzen."
NO_FIELD = "Dieses Feld gibt es am Spiel nicht, oder es hat keine Auswahl. Bitte ein ID-Feld mit Auswahlwerten wählen."
DIVISION_NEEDS_FIELD = ("Eigene Plattformen einer Liga N brauchen bei der Season das Feld, in dem die Plattform steht "
                        "(Kasten „Plattform und Eingabegerät“).")


class PlatformProblem(ValueError):
    """Eine Einstellung, die nicht passt - mit deutscher Meldung (422)."""

    def __init__(self, message: str, status: int = 422):
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass(frozen=True)
class PlatformRule:
    """Die geltende Regel: Feld, sein Name, die erlaubten Werte und wer sie setzt („Diese Season“ oder „Liga 2“)."""

    key: str
    label: str
    allowed: tuple[str, ...]
    where: str = SEASON_WHERE


# ---------------------------------------------------------------- Bausteine


def words(items) -> str:
    """„PC“, „PC und Xbox“, „PC, PlayStation und Xbox“."""
    items = [str(item) for item in items]
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} und {items[-1]}"


def _options(item: dict | None) -> list[str]:
    out: list[str] = []
    for option in (item or {}).get("options") or []:
        text = str(option or "").strip()
        if text and text not in out:
            out.append(text)
    return out


def option_fields(game: dict | None) -> list[dict]:
    """Die ID-Felder des Spiels mit Auswahl (samt denen des Hauptspiels, nach ``_enrich_game_identity``) - nur sie taugen als Plattform."""
    fields = (game or {}).get("effective_player_id_fields") or (game or {}).get("player_id_fields") or []
    return [item for item in fields if isinstance(item, dict) and str(item.get("key") or "").strip() and _options(item)]


def field_of(game: dict | None, key: str | None) -> dict | None:
    if not key:
        return None
    return next((item for item in option_fields(game) if item["key"] == key), None)


def _label(item: dict | None) -> str:
    return str((item or {}).get("label") or (item or {}).get("key") or "Plattform")


def _division_label(division: dict) -> str:
    from services.league_service import division_label

    return division_label(division)


def _bool_or_none(value):
    return value if isinstance(value, bool) else None


def settings_of(season: dict | None, division: dict | None = None) -> dict:
    """Die geltenden Angaben: Season, darüber die Abweichung der Liga N (fehlt der Schlüssel, gilt die Season)."""
    season = season or {}
    out = {
        FIELD: str(season.get(FIELD) or "").strip() or None,
        ALLOWED: [str(value) for value in season.get(ALLOWED) or []],
        CROSSPLAY: _bool_or_none(season.get(CROSSPLAY)),
        INPUT: season.get(INPUT) if season.get(INPUT) in INPUT_DEVICES else None,
    }
    own = (division or {}).get("overrides") or {}
    if own.get(ALLOWED) is not None:
        out[ALLOWED] = [str(value) for value in own[ALLOWED]]
    if isinstance(own.get(CROSSPLAY), bool):
        out[CROSSPLAY] = own[CROSSPLAY]
    if own.get(INPUT) in INPUT_DEVICES:
        out[INPUT] = own[INPUT]
    return out


def own_overrides(division: dict | None) -> dict:
    """Nur die Plattform-Abweichungen einer Liga N."""
    own = (division or {}).get("overrides") or {}
    return {key: own[key] for key in DIVISION_KEYS if own.get(key) is not None}


# ---------------------------------------------------------------- Regel und Prüfung


def rule_for(season: dict | None, division: dict | None, game: dict | None) -> PlatformRule | None:
    """Die Regel einer Staffel (Season plus ihre Liga N) - ``None``: keine Prüfung (nichts eingegrenzt oder das Feld fehlt am Spiel)."""
    settings = settings_of(season, division)
    item = field_of(game, settings[FIELD])
    if not settings[ALLOWED] or not item:
        return None
    own = (division or {}).get("overrides") or {}
    where = _division_label(division) if own.get(ALLOWED) is not None else SEASON_WHERE
    return PlatformRule(item["key"], _label(item), tuple(settings[ALLOWED]), where)


def lenient_rule(season: dict | None, divisions, game: dict | None) -> PlatformRule | None:
    """Wo die Liga N noch nicht feststeht (Prüfung der Anmeldung): die weiteste aller aktiven Liga N - die Vereinigung ihrer
    Plattformen; eine Liga N ohne Grenze hebt die Prüfung auf. Ohne aktive Liga N gilt die Season."""
    active = [row for row in divisions or [] if (row.get("status") or "active") == "active"] or [None]
    rules = [rule_for(season, row, game) for row in active]
    if any(rule is None for rule in rules):
        return None
    wanted = {value for rule in rules for value in rule.allowed}
    first = rules[0]
    known = _options(field_of(game, first.key))
    allowed = [value for value in known if value in wanted] + sorted(value for value in wanted if value not in known)
    return PlatformRule(first.key, first.label, tuple(allowed), SEASON_WHERE)


def value_of(rule: PlatformRule, person: dict | None, entry: dict | None, game: dict | None) -> str:
    """Die Plattform einer Person: der festgehaltene Wert (``league_rosters.player_ids``, nur bei einem Pflichtfeld), sonst das Profil."""
    locked = str(((entry or {}).get("player_ids") or {}).get(rule.key) or "").strip()
    if locked:
        return locked
    from routes.tournament_common import _profile_player_ids

    return str(_profile_player_ids(person, game).get(rule.key) or "").strip()


def check(rule: PlatformRule | None, value: str) -> tuple[str, str] | None:
    """``(Stand, Satz)`` oder ``None``, wenn die Plattform passt oder es keine Regel gibt."""
    if not rule:
        return None
    if not value:
        return MISSING, f"{rule.label} fehlt im Profil."
    if value not in rule.allowed:
        return NOT_ALLOWED, f"{rule.where} ist nur für {words(rule.allowed)} – angegeben ist {value}."
    return None


# ---------------------------------------------------------------- Anzeige


def rule_values(view: dict) -> dict:
    """Die Werte als Text - für das Regelwerk (#2269) und die Ligaseite."""
    crossplay = view.get("crossplay")
    return {
        "platforms": words(view.get("allowed") or []) or EVERY_PLATFORM,
        "crossplay": None if crossplay is None else ("an" if crossplay else "aus"),
        "input_device": INPUT_DEVICES.get(view.get("input_device") or ""),
    }


def view(season: dict | None, division: dict | None, game: dict | None) -> dict:
    """Was gilt, ohne interne Schlüssel. Fehlt das Feld am Spiel, prüft die Season nichts - dann steht auch nichts eingegrenzt da."""
    settings = settings_of(season, division)
    item = field_of(game, settings[FIELD])
    out = {
        "field_label": _label(item) if item else None,
        "allowed": list(settings[ALLOWED]) if item else [],
        "crossplay": settings[CROSSPLAY],
        "input_device": settings[INPUT],
        "input_device_label": INPUT_DEVICES.get(settings[INPUT] or ""),
    }
    out["values"] = rule_values(out)
    return out


def _has_any(row: dict) -> bool:
    return bool(row["allowed"]) or row["crossplay"] is not None or bool(row["input_device"])


def public_block(season: dict, divisions, game: dict | None) -> dict | None:
    """Für die Ligaseite (#2268): die Season und je aktiver Liga N, was dort gilt. ``None`` ohne jede Angabe."""
    base = view(season, None, game)
    rows = [{"id": row["id"], "label": _division_label(row), **view(season, row, game), "differs": bool(own_overrides(row))}
            for row in divisions or [] if (row.get("status") or "active") == "active"]
    if not _has_any(base) and not any(_has_any(row) for row in rows):
        return None
    return {**base, "divisions": rows}


async def league_game(db, season: dict) -> dict | None:
    """Das Spiel der Liga mit den geerbten ID-Feldern des Hauptspiels."""
    from services.league_roster import _game

    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "game_id": 1}) or {}
    return await _game(db, league.get("game_id"))


async def divisions_of(db, season_id: str) -> list[dict]:
    return await db.league_divisions.find({"season_id": season_id}, {"_id": 0}).sort("level", 1).to_list(50)


async def season_block(db, season: dict, *, with_divisions: bool = True) -> dict | None:
    game = await league_game(db, season)
    divisions = await divisions_of(db, season["id"]) if with_divisions else []
    block = public_block(season, divisions, game)
    if block is not None and not with_divisions:
        block.pop("divisions", None)
    return block


# ---------------------------------------------------------------- Verwaltung


def _clean_allowed(values, item: dict | None, before) -> list[str]:
    """Die erlaubten Werte aus den Optionen des Felds, in seiner Reihenfolge. Schon gespeicherte bleiben wählbar."""
    picked: list[str] = []
    for value in values or []:
        text = " ".join(str(value or "").split())
        if text and text not in picked:
            picked.append(text)
    if len(picked) > MAX_ALLOWED:
        raise PlatformProblem(f"Höchstens {MAX_ALLOWED} Plattformen.")
    options = _options(item)
    known = options + [str(value) for value in before or [] if str(value) not in options]
    for value in picked:
        if value not in known:
            shown = value[:MAX_VALUE_LENGTH]
            raise PlatformProblem(f"Unbekannte Plattform „{shown}“. Wählbar sind die Auswahlwerte des Felds: {words(options)}.")
    return [value for value in known if value in picked]


def clean_season(raw: dict, season: dict, game: dict | None, divisions) -> dict:
    """Die Eingabe des Kastens geprüft. Wirft ``PlatformProblem``."""
    field = " ".join(str(raw.get(FIELD) or "").split()) or None
    item = field_of(game, field) if field else None
    if field and not item:
        raise PlatformProblem(NO_FIELD)
    before = season.get(ALLOWED) if season.get(FIELD) == field else []
    allowed = _clean_allowed(raw.get(ALLOWED), item, before)
    if allowed and not field:
        raise PlatformProblem(NEEDS_FIELD)
    device = raw.get(INPUT)
    if device is not None and device not in INPUT_DEVICES:
        raise PlatformProblem("Unbekanntes Eingabegerät.")
    for division in divisions or []:
        own = ((division.get("overrides") or {}).get(ALLOWED)) or []
        if not own:
            continue
        label = _division_label(division)
        if not field:
            raise PlatformProblem(f"{label} legt eigene Plattformen fest – dafür braucht die Season das Feld. Erst dort „wie Season“ wählen.")
        known = _options(item) + ([str(value) for value in own] if field == season.get(FIELD) else [])
        if any(str(value) not in known for value in own):
            raise PlatformProblem(f"{label} legt Plattformen fest, die das neue Feld nicht kennt. Erst dort „wie Season“ wählen.")
    return {FIELD: field, ALLOWED: allowed, CROSSPLAY: _bool_or_none(raw.get(CROSSPLAY)), INPUT: device}


async def check_division_overrides(db, season: dict, overrides: dict, before: dict | None) -> dict:
    """Die Plattform-Abweichung einer Liga N geprüft und in der Reihenfolge des Spiels. Wirft ``PlatformProblem``."""
    allowed = overrides.get(ALLOWED)
    if overrides.get(INPUT) is not None and overrides[INPUT] not in INPUT_DEVICES:
        raise PlatformProblem("Unbekanntes Eingabegerät.")
    if not allowed:
        return overrides
    if not season.get(FIELD):
        raise PlatformProblem(DIVISION_NEEDS_FIELD)
    item = field_of(await league_game(db, season), season[FIELD])
    if not item:
        raise PlatformProblem(NO_FIELD)
    return {**overrides, ALLOWED: _clean_allowed(allowed, item, (before or {}).get(ALLOWED))}


async def admin_view(db, season: dict) -> dict:
    """Für den Kasten „Plattform und Eingabegerät“: Angaben, wählbare Felder, Liga N mit Abweichung und was dort gilt."""
    game = await league_game(db, season)
    settings = settings_of(season)
    divisions = await divisions_of(db, season["id"])
    fields = []
    for item in option_fields(game):
        options = _options(item)
        saved = [value for value in (settings[ALLOWED] if item["key"] == settings[FIELD] else []) if value not in options]
        saved += [value for row in divisions for value in own_overrides(row).get(ALLOWED) or []
                  if item["key"] == settings[FIELD] and value not in options and value not in saved]
        fields.append({"key": item["key"], "label": _label(item), "options": options + saved, "retired": saved,
                       "required": item.get("required") is not False})
    return {
        "settings": settings,
        "fields": fields,
        "field_missing": bool(settings[FIELD]) and not field_of(game, settings[FIELD]),
        "input_devices": [{"value": key, "label": label} for key, label in INPUT_DEVICES.items()],
        "game": {"id": (game or {}).get("id"), "name": (game or {}).get("display_name") or (game or {}).get("name")},
        "divisions": [{"id": row["id"], "label": _division_label(row), "status": row.get("status") or "active",
                       "overrides": own_overrides(row), "effective": view(season, row, game)} for row in divisions],
    }


async def save(db, season: dict, raw: dict, actor: dict) -> dict:
    """Speichern mit Protokoll ``league.season.platform`` (vorher und nachher, nur bei einer Änderung). Wirft ``PlatformProblem``."""
    from models import new_id, now_utc

    game = await league_game(db, season)
    after = clean_season(raw, season, game, await divisions_of(db, season["id"]))
    before = settings_of(season)
    if after != before:
        now = now_utc().isoformat()
        await db.league_seasons.update_one({"id": season["id"]}, {"$set": {**after, "updated_at": now}})
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.season.platform", "target_id": season["id"], "actor_id": actor.get("id"),
            "data": {"season_id": season["id"], "before": before, "after": after}, "created_at": now,
        })
    return await admin_view(db, {**season, **after})
