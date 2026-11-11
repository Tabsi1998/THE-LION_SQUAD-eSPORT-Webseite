"""Veto am Spiel (docs/LIGA.md, Abschnitt „D.3 Veto“, #1618; Regelwerk § 6 und Anlage B).

Der Zustandsautomat steht auf dem Server, in ``matches_v2.flow.veto`` (intern wie ``flow.checkin``):

- **Start** genau einmal je Termin, sobald beide Seiten eingecheckt sind (``ensure_started`` - im Check-in, beim Lesen der Matchseite,
  beim ersten Zug, beim Start und im Job; Bedingung „kein Veto für diesen Termin“). Team A nach der Vorlage (Heim oder einmal gelost).
- **Zug** mit Versionsnummer (optimistische Sperre) und Bedingung auf ``version`` und ``status`` - doppelt, gleichzeitig, zwei Geräte:
  einer schreibt, der andere bekommt „bitte neu laden“ oder die Wiederholung. Der Decider folgt sofort als automatischer Schritt.
- **Zeit:** nach Ablauf wählt das System zufällig und gleichverteilt aus den Maps, die die Serie vervollständigbar lassen
  (``settle_due``, idempotent; Job ``league_veto_sweep``).
- **Leitung:** Pause, Fortsetzen, Schritt zurück, Neustart - mit Grund und Protokoll, Befangenheit prüft die Route.
- **Abschluss:** ``planned_games[]`` am Spiel (Schlüssel wie ``games[]``), ``map_pool_id`` festgehalten, Stand ``ready``.
- **Vorgabe der Woche** (#2326): Hat die Vorlage einen Schritt ``preset``, liest der Start die Map der Spielwoche des Spiels an der
  Season (``veto_presets``) und hält sie am Veto fest (``flow.veto.presets``). Fehlt sie, beginnt das Veto nicht: Die Matchseite sagt
  es, die Liga-Leitung bekommt einen Hinweis - nie eine Wertung. Eine spätere Änderung gilt nur für Vetos, die noch nicht begonnen haben.

Die Regeln ohne Datenbank stehen in ``services/league_veto_rules.py``.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta

from models import new_id, now_utc
from services import league_veto_rules as rules_mod, map_pools
from services.checkin_rules import (
    OPEN_MATCH_STATUSES,
    FlowProblem,
    filled,
    has_report,
    is_finished,
    is_running,
    iso,
    missing_sides,
    moment,
    schedule_rev,
)
from services.league_veto_rules import (
    DECIDER, DONE, DRAW, HOME, PAUSED, PRESET, ROLE_OF, RUNNING, SKIPPED, SYSTEM_KINDS, VetoProblem, veto_of,
)

logger = logging.getLogger("tls.league_veto")

SIDE, AUTO = "side", "auto"
REASON_MIN, REASON_MAX = 5, 500
LEAD_ACTIONS = ("pause", "resume", "undo", "restart")

NO_VETO_DETAIL = "In dieser Staffel gibt es kein Veto."
NOT_STARTED_DETAIL = "Das Veto beginnt erst, wenn beide Seiten eingecheckt sind."
NOT_A_SIDE_DETAIL = "Ziehen können Captain oder Vertreter der Seite, die am Zug ist."
CHANGED_DETAIL = "Gerade hat sich am Veto etwas geändert – bitte die Seite neu laden."
DONE_DETAIL = "Das Veto ist abgeschlossen."
STARTED_DETAIL = "Das Spiel läuft schon – am Veto ändert sich nichts mehr."
REPORT_VETO_DETAIL = "Erst das Veto abschließen – dann melden."
SYSTEM_STEP_DETAIL = "Diesen Schritt setzt das System."
NO_WEEK_DETAIL = "Dieses Spiel gehört zu keiner Spielwoche – die Vorgabe der Woche lässt sich nicht bestimmen."
START_READY_DETAIL = "Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben. Vorher läuft keine Zeit."
PRESET_LIMIT = 500
HISTORY_LIMIT = 10


# ---------------------------------------------------------------- Vorlage der Season

async def store_template(db, season: dict, rules: dict, *, actor_id: str | None, via: str = SIDE) -> int:
    """Die Vorlage der Season speichern und sofort auf ihre Staffeln legen - gesperrte bleiben, wie sie sind (dort nimmt es das Übertragen
    nach dem Entsperren mit). Protokoll ``league.season.veto_rules`` mit altem und neuem Wert; ``via: "auto"`` beim Nachziehen (Nr. 108).
    Gibt die Zahl der geänderten Staffeln zurück."""
    before = season.get("veto_rules")
    now_iso = now_utc().isoformat()
    if before != rules:
        await db.league_seasons.update_one({"id": season["id"]}, {"$set": {"veto_rules": rules, "updated_at": now_iso}})
    staffeln = await db.tournaments.update_many(
        {"league_context.season_id": season["id"], "locked_at": None, "veto_rules": {"$ne": rules}},
        {"$set": {"veto_rules": rules, "updated_at": now_iso}})
    if before != rules:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.season.veto_rules", "target_id": season["id"], "actor_id": actor_id,
            "data": {"from": before, "to": rules, "staffeln": staffeln.modified_count, "via": via}, "created_at": now_iso})
    return staffeln.modified_count


async def follow_pool(db, season: dict, *, actor_id: str | None) -> dict | None:
    """Fabian Nr. 108: Solange die Vorlage unberührt ist (Merker ``veto_rules.auto``), zieht sie nach, sobald der Pool der Season sich
    ändert - neu vorgeschlagen aus Modusfolge, Pool und Best of und gespeichert wie von Hand. Ohne Merker (einmal von Hand gespeichert),
    ohne Pool oder ohne Vorschlag passiert nichts. Gibt die geltende Vorlage zurück."""
    raw = season.get("veto_rules")
    if not rules_mod.is_auto(raw) or not raw.get("enabled"):
        return None
    try:
        rules = rules_mod.normalize(raw)
    except VetoProblem:
        return None
    league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0, "game_id": 1}) or {}
    pool = map_pools.valid_for(await map_pools.current(db, "league_season", season["id"]), league.get("game_id"))
    if not pool:
        return None
    steps = rules_mod.propose(order=season.get("game_mode_order"), pool=pool, best_of=int(season.get("best_of") or 1))
    if not steps:
        return None
    fresh = {**rules, "steps": steps, rules_mod.AUTO: True}
    if fresh != raw:
        await store_template(db, season, fresh, actor_id=actor_id, via=AUTO)
    return fresh


# ---------------------------------------------------------------- Vorgabe der Woche (#2326)

def week_of(match: dict | None) -> int | None:
    """Die Spielwoche eines Spiels: sein Spieltag (``matchday_number``, sonst ``round``) - Spieltag N liegt in der N-ten aktiven
    Spielwoche. Ein verschobenes Spiel behält seinen Spieltag, also gilt die Vorgabe seines Spieltags, nicht die des neuen Termins."""
    from services.matchday_schedule import matchday_number_of

    return matchday_number_of(match or {})


async def season_presets(db, tournament: dict | None) -> list[dict]:
    """Die Vorgaben der Season einer Staffel - eine Quelle für alle Staffeln, nichts wird auf die Staffel kopiert."""
    season_id = ((tournament or {}).get("league_context") or {}).get("season_id")
    if not season_id:
        return []
    season = await db.league_seasons.find_one({"id": season_id}, {"_id": 0, "veto_presets": 1}) or {}
    return rules_mod.presets_of(season.get("veto_presets"))


async def store_presets(db, season: dict, presets: list[dict], *, actor_id: str | None) -> list[dict]:
    """Die Vorgaben je Spielwoche speichern. Protokoll ``league.season.veto_presets`` mit altem und neuem Wert und den geänderten
    Zeilen (``changes``: Woche, Modus, vorher, nachher) - daraus liest die Verwaltung die Historie. Gibt die Änderungen zurück."""
    before = rules_mod.presets_of(season.get("veto_presets"))
    old = {(row["week"], row["mode"]): row["map_id"] for row in before}
    new = {(row["week"], row["mode"]): row["map_id"] for row in presets}
    changes = [{"week": week, "mode": mode, "from": old.get((week, mode)), "to": new.get((week, mode))}
               for week, mode in sorted(set(old) | set(new)) if old.get((week, mode)) != new.get((week, mode))]
    if not changes:
        return []
    now_iso = now_utc().isoformat()
    await db.league_seasons.update_one({"id": season["id"]}, {"$set": {"veto_presets": presets, "updated_at": now_iso}})
    await db.audit_logs.insert_one({
        "id": new_id(), "action": "league.season.veto_presets", "target_id": season["id"], "actor_id": actor_id,
        "data": {"from": before, "to": presets, "changes": changes}, "created_at": now_iso})
    return changes


async def presets_history(db, season_id: str, limit: int = HISTORY_LIMIT) -> list[dict]:
    """Die letzten Änderungen der Vorgaben aus dem Protokoll - wer, wann, welche Woche von welcher Map auf welche."""
    rows = await db.audit_logs.find({"action": "league.season.veto_presets", "target_id": season_id},
                                    {"_id": 0, "actor_id": 1, "created_at": 1, "data.changes": 1}).sort("created_at", -1).to_list(limit)
    wanted = sorted({row.get("actor_id") for row in rows if row.get("actor_id")})
    people = await db.users.find({"id": {"$in": wanted}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1}).to_list(len(wanted) + 1) if wanted else []
    names = {row["id"]: row.get("display_name") or row.get("username") or "Leitung" for row in people}
    return [{"at": row.get("created_at"), "by_name": names.get(row.get("actor_id")) or "Leitung",
             "changes": list((row.get("data") or {}).get("changes") or [])} for row in rows]


def season_weeks(season: dict, *, rounds: int = 0, today=None, started=()) -> list[dict]:
    """Die Spielwochen, für die es eine Vorgabe braucht: Spieltag 1 bis ``rounds`` (so viele Spieltage hat die größte Staffel oder
    sind schon angesetzt), ohne Angabe alle aktiven Wochen der Season. Spieltag N liegt in der N-ten aktiven Woche - Sperrwochen zählen
    nicht mit; ``start_day``/``end_day`` sind deren Wiener Kalendertage (``None``, wenn der Kalender nicht so weit reicht).

    ``past`` (die Woche ist vorbei - ihr letzter Tag liegt vor ``today``, dem Wiener Kalendertag) und ``started`` (in der Woche hat ein
    Veto begonnen) sagen der Verwaltung, welche Wochen der Vorschlag „rotiert durch den Pool“ nie anfasst."""
    from services import league_service

    blocked = set(league_service.blocked_weeks(season))
    active = [days for number, days in enumerate(league_service.week_days(season), start=1) if number not in blocked]
    count = min(int(rounds or 0) or len(active), rules_mod.WEEKS_MAX)
    begun = set(started or ())
    out = []
    for number in range(1, count + 1):
        first, last = active[number - 1] if number <= len(active) else (None, None)
        out.append({"week": number, "start_day": first.isoformat() if first else None, "end_day": last.isoformat() if last else None,
                    "past": bool(today and last and last < today), "started": number in begun})
    return out


async def preset_weeks(db, season: dict, divisions: list[dict] | None = None) -> list[dict]:
    """``season_weeks`` mit der Zahl der Spieltage: der größten Staffel laut Vorgaben (Season und Liga N) oder dem höchsten schon
    angesetzten Spieltag - je nachdem, was größer ist."""
    from services import league_service
    from services.league_rounds import rounds_needed

    if divisions is None:
        divisions = await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0}).to_list(50)
    settings = [league_service.effective_settings(season, division) for division in divisions] or [league_service.effective_settings(season, None)]
    needed = max(rounds_needed(int(row.get("max_staffel_size") or 0), int(row.get("round_robin_legs") or 1)) for row in settings)
    staffeln = await db.tournaments.find({"league_context.season_id": season["id"]}, {"_id": 0, "id": 1}).to_list(200)
    played, started = 0, set()
    if staffeln:
        rows = await db.matches_v2.find({"tournament_id": {"$in": [row["id"] for row in staffeln]}},
                                        {"_id": 0, "matchday_number": 1, "round": 1, "round_index": 1, "flow.veto.status": 1}).to_list(5000)
        played = max((week_of(row) or 0 for row in rows), default=0)
        # Wochen mit begonnenem Veto (läuft, pausiert, fertig): Die Vorgabe dort steht in einem Veto fest.
        started = {week_of(row) for row in rows if ((row.get("flow") or {}).get("veto") or {}).get("status") in (RUNNING, PAUSED, DONE)}
    from services.matchday_schedule import LOCAL_TZ

    return season_weeks(season, rounds=max(needed, played), today=now_utc().astimezone(LOCAL_TZ).date(), started=started - {None})


def presets_overview(rules: dict | None, presets: list[dict], weeks: list[dict], *, pool: dict | None, repeat: str,
                     labels: dict[str, str] | None = None) -> list[dict]:
    """Je Spielwoche, was an den Vorgaben fehlt oder nicht passt (``[{week, problems}]``, nur Wochen mit Problem) - für Verwaltung und
    „Was fehlt noch?“. Ohne aktive Vorlage oder ohne Schritt „Vorgabe der Woche“ leer."""
    if not rules or not rules.get("enabled") or not rules_mod.preset_steps(rules.get("steps")):
        return []
    out = []
    for row in weeks:
        problems = rules_mod.week_problems(rules, rules_mod.presets_of_week(presets, row["week"]), pool=pool, repeat=repeat, labels=labels)
        if problems:
            out.append({"week": row["week"], "problems": problems})
    return out


def _preset_text(week: int, problems: list[str]) -> str:
    return (f"Für Spielwoche {week} steht die Vorgabe der Woche noch nicht – {' '.join(problems)} Das Veto beginnt erst, wenn die "
            "Liga-Leitung sie eingetragen hat.")


def _preset_rows(steps: list[dict], presets: dict[str, str], pool: dict | None) -> list[dict]:
    """Die Vorgaben einer Spielwoche zum Anzeigen: je Schritt Modus, Position und die Map mit Name und Bild aus dem Pool."""
    rows = []
    for step in rules_mod.preset_steps(steps):
        snapshot = _snapshot(pool, step["mode"], presets.get(step["mode"]) or "")
        if snapshot:
            rows.append({"mode": step["mode"], **_mode_head(pool, step["mode"]), "position": step.get("position"),
                         "map_id": snapshot.get("map_id"), "map_name": snapshot.get("name"), "map_image_url": snapshot.get("image_url")})
    return rows


async def _waiting_presets(db, match: dict, tournament: dict, rules: dict) -> tuple[int | None, list[dict], str | None]:
    """Vor dem Start des Vetos: Spielwoche, die Vorgaben zum Ansehen und - fehlt etwas - der Satz dazu. Ohne Schritt „Vorgabe der
    Woche“, ohne Spielwoche oder mit einer Vorlage, die für dieses Spiel ohnehin nicht läuft, bleibt alles leer."""
    if not rules_mod.preset_steps(rules["steps"]):
        return None, [], None
    week = week_of(match)
    if week is None:
        return None, [], None
    pool, best_of, order, repeat = await _match_setup(db, match, tournament)
    if rules_mod.fits_problem(rules, pool=pool, best_of=best_of, order=order, repeat=repeat):
        return week, [], None
    presets = rules_mod.presets_of_week(await season_presets(db, tournament), week)
    problems = rules_mod.week_problems(rules, presets, pool=pool, repeat=repeat)
    return week, _preset_rows(rules["steps"], presets, pool), _preset_text(week, problems) if problems else None


async def preset_gap(db, match: dict, tournament: dict | None) -> str | None:
    """Wartet das Veto dieses Spiels auf die Vorgabe der Woche? Dann der Satz dazu - ``None``, wenn es beginnen kann oder die Staffel
    keine Vorgabe kennt."""
    rules = rules_mod.rules_of(tournament)
    if not rules or veto_of(match) is not None:
        return None
    return (await _waiting_presets(db, match, tournament, rules))[2]


WILL_RUN, WILL_WAIT, WILL_SKIP = "running", "waiting", "skipped"


async def outlook(db, match: dict, tournament: dict | None) -> str | None:
    """Was mit dem Veto geschieht, sobald beide Seiten eingecheckt sind - für die Nachricht „Beide Seiten eingecheckt“
    (``match_flow.check_in``), damit sie nichts verspricht, was nicht kommt: ``running`` (es beginnt), ``waiting`` (die Vorgabe der Woche
    fehlt), ``skipped`` (die Vorlage passt nicht zu diesem Spiel - die Maps kommen beim Ergebnis); ``None`` ohne Veto in der Staffel."""
    rules = rules_mod.rules_of(tournament)
    if not rules:
        return None
    veto = veto_of(match)
    if veto is not None:
        return WILL_SKIP if veto.get("status") == SKIPPED else WILL_RUN
    pool, best_of, order, repeat = await _match_setup(db, match, tournament)
    if rules_mod.fits_problem(rules, pool=pool, best_of=best_of, order=order, repeat=repeat):
        return WILL_SKIP
    if rules_mod.preset_steps(rules["steps"]):
        week = week_of(match)
        if week is None:
            return WILL_SKIP
        presets = rules_mod.presets_of_week(await season_presets(db, tournament), week)
        if rules_mod.week_problems(rules, presets, pool=pool, repeat=repeat):
            return WILL_WAIT
    return WILL_RUN


async def _wait_for_preset(db, match: dict, tournament: dict, week: int, problems: list[str], now: datetime) -> None:
    """Die Vorgabe der Woche fehlt: Das Veto beginnt nicht. Je Termin einmal vermerkt (``flow.veto_wait``, Bedingung auf Termin und
    Revision), mit Protokoll und Hinweis an die Liga-Leitung - je Season und Spielwoche eine Nachricht, nie eine Wertung."""
    for_at, rev = iso(match.get("scheduled_at")), schedule_rev(match)
    marker = {"for_at": for_at, "rev": rev, "week": week, "at": now.isoformat()}
    written = await db.matches_v2.update_one(
        {"id": match["id"], "started_at": None,
         "$or": [{"flow.veto_wait": {"$exists": False}}, {"flow.veto_wait.for_at": {"$ne": for_at}}, {"flow.veto_wait.rev": {"$ne": rev}}]},
        {"$set": {"flow.veto_wait": marker}})
    if not written.matched_count:
        return
    # Zwischen dem Lesen der Vorgaben und dem Merker kann die Leitung sie gespeichert haben (Review zu #2326): Ihr Speichern fand dann
    # noch kein wartendes Spiel, und niemand erführe, dass es losgehen kann. Darum nach dem Merker noch einmal lesen - stehen die
    # Vorgaben jetzt, bekommen die Seiten „Vorgabe da – Veto kann starten“ statt die Leitung einen überholten Hinweis.
    fresh = await _reload(db, match)
    if not await preset_gap(db, fresh, tournament):
        await announce_ready(db, fresh, tournament, now=now)
        return
    await _audit(db, "match.veto.waiting", match, None, {"week": week, "problems": problems})
    try:
        from services.league_permissions import staff_user_ids
        from services.user_notifications import create_user_notification

        context = tournament.get("league_context") or {}
        season_id = context.get("season_id")
        for user_id in sorted(await staff_user_ids(db, context.get("league_id"), ("season", "matches"))):
            await create_user_notification(
                user_id, "Veto wartet auf die Vorgabe der Woche",
                f"{tournament.get('title') or 'Liga'} · Spielwoche {week}: {' '.join(problems)} Mindestens ein Spiel ist eingecheckt und "
                "wartet. Sobald die Vorgabe eingetragen ist, bekommen beide Seiten eine Nachricht – das Veto beginnt, wenn beide "
                "„Bereit zum Veto“ getippt haben.",
                url=f"/admin/leagues/seasons/{season_id}#veto", kind="match_attention",
                meta={"category": "tournament_updates", "tournament_id": tournament.get("id"), "match_id": match.get("id"),
                      "reason": "veto_preset_missing", "dedupe_key": f"veto-preset-missing:{season_id}:{week}"})
    except Exception:  # noqa: BLE001 - der Merker steht, die Matchseite sagt es ohnehin
        logger.warning("[league_veto] Hinweis zur fehlenden Vorgabe nicht verschickt", exc_info=True)


# ---------------------------------------------------------------- Hilfen

def _clean_reason(reason: str | None) -> str:
    text = " ".join(str(reason or "").split())
    if len(text) < REASON_MIN:
        raise FlowProblem("Bitte einen Grund angeben (mindestens fünf Zeichen).", 422)
    if len(text) > REASON_MAX:
        raise FlowProblem("Der Grund ist zu lang (höchstens 500 Zeichen).", 422)
    return text


async def _audit(db, action: str, match: dict, actor_id: str | None, data: dict) -> None:
    await db.audit_logs.insert_one({
        "id": new_id(), "action": action, "target_id": match.get("tournament_id"), "actor_id": actor_id,
        "data": {"match_id": match.get("id"), "stage_id": match.get("stage_id"), "match_key": match.get("match_key"), **data},
        "created_at": now_utc().isoformat(),
    })


async def _tell(db, match: dict, targets: list[str], title: str, text: str, reason: str, dedupe: str, *, kind: str = "match_call") -> int:
    """Nachricht an die Verantwortlichen der genannten Seiten - eine Nachricht hält die Aktion nie auf."""
    from services.match_audience import registrations_for_match, responsible_user_ids
    from services.match_notifications import match_title
    from services.user_notifications import create_user_notification

    try:
        registrations = await registrations_for_match(db, match)
        regs_by_id = {reg["id"]: reg for reg in registrations if reg.get("id")}
        tournament = await db.tournaments.find_one({"id": match.get("tournament_id")}, {"_id": 0, "title": 1}) or {}
        body = f"{tournament.get('title') or 'Liga'} · {match_title(match, regs_by_id)}: {text}"
        sent = 0
        for user_id in sorted(await responsible_user_ids(db, [reg for reg in registrations if reg.get("id") in targets])):
            if await create_user_notification(
                user_id, title, body, url=f"/matches/{match.get('id')}", kind=kind,
                meta={"category": "match_reminders", "match_id": match.get("id"), "tournament_id": match.get("tournament_id"),
                      "reason": reason, "dedupe_key": dedupe}):
                sent += 1
        return sent
    except Exception:  # noqa: BLE001 - der Schritt ist schon gespeichert
        logger.warning("[league_veto] Nachricht zu %s nicht verschickt", match.get("id"), exc_info=True)
        return 0


async def _reload(db, match: dict) -> dict:
    fresh = await db.matches_v2.find_one({"id": match["id"]}, {"_id": 0})
    return fresh or match


def _names_of(setup) -> dict[str, str]:
    return dict(getattr(setup, "names", None) or {})


async def _side_names(db, match: dict) -> dict[str, str]:
    from services.match_audience import registrations_for_match

    return {reg["id"]: reg.get("display_name") or reg.get("team_name") or "Team"
            for reg in await registrations_for_match(db, match) if reg.get("id")}


def _registration_for(veto: dict, step: dict) -> str | None:
    if step.get("kind") in SYSTEM_KINDS:
        return None
    return veto.get("team_a") if step.get("team") == "A" else veto.get("team_b")


def _snapshot(pool: dict | None, mode: str, map_id: str) -> dict:
    for item in rules_mod.pool_maps(pool).get(mode) or []:
        if item.get("map_id") == map_id:
            return item
    return {}


def _mode_head(pool: dict | None, mode: str) -> dict:
    for group in (pool or {}).get("modes") or []:
        if group.get("mode") == mode:
            return {"mode_label": group.get("label") or mode, **({"mode_icon_url": group["icon_url"]} if group.get("icon_url") else {})}
    return {"mode_label": mode}


def planned_games_of(veto: dict, pool: dict | None) -> list[dict]:
    """Die Spielreihenfolge aus den Wahlen und dem Decider - Schlüssel wie ``games[]``, nach Position; ``role`` wie #1931."""
    rows = []
    for step in veto.get("steps") or []:
        if step.get("kind") == rules_mod.BAN or not step.get("position"):
            continue
        rows.append({
            "position": int(step["position"]), "mode": step.get("mode"), **_mode_head(pool, step.get("mode")),
            "map_id": step.get("map_id"), "map_name": step.get("map_name"), "map_image_url": step.get("map_image_url"),
            "role": step.get("role") or ROLE_OF.get(step.get("kind"), "picked"), "by_registration_id": step.get("registration_id"),
        })
    return sorted(rows, key=lambda row: row["position"])


# ---------------------------------------------------------------- Start

async def _match_setup(db, match: dict, tournament: dict):
    """Pool, Best of, Modusfolge und Wiederholungsregel dieses Spiels - wie beim Melden (``league_games``)."""
    from services import league_games
    from services.match_v2_results import result_best_of

    stage = await db.tournament_stages.find_one({"id": match["stage_id"]}, {"_id": 0}) if match.get("stage_id") else None
    pool = await map_pools.effective_pool(db, tournament, stage=stage, match=match)
    return pool, await result_best_of(db, match), league_games.effective_mode_order(tournament, pool), league_games.map_repeat_of(tournament)


def _can_run(match: dict) -> bool:
    return (len(filled(match)) == 2 and not missing_sides(match) and not is_running(match) and not is_finished(match)
            and not has_report(match) and str(match.get("status") or "") in OPEN_MATCH_STATUSES and not match.get("is_preview"))


def wait_of(match: dict | None) -> dict | None:
    """Der Merker „das Veto hat auf die Vorgabe der Woche gewartet“ zum geltenden Termin und seiner Revision (``flow.veto_wait``) - ein
    neuer Termin macht ihn ungültig, wie das Veto selbst."""
    wait = ((match or {}).get("flow") or {}).get("veto_wait")
    if not isinstance(wait, dict):
        return None
    same = wait.get("for_at") == iso((match or {}).get("scheduled_at")) and int(wait.get("rev") or 0) == schedule_rev(match)
    return wait if same else None


async def ensure_started(db, match: dict, tournament: dict | None, *, now: datetime | None = None, manual: bool = False,
                         actor_id: str | None = None, via: str = "ready") -> dict:
    """Das Veto beginnen, sobald beide Seiten eingecheckt sind - genau einmal je Termin (Bedingung: kein Veto für diesen Termin).
    Gibt das Spiel zurück, bei einem Start den frischen Stand. Ohne Vorlage, mit Veto oder ohne „beide da“ passiert nichts.

    Hat das Veto auf die Vorgabe der Woche gewartet (``wait_of``), beginnt es **nicht mehr von selbst**: Die Teams sind vielleicht nicht
    mehr da, und nach 60 Sekunden würde das System für sie wählen. Dann startet es erst ``manual`` - sobald beide Seiten „Bereit zum
    Veto“ getippt haben (``set_ready``, ``via: "ready"``) oder im Notfall durch die Liga-Leitung (``lead_start``, ``via: "lead"``)."""
    rules = rules_mod.rules_of(tournament)
    # Gesperrte Staffel (Codex zu D.3): nur lesen - kein Start aus einem Seitenaufruf, der Scheduler lässt sie ohnehin aus.
    if not rules or tournament.get("locked_at") or veto_of(match) is not None or not _can_run(match):
        return match
    # Der Merker allein sperrt den Start von selbst - auch wenn die Leitung den Schritt „Vorgabe“ inzwischen aus der Vorlage genommen
    # hat: Die Teams haben gewartet und sind vielleicht nicht mehr da, eine Frist dürfte jetzt nicht einfach loslaufen.
    if not manual and wait_of(match) is not None:
        return match
    now = now or now_utc()
    now_iso = now.isoformat()
    for_at = iso(match.get("scheduled_at"))
    # Termin-Revision (Codex zu D.3): das Veto gehört zu Termin und Revision - A → B → A zählt nicht als derselbe Termin.
    rev = schedule_rev(match)
    home, away = filled(match)[:2]
    pool, best_of, order, repeat = await _match_setup(db, match, tournament)
    problem = rules_mod.fits_problem(rules, pool=pool, best_of=best_of, order=order, repeat=repeat)
    # Vorgabe der Woche (#2326): die Map der Spielwoche dieses Spiels - fehlt sie, beginnt das Veto nicht (kein ``skipped``, keine
    # Wertung): Die Leitung trägt sie nach, danach startet eine Seite das Veto von Hand.
    week, presets = None, {}
    if not problem and rules_mod.preset_steps(rules["steps"]):
        week = week_of(match)
        if week is None:
            problem = NO_WEEK_DETAIL
        else:
            presets = rules_mod.presets_of_week(await season_presets(db, tournament), week)
            missing = rules_mod.week_problems(rules, presets, pool=pool, repeat=repeat)
            if missing:
                await _wait_for_preset(db, match, tournament, week, missing, now)
                return match
    doc = {
        "version": 1, "for_at": for_at, "rev": rev, "started_at": now_iso, "finished_at": None,
        "template": {"team_a": rules["team_a"], "step_seconds": int(rules["step_seconds"]), "steps": [dict(step) for step in rules["steps"]]},
        # Schnappschuss der Vorgaben: eine spätere Änderung an der Season ändert ein begonnenes Veto nicht.
        "week": week, "presets": [{"mode": step["mode"], "map_id": presets[step["mode"]]} for step in rules_mod.preset_steps(rules["steps"])
                                  if presets.get(step["mode"])],
        "map_pool_id": (pool or {}).get("id"), "best_of": best_of, "map_repeat": repeat,
        "team_a": None, "team_b": None, "team_a_via": rules["team_a"], "draw": None,
        "step": 0, "deadline_at": None, "steps": [], "paused": None, "lead_log": [],
    }
    if problem:
        doc.update({"status": SKIPPED, "skipped_reason": problem})
    else:
        team_a = home if rules["team_a"] == HOME else secrets.choice([home, away])
        doc.update({"status": RUNNING, "team_a": team_a, "team_b": away if team_a == home else home,
                    "draw": {"at": now_iso} if rules["team_a"] == DRAW else None,
                    "deadline_at": (now + timedelta(seconds=int(rules["step_seconds"]))).isoformat()})
    written = await db.matches_v2.update_one(
        {"id": match["id"], "started_at": None, "status": {"$in": sorted(OPEN_MATCH_STATUSES)}, "scheduled_at": match.get("scheduled_at"),
         "flow.schedule_rev": rev if rev else {"$in": [None, 0]},
         "$or": [{"flow.veto": {"$exists": False}}, {"flow.veto.for_at": {"$ne": for_at}}, {"flow.veto.rev": {"$ne": rev}}]},
        {"$set": {"flow.veto": doc, "updated_at": now_iso}, "$unset": {"planned_games": "", "flow.veto_wait": ""}})
    fresh = await _reload(db, match)
    if not written.matched_count:
        return fresh
    await _audit(db, "match.veto.start", match, actor_id if manual else None, {
        "status": doc["status"], "team_a": doc["team_a"], "team_a_via": doc["team_a_via"], "map_pool_id": doc["map_pool_id"],
        **({"via": via} if manual else {}),
        **({"week": week, "presets": doc["presets"]} if doc["presets"] else {}),
        **({"skipped_reason": problem} if problem else {})})
    if problem:
        return fresh
    names = await _side_names(db, match)
    await _tell(db, match, [doc["team_a"]], "Veto läuft – ihr seid am Zug",
                f"Das Map-Veto hat begonnen, ihr beginnt. Je Schritt {doc['template']['step_seconds']} Sekunden – danach wählt das System.",
                "veto_start", f"veto-start:{match['id']}:{now_iso}")
    await _tell(db, match, [doc["team_b"]], "Veto läuft",
                f"Das Map-Veto hat begonnen – {names.get(doc['team_a'], 'die Gegenseite')} beginnt. Je Schritt "
                f"{doc['template']['step_seconds']} Sekunden.", "veto_start", f"veto-start:{match['id']}:{now_iso}")
    return await settle_due(db, fresh, tournament, now=now)


async def _not_started_detail(db, match: dict, tournament: dict | None) -> str:
    """Warum es noch kein Veto gibt: die Vorgabe der Woche fehlt, sie steht und beide Seiten müssen „Bereit zum Veto“ tippen - oder es
    fehlt schlicht der Check-in."""
    gap = await preset_gap(db, match, tournament)
    if gap:
        return gap
    return START_READY_DETAIL if start_ready(match, tournament) else NOT_STARTED_DETAIL


def start_ready(match: dict, tournament: dict | None) -> bool:
    """Wartet das Veto nur noch auf „Bereit zum Veto“ beider Seiten? Beide sind eingecheckt, das Veto hatte auf die Vorgabe der Woche
    gewartet - ob sie inzwischen steht, sagt ``preset_gap``."""
    # Nur der Merker zählt, nicht ob die Vorlage den Schritt „Vorgabe“ noch trägt (Review zu #2326): Wer gewartet hat, startet von Hand.
    return bool(rules_mod.rules_of(tournament) and veto_of(match) is None and wait_of(match) is not None and _can_run(match))


def ready_sides(match: dict | None) -> set[str]:
    """Die Seiten (``registration_id``), die „Bereit zum Veto“ getippt haben - zum geltenden Termin und seiner Revision. Ein neuer
    Termin setzt sie mit dem Merker zurück."""
    marks = (wait_of(match) or {}).get("ready")
    return {reg_id for reg_id in filled(match or {})[:2] if isinstance(marks, dict) and marks.get(reg_id)}


def _start_answer(veto: dict | None, *, replay: bool, **extra) -> dict:
    return {"started": veto is not None, "status": (veto or {}).get("status"), "version": (veto or {}).get("version"),
            "idempotent_replay": replay, **extra}


async def _startable(db, match: dict, tournament: dict | None) -> None:
    """Darf dieses Spiel sein Veto jetzt von Hand beginnen? Sonst der deutsche Satz, warum nicht."""
    if not rules_mod.rules_of(tournament):
        raise FlowProblem(NO_VETO_DETAIL)
    if not _can_run(match):
        raise FlowProblem(STARTED_DETAIL if is_running(match) else NOT_STARTED_DETAIL)
    gap = await preset_gap(db, match, tournament)
    if gap:
        raise FlowProblem(gap)
    if wait_of(match) is None:
        # Kein Warten, kein Start von Hand: Dieses Veto beginnt von selbst (beim nächsten Lesen der Seite).
        raise FlowProblem(NOT_STARTED_DETAIL)


async def set_ready(db, match: dict, tournament: dict | None, *, registration_id: str, ready: bool, user: dict,
                    now: datetime | None = None) -> dict:
    """„Bereit zum Veto“ (#2326, Nr. 127): Hat das Veto auf die Vorgabe der Woche gewartet, beginnt es erst, wenn **beide** Seiten bereit
    sind - Captain oder Vertreter je Seite. Eine Seite kann ihr „Bereit“ zurücknehmen, solange kein Veto läuft; die Gegenseite
    bekommt einmal eine Nachricht. Mit der zweiten Seite beginnt das Veto, und erst dann läuft die Zeit je Schritt.
    Doppelklick, zweites Gerät, beide gleichzeitig: jede Markierung und der Start schreiben mit Bedingung - genau ein Veto."""
    now = now or now_utc()
    veto = veto_of(match)
    if veto is not None:
        if not ready:
            raise FlowProblem("Das Veto läuft schon – „Bereit“ lässt sich nicht mehr zurücknehmen.")
        return _start_answer(veto, replay=True, ready=True)
    if ready:
        await _startable(db, match, tournament)
    elif not rules_mod.rules_of(tournament):
        raise FlowProblem(NO_VETO_DETAIL)
    elif not _can_run(match) or wait_of(match) is None:
        raise FlowProblem(STARTED_DETAIL if is_running(match) else NOT_STARTED_DETAIL)
    wait = wait_of(match)
    sides = filled(match)[:2]
    other = next((reg_id for reg_id in sides if reg_id != registration_id), None)
    scope = {"id": match["id"], "started_at": None, "flow.veto_wait.for_at": wait.get("for_at"), "flow.veto_wait.rev": wait.get("rev")}
    key = f"flow.veto_wait.ready.{registration_id}"
    already = registration_id in ready_sides(match)
    if not ready:
        if not already:
            return _start_answer(None, replay=True, ready=False)
        # Zurücknehmen geht, solange kein Veto läuft. Sind beide bereit, beginnt es im selben Aufruf der zweiten Seite - übrig bleibt
        # „beide bereit, kein Veto“ nur, wenn die Vorgabe der Woche genau dazwischen wieder lückenhaft wurde (Review zu #2326). Dann
        # soll niemand ohne Knopf dastehen: Zurücknehmen bleibt möglich, auch wenn die Vorgabe gerade fehlt. Der Merker fällt mit dem
        # Start weg, die Bedingung auf ihn schließt ein inzwischen begonnenes Veto aus.
        written = await db.matches_v2.update_one({**scope, key: {"$exists": True}}, {"$unset": {key: ""}})
        if not written.matched_count:
            raise FlowProblem(CHANGED_DETAIL)
        await _audit(db, "match.veto.ready_side", match, user.get("id"), {"registration_id": registration_id, "ready": False})
        return _start_answer(None, replay=False, ready=False)
    if not already:
        written = await db.matches_v2.update_one({**scope, key: {"$exists": False}}, {"$set": {key: {"at": now.isoformat()}}})
        if written.matched_count:
            await _audit(db, "match.veto.ready_side", match, user.get("id"), {"registration_id": registration_id, "ready": True})
    fresh = await _reload(db, match)
    if veto_of(fresh) is None and set(sides) <= ready_sides(fresh):
        fresh = await ensure_started(db, fresh, tournament, now=now, manual=True, actor_id=user.get("id"), via="ready")
    veto = veto_of(fresh)
    if veto is not None:
        return _start_answer(veto, replay=veto.get("started_at") != now.isoformat(), ready=True)
    if not already and other:
        names = await _side_names(db, match)
        await _tell(db, match, [other], "Gegenseite bereit zum Veto",
                    f"{names.get(registration_id, 'Die Gegenseite')} ist bereit zum Veto. Tippt auf der Matchseite auf „Bereit zum Veto“ – dann "
                    "beginnt es sofort, und erst ab dann läuft die Zeit je Schritt.",
                    "veto_side_ready", f"veto-side-ready:{match['id']}:{wait.get('for_at')}:{wait.get('rev')}:{registration_id}")
    return _start_answer(None, replay=already, ready=True)


async def lead_start(db, match: dict, tournament: dict | None, *, reason: str | None, user: dict, now: datetime | None = None) -> dict:
    """Notfall (#2326, Nr. 127): Die Liga-Leitung beginnt das wartende Veto, ohne dass beide Seiten „Bereit“ getippt haben - mit
    Pflichtgrund, im Protokoll (``match.veto.lead``, ``action: "start"``) und im ``lead_log`` des Vetos. Befangenheit prüft die Route."""
    now = now or now_utc()
    veto = veto_of(match)
    if veto is not None:
        return _start_answer(veto, replay=True)
    await _startable(db, match, tournament)
    text = _clean_reason(reason)
    fresh = await ensure_started(db, match, tournament, now=now, manual=True, actor_id=user.get("id"), via="lead")
    veto = veto_of(fresh)
    if veto is None:
        raise FlowProblem(await preset_gap(db, fresh, tournament) or CHANGED_DETAIL)
    if veto.get("started_at") != now.isoformat():
        return _start_answer(veto, replay=True)
    log = {"action": "start", "at": now.isoformat(), "by": user.get("id"), "reason": text}
    await db.matches_v2.update_one({"id": match["id"], "flow.veto.started_at": veto.get("started_at")},
                                   {"$push": {"flow.veto.lead_log": log}, "$addToSet": {"flow.user_ids": user.get("id")}})
    await _audit(db, "match.veto.lead", match, user.get("id"), {"action": "start", "reason": text, "step": 0})
    return _start_answer(veto_of(await _reload(db, match)) or veto, replay=False)


async def _start_both_ready(db, match: dict, *, now: datetime | None = None) -> bool:
    """Beide Seiten sind bereit, die Vorgabe steht (wieder), aber es läuft kein Veto: jetzt beginnen - unter der Sperre des Turniers wie
    jeder Zug, mit frisch gelesenem Stand. Idempotent: ``ensure_started`` schreibt mit der Bedingung „kein Veto für diesen Termin“; ein
    zweiter Lauf findet das Veto vor und tut nichts. Ist die Sperre belegt, bleibt es beim Stand - die Seiten können „Bereit“
    zurücknehmen und neu tippen, das nächste Speichern versucht es wieder."""
    from services.log_safe import log_safe
    from services.mutation_lock import MutationLockBusy, mutation_lock, tournament_write_resource

    try:
        async with mutation_lock(db, tournament_write_resource(match["tournament_id"]), wait_seconds=2.0):
            tournament = await db.tournaments.find_one({"id": match["tournament_id"]}, {"_id": 0, "creation_key": 0, "billing": 0})
            fresh = await _reload(db, match)
            if not tournament or tournament.get("locked_at") or veto_of(fresh) is not None or not start_ready(fresh, tournament):
                return False
            if not set(filled(fresh)[:2]) <= ready_sides(fresh) or await preset_gap(db, fresh, tournament):
                return False
            started = await ensure_started(db, fresh, tournament, now=now, manual=True, via="ready")
            return veto_of(started) is not None
    except MutationLockBusy:
        logger.info("[league_veto] Veto für match=%s wartet auf die Turniersperre", log_safe(match.get("id")))
        return False


async def announce_ready(db, match: dict, tournament: dict | None, *, now: datetime | None = None) -> bool:
    """Die Leitung hat die fehlende Vorgabe nachgetragen: beiden Seiten sagen, dass das Veto jetzt beginnen kann - einmal je Termin
    (``flow.veto_wait.ready_at`` mit Bedingung, dazu der Schlüssel der Nachricht). Das Veto beginnt dadurch nicht: Dafür tippen beide
    Seiten „Bereit zum Veto“. ``True``, wenn die Nachricht jetzt hinausging.

    **Ausnahme** (Review zu #2326): Sind **beide Seiten schon bereit** und es läuft kein Veto - die Vorgabe wurde genau zwischen den
    beiden Klicks wieder lückenhaft -, gibt es niemanden mehr, der tippen könnte. Dann beginnt das Veto hier selbst (``_start_both_ready``:
    unter der Sperre des Turniers, ``manual=True``, ``via="ready"``); ``True``, wenn es jetzt begonnen hat."""
    wait = wait_of(match)
    if not start_ready(match, tournament) or (tournament or {}).get("locked_at"):
        return False
    if await preset_gap(db, match, tournament):
        return False
    if set(filled(match)[:2]) <= ready_sides(match):
        return await _start_both_ready(db, match, now=now)
    if wait.get("ready_at"):
        return False
    now_iso = (now or now_utc()).isoformat()
    # Der Merker fällt mit dem Start des Vetos weg - die Bedingung auf ihn schließt ein inzwischen begonnenes Veto mit aus.
    written = await db.matches_v2.update_one(
        {"id": match["id"], "started_at": None, "flow.veto_wait.for_at": wait.get("for_at"), "flow.veto_wait.rev": wait.get("rev"),
         "flow.veto_wait.ready_at": None},
        {"$set": {"flow.veto_wait.ready_at": now_iso}})
    if not written.matched_count:
        return False
    await _audit(db, "match.veto.ready", match, None, {"week": wait.get("week")})
    has_preset = bool(rules_mod.preset_steps((rules_mod.rules_of(tournament) or {}).get("steps")))
    await _tell(db, match, filled(match)[:2], "Vorgabe da – Veto kann starten" if has_preset else "Veto kann starten",
                f"{'Die Liga-Leitung hat die Vorgabe der Woche eingetragen' if has_preset else 'Das Map-Veto kann jetzt beginnen'}. Tippt auf "
                "der Matchseite auf „Bereit zum Veto“ – es beginnt, sobald beide Seiten bereit sind. Erst ab dann läuft die Zeit je Schritt.",
                "veto_preset_ready", f"veto-preset-ready:{match['id']}:{wait.get('for_at')}:{wait.get('rev')}")
    return True


# ---------------------------------------------------------------- Schritte schreiben

class _Run:
    """Der Stand eines laufenden Vetos mit Pool - für Züge, Fristen und die Matchseite einmal gerechnet."""

    def __init__(self, match: dict, veto: dict, pool: dict | None):
        self.match, self.veto, self.pool = match, veto, pool
        self.template = veto.get("template") or {}
        self.steps = self.template.get("steps") or []
        self.repeat = veto.get("map_repeat") or "other_mode"
        # Vorgabe der Woche (#2326): je Modus die festgehaltene Map - vom ersten Schritt an aus dem Stand genommen.
        self.presets = {row["mode"]: row["map_id"] for row in veto.get("presets") or [] if row.get("mode") and row.get("map_id")}
        self.remaining = rules_mod.reserve(rules_mod.remaining_after(veto.get("steps") or [], pool, self.repeat), self.steps, self.presets,
                                           self.repeat)

    @property
    def index(self) -> int:
        return int(self.veto.get("step") or 0)

    @property
    def current(self) -> dict | None:
        return self.steps[self.index] if self.index < len(self.steps) else None

    @property
    def open_steps(self) -> list[dict]:
        return self.steps[self.index:]

    def options(self) -> list[str]:
        step = self.current
        if step and step["kind"] == PRESET:
            map_id = self.presets.get(step["mode"])
            return [map_id] if map_id else []
        return rules_mod.allowed_options(self.remaining, self.open_steps, self.repeat)

    def preset_position(self, mode: str | None, map_id: str | None) -> int | None:
        """Die Position, auf die diese Map als Vorgabe der Woche ihres Modus kommt - ``None``, wenn sie dort keine Vorgabe ist."""
        if not map_id or self.presets.get(mode) != map_id:
            return None
        return next((step.get("position") for step in rules_mod.preset_steps(self.steps) if step["mode"] == mode), None)

    def preset_elsewhere(self, mode: str | None, map_id: str | None) -> tuple[str, int | None] | None:
        """Jede Map nur einmal je Serie: Ist diese Map die Vorgabe eines **anderen** Modus? Dann (Modus, Position)."""
        if self.repeat != rules_mod.NEVER:
            return None
        for step in rules_mod.preset_steps(self.steps):
            if step["mode"] != mode and self.presets.get(step["mode"]) == map_id:
                return step["mode"], step.get("position")
        return None


async def _run_of(db, match: dict, veto: dict) -> _Run:
    pool = await map_pools.version_by_id(db, veto.get("map_pool_id"))
    return _Run(match, veto, pool)


async def _apply(db, run: _Run, *, map_id: str, via: str, user_id: str | None, now: datetime) -> dict | None:
    """Einen Schritt schreiben - mit Bedingung auf Version und Stand. ``None``: der Stand war inzwischen ein anderer."""
    veto, step = run.veto, run.current
    if step is None:
        return None
    snapshot = _snapshot(run.pool, step["mode"], map_id)
    now_iso = now.isoformat()
    entry = {
        "index": run.index, "kind": step["kind"], "mode": step["mode"], "mode_label": _mode_head(run.pool, step["mode"])["mode_label"],
        "team": step.get("team"), "registration_id": _registration_for(veto, step), "position": step.get("position"),
        "map_id": map_id, "map_name": snapshot.get("name"), "map_image_url": snapshot.get("image_url"),
        "role": ROLE_OF[step["kind"]], "via": via, "by": user_id if via == SIDE else None, "at": now_iso,
    }
    finished = run.index + 1 >= len(run.steps)
    seconds = int(run.template.get("step_seconds") or 60)
    update = {"$set": {"flow.veto.version": int(veto["version"]) + 1, "flow.veto.step": run.index + 1,
                       "flow.veto.deadline_at": None if finished else (now + timedelta(seconds=seconds)).isoformat(), "updated_at": now_iso},
              "$push": {"flow.veto.steps": entry}}
    if finished:
        done_steps = [*(veto.get("steps") or []), entry]
        update["$set"].update({"flow.veto.status": DONE, "flow.veto.finished_at": now_iso,
                               "planned_games": planned_games_of({"steps": done_steps}, run.pool)})
    if user_id:
        update["$addToSet"] = {"flow.user_ids": user_id}
    written = await db.matches_v2.update_one(
        {"id": run.match["id"], "flow.veto.version": veto["version"], "flow.veto.status": RUNNING, "started_at": None}, update)
    if not written.matched_count:
        return None
    await _audit(db, "match.veto.step", run.match, user_id, {
        "index": run.index, "kind": step["kind"], "mode": step["mode"], "map_id": map_id, "registration_id": entry["registration_id"],
        "position": step.get("position"), "via": via})
    if finished:
        if veto.get("map_pool_id"):
            await db.matches_v2.update_one({"id": run.match["id"], "map_pool_id": None}, {"$set": {"map_pool_id": veto["map_pool_id"]}})
        await _audit(db, "match.veto.done", run.match, None, {"steps": len(run.steps), "map_pool_id": veto.get("map_pool_id")})
        await _tell(db, run.match, [veto["team_a"], veto["team_b"]], "Veto abgeschlossen",
                    "Die Spielreihenfolge steht – ihr könnt starten. Map 1 beginnt, sobald eine Seite auf „Spiel starten“ tippt.",
                    "veto_done", f"veto-done:{run.match['id']}:{now_iso}")
    return await _reload(db, run.match)


async def settle_due(db, match: dict, tournament: dict | None, *, now: datetime | None = None, rng=None) -> dict:
    """Fällige Decider setzen und abgelaufene Fristen auflösen (Zufall, gleichverteilt) - so oft, bis nichts mehr fällig ist. Idempotent:
    jedes Schreiben trägt die Bedingung auf die Version; verliert dieser Aufruf, liest er neu und prüft wieder."""
    now = now or now_utc()
    # Gesperrte Staffel (Codex zu D.3): nur lesen - Job und Seitenaufruf lassen die Frist stehen.
    if (tournament or {}).get("locked_at"):
        return match
    for _ in range(rules_mod.STEPS_MAX + 1):
        veto = veto_of(match)
        if not veto or veto.get("status") != RUNNING or match.get("started_at"):
            return match
        run = await _run_of(db, match, veto)
        step = run.current
        if step is None:
            return match
        deadline = moment(veto.get("deadline_at"))
        if step["kind"] not in SYSTEM_KINDS and (not deadline or deadline > now):
            return match
        options = run.options()
        if not options:
            # Darf nach der Prüfung der Vorlage nicht passieren - lieber stehen lassen als still etwas wählen.
            logger.warning("[league_veto] Spiel %s: Schritt %s ohne wählbare Map", match.get("id"), run.index)
            return match
        chosen = options[0] if step["kind"] in SYSTEM_KINDS else rules_mod.auto_choice(options, rng)
        written = await _apply(db, run, map_id=chosen, via=AUTO, user_id=None, now=now)
        match = written if written is not None else await _reload(db, match)
    return match


# ---------------------------------------------------------------- Zug einer Seite

def _replay(veto: dict, *, registration_id: str | None, map_id: str | None, version: int) -> bool:
    """Derselbe Zug noch einmal (Doppelklick, zweites Gerät): die Version ist um eins älter und der letzte Schritt ist genau dieser."""
    last = (veto.get("steps") or [None])[-1]
    return bool(last and int(version) == int(veto.get("version") or 0) - 1 and last.get("via") == SIDE
                and last.get("registration_id") == registration_id and last.get("map_id") == map_id)


def _refusal(veto: dict) -> str | None:
    if veto.get("status") == SKIPPED:
        return f"In diesem Spiel läuft kein Veto: {veto.get('skipped_reason') or 'die Vorlage passt nicht.'}"
    if veto.get("status") == PAUSED:
        reason = (veto.get("paused") or {}).get("reason") or "ohne Grund"
        return f"Das Veto ist pausiert – {reason}. Die Liga-Leitung setzt es fort."
    return None


def _taken_here(run: _Run, mode: str | None, map_id: str) -> bool:
    """Steht die Map in diesem Modus schon im Verlauf (gesperrt, gewählt, Decider)?"""
    return any(row.get("mode") == mode and row.get("map_id") == map_id for row in run.veto.get("steps") or [])


def _option_hint(run: _Run, map_id: str) -> str:
    step = run.current or {}
    pool_ids = rules_mod.pool_ids(run.pool).get(step.get("mode"), [])
    name = _snapshot(run.pool, step.get("mode"), map_id).get("name") or "Diese Map"
    if map_id not in pool_ids:
        return f"{name} ist im Pool für {_mode_head(run.pool, step.get('mode'))['mode_label']} nicht freigegeben."
    if map_id not in run.remaining.get(step.get("mode"), []):
        if run.preset_position(step.get("mode"), map_id) or run.preset_elsewhere(step.get("mode"), map_id):
            return f"{name} ist die Vorgabe der Woche – weder sperrbar noch wählbar."
        if _taken_here(run, step.get("mode"), map_id):
            return f"{name} ist in diesem Modus schon gesperrt oder gewählt."
        return f"{name} läuft schon in einem anderen Modus – in dieser Season jede Map nur einmal je Serie."
    return f"{name} ließe sich nicht mehr zu Ende spielen – die restlichen Schritte gingen nicht auf."


async def pick(db, match: dict, tournament: dict | None, *, registration_id: str, map_id: str, version: int, user: dict,
               now: datetime | None = None) -> dict:
    """Die Seite am Zug sperrt oder wählt eine Map. Gleichzeitig, doppelt, zwei Geräte: einer schreibt, die anderen bekommen die
    Wiederholung oder „bitte neu laden“."""
    if not rules_mod.rules_of(tournament):
        raise FlowProblem(NO_VETO_DETAIL)
    now = now or now_utc()
    match = await ensure_started(db, match, tournament, now=now)
    match = await settle_due(db, match, tournament, now=now)
    veto = veto_of(match)
    if veto is None:
        raise FlowProblem(STARTED_DETAIL if is_running(match) else await _not_started_detail(db, match, tournament))
    refusal = _refusal(veto)
    if refusal:
        raise FlowProblem(refusal)
    if _replay(veto, registration_id=registration_id, map_id=map_id, version=version):
        return {"version": veto["version"], "step": veto["step"], "status": veto["status"], "idempotent_replay": True}
    if veto.get("status") == DONE:
        raise FlowProblem(DONE_DETAIL)
    if int(version) != int(veto.get("version") or 0):
        raise FlowProblem(CHANGED_DETAIL)
    run = await _run_of(db, match, veto)
    step = run.current
    if step is None:
        raise FlowProblem(DONE_DETAIL)
    if step["kind"] in SYSTEM_KINDS:
        raise FlowProblem(SYSTEM_STEP_DETAIL)
    expected = _registration_for(veto, step)
    if expected != registration_id:
        names = await _side_names(db, match)
        raise FlowProblem(f"Jetzt ist {names.get(expected, 'die Gegenseite')} am Zug.")
    options = run.options()
    if map_id not in options:
        raise FlowProblem(_option_hint(run, map_id), 422)
    fresh = await _apply(db, run, map_id=map_id, via=SIDE, user_id=user.get("id"), now=now)
    if fresh is None:
        raise FlowProblem(CHANGED_DETAIL)
    fresh = await settle_due(db, fresh, tournament, now=now)
    after = veto_of(fresh) or {}
    return {"version": after.get("version"), "step": after.get("step"), "status": after.get("status"), "idempotent_replay": False}


# ---------------------------------------------------------------- Leitung

async def lead_action(db, match: dict, tournament: dict | None, *, action: str, reason: str | None, version: int, user: dict,
                      now: datetime | None = None) -> dict:
    """Pause, Fortsetzen, Schritt zurück, Neustart - mit Grund, nur solange nichts begonnen und nichts gemeldet ist."""
    if action not in LEAD_ACTIONS:
        raise FlowProblem("Unbekannter Eingriff – möglich sind Pause, Fortsetzen, Schritt zurück und Neustart.", 422)
    if not rules_mod.rules_of(tournament):
        raise FlowProblem(NO_VETO_DETAIL)
    now = now or now_utc()
    now_iso = now.isoformat()
    match = await ensure_started(db, match, tournament, now=now)
    if action != "pause":
        match = await settle_due(db, match, tournament, now=now)
    if is_running(match) or is_finished(match) or has_report(match):
        raise FlowProblem(STARTED_DETAIL)
    veto = veto_of(match)
    if veto is None:
        raise FlowProblem(await _not_started_detail(db, match, tournament))
    if veto.get("status") == SKIPPED:
        raise FlowProblem(_refusal(veto))
    text = _clean_reason(reason)
    last = (veto.get("lead_log") or [None])[-1]
    if last and int(version) == int(veto.get("version") or 0) - 1 and last.get("action") == action and last.get("reason") == text:
        return {"version": veto["version"], "status": veto["status"], "idempotent_replay": True}
    if int(version) != int(veto.get("version") or 0):
        raise FlowProblem(CHANGED_DETAIL)
    seconds = int((veto.get("template") or {}).get("step_seconds") or 60)
    log = {"action": action, "at": now_iso, "by": user.get("id"), "reason": text}
    update: dict = {"$set": {"flow.veto.version": int(veto["version"]) + 1, "updated_at": now_iso}, "$push": {"flow.veto.lead_log": log},
                    "$addToSet": {"flow.user_ids": user.get("id")}}
    status = veto.get("status")
    if action == "pause":
        if status != RUNNING:
            raise FlowProblem("Pausieren geht nur, solange das Veto läuft.")
        deadline = moment(veto.get("deadline_at"))
        remaining = max(0, int((deadline - now).total_seconds())) if deadline else seconds
        update["$set"].update({"flow.veto.status": PAUSED, "flow.veto.deadline_at": None,
                               "flow.veto.paused": {"at": now_iso, "by": user.get("id"), "reason": text, "remaining_seconds": remaining}})
    elif action == "resume":
        if status != PAUSED:
            raise FlowProblem("Fortsetzen geht nur aus einer Pause.")
        remaining = int((veto.get("paused") or {}).get("remaining_seconds") or seconds)
        update["$set"].update({"flow.veto.status": RUNNING, "flow.veto.paused": None,
                               "flow.veto.deadline_at": (now + timedelta(seconds=max(1, remaining))).isoformat()})
    elif action == "undo":
        steps = list(veto.get("steps") or [])
        # Schritte des Systems (Decider, Vorgabe der Woche) setzt es gleich wieder - zurücknehmen lässt sich nur der Zug einer Seite.
        if not any(row.get("kind") not in SYSTEM_KINDS for row in steps):
            raise FlowProblem("Es gibt noch keinen Schritt, der sich zurücknehmen ließe.")
        # Ein automatischer Schritt ist die Folge des Zugs davor - er geht mit.
        while steps and steps[-1].get("kind") in SYSTEM_KINDS and len(steps) > 1:
            steps.pop()
        steps.pop()
        update["$set"].update({"flow.veto.status": RUNNING, "flow.veto.steps": steps, "flow.veto.step": len(steps), "flow.veto.paused": None,
                               "flow.veto.finished_at": None, "flow.veto.deadline_at": (now + timedelta(seconds=seconds)).isoformat()})
        update["$unset"] = {"planned_games": ""}
    else:
        update["$set"].update({"flow.veto.status": RUNNING, "flow.veto.steps": [], "flow.veto.step": 0, "flow.veto.paused": None,
                               "flow.veto.finished_at": None, "flow.veto.deadline_at": (now + timedelta(seconds=seconds)).isoformat()})
        update["$unset"] = {"planned_games": ""}
    written = await db.matches_v2.update_one(
        {"id": match["id"], "flow.veto.version": veto["version"], "flow.veto.status": status, "started_at": None}, update)
    if not written.matched_count:
        raise FlowProblem(CHANGED_DETAIL)
    await _audit(db, "match.veto.lead", match, user.get("id"), {"action": action, "reason": text, "step": veto.get("step")})
    fresh = await _reload(db, match)
    if action != "pause":
        fresh = await settle_due(db, fresh, tournament, now=now)
    after = veto_of(fresh) or {}
    return {"version": after.get("version"), "status": after.get("status"), "step": after.get("step"), "idempotent_replay": False}


# ---------------------------------------------------------------- Matchseite

async def page_block(db, match: dict, tournament: dict | None, *, names: dict[str, str], own_id: str | None, lead: bool,
                     can_lead_act: bool, conflict: dict | None, now: datetime | None = None) -> dict | None:
    """Der Block ``checkin.veto`` - nur Staffeln mit Vorlage. Das Spiel muss vorher durch ``ensure_started`` und ``settle_due`` gelaufen
    sein (``match_flow.page_block`` macht das)."""
    rules = rules_mod.rules_of(tournament)
    if not rules:
        return None
    now = now or now_utc()
    veto = veto_of(match)
    if veto is None:
        # Vorgabe der Woche (#2326): schon vor dem Start sichtbar - und klar gesagt, wenn sie fehlt (dann beginnt das Veto nicht).
        week, presets, blocked = (None, [], None) if is_running(match) or is_finished(match) else await _waiting_presets(db, match, tournament, rules)
        # Die Vorgabe wurde nachgetragen: Das Veto wartet nur noch auf „Bereit zum Veto“ beider Seiten (Nr. 127) - ohne Frist.
        waiting = not (tournament or {}).get("locked_at") and start_ready(match, tournament)
        ready = bool(waiting and not blocked)
        done = ready_sides(match) if waiting else set()
        start = None
        # Der Bereit-Block steht auch da, wenn die Vorgabe wieder fehlt, aber schon jemand bereit ist (Review zu #2326): Wurde die
        # Woche zwischen den beiden Klicks lückenhaft, soll keine Seite ohne Knopf festsitzen - „Doch nicht bereit“ bleibt möglich.
        if ready or done:
            own_ready = bool(own_id and own_id in done)
            other_ready = any(reg_id in done for reg_id in filled(match)[:2] if reg_id != own_id) if own_id else False
            start = {
                "sides": [{"registration_id": reg_id, "name": names.get(reg_id), "ready": reg_id in done, "own": reg_id == own_id}
                          for reg_id in filled(match)[:2]],
                "own_ready": own_ready, "other_ready": other_ready,
                # Bereit tippen Captain oder Vertreter der eigenen Seite - nicht, solange die Vorgabe fehlt. Zurücknehmen geht, solange
                # kein Veto läuft: Sind beide bereit, beginnt es sofort; bleibt es aus, darf jede Seite wieder zurück.
                "can_ready": bool(own_id) and not own_ready and ready, "can_withdraw": own_ready,
                "hint": START_READY_DETAIL,
                # Notfall: Die Leitung startet mit Pflichtgrund, ohne auf beide zu warten (Befangenheit wie bei jedem Eingriff).
                "lead": {"can_start": bool(can_lead_act) and ready, "conflict": conflict} if lead else None,
            }
        return {"status": "waiting", "skipped_reason": None, "version": 0, "step_seconds": int(rules["step_seconds"]) if ready else None,
                "team_a": None, "team_b": None, "current": None, "own_turn": False, "can_pick": False,
                "pick_hint": blocked or (START_READY_DETAIL if ready else NOT_STARTED_DETAIL), "options": [],
                "remaining": [], "history": [], "planned_games": [], "paused": None, "lead": None,
                "week": week, "presets": presets, "blocked": {"week": week, "text": blocked} if blocked else None, "start": start,
                # Live-Oberfläche (D.4, #1651): Ablauf, eigene Seite und die Serverzeit der Antwort für den Countdown.
                "plan": [], "own_side": None, "server_now": now.isoformat()}
    run = await _run_of(db, match, veto)
    step = run.current if veto.get("status") in (RUNNING, PAUSED) else None
    deadline = moment(veto.get("deadline_at"))
    turn_id = _registration_for(veto, step) if step else None
    own_turn = bool(own_id and step and turn_id == own_id)
    pick_hint = None
    if veto.get("status") == SKIPPED:
        pick_hint = _refusal(veto)
    elif veto.get("status") == DONE:
        pick_hint = DONE_DETAIL
    elif veto.get("status") == PAUSED:
        pick_hint = _refusal(veto)
    elif step and own_id and not own_turn:
        pick_hint = f"Jetzt ist {names.get(turn_id, 'die Gegenseite')} am Zug."
    elif step and step["kind"] == DECIDER:
        pick_hint = "Die übrige Map setzt das System."
    elif step and step["kind"] == PRESET:
        pick_hint = "Die Vorgabe der Woche setzt das System."
    allowed = set(run.options()) if step and veto.get("status") == RUNNING else set()
    options = []
    if step:
        for item in rules_mod.pool_maps(run.pool).get(step["mode"]) or []:
            ok = item["map_id"] in allowed
            options.append({"map_id": item["map_id"], "name": item.get("name"), "image_url": item.get("image_url"), "allowed": ok,
                            "hint": None if ok else _option_hint(run, item["map_id"])})
    taken = {(row.get("mode"), row.get("map_id")): row for row in veto.get("steps") or []}
    # Live-Oberfläche (D.4, #1651): Team A oder B statt der Anmeldung - so erkennt die Seite die Züge der Gegenseite, ohne Kennungen.
    side_of = {reg_id: side for side, reg_id in (("A", veto.get("team_a")), ("B", veto.get("team_b"))) if reg_id}
    # Jede Map nur einmal je Serie (``never``): eine in einem anderen Modus gewählte Map ist hier nicht mehr „offen“.
    played = {row.get("map_id"): row for row in veto.get("steps") or [] if row.get("kind") != rules_mod.BAN}
    remaining = []
    for group in (run.pool or {}).get("modes") or []:
        if not group.get("mode"):
            continue
        maps = []
        for item in group.get("maps") or []:
            row = taken.get((group["mode"], item.get("map_id")))
            preset_at = run.preset_position(group["mode"], item.get("map_id"))
            elsewhere = run.preset_elsewhere(group["mode"], item.get("map_id"))
            if row is None and preset_at:
                # Vorgabe der Woche (#2326): von Anfang an als solche gezeigt, auch bevor ihr Schritt an der Reihe war.
                row, status = {"position": preset_at}, ROLE_OF[PRESET]
            elif row is None and elsewhere:
                row, status = {"position": elsewhere[1]}, "elsewhere"
            elif row is None and item.get("map_id") not in run.remaining.get(group["mode"], []) and item.get("map_id") in played:
                row, status = played[item["map_id"]], "elsewhere"
            else:
                status = (row or {}).get("role") or "open"
            maps.append({"map_id": item.get("map_id"), "name": item.get("name"), "image_url": item.get("image_url"),
                         "status": status, "by_name": names.get((row or {}).get("registration_id")) if row else None,
                         "side": side_of.get((row or {}).get("registration_id")) if row else None,
                         "position": (row or {}).get("position")})
        remaining.append({"mode": group["mode"], "label": group.get("label") or group["mode"],
                          **({"icon_url": group["icon_url"]} if group.get("icon_url") else {}), "maps": maps})
    history = [{"index": row.get("index"), "kind": row.get("kind"), "mode_label": row.get("mode_label"),
                "name": names.get(row.get("registration_id")) if row.get("registration_id") else None, "map_name": row.get("map_name"),
                "position": row.get("position"), "via": row.get("via"), "at": row.get("at")} for row in veto.get("steps") or []]
    paused = veto.get("paused") if veto.get("status") == PAUSED else None
    return {
        "status": veto.get("status"), "skipped_reason": veto.get("skipped_reason"), "version": veto.get("version"),
        "step_seconds": (veto.get("template") or {}).get("step_seconds"),
        "team_a": {"registration_id": veto.get("team_a"), "name": names.get(veto.get("team_a")), "via": veto.get("team_a_via")} if veto.get("team_a") else None,
        "team_b": {"registration_id": veto.get("team_b"), "name": names.get(veto.get("team_b"))} if veto.get("team_b") else None,
        "current": {
            "index": run.index, "number": run.index + 1, "total": len(run.steps), "kind": step["kind"], "mode": step["mode"],
            **_mode_head(run.pool, step["mode"]), "registration_id": turn_id, "name": names.get(turn_id) if turn_id else None,
            "position": step.get("position"), "deadline_at": veto.get("deadline_at"),
            "remaining_seconds": max(0, int((deadline - now).total_seconds())) if deadline else (paused or {}).get("remaining_seconds"),
        } if step else None,
        "own_turn": own_turn, "can_pick": own_turn and veto.get("status") == RUNNING and step["kind"] not in SYSTEM_KINDS, "pick_hint": pick_hint,
        "options": options, "remaining": remaining, "history": history,
        "planned_games": list(match.get("planned_games") or []) if veto.get("status") == DONE else [],
        "paused": {"at": paused.get("at"), "reason": paused.get("reason"), "remaining_seconds": paused.get("remaining_seconds")} if paused else None,
        "lead": {"can_act": bool(can_lead_act and veto.get("status") in (RUNNING, PAUSED, DONE) and not match.get("started_at")),
                 "conflict": conflict} if lead else None,
        # Vorgabe der Woche (#2326): die Spielwoche und die festgehaltenen Maps dieses Vetos - nicht die heutigen der Season.
        "week": veto.get("week"), "presets": _preset_rows(run.steps, run.presets, run.pool), "blocked": None, "start": None,
        # Live-Oberfläche (D.4, #1651): der ganze Ablauf als Zeitleiste, die eigene Seite (A/B) und die Serverzeit der Antwort - der
        # Countdown rechnet damit, nicht mit der Uhr des Geräts.
        "plan": _plan_rows(run, veto, step, names), "own_side": side_of.get(own_id) if own_id else None, "server_now": now.isoformat(),
    }


def _plan_rows(run: _Run, veto: dict, step: dict | None, names: dict[str, str]) -> list[dict]:
    """Der Ablauf des Vetos als Zeitleiste (D.4, #1651): jeder Schritt der Vorlage mit Art, Modus, Seite und Position - erledigte mit der
    Map (und ob das System gewählt hat), der laufende als ``current``, die übrigen ``open``. Ohne Personen."""
    done = {row.get("index"): row for row in veto.get("steps") or [] if isinstance(row.get("index"), int)}
    rows = []
    for index, item in enumerate(run.steps):
        entry = done.get(index) or {}
        side = None if item.get("kind") in SYSTEM_KINDS else item.get("team")
        reg_id = _registration_for(veto, item)
        rows.append({
            "index": index, "number": index + 1, "kind": item.get("kind"), "mode": item.get("mode"), **_mode_head(run.pool, item.get("mode")),
            "side": side, "name": names.get(reg_id) if reg_id else None, "position": item.get("position"),
            "state": "done" if entry else ("current" if step is not None and index == run.index else "open"),
            "map_id": entry.get("map_id"), "map_name": entry.get("map_name"), "map_image_url": entry.get("map_image_url"),
            "via": entry.get("via"),
        })
    return rows


# ---------------------------------------------------------------- Live: Zuschauer, TV, Erinnerung (D.4, #1651)

SPECTATOR_PAUSE_HINT = "Das Veto ist pausiert – die Liga-Leitung setzt es fort."
# Die Seite hat das Veto offen, solange ihr kurzer Abruf läuft (sichtbarer Tab, alle 2 Sekunden): geschrieben wird höchstens alle
# SEEN_THROTTLE_SECONDS, als „offen“ gilt ein Abruf der letzten NUDGE_SEEN_SECONDS.
SEEN_THROTTLE_SECONDS = 5
NUDGE_SEEN_SECONDS = 15
# „Map-Veto wartet“: frühestens nach NUDGE_IDLE_SECONDS ohne Zug im laufenden Schritt, nicht mehr in den letzten Sekunden.
NUDGE_IDLE_SECONDS = 20
NUDGE_MIN_LEFT_SECONDS = 5


def spectator_view(block: dict | None) -> dict | None:
    """Was Zuschauer und TV vom Veto sehen (#1651): nur lesend und ohne Internes - keine Wahl, kein Eingriff, kein Bereit-Stand, keine
    Lücke der Vorgabe und kein Grund einer Pause (den schreibt die Leitung frei hinein). Personen stehen ohnehin nicht im Block, nur die
    Namen der beiden Seiten. Vor dem Start bleibt nur die Vorgabe der Woche."""
    if not block:
        return None
    out = {**block, "own_turn": False, "can_pick": False, "own_side": None, "options": [], "lead": None, "start": None, "blocked": None}
    if block.get("status") == "waiting":
        return {**out, "pick_hint": None, "step_seconds": None}
    if isinstance(block.get("paused"), dict):
        out["paused"] = {"at": block["paused"].get("at"), "reason": None, "remaining_seconds": block["paused"].get("remaining_seconds")}
    if block.get("status") == PAUSED:
        out["pick_hint"] = SPECTATOR_PAUSE_HINT
    return out


async def side_names(db, match: dict) -> dict[str, str]:
    """Die Namen der Seiten (Anmeldung → Name), wie Matchseite und Nachrichten sie nennen."""
    return await _side_names(db, match)


async def live_block(db, match: dict, tournament: dict | None, *, names: dict[str, str] | None = None, own_id: str | None = None,
                     lead: bool = False, can_lead_act: bool = False, conflict: dict | None = None, spectator: bool = False,
                     now: datetime | None = None) -> dict | None:
    """Der Veto-Block für den kurzen Abruf (``GET /api/matches/{id}/veto``) - derselbe wie auf der Matchseite, nur ohne den übrigen
    Check-in. ``spectator``: die Sicht für Zuschauer und TV (``spectator_view``). Schreibt nichts; Start und Fristen löst vorher der
    Aufruf der Beteiligten bzw. der Job."""
    names = names if names is not None else await _side_names(db, match)
    if spectator:
        return spectator_view(await page_block(db, match, tournament, names=names, own_id=None, lead=False, can_lead_act=False,
                                               conflict=None, now=now))
    return await page_block(db, match, tournament, names=names, own_id=own_id, lead=lead, can_lead_act=can_lead_act,
                            conflict=conflict, now=now)


def _plain_key(value: str | None) -> bool:
    text = str(value or "")
    return bool(text) and "." not in text and not text.startswith("$")


async def mark_seen(db, match: dict, registration_id: str | None, *, now: datetime | None = None) -> bool:
    """Die Seite hat das laufende Veto offen (#1651) - für die Erinnerung „Map-Veto wartet“. Steht als ``flow.veto_seen.<Anmeldung>``
    (Zeitpunkt, keine Person), geschrieben höchstens alle SEEN_THROTTLE_SECONDS und nur, solange das Veto läuft. Am Veto selbst ändert
    sich nichts (keine Version, kein ``updated_at``)."""
    veto = veto_of(match)
    if not _plain_key(registration_id) or not veto or veto.get("status") != RUNNING:
        return False
    now = now or now_utc()
    path = f"flow.veto_seen.{registration_id}"
    cutoff = (now - timedelta(seconds=SEEN_THROTTLE_SECONDS)).isoformat()
    written = await db.matches_v2.update_one(
        {"id": match["id"], "flow.veto.status": RUNNING, "$or": [{path: {"$exists": False}}, {path: {"$lt": cutoff}}]},
        {"$set": {path: now.isoformat()}})
    return bool(written.modified_count)


def nudge_target(match: dict, *, now: datetime) -> dict | None:
    """Ist jetzt eine Erinnerung „Map-Veto wartet“ fällig (#1651)? Nur im laufenden Veto, nur für den Zug einer Seite (nie Decider oder
    Vorgabe), frühestens NUDGE_IDLE_SECONDS nach Beginn des Schritts, nicht in den letzten NUDGE_MIN_LEFT_SECONDS, nur wenn die Seite das
    Veto gerade nicht offen hat - und je Schritt und Seite einmal (``flow.veto_nudge.key``). Gibt Schritt, Seite und Schlüssel zurück."""
    veto = veto_of(match)
    if not veto or veto.get("status") != RUNNING or match.get("started_at"):
        return None
    template = veto.get("template") or {}
    steps = template.get("steps") or []
    index = int(veto.get("step") or 0)
    if index >= len(steps) or steps[index].get("kind") in SYSTEM_KINDS:
        return None
    step = steps[index]
    turn_id = _registration_for(veto, step)
    deadline = moment(veto.get("deadline_at"))
    if not turn_id or not deadline:
        return None
    left = (deadline - now).total_seconds()
    if int(template.get("step_seconds") or 60) - left < NUDGE_IDLE_SECONDS or left < NUDGE_MIN_LEFT_SECONDS:
        return None
    flow = match.get("flow") or {}
    seen = moment((flow.get("veto_seen") or {}).get(turn_id)) if isinstance(flow.get("veto_seen"), dict) else None
    if seen and (now - seen).total_seconds() < NUDGE_SEEN_SECONDS:
        return None
    # „Schritt zurück“ und „Neu starten“ der Leitung (Review zu #1651): Derselbe Schritt beginnt dann noch einmal - der Zähler dieser
    # Eingriffe gehört in den Schlüssel, sonst bliebe die Seite beim zweiten Mal ohne Erinnerung. Pause und Fortsetzen zählen nicht:
    # Es bleibt derselbe Schritt.
    resets = sum(1 for row in veto.get("lead_log") or [] if isinstance(row, dict) and row.get("action") in ("undo", "restart"))
    key = f"veto-turn:{match.get('id')}:{veto.get('started_at')}:{resets}:{index}:{turn_id}"
    if (flow.get("veto_nudge") or {}).get("key") == key:
        return None
    return {"index": index, "step": step, "registration_id": turn_id, "key": key, "left": max(0, int(left))}


async def nudge_due(db, match: dict, tournament: dict | None, *, now: datetime | None = None) -> bool:
    """Erinnerung „Map-Veto wartet“ (#1651) an die Verantwortlichen der Seite am Zug, wenn ``nudge_target`` sie fällig nennt. Der Merker
    ``flow.veto_nudge`` wird mit Bedingung auf Version und Schlüssel gesetzt - zwei Läufe gleichzeitig schicken eine Nachricht. Am Veto
    ändert sich nichts. Gesperrte Staffel: nichts."""
    now = now or now_utc()
    if (tournament or {}).get("locked_at"):
        return False
    target = nudge_target(match, now=now)
    if not target:
        return False
    veto = veto_of(match) or {}
    written = await db.matches_v2.update_one(
        {"id": match["id"], "flow.veto.version": veto.get("version"), "flow.veto.status": RUNNING, "started_at": None,
         "flow.veto_nudge.key": {"$ne": target["key"]}},
        {"$set": {"flow.veto_nudge": {"key": target["key"], "at": now.isoformat()}}})
    if not written.matched_count:
        return False
    pool = await map_pools.version_by_id(db, veto.get("map_pool_id"))
    step = target["step"]
    what = "sperrt eine Map" if step.get("kind") == rules_mod.BAN else f"wählt Map {step.get('position')}"
    label = _mode_head(pool, step.get("mode"))["mode_label"]
    sent = await _tell(db, match, [target["registration_id"]], "Map-Veto wartet – ihr seid am Zug",
                       f"Ihr seid im Map-Veto am Zug: {what} ({label}). Noch {target['left']} Sekunden – danach wählt das System.",
                       "veto_turn", target["key"])
    return sent > 0


# ---------------------------------------------------------------- Datenschutz

def export_steps(match: dict, user_id: str) -> list[dict]:
    """Für die Auskunft: die eigenen Züge und Eingriffe als Leitung - je Spiel, ohne die Züge anderer."""
    veto = ((match.get("flow") or {}).get("veto") or {})
    out = []
    for row in veto.get("steps") or []:
        if row.get("by") == user_id:
            out.append({"role": "veto_step", "kind": row.get("kind"), "side": row.get("registration_id"), "at": row.get("at")})
    for row in veto.get("lead_log") or []:
        if row.get("by") == user_id:
            out.append({"role": "veto_lead", "action": row.get("action"), "at": row.get("at")})
    return out


def scrub(veto: dict | None, user_id: str) -> tuple[dict | None, bool]:
    """Kontolöschung: die Kennung der Person fällt aus Zügen, Pause und Eingriffen - die Züge bleiben."""
    if not isinstance(veto, dict):
        return veto, False
    changed = False
    out = dict(veto)
    steps = []
    for row in veto.get("steps") or []:
        if isinstance(row, dict) and row.get("by") == user_id:
            row = {**row, "by": None}
            changed = True
        steps.append(row)
    out["steps"] = steps
    if isinstance(veto.get("paused"), dict) and veto["paused"].get("by") == user_id:
        out["paused"] = {**veto["paused"], "by": None}
        changed = True
    log = []
    for row in veto.get("lead_log") or []:
        if isinstance(row, dict) and row.get("by") == user_id:
            row = {**row, "by": None}
            changed = True
        log.append(row)
    out["lead_log"] = log
    return out, changed


__all__ = ["AUTO", "CHANGED_DETAIL", "DONE_DETAIL", "LEAD_ACTIONS", "NO_VETO_DETAIL", "NO_WEEK_DETAIL", "NOT_A_SIDE_DETAIL",
           "NOT_STARTED_DETAIL", "REPORT_VETO_DETAIL", "SIDE", "VetoProblem", "ensure_started", "export_steps", "lead_action", "page_block",
           "START_READY_DETAIL", "WILL_RUN", "WILL_SKIP", "WILL_WAIT", "announce_ready", "lead_start", "outlook", "pick", "ready_sides", "set_ready", "planned_games_of", "preset_gap", "preset_weeks", "presets_history",
           "presets_overview", "scrub", "season_presets", "season_weeks", "settle_due", "start_ready", "store_presets", "wait_of", "week_of"]
