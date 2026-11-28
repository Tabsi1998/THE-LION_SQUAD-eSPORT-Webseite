"""Season absagen (#2607, Entscheidung Nr. 302; docs/LIGA.md „Season absagen“).

Ein Knopf statt des Umwegs von Hand (jede Anmeldung ablehnen, jede Staffel absagen, löschen oder archivieren). Die Leitung entscheidet,
nie der Server: keine Mindestzahl, nie automatisch. Eine abgesagte Season wirkt überall wie geschlossen, bleibt aber sichtbar.

- **Wann:** vor dem Start, solange keine Staffel läuft oder Ergebnisse hat. Recht „Liga verwalten“ (``manage``), Grund Pflicht (mindestens
  fünf Zeichen). Team- und Solo-Seasons gleich.
- **In einem Schritt, unter Sperre:** zuerst die Sperren aller Staffeln, dann die der Season, zuletzt die des Map-Pools (dieselbe
  Reihenfolge wie Zuteilen und „Staffel anlegen“). Dann: Season auf ``cancelled`` (mit Grund und Zeit, die Anmeldung ist damit zu), alle offenen
  Anträge abgelehnt (eingereicht, in Prüfung, Warteliste, angenommen - auch zugeteilt), alle Staffeln auf „Abgesagt“, je Teamleitung bzw.
  Person genau eine Nachricht samt Mail (``dedupe_key`` je Season und Person, nie gesammelt), Protokoll ``league.season.cancel``.
- **Idempotent:** Ein zweites Absagen (auch gleichzeitig, auch nach einem Abbruch mittendrin) läuft dieselben Schritte noch einmal - sie
  finden nichts mehr zu tun, und die Nachrichten sind schon verschickt (``dedupe_key``). Die Antwort sagt ``already``.
- **Startrechte:** Die abgesagte Season gibt ``predecessor_id`` frei (``cancelled_predecessor_id``, die Anzeige ``predecessor`` bleibt). So legt
  „Neue Season aus …“ beim Vorgänger wieder eine Season an, und dessen Startrechte gelten dort neu.
- **Kein Zurücknehmen:** Für einen Neustart eine neue Season anlegen.
"""
from __future__ import annotations

import logging
from contextlib import AsyncExitStack

from models import new_id, now_utc
from services import league_applications, league_participants, league_service
from services.league_mail import send_league_mail
from services.league_permissions import staff_user_ids
from services.league_scope import ONLY_LEAGUE
from services.league_service import CANCELLED, LeagueProblem
from services.log_safe import log_safe
from services.match_audience import responsible_ids, teams_by_id
from services.mutation_lock import (
    MutationLockBusy, league_season_pool_resource, league_season_resource, mutation_lock, tournament_write_resource,
)

logger = logging.getLogger("tls.league_season_cancel")

REASON_MIN = 5
REASON_MAX = 500
LOCK_WAIT_SECONDS = 10.0
REASON_SHORT = f"Bitte einen Grund angeben (mindestens {REASON_MIN} Zeichen). Er steht auf der Ligaseite und in der Nachricht an alle."
BUSY = "An dieser Season wird gerade etwas geändert. Bitte gleich noch einmal versuchen."
FINISHED = "Diese Season ist beendet oder archiviert – absagen geht nur vor dem Start."
RUNNING = "{name} läuft schon – absagen geht nur vor dem Start. Eine laufende Staffel sagst du auf ihrer Seite ab."
SCORED = "{name} hat schon Ergebnisse – absagen geht nur, solange keine Staffel Ergebnisse hat."
# Staffeln, die schon für sich entschieden sind: Sie bleiben, wie sie sind.
SETTLED_STAFFEL = frozenset({"cancelled", "archived"})
NOTE_KIND = "tournament_cancelled"
SHORTFALL_KEY = "league-season-shortfall"


def clean_reason(raw) -> str:
    text = " ".join(str(raw or "").split())
    if len(text) < REASON_MIN:
        raise LeagueProblem(REASON_SHORT, 422)
    return text[:REASON_MAX]


def _staffel_name(row: dict) -> str:
    context = row.get("league_context") or {}
    return f"Staffel {context.get('staffel')}" if context.get("staffel") else (row.get("title") or "Eine Staffel")


async def _staffeln(db, season_id: str) -> list[dict]:
    """Alle Staffeln der Season - auch Playoffs und Relegation."""
    return await db.tournaments.find({"league_context.season_id": season_id, **ONLY_LEAGUE},
                                     {"_id": 0, "id": 1, "title": 1, "status": 1, "league_context": 1, "final_table": 1,
                                      "cancelled_with_season": 1}).to_list(500)


def told_staffeln(staffeln: list[dict]) -> list[str]:
    """Die Staffeln, deren Teilnehmer die Absage der Season hören: die noch offenen (Vorschau) bzw. die mit der Season abgesagten.
    Wer nur in einer vorher einzeln abgesagten oder archivierten Staffel stand, hat seine Absage schon - Blatt und Nachricht zählen gleich."""
    return [row["id"] for row in staffeln if row.get("status") not in SETTLED_STAFFEL or row.get("cancelled_with_season")]


async def problems(db, season: dict, staffeln: list[dict] | None = None) -> list[str]:
    """Was gegen das Absagen spricht. Leer heißt: es geht. Eine schon abgesagte Season hat keine Probleme (``already``)."""
    status = season.get("status") or "draft"
    if status == CANCELLED:
        return []
    if status in ("completed", "archived"):
        return [FINISHED]
    rows = staffeln if staffeln is not None else await _staffeln(db, season["id"])
    out = [RUNNING.format(name=_staffel_name(row)) for row in rows
           if row.get("status") in league_service.RUNNING_STAFFEL_STATUSES or isinstance(row.get("final_table"), dict)]
    ids = [row["id"] for row in rows]
    if ids:
        scored = await db.matches_v2.distinct("tournament_id", {"tournament_id": {"$in": ids}, "is_preview": {"$ne": True},
                                                               "status": {"$in": list(league_service.SCORED_MATCH_STATUSES)}})
        named = {row["id"]: _staffel_name(row) for row in rows}
        out += [SCORED.format(name=named[tid]) for tid in sorted(scored) if tid in named]
    return list(dict.fromkeys(out))


# ---------------------------------------------------------------- Wer eine Nachricht bekommt

async def _registrations(db, staffel_ids: list[str]) -> list[dict]:
    if not staffel_ids:
        return []
    from services.squad_registration import ACTIVE_REGISTRATION_STATUSES

    return await db.tournament_registrations.find(
        {"tournament_id": {"$in": staffel_ids}, "status": {"$in": list(ACTIVE_REGISTRATION_STATUSES)}},
        {"_id": 0, "id": 1, "tournament_id": 1, "team_id": 1, "squad_id": 1, "user_id": 1, "registration_type": 1, "display_name": 1,
         "application_id": 1}).to_list(5000)


async def audience(db, applications: list[dict], registrations: list[dict], carried: set[str] | None = None) -> dict[str, list[str]]:
    """Je Person die Namen, für die sie die Nachricht bekommt: Captain und Vertreter (ohne beide die Hauptteam-Leitung) je Antrag bzw.
    Co-Team, in der Solo-Liga die Person selbst. Zugeteilte ohne offenen Antrag (Sonderweg „Co-Team zuteilen“) zählen mit - jede
    Person steht nur einmal da, auch mit zwei Co-Teams. ``carried`` sammelt, wer für einen aus dem Vorgänger übernommenen Antrag
    (``carry_over``) zuständig ist - nur diese Personen lesen den Satz zu den Startrechten."""
    out: dict[str, list[str]] = {}

    def add(user_ids, name: str) -> None:
        for user_id in user_ids:
            if user_id and name not in out.setdefault(user_id, []):
                out[user_id].append(name)

    covered: set[str] = set()
    for application in applications:
        people = await league_applications._audience(db, application)
        add(people, application.get("display_name") or "Anmeldung")
        if carried is not None and application.get("carry_over"):
            carried.update(people)
        covered.add(application["id"])
        if application.get("squad_id"):
            covered.add(f"squad:{application['squad_id']}")
        if application.get("user_id"):
            covered.add(f"user:{application['user_id']}")
    sides = [row for row in registrations if row.get("application_id") not in covered and row.get("squad_id")
             and f"squad:{row['squad_id']}" not in covered]
    teams = await teams_by_id(db, [{"team_id": row.get("team_id"), "squad_id": row.get("squad_id")} for row in sides]) if sides else {}
    for row in sides:
        side = {"team_id": row.get("team_id"), "squad_id": row.get("squad_id")}
        add(responsible_ids(side, teams.get(row.get("team_id") or "")), row.get("display_name") or "Co-Team")
        covered.add(f"squad:{row['squad_id']}")
    people = [row for row in registrations if not row.get("squad_id") and row.get("user_id") and row.get("application_id") not in covered
              and f"user:{row['user_id']}" not in covered]
    if people:
        active = {row["id"] for row in await db.users.find(
            {"id": {"$in": sorted({row["user_id"] for row in people})}, "is_active": {"$ne": False}, "is_banned": {"$ne": True}},
            {"_id": 0, "id": 1}).to_list(len(people) + 1)}
        for row in people:
            if row["user_id"] in active:
                add([row["user_id"]], row.get("display_name") or "Spieler")
    return out


async def _open_applications(db, season_id: str) -> list[dict]:
    return await db.league_applications.find({"season_id": season_id, "status": {"$in": list(league_applications.OPEN_STATUSES)}},
                                             {"_id": 0}).to_list(5000)


async def _cancelled_applications(db, season_id: str) -> list[dict]:
    """Die Anträge, die das Absagen abgelehnt hat - für die Nachrichten auch beim Wiederholen."""
    return await db.league_applications.find({"season_id": season_id, "season_cancelled": True}, {"_id": 0}).to_list(5000)


# ---------------------------------------------------------------- Vorschau

async def plan(db, league: dict, season: dict) -> dict:
    """Was das Absagen täte - für das Bestätigungsblatt. Liest nur. Die Zahlen rechnet dieselbe Stelle wie das Absagen selbst."""
    staffeln = await _staffeln(db, season["id"])
    found = await problems(db, season, staffeln)
    applications = await _open_applications(db, season["id"])
    open_ids = told_staffeln(staffeln)
    registrations = await _registrations(db, open_ids)
    people = await audience(db, applications, registrations)
    by_status = {status: 0 for status in league_applications.OPEN_STATUSES}
    for row in applications:
        by_status[row["status"]] += 1
    names = sorted({name for row in people.values() for name in row})
    solo = league_participants.is_solo(league)
    return {
        "season_id": season["id"], "cancelled": season.get("status") == CANCELLED, "can_cancel": not found and season.get("status") != CANCELLED,
        "problems": found, "kind": league_participants.SOLO if solo else "team",
        "applications": len(applications), "applications_by_status": by_status,
        "staffeln": len(open_ids), "registrations": len(registrations),
        # Wer die Nachricht bekommt: Personen (Captain und Vertreter bzw. Spieler) und für welche Teams bzw. Spieler.
        "people": len(people), "teams": len(names),
        "carried": len([row for row in applications if row.get("carry_over")]),
        "predecessor": season.get("predecessor") if season.get("predecessor_id") else None,
    }


# ---------------------------------------------------------------- Absagen

async def cancel(db, league: dict, season: dict, reason, actor: dict) -> dict:
    """Die Season absagen. Wirft ``LeagueProblem`` (422 Grund, 409 begonnen oder besetzt). Siehe Modulkopf."""
    text = clean_reason(reason)
    staffel_ids = sorted(row["id"] for row in await _staffeln(db, season["id"]))
    try:
        async with AsyncExitStack() as stack:
            for tid in staffel_ids:
                await stack.enter_async_context(mutation_lock(db, tournament_write_resource(tid), wait_seconds=LOCK_WAIT_SECONDS))
            await stack.enter_async_context(mutation_lock(db, league_season_resource(season["id"]), wait_seconds=LOCK_WAIT_SECONDS))
            await stack.enter_async_context(mutation_lock(db, league_season_pool_resource(season["id"]), wait_seconds=LOCK_WAIT_SECONDS))
            result = await _cancel_locked(db, league, season["id"], text, actor, staffel_ids)
    except MutationLockBusy:
        raise LeagueProblem(BUSY, 409) from None
    from services.change_events import reset_scope_cache

    reset_scope_cache()
    # Nachrichten erst nach den Sperren: Sie halten nichts auf, doppelt verhindert der ``dedupe_key`` (auch beim Wiederholen).
    result["notified"] = await _tell(db, league, result["season"], await _staffeln(db, season["id"]))
    if not result["already"]:
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "league.season.cancel", "actor_id": actor.get("id"), "target_id": season["id"],
            "data": {"season_id": season["id"], "league_id": league["id"], "reason": text, "applications": result["application_ids"],
                     "staffeln": result["staffel_ids"], "people": result["notified"], "from": result["from"]},
            "created_at": now_utc().isoformat()})
    return result


async def _cancel_locked(db, league: dict, season_id: str, text: str, actor: dict, locked_ids: list[str]) -> dict:
    fresh = await league_service.get_season(db, season_id)
    already = fresh.get("status") == CANCELLED
    staffeln = await _staffeln(db, season_id)
    if sorted(row["id"] for row in staffeln) != locked_ids:
        # Inzwischen kam eine Staffel dazu oder ging weg - sie hielte keine Sperre. Neu laden und noch einmal.
        raise LeagueProblem(league_service.CHANGED_MEANWHILE, 409)
    if not already:
        found = await problems(db, fresh, staffeln)
        if found:
            raise LeagueProblem(found[0], 409)
        now = now_utc().isoformat()
        change: dict = {"$set": {"status": CANCELLED, "cancel_reason": text, "cancelled_at": now, "cancelled_by": actor.get("id"),
                                 "status_before_cancel": fresh.get("status") or "draft", "updated_at": now}}
        if fresh.get("predecessor_id"):
            # Startrechte (#1627): Der Vorgänger bekommt wieder eine Folge-Season - der eindeutige Index hält nur eine je Vorgänger.
            change["$set"]["cancelled_predecessor_id"] = fresh["predecessor_id"]
            change["$unset"] = {"predecessor_id": ""}
        written = await db.league_seasons.update_one({"id": season_id, "status": {"$nin": [CANCELLED, "completed", "archived"]}}, change)
        if not written.modified_count:
            fresh = await league_service.get_season(db, season_id)
            if fresh.get("status") != CANCELLED:
                raise LeagueProblem(FINISHED, 409)
            already = True
        else:
            fresh = await league_service.get_season(db, season_id)
    reason = fresh.get("cancel_reason") or text
    application_ids = await _reject_all(db, fresh, reason, actor)
    staffel_ids = await _cancel_staffeln(db, staffeln, actor)
    return {"already": already, "season": fresh, "application_ids": application_ids, "staffel_ids": staffel_ids,
            "notified": 0, "from": fresh.get("status_before_cancel")}


async def _reject_all(db, season: dict, reason: str, actor: dict) -> list[str]:
    """Jeder offene Antrag wird abgelehnt - mit dem Grund, der Platz wird frei. Eine Zuteilung bleibt als Nachweis stehen, die Staffel ist abgesagt."""
    done = []
    for application in await _open_applications(db, season["id"]):
        now = now_utc().isoformat()
        step = {"status": league_applications.REJECTED, "by": actor.get("id"), "at": now, "reason": reason, "season_cancelled": True}
        written = await db.league_applications.update_one(
            {"id": application["id"], "status": application["status"]},
            {"$set": {"status": league_applications.REJECTED, "decided_by": actor.get("id"), "decided_at": now, "decision_reason": reason,
                      "season_cancelled": True, "updated_at": now},
             "$unset": {"active_key": "", "auto_accepted": "", "auto_problem": ""}, "$push": {"history": step}})
        if not written.modified_count:
            continue
        done.append(application["id"])
        await league_applications._audit(db, "reject", application, actor.get("id"), reason=reason, via="season_cancel",
                                         previous_status=application["status"])
    return done


async def _cancel_staffeln(db, staffeln: list[dict], actor: dict) -> list[str]:
    """Jede Staffel, die noch nicht abgesagt oder archiviert ist, auf „Abgesagt“ - ohne eigene Nachricht: Die kommt einmal für die Season."""
    done = []
    for row in staffeln:
        if row.get("status") in SETTLED_STAFFEL:
            continue
        now = now_utc().isoformat()
        written = await db.tournaments.update_one({"id": row["id"], "status": row.get("status")},
                                                  {"$set": {"status": "cancelled", "updated_at": now, "cancelled_with_season": True}})
        if not written.modified_count:
            continue
        done.append(row["id"])
        await db.audit_logs.insert_one({
            "id": new_id(), "action": "tournament.status.change", "actor_id": actor.get("id"), "target_id": row["id"],
            "data": {"previous_status": row.get("status"), "status": "cancelled", "via": "season_cancel",
                     "season_id": (row.get("league_context") or {}).get("season_id")},
            "created_at": now})
    return done


def texts(league: dict, season: dict, names: list[str], *, carried: bool = False) -> tuple[str, str]:
    """Die Nachricht an eine Person: Season, Grund, für wen. Kein Hinweis auf Zurücknehmen - das gibt es nicht. ``carried``: Die Person ist
    für ein aus dem Vorgänger übernommenes Co-Team zuständig - nur dann der Satz zu den Startrechten."""
    title = league_applications._season_title(league, season)
    reason = season.get("cancel_reason") or ""
    if league_participants.is_solo(league):
        return "Season abgesagt", f"Die Liga-Leitung hat {title} abgesagt. Grund: {reason} Deine Anmeldung ist damit beendet."
    who = ", ".join(names)
    rights = " Startrechte aus der Vorgänger-Season gelten für die nächste Season weiter." if carried else ""
    return "Season abgesagt", f"Die Liga-Leitung hat {title} abgesagt. Grund: {reason} Betroffen: {who}. Die Anmeldung ist damit beendet.{rights}"


async def _tell(db, league: dict, season: dict, staffeln: list[dict]) -> int:
    """Genau eine Nachricht samt Mail je Person (``dedupe_key`` je Season und Person). Zeitkritisch wie jede Absage (Nr. 261, 267): nie gesammelt."""
    from services.user_notifications import create_user_notification

    try:
        applications = await _cancelled_applications(db, season["id"])
        registrations = await _registrations(db, told_staffeln(staffeln))
        carried: set[str] = set()
        people = await audience(db, applications, registrations, carried)
        page = f"/liga/{league.get('slug')}/{season.get('slug')}"
        sent = 0
        for user_id in sorted(people):
            headline, text = texts(league, season, people[user_id], carried=user_id in carried)
            key = f"league-season-cancelled:{season['id']}:{user_id}"
            if await create_user_notification(user_id, headline, text, url=page, kind=NOTE_KIND,
                                              meta={"category": "tournament_updates", "reason": "league_season_cancelled", "season_id": season["id"],
                                                    "dedupe_key": key, "unique_dedupe": True, "timely": True}):
                sent += 1
            await send_league_mail(db, user_id, headline, text, page, f"{key}:mail", never_collect=True)
        return sent
    except Exception:  # noqa: BLE001 - die Absage ist gespeichert; ein zweites Absagen holt fehlende Nachrichten nach (dedupe_key)
        logger.warning("[liga] Nachricht zur Absage nicht verschickt: %s", log_safe(season.get("id")), exc_info=True)
        return 0


# ---------------------------------------------------------------- Warnung ohne Mindestzahl (Nr. 302)

async def entry_shortfall(db, season: dict) -> list[dict]:
    """Zu wenige für den Spielplan, sobald die Anmeldung zu ist (Fenster vorbei bzw. Meldeschluss erreicht) und vor dem Start: je aktiver
    Liga N die angenommenen und zugeteilten Teilnehmer gegen das, was ihre Staffeln brauchen (je Staffel mindestens 2, ohne Staffel 2).
    Angenommene ohne Zuteilung zählen bei ihrer Liga N (übernommen) bzw. bei der einzigen Liga N. Leer heißt: nichts zu warnen.
    Keine Mindestzahl der Leitung, nie automatisch abgesagt."""
    if (season.get("status") or "draft") in league_service.CLOSED_SEASON_STATUSES or not _entry_closed(season):
        return []
    staffeln = await _staffeln(db, season["id"])
    regular = [row for row in staffeln if not (row.get("league_context") or {}).get("kind") and row.get("status") not in SETTLED_STAFFEL]
    if any(row.get("status") not in league_service.PRE_START_STATUSES for row in regular):
        return []
    divisions = await db.league_divisions.find({"season_id": season["id"], "status": "active"}, {"_id": 0}).sort("level", 1).to_list(50)
    if not divisions:
        return []
    staffeln_of = {division["id"]: [row for row in regular if (row.get("league_context") or {}).get("division_id") == division["id"]]
                   for division in divisions}
    rows = await league_applications._staffeln(db, season["id"])
    counts = {division["id"]: 0 for division in divisions}
    per_staffel: dict[str, int] = {}
    if rows:
        seated = await db.tournament_registrations.find(league_applications._seated_query(rows), {"_id": 0, "tournament_id": 1}).to_list(5000)
        where = {row["id"]: (row.get("league_context") or {}).get("division_id") for row in rows}
        for row in seated:
            per_staffel[row["tournament_id"]] = per_staffel.get(row["tournament_id"], 0) + 1
            if where.get(row["tournament_id"]) in counts:
                counts[where[row["tournament_id"]]] += 1
    # Angenommene ohne Zuteilung: Sie zählen bei ihrer Liga N - und solange sie warten, kann die Leitung jede Staffel noch auffüllen.
    waiting = {division["id"]: 0 for division in divisions}
    async for row in db.league_applications.find({"season_id": season["id"], "status": league_applications.ACCEPTED,
                                                  "assignment": {"$exists": False}}, {"_id": 0, "carry_over": 1}):
        target = (row.get("carry_over") or {}).get("division_id")
        if target in counts:
            counts[target] += 1
            waiting[target] += 1
        elif len(divisions) == 1:
            counts[divisions[0]["id"]] += 1
            waiting[divisions[0]["id"]] += 1
        else:
            waiting = {key: value + 1 for key, value in waiting.items()}  # ohne Ziel: wartet für jede Liga N
    out = []
    for division in divisions:
        label = league_service.division_label(division)
        own = staffeln_of[division["id"]]
        needed = 2 * max(1, len(own))
        have = counts[division["id"]]
        if have < needed:
            many = len(own) > 1
            out.append({"division_id": division["id"], "label": label, "have": have, "needed": needed,
                        "text": (f"{label}: Für den Spielplan sind zu wenige dabei – {have} angenommen oder zugeteilt, nötig sind mindestens "
                                 f"{needed}{' (2 je Staffel)' if many else ''}. Entscheide, ob die Season so startet, ob du Staffeln "
                                 "zusammenlegst oder ob du sie absagst.")})
            continue
        if waiting[division["id"]]:
            continue
        # Genug in der Liga N, aber ungleich verteilt (etwa 3 und 1): 2 je Staffel gilt für jede einzelne, sobald niemand mehr wartet.
        for row in sorted(own, key=lambda item: str((item.get("league_context") or {}).get("staffel") or "")):
            seated_here = per_staffel.get(row["id"], 0)
            if seated_here < 2:
                name = f"{label} · {_staffel_name(row)}"
                out.append({"division_id": division["id"], "tournament_id": row["id"], "label": name, "have": seated_here, "needed": 2,
                            "text": (f"{name}: Für den Spielplan sind zu wenige dabei – {seated_here} zugeteilt, nötig sind mindestens 2. "
                                     "Entscheide, ob du Teams verschiebst, Staffeln zusammenlegst oder die Season absagst.")})
    return out


def _entry_closed(season: dict) -> bool:
    """Ist die Anmeldung zu? Mit Fenster: dessen wirksames Ende ist vorbei. Ohne Fenster: der Meldeschluss (Wiener Kalendertag) ist vorbei."""
    state = league_applications.window_state(season)
    if state is not None:
        return state == league_applications.CLOSED
    deadline = season.get("registration_deadline")
    if not deadline:
        return False
    from datetime import datetime, time, timedelta

    from services.matchday_schedule import LOCAL_TZ

    try:
        day = datetime.fromisoformat(str(deadline)[:10]).date()
    except ValueError:
        return False
    return now_utc() >= datetime.combine(day + timedelta(days=1), time(0, 0), tzinfo=LOCAL_TZ)


async def shortfall_sweep(db) -> dict:
    """Job „league_season_shortfall“: Ist die Anmeldung zu und fehlen für den Spielplan Teilnehmer, hört die Leitung (``manage``) es einmal
    je Season (``dedupe_key``). Kein Text an Teams, nie automatisch abgesagt."""
    from services.user_notifications import create_user_notification

    told = 0
    seasons = await db.league_seasons.find({"status": {"$in": ["draft", "active", None]}}, {"_id": 0}).to_list(500)
    for season in seasons:
        try:
            short = await entry_shortfall(db, season)
            if not short:
                continue
            league = await db.leagues.find_one({"id": season.get("league_id")}, {"_id": 0}) or {}
            title = league_applications._season_title(league, season)
            text = f"Die Anmeldung für {title} ist zu. " + " ".join(row["text"] for row in short)
            page = f"/admin/leagues/seasons/{season['id']}"
            for user_id in sorted(await staff_user_ids(db, season.get("league_id"), ("manage",))):
                key = f"{SHORTFALL_KEY}:{season['id']}:{user_id}"
                if await create_user_notification(user_id, "Zu wenige für den Spielplan", text, url=page, kind="tournament_registration",
                                                  meta={"reason": "league_season_shortfall", "season_id": season["id"], "dedupe_key": key,
                                                        "unique_dedupe": True}):
                    told += 1
                    await send_league_mail(db, user_id, "Zu wenige für den Spielplan", text, page, f"{key}:mail")
        except Exception:  # noqa: BLE001 - eine Season hält die anderen nicht auf
            logger.warning("[liga] Warnung „zu wenige“ nicht geprüft: %s", log_safe(season.get("id")), exc_info=True)
    return {"told": told}
