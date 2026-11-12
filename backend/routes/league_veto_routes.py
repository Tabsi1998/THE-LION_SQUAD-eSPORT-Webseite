"""Liga-Veto (docs/LIGA.md, „D.3 Veto“, #1618; Regelwerk § 6, Anlage B).

- ``GET|PUT /api/admin/leagues/seasons/{season_id}/veto-rules``: die Vorlage je Season (an/aus, Team A, Zeit je Schritt, Schritte) -
  Zuständigkeit „Season konfigurieren“, lesen jede Zuständigkeit. Das Speichern gilt sofort für alle nicht gesperrten Staffeln.
- ``GET …/veto-rules/proposal``: ein Vorschlag aus Modusfolge, Poolgrößen und Best of - nichts wird gespeichert.
- ``GET|PUT /api/admin/leagues/seasons/{season_id}/veto-presets`` (#2326): die Vorgabe der Woche - je Spielwoche und Modus eine Map aus
  dem Pool, mit Vorschlag „rotiert durch den Pool“, fehlenden Wochen und Historie. Rechte wie die Vorlage. Eine Änderung gilt nur für
  Vetos, die noch nicht begonnen haben; Spiele, die auf die Vorgabe gewartet haben, bekommen „Vorgabe da – Veto kann starten“.
- ``POST /api/matches/{match_id}/veto/ready`` (#2326, Nr. 127): „Bereit zum Veto“ nach einer nachgetragenen Vorgabe - Captain oder
  Vertreter je Seite; sind beide bereit, beginnt das Veto. Zurücknehmen, solange die Gegenseite nicht bereit ist. Idempotent.
- ``POST /api/matches/{match_id}/veto/start`` (#2326, Nr. 127): Notfall-Start durch die Liga-Leitung („Spiele betreuen“) mit Pflichtgrund,
  Befangenheit wie B.1.
- ``GET /api/matches/{match_id}/veto`` (D.4, #1651): der Veto-Block für den kurzen Abruf - Beteiligte und Leitung wie auf der Matchseite,
  alle anderen (und ``display=1``, der TV) nur lesend ohne Internes; mit Anzeige-Schlüssel des Turniers (``key``) ohne Anmeldung. Dazu
  die Serverzeit der Antwort für den Countdown.
- ``POST /api/matches/{match_id}/veto/pick``: die Seite am Zug sperrt oder wählt eine Map (Captain, Vertreter).
- ``POST /api/matches/{match_id}/veto/lead``: Pause, Fortsetzen, Schritt zurück, Neustart - Liga-Leitung mit „Spiele betreuen“, mit Grund,
  Befangenheit wie B.1.

Die Logik steht in ``services/league_veto.py`` und ``services/league_veto_rules.py``.
"""
from __future__ import annotations

import hashlib
import time
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from auth import get_current_user, get_optional_user
from database import get_db
from models import now_utc
from routes.match_routes import (
    _acting_registration_for_match,
    _assert_match_visible,
    _can_read_match,
    _find_match_any,
    _member_registration_for_match,
    _result_conflict,
    _serialized_match_write,
)
from services import game_maps, league_procedures, league_veto, league_veto_rules, league_veto_sweep, map_pools, match_flow
from services.access_links import touch_access_link, validate_access_link
from services.checkin_rules import FlowProblem, filled, moment
from services.league_permissions import ANY, require_league, require_no_conflict
from services.rate_limit import enforce_rate_limit, get_client_ip
from services.tournament_permissions import has_match_result_permission
from services.tv_display import DISPLAY_GRANT, KEY_EXPIRED, KEY_INVALID, key_expired, shown_on_event_tv

admin_router = APIRouter(prefix="/api/admin/leagues", tags=["leagues-admin"])
router = APIRouter(prefix="/api/matches", tags=["matches"])

require_season = require_league("season", via="season_id")
require_any_capability = require_league(ANY, via="season_id")


class VetoStepBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str = Field(max_length=20)
    mode: str = Field(max_length=40)
    team: Optional[str] = Field(default=None, max_length=1)
    position: Optional[int] = None


class VetoRulesBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    team_a: str = Field(default=league_veto_rules.HOME, max_length=10)
    step_seconds: int = 60
    steps: list[VetoStepBody] = Field(default_factory=list, max_length=league_veto_rules.STEPS_MAX)


class VetoPresetBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    week: int
    mode: str = Field(max_length=40)
    # Leer heißt „noch nicht gewählt“ - die Woche bleibt als fehlend sichtbar.
    map_id: str = Field(default="", max_length=120)


class VetoPresetsBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    presets: list[VetoPresetBody] = Field(default_factory=list, max_length=league_veto_rules.WEEKS_MAX * league_veto_rules.POSITION_MAX)


class PickBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    map_id: str = Field(min_length=1, max_length=120)
    version: int = Field(ge=0)


class ReadyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # False nimmt „Bereit“ zurück - nur solange die Gegenseite noch nicht bereit ist.
    ready: bool = True


class LeadStartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: Optional[str] = Field(default=None, max_length=500)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


class LeadBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    action: str = Field(max_length=20)
    reason: Optional[str] = Field(default=None, max_length=500)
    version: int = Field(ge=0)
    conflict_reason: Optional[str] = Field(default=None, max_length=500)


def _raise(problem: FlowProblem | league_veto_rules.VetoProblem):
    raise HTTPException(status_code=problem.status_code, detail=problem.detail) from None


async def _season(db, season_id: str) -> dict:
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0})
    if not season:
        raise HTTPException(status_code=404, detail="Season nicht gefunden.")
    return season


async def _season_context(db, season: dict) -> dict:
    """Pool, Modi, Best of, Modusfolge und Wiederholungsregel der Season - für Prüfung und Vorschlag."""
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "game_id": 1}) or {}
    game = await db.games.find_one({"id": league.get("game_id")}, {"_id": 0}) if league.get("game_id") else None
    pool = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    labels = {row["mode"]: row["label"] for row in game_maps.game_modes(game)} if game else {}
    pool_modes = [{"mode": group["mode"], "label": group.get("label") or labels.get(group["mode"]) or group["mode"],
                   "maps": len(group.get("maps") or [])} for group in (pool or {}).get("modes") or [] if group.get("mode")]
    return {"pool": pool, "labels": labels, "modes": pool_modes, "best_of": int(season.get("best_of") or 1),
            "order": [mode for mode in season.get("game_mode_order") or [] if mode], "repeat": season.get("map_repeat") or "other_mode"}


def _stored(season: dict) -> dict | None:
    raw = season.get("veto_rules")
    if not isinstance(raw, dict):
        return None
    try:
        return league_veto_rules.normalize(raw)
    except league_veto_rules.VetoProblem:
        return league_veto_rules.defaults()


def _problems(rules: dict | None, context: dict) -> list[str]:
    if not rules or not rules.get("enabled"):
        return []
    return league_veto_rules.template_problems(rules, pool=context["pool"], best_of=context["best_of"], order=context["order"],
                                               repeat=context["repeat"], labels=context["labels"])


def _answer(season: dict, rules: dict | None, context: dict, **extra) -> dict:
    return {"veto_rules": rules, "active": bool(rules and rules.get("enabled") and rules.get("steps")),
            "defaults": league_veto_rules.defaults(), "problems": _problems(rules, context), "modes": context["modes"],
            "best_of": context["best_of"], "game_mode_order": context["order"], "map_repeat": context["repeat"],
            "has_checkin": isinstance(season.get("checkin_rules"), dict),
            # Nr. 108: unberührt - folgt dem Pool, bis die Leitung hier das erste Mal speichert.
            "auto": league_veto_rules.is_auto(season.get("veto_rules")), **extra}


@admin_router.get("/seasons/{season_id}/veto-rules")
async def get_veto_rules(season_id: str, _me: dict = Depends(require_any_capability)):
    db = get_db()
    season = await _season(db, season_id)
    context = await _season_context(db, season)
    return _answer(season, _stored(season), context,
                   staffeln=await db.tournaments.count_documents({"league_context.season_id": season_id}))


@admin_router.get("/seasons/{season_id}/veto-rules/proposal")
async def propose_veto_rules(season_id: str, _me: dict = Depends(require_any_capability)):
    db = get_db()
    season = await _season(db, season_id)
    context = await _season_context(db, season)
    steps = league_veto_rules.propose(order=context["order"], pool=context["pool"], best_of=context["best_of"]) if context["pool"] else []
    if not steps:
        raise HTTPException(status_code=409, detail="Für einen Vorschlag braucht die Season einen Map-Pool mit mindestens einem Modus.")
    proposal = {**(_stored(season) or league_veto_rules.defaults()), "enabled": True, "steps": steps}
    return {"steps": steps, "problems": _problems(proposal, context)}


@admin_router.put("/seasons/{season_id}/veto-rules")
async def put_veto_rules(season_id: str, body: VetoRulesBody, me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    context = await _season_context(db, season)
    try:
        rules = league_veto_rules.normalize(body.model_dump())
    except league_veto_rules.VetoProblem as problem:
        _raise(problem)
    problems = _problems(rules, context)
    if problems:
        raise HTTPException(status_code=422, detail=f"Die Vorlage passt noch nicht: {' '.join(problems)}")
    # Von Hand gespeichert: ohne den Merker „unberührt“ (Nr. 108) - ab jetzt bleibt die Vorlage, auch wenn der Pool sich ändert.
    # Sofort auf die Staffeln - gesperrte bleiben, wie sie sind (dort nimmt es das Übertragen nach dem Entsperren mit).
    staffeln = await league_veto.store_template(db, season, rules, actor_id=me.get("id"))
    # Vorgabe der Woche (#2326): Mit der neuen Vorlage (etwa ohne den Schritt „Vorgabe“) kann ein wartendes Veto jetzt starten - beide
    # Seiten erfahren es. Es beginnt dadurch nicht.
    ready = await league_veto_sweep.announce_waiting(db, season_id)
    return _answer({**season, "veto_rules": rules}, rules, context, staffeln_updated=staffeln, matches_ready=ready)


# ---------------------------------------------------------------- Vorgabe der Woche (#2326)

def _preset_modes(rules: dict | None, context: dict) -> list[dict]:
    """Die Modi mit einem Schritt „Vorgabe der Woche“ in der gespeicherten Vorlage - mit Position und den Maps des Pools zur Auswahl."""
    maps = league_veto_rules.pool_maps(context["pool"])
    labels = {**context["labels"], **league_veto_rules.pool_labels(context["pool"])}
    return [{"mode": step["mode"], "label": labels.get(step["mode"]) or step["mode"], "position": step["position"],
             "maps": [{"map_id": item["map_id"], "name": item.get("name")} for item in maps.get(step["mode"]) or []]}
            for step in league_veto_rules.preset_steps((rules or {}).get("steps"))]


async def _presets_answer(db, season: dict, context: dict, **extra) -> dict:
    rules = _stored(season)
    presets = league_veto_rules.presets_of(season.get("veto_presets"))
    weeks = await league_veto.preset_weeks(db, season)
    return {
        "active": bool(rules and rules.get("enabled") and league_veto_rules.preset_steps(rules.get("steps"))),
        "weeks": weeks, "modes": _preset_modes(rules, context), "presets": presets,
        # Sichtbar, welche Wochen fehlen oder nicht mehr passen - je Woche die Sätze.
        "problems": league_veto.presets_overview(rules, presets, weeks, pool=context["pool"], repeat=context["repeat"], labels=context["labels"]),
        # Der Vorschlag „rotiert automatisch durch den Pool“ für alle Wochen - nichts davon ist gespeichert.
        "rotation": league_veto_rules.rotate(rules or {}, pool=context["pool"], weeks=len(weeks), repeat=context["repeat"]),
        "history": await league_veto.presets_history(db, season["id"]), **extra}


@admin_router.get("/seasons/{season_id}/veto-presets")
async def get_veto_presets(season_id: str, _me: dict = Depends(require_any_capability)):
    db = get_db()
    season = await _season(db, season_id)
    return await _presets_answer(db, season, await _season_context(db, season))


@admin_router.put("/seasons/{season_id}/veto-presets")
async def put_veto_presets(season_id: str, body: VetoPresetsBody, me: dict = Depends(require_season)):
    db = get_db()
    season = await _season(db, season_id)
    context = await _season_context(db, season)
    try:
        presets = league_veto_rules.normalize_presets(body.model_dump()["presets"])
    except league_veto_rules.VetoProblem as problem:
        _raise(problem)
    rules = _stored(season) or league_veto_rules.defaults()
    weeks = await league_veto.preset_weeks(db, season)
    known = {row["week"] for row in weeks}
    ids = league_veto_rules.pool_ids(context["pool"])
    labels = {**context["labels"], **league_veto_rules.pool_labels(context["pool"])}
    wanted = {step["mode"] for step in league_veto_rules.preset_steps(rules.get("steps"))}
    # Was gespeichert ist und unverändert wiederkommt, bleibt - auch eine Map, die den Pool inzwischen verlassen hat (Review zu #2326):
    # Die Verwaltung zeigt sie als „nicht mehr im Pool“, und das Speichern einer anderen Woche wirft sie nicht still weg. Geprüft
    # wird nur, was sich ändert.
    stored = league_veto_rules.presets_of(season.get("veto_presets"))
    before = {(row["week"], row["mode"]): row["map_id"] for row in stored}
    touched = set()
    for row in presets:
        if before.get((row["week"], row["mode"])) == row["map_id"]:
            continue
        touched.add(row["week"])
        label = labels.get(row["mode"]) or "den Modus"
        if row["week"] not in known:
            raise HTTPException(status_code=422, detail=f"Spielwoche {row['week']} gibt es in dieser Season nicht.")
        if row["mode"] not in wanted:
            raise HTTPException(status_code=422, detail=f"Spielwoche {row['week']}: Für {label} sieht die Veto-Vorlage keine Vorgabe der Woche vor.")
        if row["map_id"] not in (ids.get(row["mode"]) or []):
            raise HTTPException(status_code=422, detail=f"Spielwoche {row['week']}: Die Map steht nicht im Pool für {label}.")
    # Einträge, die die Verwaltung gar nicht zeigt (der Modus hat gerade keinen Schritt „Vorgabe“, die Woche gibt es nicht mehr),
    # kann sie auch nicht mitschicken - sie bleiben gespeichert, statt beim nächsten Speichern zu verschwinden.
    sent = {(row["week"], " ".join(str(row["mode"]).split())) for row in body.model_dump()["presets"]}
    hidden = [row for row in stored if (row["mode"] not in wanted or row["week"] not in known) and (row["week"], row["mode"]) not in sent]
    if hidden:
        presets = league_veto_rules.normalize_presets([*presets, *hidden])
    # Vollständige Wochen müssen aufgehen (etwa „jede Map nur einmal je Serie“) - eine Woche mit Lücke bleibt speicherbar und sichtbar.
    for row in weeks:
        chosen = league_veto_rules.presets_of_week(presets, row["week"])
        if row["week"] in touched and wanted and wanted <= set(chosen):
            problems = league_veto_rules.week_problems(rules, chosen, pool=context["pool"], repeat=context["repeat"], labels=context["labels"])
            if problems:
                raise HTTPException(status_code=422, detail=f"Spielwoche {row['week']}: {' '.join(problems)}")
    changes = await league_veto.store_presets(db, season, presets, actor_id=me.get("id"))
    # Wartende Spiele (beide Seiten eingecheckt, die Vorgabe fehlte): Beide Seiten erfahren, dass sie das Veto jetzt starten können.
    # Es beginnt nicht von selbst - sonst liefe die Zeit, während niemand mehr da ist. Begonnene und fertige Vetos bleiben, wie sie sind.
    told = await league_veto_sweep.announce_waiting(db, season_id) if changes else 0
    return await _presets_answer(db, {**season, "veto_presets": presets}, context, changed=len(changes), matches_ready=told)


async def _context(match_id: str, user: dict):
    db = get_db()
    match, collection = await _find_match_any(match_id)
    if collection != "matches_v2":
        raise HTTPException(status_code=409, detail=league_veto.NO_VETO_DETAIL)
    await _assert_match_visible(match, user)
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "creation_key": 0, "billing": 0})
    if tournament and tournament.get("locked_at"):
        raise HTTPException(status_code=423, detail="Turnier ist gesperrt und kann nur noch angesehen werden.")
    return db, match, tournament, await _acting_registration_for_match(match, user)


def _match_head(match: dict, tournament: dict | None, names: dict[str, str]) -> dict:
    """Kopf für die TV-Ansicht und Zuschauer: Staffel, Spieltag, die beiden Seiten - was die öffentliche Matchseite ohnehin zeigt."""
    number = match.get("matchday_number") or match.get("round")
    label = match.get("matchday_label") or match.get("round_name") or (f"Spieltag {number}" if number else "Spiel")
    return {"id": match.get("id"), "tournament_id": match.get("tournament_id"), "tournament_title": (tournament or {}).get("title"), "matchday_label": label,
            "scheduled_at": match.get("scheduled_at"), "sides": [names.get(reg_id) or "Team" for reg_id in filled(match)[:2]]}


# Zuschauer und TV (#1651, Review): Viele Bildschirme und Handys fragen dasselbe Spiel alle 2 Sekunden ab. Die Zuschauer-Sicht gilt darum
# kurz für alle (``SPECTATOR_CACHE_SECONDS``) - solange sich am Spiel nichts geändert hat (Schlüssel: ``updated_at`` und der Stand des
# Vetos, frisch gelesen). Ein neuer Zug ist damit sofort sichtbar; Serverzeit und Restsekunden werden bei jedem Abruf neu gesetzt.
# Dazu ein großzügiges Limit je Adresse und je Anzeige-Schlüssel wie beim Event-TV. Beteiligte und Leitung: kein Zwischenspeicher.
SPECTATOR_CACHE_SECONDS = 2
SPECTATOR_CACHE_MATCHES = 256
SPECTATOR_RATE_LIMIT = 600
SPECTATOR_RATE_WINDOW_SECONDS = 60
SPECTATOR_RATE_MESSAGE = "Zu viele Abrufe für dieses Veto. Bitte warte noch {wait}."

_spectator_cache: dict[str, tuple[float, tuple, dict, dict]] = {}


def _clock() -> float:
    return time.monotonic()


def _key_subject(key: str) -> str:
    """Der Zähler je Schlüssel nennt den Schlüssel nie - nur einen eigenen Hash davon."""
    return hashlib.sha256(f"tv-veto-display:{key}".encode("utf-8")).hexdigest()[:32]


def _spectator_signature(match: dict) -> tuple:
    """Was die Zuschauer-Sicht ändern kann, frisch aus dem Spiel: jede Änderung am Spiel (``updated_at``) und der Stand des Vetos."""
    flow = match.get("flow") or {}
    veto = flow.get("veto") if isinstance(flow.get("veto"), dict) else {}
    return (match.get("updated_at"), match.get("scheduled_at"), flow.get("schedule_rev"), veto.get("started_at"), veto.get("version"),
            veto.get("status"), veto.get("deadline_at"), bool(flow.get("veto_wait")))


def _with_server_time(block: dict | None, now) -> dict | None:
    """Ein zwischengespeicherter Block mit der Serverzeit dieses Abrufs - der Countdown rechnet damit."""
    if not block:
        return block
    out = {**block, "server_now": now.isoformat()}
    current = block.get("current")
    deadline = moment((current or {}).get("deadline_at"))
    if current and deadline:
        out["current"] = {**current, "remaining_seconds": max(0, int((deadline - now).total_seconds()))}
    return out


async def _spectator_block(db, match: dict, tournament: dict | None, now) -> tuple[dict | None, dict]:
    signature = _spectator_signature(match)
    hit = _spectator_cache.get(match["id"])
    if hit and hit[0] > _clock() and hit[1] == signature:
        return _with_server_time(hit[2], now), hit[3]
    names = await league_veto.side_names(db, match)
    block = await league_veto.live_block(db, match, tournament, names=names, spectator=True, now=now)
    _spectator_cache.pop(match["id"], None)
    while len(_spectator_cache) >= SPECTATOR_CACHE_MATCHES:
        _spectator_cache.pop(next(iter(_spectator_cache)))
    _spectator_cache[match["id"]] = (_clock() + SPECTATOR_CACHE_SECONDS, signature, block, names)
    return block, names


async def _limit_address(request: Request) -> None:
    """Zuschauer ohne Schlüssel und jeder abgelehnte Schlüssel zählen je Adresse - so bleibt auch das Raten von Schlüsseln gebremst."""
    await enforce_rate_limit(request, "veto_live_address", SPECTATOR_RATE_LIMIT, SPECTATOR_RATE_WINDOW_SECONDS,
                             subject=get_client_ip(request), message=SPECTATOR_RATE_MESSAGE)


async def _limit_key(request: Request, key: str) -> None:
    """Ein gültiger Schlüssel zählt nur in seinem eigenen Topf (Review): Hallen-TVs hinter einer gemeinsamen Adresse laufen nicht ins
    Limit der Zuschauer im selben Netz."""
    await enforce_rate_limit(request, "veto_live_key", SPECTATOR_RATE_LIMIT, SPECTATOR_RATE_WINDOW_SECONDS, subject=_key_subject(key),
                             message=SPECTATOR_RATE_MESSAGE)


async def _refuse_key(request: Request, detail: str = KEY_INVALID):
    await _limit_address(request)
    raise HTTPException(status_code=403, detail=detail)


@router.get("/{match_id}/veto")
async def veto_live(match_id: str, request: Request, key: Optional[str] = None, display: bool = False,
                    user: dict | None = Depends(get_optional_user)):
    """Der kurze Abruf des Vetos (D.4, #1651) - Matchseite, Zuschauer und TV fragen hier statt der ganzen Seite nach.

    Beteiligte (Captain, Vertreter, Kader) und die Liga-Leitung bekommen denselben Block wie auf der Matchseite; wie dort beginnt ein
    fälliges Veto beim Lesen und abgelaufene Fristen lösen sich auf. Alle anderen sehen das Veto nur lesend (``spectator_view``: keine
    Wahl, kein Eingriff, kein Grund einer Pause) - Sichtbarkeit wie die Matchseite, also nach Staffel bzw. Season. ``display=1`` (TV)
    liefert immer die Zuschauer-Sicht. Mit dem Anzeige-Schlüssel des Turniers (``key``) auch ohne Anmeldung, wie Turnierbaum und
    Stationen - aber nie für eine Staffel im Entwurf oder eine interne (Season aus bzw. nur Verwaltung), wie beim Event-TV; ein
    unbekanntes Spiel und ein falscher Schlüssel sehen gleich aus (403). Zuschauer und TV lösen nichts aus - Start und Fristen
    übernehmen der Aufruf der Beteiligten und der Job."""
    db = get_db()
    now = now_utc()
    if not key and (display or not user):
        await _limit_address(request)
    try:
        match, collection = await _find_match_any(match_id)
    except HTTPException:
        if key:
            await _refuse_key(request)
        raise
    tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "creation_key": 0, "billing": 0})
    if key:
        link = await validate_access_link(db, key, "tournament", match.get("tournament_id"), None, DISPLAY_GRANT) if tournament else None
        if not link or not shown_on_event_tv(tournament):
            await _refuse_key(request)
        if key_expired(tournament, now):
            await _refuse_key(request, KEY_EXPIRED)
        # Gültiger Schlüssel: nur sein eigener Topf, nicht zusätzlich der der Adresse.
        await _limit_key(request, key)
        await touch_access_link(db, link)
    else:
        await _assert_match_visible(match, user)
    if collection != "matches_v2" or not league_veto_rules.rules_of(tournament):
        return {"veto": None, "now": now.isoformat(), "state": None, "match": None}
    spectator = bool(key or display or not user)
    lead = False
    if not spectator:
        involved = await _can_read_match(match, user) or bool(await _member_registration_for_match(db, match, user.get("id")))
        lead = await has_match_result_permission(user, match, capability="matches")
        spectator = not (involved or lead)
        if spectator:
            await _limit_address(request)
    state = None
    if spectator:
        block, names = await _spectator_block(db, match, tournament, now)
    else:
        names = await league_veto.side_names(db, match)
        # Wie die Matchseite (``match_flow.page_block``): ein fälliges Veto beginnt, abgelaufene Fristen lösen sich auf.
        match = await league_veto.settle_due(db, await league_veto.ensure_started(db, match, tournament, now=now), tournament, now=now)
        acting = await _acting_registration_for_match(match, user)
        conflict = await _result_conflict(db, user, match) if lead else None
        block = await league_veto.live_block(db, match, tournament, names=names, own_id=(acting or {}).get("id"), lead=lead,
                                             can_lead_act=bool(lead and (not conflict or conflict["override"])), conflict=conflict, now=now)
        # Die Seite hat das Veto offen - dann braucht sie keine Erinnerung „Map-Veto wartet“.
        await league_veto.mark_seen(db, match, (acting or {}).get("id"), now=now)
        state = match_flow.state(match, tournament, now)
    return {"veto": block, "now": now.isoformat(), "state": state, "match": _match_head(match, tournament, names)}


@router.post("/{match_id}/veto/pick")
async def veto_pick(match_id: str, body: PickBody, me: dict = Depends(get_current_user),
                    _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, acting_reg = await _context(match_id, me)
    if not acting_reg:
        raise HTTPException(status_code=403, detail=league_veto.NOT_A_SIDE_DETAIL)
    if not league_veto_rules.rules_of(tournament):
        raise HTTPException(status_code=409, detail=league_veto.NO_VETO_DETAIL)
    try:
        done = await league_veto.pick(db, match, tournament, registration_id=acting_reg["id"], map_id=body.map_id, version=body.version,
                                      user=me)
        # Verfahren in der Antwort nur, soweit diese Person sie sehen darf (#1619, Nr. 133/137).
        return await league_procedures.guard(db, done, me)
    except (FlowProblem, league_veto_rules.VetoProblem) as problem:
        _raise(problem)


@router.post("/{match_id}/veto/ready")
async def veto_ready(match_id: str, body: ReadyBody, me: dict = Depends(get_current_user),
                     _mutation: None = Depends(_serialized_match_write)):
    """„Bereit zum Veto“ (#2326, Nr. 127): nur, wenn das Veto auf die Vorgabe der Woche gewartet hat - Captain oder Vertreter der
    eigenen Seite, wie bei einem Zug. Sind beide Seiten bereit, beginnt das Veto; sonst beginnt es wie immer von selbst."""
    db, match, tournament, acting_reg = await _context(match_id, me)
    if not acting_reg:
        raise HTTPException(status_code=403, detail=league_veto.NOT_A_SIDE_DETAIL)
    if not league_veto_rules.rules_of(tournament):
        raise HTTPException(status_code=409, detail=league_veto.NO_VETO_DETAIL)
    try:
        return await league_procedures.guard(
            db, await league_veto.set_ready(db, match, tournament, registration_id=acting_reg["id"], ready=body.ready, user=me), me)
    except (FlowProblem, league_veto_rules.VetoProblem) as problem:
        _raise(problem)


@router.post("/{match_id}/veto/start")
async def veto_start(match_id: str, body: LeadStartBody, me: dict = Depends(get_current_user),
                     _mutation: None = Depends(_serialized_match_write)):
    """Notfall (#2326, Nr. 127): Die Liga-Leitung („Spiele betreuen“) beginnt ein wartendes Veto, ohne dass beide Seiten „Bereit“ getippt
    haben - mit Pflichtgrund und Protokoll, Befangenheit wie bei jedem Eingriff."""
    db, match, tournament, _acting_reg = await _context(match_id, me)
    # Erst, wer handeln darf (403), dann, ob es hier ein Veto gibt (409) - wie beim Eingriff ins laufende Veto.
    if not await has_match_result_permission(me, match, capability="matches"):
        raise HTTPException(status_code=403, detail="Im Notfall starten kann die Liga-Leitung mit „Spiele betreuen“.")
    await require_no_conflict(db, me, match, action="veto_start", conflict_reason=body.conflict_reason)
    if not league_veto_rules.rules_of(tournament):
        raise HTTPException(status_code=409, detail=league_veto.NO_VETO_DETAIL)
    try:
        return await league_procedures.guard(db, await league_veto.lead_start(db, match, tournament, reason=body.reason, user=me), me)
    except (FlowProblem, league_veto_rules.VetoProblem) as problem:
        _raise(problem)


@router.post("/{match_id}/veto/lead")
async def veto_lead(match_id: str, body: LeadBody, me: dict = Depends(get_current_user),
                    _mutation: None = Depends(_serialized_match_write)):
    db, match, tournament, _acting_reg = await _context(match_id, me)
    # Erst, wer handeln darf (403), dann, ob es hier ein Veto gibt (409) - so antwortet die Rechte-Matrix gleich.
    if not await has_match_result_permission(me, match, capability="matches"):
        raise HTTPException(status_code=403, detail="Eingreifen kann die Liga-Leitung mit „Spiele betreuen“.")
    await require_no_conflict(db, me, match, action=f"veto_{body.action}", conflict_reason=body.conflict_reason)
    if not league_veto_rules.rules_of(tournament):
        raise HTTPException(status_code=409, detail=league_veto.NO_VETO_DETAIL)
    try:
        return await league_procedures.guard(
            db, await league_veto.lead_action(db, match, tournament, action=body.action, reason=body.reason, version=body.version, user=me), me)
    except (FlowProblem, league_veto_rules.VetoProblem) as problem:
        _raise(problem)
