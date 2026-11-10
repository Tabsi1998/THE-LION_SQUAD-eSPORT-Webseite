"""Stiller Modus für die Neuberechnung der Erfolge (#2340).

Korrekturen an den Zählern (#2337, #2338, #2339) schalten bei vielen Personen auf einen Schlag Erfolge frei, die ihnen
schon länger zustehen. Der 15-Minuten-Lauf und der Nachtlauf vergäben sie über den normalen Weg - Postfach, Push und
Discord je Paket. Solange der stille Modus an ist (``settings`` ``achievements_recount``, gesetzt von Migration 22):

- Vergaben aus der **Neuberechnung** - Sweep und Nachtlauf, Warteschlange ohne Ereignis, Folge-Auswertung nach einer
  Vergabe, volle Auswertung ohne Quelle - werden normal gespeichert (Stufe, XP, Kronen), aber ohne Meldung, ohne
  „Level erreicht“, ohne Laufband und ohne Erfolg der Woche. Jede trägt ``recount: true`` und ``recount_id``.
- Ein **echtes Ereignis** (Ergebnis, Check-in, Chat, Konto verknüpft …) meldet weiter laut - aber nur Stufen, deren
  Zähler zu seiner Quelle gehört (``announce``). Was es nebenbei an Altansprüchen freischaltet, geht still.

Der **Probelauf** rechnet für alle aus, was neu dazukäme, und schreibt nichts außer seinem Ergebnis. Der **Abschluss**
ergänzt zuerst an alten Pokalen, wer im Finale stand (``backfill_finalists``), wertet alle still aus, beendet den stillen
Modus und schickt je Person EINE Sammel-Nachricht (Postfach, Push, kein Discord). Beide laufen in Stapeln unter einer
Sperre; der Abschluss merkt sich seinen Stand, lässt sich nach einem Abbruch fortsetzen und schickt beim zweiten Lauf
nichts doppelt (``dedupe_key``).
"""
from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from database import get_db
from models import now_utc
from services.achievement_core import due_tiers, in_quiet_scope, quiet_scope

logger = logging.getLogger("tls.achievements.recount")

SETTING_ID = "achievements_recount"
DRY_RUN_ID = "achievements_recount_dry_run"
# Kennung dieser Neuberechnung: steht an jeder still vergebenen Stufe und im ``dedupe_key`` der Sammel-Nachricht.
MARKER = "2340"
NOTIFY_KIND = "achievement_recount"
NOTIFY_URL = "/profile?tab=achievements"
BATCH = 50
DRY_RUN_BATCH = 200
LEASE_MINUTES = 10
# Folge-Stufen (Sammler, Kategorie-Meister, Level) nimmt der Abschluss gleich mit - danach ist der stille Modus aus, die
# Warteschlange würde sie sonst laut melden.
FOLLOW_UP_SOURCES = ("achievement", "xp")
FOLLOW_UP_ROUNDS = 3
# Wer mitgerechnet wird: dieselben Konten wie beim nächtlichen Lauf über alle (achievement_queue.sweep).
ACCOUNTS = {"is_active": True, "is_banned": {"$ne": True}}

# Die Zähler des alten Blocks (achievement_counters.LEGACY_KEYS) haben keine Quelle in der Registry - hier steht, welches
# Ereignis sie ändert. Nur dafür, ob eine Stufe im stillen Modus laut gemeldet wird; gerechnet wird wie immer. Zähler,
# die in die Registry umgezogen sind (Anmeldungen, Discord und Chat mit #2337/#2338), bringen ihre Quelle selbst mit und
# stehen hier nicht - ein Test hält die Liste innerhalb von LEGACY_KEYS.
LEGACY_KEY_SOURCES: dict[str, frozenset[str]] = {
    "seasons_active": frozenset({"registration", "tournament", "season"}),
    "matches_played": frozenset({"match"}),
    "matches_won": frozenset({"match"}),
    "match_streak_max": frozenset({"match"}),
    "tournaments_won": frozenset({"tournament"}),
    "podium_finishes": frozenset({"tournament"}),
    "rank_4_count": frozenset({"tournament"}),
    "season_points_total": frozenset({"season"}),
    "fastlap_valid_count": frozenset({"fastlap"}),
    "distinct_tracks": frozenset({"fastlap"}),
    "pole_count": frozenset({"fastlap"}),
    "membership_days": frozenset({"club"}),
    "events_attended": frozenset({"event"}),
    "distinct_platforms": frozenset({"profile"}),
    "profile_completeness": frozenset({"profile"}),
    "achievements_unlocked": frozenset({"achievement"}),
    "achievement_points": frozenset({"achievement"}),
    "teams_founded": frozenset({"team"}),
    "team_days_max": frozenset({"team"}),
    "twitch_live_sessions": frozenset({"stream"}),
    "twitch_stream_minutes": frozenset({"stream"}),
    "friends_count": frozenset({"friend"}),
}
# Folge-Auswertungen nach einer Vergabe melden im stillen Modus nie laut - sie sind selbst schon Neuberechnung.
DERIVED_SOURCES = frozenset({"achievement"})

_jobs: set[asyncio.Task] = set()


# ------------------------------------------------------------------ Still oder laut
# ``quiet_scope`` (aus dem Kern, services/achievement_core.py): alles darin gehört zur Neuberechnung - Aufstiege melden
# sich nicht, Folge-Auswertungen sind still, und jede Auswertung vergibt im stillen Modus still, auch für ihre Quellen.

async def active_marker(db=None) -> str | None:
    """Die Kennung der laufenden Neuberechnung, solange der stille Modus an ist - sonst None."""
    db = db if db is not None else get_db()
    doc = await db.settings.find_one({"id": SETTING_ID}, {"_id": 0, "active": 1, "marker": 1})
    return str(doc.get("marker") or MARKER) if doc and doc.get("active") else None


def loud_keys(announce) -> frozenset[str]:
    """Die Zähler, deren Stufen ein Ereignis mit diesen Quellen im stillen Modus laut melden darf."""
    wanted = set(announce or ()) - DERIVED_SOURCES
    if not wanted:
        return frozenset()
    from services import achievement_counters

    keys = set(achievement_counters.keys_for_sources(wanted))
    keys |= {key for key, sources in LEGACY_KEY_SOURCES.items() if sources & wanted}
    return frozenset(keys)


class Decider:
    """Für eine Auswertung: welche Stufe still vergeben wird. Den stillen Modus fragt sie erst bei der ersten fälligen
    Stufe ab - die meisten Auswertungen vergeben nichts und kosten so keinen Blick in die Einstellungen."""

    def __init__(self, announce):
        self._announce = tuple(announce or ())
        self._checked = False
        self._marker: str | None = None
        self._loud: frozenset[str] = frozenset()

    async def marker_for(self, key: str | None) -> str | None:
        """Die Kennung der Neuberechnung, wenn diese Stufe still vergeben wird - None heißt: laut wie immer."""
        if not self._checked:
            self._checked = True
            self._marker = await active_marker()
            if self._marker and not in_quiet_scope():
                self._loud = loud_keys(self._announce)
        if not self._marker or key in self._loud:
            return None
        return self._marker


# ------------------------------------------------------------------ Einschalten und Stand

async def begin(db=None, *, marker: str = MARKER) -> str:
    """Den stillen Modus einschalten - einmal je Neuberechnung (Migration 22). Steht der Eintrag schon, auch
    abgeschlossen, bleibt er, wie er ist; ohne Konten (frische Installation) gibt es nichts nachzurechnen."""
    db = db if db is not None else get_db()
    if await db.settings.find_one({"id": SETTING_ID}, {"_id": 1}):
        return "already present"
    if not await db.users.find_one({}, {"_id": 1}):
        return "no accounts - nothing to recount"
    await db.settings.update_one(
        {"id": SETTING_ID},
        {"$setOnInsert": {"id": SETTING_ID, "active": True, "marker": marker, "started_at": now_utc().isoformat()}},
        upsert=True,
    )
    return "silent mode on"


async def ceremony_state(db=None) -> dict | None:
    """Für die eigene Erfolge-Seite: Kennung der Neuberechnung und ob sie abgeschlossen ist - erst dann zeigt die Seite
    die Sammel-Zeremonie der nachgerechneten Stufen (einmal je Kennung). None, wenn es keine Neuberechnung gibt."""
    db = db if db is not None else get_db()
    doc = await db.settings.find_one({"id": SETTING_ID}, {"_id": 0, "id": 1, "marker": 1, "finish.phase": 1})
    if not doc:
        return None
    return {"marker": str(doc.get("marker") or MARKER), "finished": (doc.get("finish") or {}).get("phase") == "done"}


def _held(lease_until, now: str) -> bool:
    return bool(lease_until) and str(lease_until) > now


async def status(db=None) -> dict:
    """Für die Verwaltung: stiller Modus, letzter Probelauf, Stand des Abschlusses."""
    db = db if db is not None else get_db()
    doc = await db.settings.find_one({"id": SETTING_ID}, {"_id": 0}) or {}
    dry = await db.settings.find_one({"id": DRY_RUN_ID}, {"_id": 0}) or {}
    now = now_utc().isoformat()
    run = dict(doc.get("finish") or {})
    running = _held(run.pop("lease_until", None), now)
    phase = run.get("phase")
    dry_running = _held(dry.pop("lease_until", None), now)
    dry.pop("id", None)
    if dry.get("status") == "running" and not dry_running:
        dry["status"] = "interrupted"
    return {
        "exists": bool(doc), "active": bool(doc.get("active")), "marker": doc.get("marker"),
        "started_at": doc.get("started_at"), "ended_at": doc.get("ended_at"),
        "dry_run": {**dry, "running": dry_running},
        "finish": {**run, "running": running, "done": phase == "done",
                   "interrupted": phase in ("evaluate", "notify") and not running},
    }


# ------------------------------------------------------------------ Sperre und Stapel

async def _claim(db, doc_id: str, field: str) -> bool:
    """Die Sperre nehmen, wenn sie frei oder abgelaufen ist - ein zweiter Klick oder ein zweiter Server läuft nicht mit."""
    now = now_utc()
    result = await db.settings.update_one(
        {"id": doc_id, "$or": [{field: {"$exists": False}}, {field: None}, {field: {"$lt": now.isoformat()}}]},
        {"$set": {field: (now + timedelta(minutes=LEASE_MINUTES)).isoformat()}},
    )
    return getattr(result, "modified_count", 0) == 1


async def _extend(db, doc_id: str, field: str, changes: dict | None = None) -> None:
    lease = (now_utc() + timedelta(minutes=LEASE_MINUTES)).isoformat()
    await db.settings.update_one({"id": doc_id}, {"$set": {field: lease, **(changes or {})}})


async def _release(db, doc_id: str, field: str) -> None:
    await db.settings.update_one({"id": doc_id}, {"$set": {field: None}})


async def account_batches(db, after: str | None = None, size: int = BATCH):
    """Konten in Stapeln, nach Kennung geordnet - nie alle auf einmal. ``after``: ab hier weiter (Fortsetzen)."""
    while True:
        query = dict(ACCOUNTS)
        if after:
            query["id"] = {"$gt": after}
        ids = [row["id"] async for row in db.users.find(query, {"_id": 0, "id": 1}).sort("id", 1).limit(size)]
        if not ids:
            return
        yield ids
        after = ids[-1]


def _actor(actor: dict | None) -> str | None:
    if not actor:
        return None
    return actor.get("display_name") or actor.get("username") or actor.get("id")


# ------------------------------------------------------------------ Probelauf

async def start_dry_run(db=None, *, actor: dict | None = None) -> bool:
    """Für die Verwaltung: Sperre nehmen und den Probelauf im Hintergrund starten. False, wenn schon einer läuft."""
    db = db if db is not None else get_db()
    await db.settings.update_one({"id": DRY_RUN_ID}, {"$setOnInsert": {"id": DRY_RUN_ID}}, upsert=True)
    if not await _claim(db, DRY_RUN_ID, "lease_until"):
        return False
    _spawn(dry_run(db, actor=actor, claimed=True))
    return True


async def dry_run(db=None, *, actor: dict | None = None, claimed: bool = False, batch: int = DRY_RUN_BATCH, progress=None) -> dict:
    """Für alle Konten ausrechnen, welche Stufen neu dazukämen - ohne Vergabe, ohne XP, ohne gespeicherte Zähler.
    Folge-Stufen (Sammler, Kategorie-Meister) entstehen erst durch Vergaben: die Zahl ist eine Untergrenze. Finalisten
    ergänzt er nicht an den Pokalen (er schreibt nichts); wo das Feld ``finalist`` fehlt, rechnen die Zähler selbst nach,
    was es festhalten würde (``awards.tournament_outcome``, #2337) - also so, als wäre es schon gesetzt."""
    db = db if db is not None else get_db()
    if not claimed:
        await db.settings.update_one({"id": DRY_RUN_ID}, {"$setOnInsert": {"id": DRY_RUN_ID}}, upsert=True)
        if not await _claim(db, DRY_RUN_ID, "lease_until"):
            return {"status": "running"}
    started = now_utc().isoformat()
    total = await db.users.count_documents(ACCOUNTS)
    await db.settings.update_one({"id": DRY_RUN_ID}, {"$set": {
        "status": "running", "started_at": started, "finished_at": None, "by": _actor(actor), "checked": 0, "total": total,
    }})
    try:
        result = await _count_due(db, batch=batch, total=total, progress=progress)
    except Exception:  # noqa: BLE001 - der Fehler steht im Protokoll, der Stand sagt „fehlgeschlagen“
        logger.exception("[achievements] Probelauf der Neuberechnung abgebrochen")
        await db.settings.update_one({"id": DRY_RUN_ID}, {"$set": {"status": "failed", "finished_at": now_utc().isoformat(), "lease_until": None}})
        return {"status": "failed"}
    result.update({"status": "done", "started_at": started, "finished_at": now_utc().isoformat(), "by": _actor(actor), "total": total})
    await db.settings.update_one({"id": DRY_RUN_ID}, {"$set": {**result, "lease_until": None}})
    return result


async def _count_due(db, *, batch: int, total: int, progress=None) -> dict:
    from services import achievement_counters
    from services.membership_service import get_membership, is_active_member

    tiers = await db.achievements.find({"manual_only": {"$ne": True}}, {"_id": 0}).to_list(5000)
    groups = {g["code"]: g async for g in db.achievement_groups.find({}, {"_id": 0, "code": 1, "name": 1, "is_negative": 1})}
    counts: dict[str, int] = {}
    checked = affected = errors = 0
    async for ids in account_batches(db, None, batch):
        for user_id in ids:
            try:
                counters = await achievement_counters.compute(user_id)
                earned = {row["tier_code"] async for row in db.user_achievements.find({"user_id": user_id}, {"_id": 0, "tier_code": 1})}
                due = due_tiers(tiers, counters, earned, active_member=is_active_member(await get_membership(user_id)))
            except Exception:  # noqa: BLE001 - ein Konto hält den Probelauf nicht auf
                errors += 1
                logger.warning("[achievements] Probelauf: ein Konto ließ sich nicht rechnen", exc_info=True)
                continue
            finally:
                checked += 1
            if due:
                affected += 1
            for tier in due:
                counts[tier["code"]] = counts.get(tier["code"], 0) + 1
        await _extend(db, DRY_RUN_ID, "lease_until", {"checked": checked})
        logger.info("[achievements] Probelauf der Neuberechnung: %d von %d Konten, %d betroffen", checked, total, affected)
        if progress:
            progress(f"{checked} von {total} Konten gerechnet, {affected} betroffen")
    by_code = {tier["code"]: tier for tier in tiers}
    rows = []
    for code, count in counts.items():
        tier = by_code.get(code) or {}
        group = groups.get(tier.get("group_code")) or {}
        rows.append({
            "tier_code": code, "name": tier.get("name") or code, "group_code": tier.get("group_code"), "group_name": group.get("name"),
            "material": tier.get("material"), "material_name": tier.get("material_name"), "negative": bool(group.get("is_negative")),
            "count": count,
        })
    rows.sort(key=lambda row: (-row["count"], str(row.get("group_name") or ""), str(row["name"])))
    return {"checked": checked, "affected_users": affected, "awards": sum(counts.values()), "errors": errors, "tiers": rows}


def render_dry_run(result: dict) -> str:
    """Der Probelauf als Text für die Kommandozeile."""
    lines = [f"Probelauf: {result.get('checked', 0)} Konten gerechnet, {result.get('affected_users', 0)} Personen bekämen "
             f"{result.get('awards', 0)} Stufen neu dazu."]
    if result.get("errors"):
        lines.append(f"{result['errors']} Konten ließen sich nicht rechnen (siehe Protokoll).")
    for row in result.get("tiers") or []:
        group = f" ({row['group_name']})" if row.get("group_name") else ""
        lines.append(f"  {row['count']:>6}  {row['name']}{group}")
    lines.append("Folge-Stufen wie Sammler entstehen erst durch Vergaben - die Zahl ist eine Untergrenze.")
    return "\n".join(lines) + "\n"


# ------------------------------------------------------------------ Abschluss

async def start_finish(db=None, *, actor: dict | None = None) -> str:
    """Für die Verwaltung: Sperre nehmen und den Abschluss im Hintergrund starten. Liefert ``started``, ``running``,
    ``done`` oder ``missing``."""
    db = db if db is not None else get_db()
    doc = await db.settings.find_one({"id": SETTING_ID}, {"_id": 0, "id": 1, "finish": 1})
    if not doc:
        return "missing"
    if (doc.get("finish") or {}).get("phase") == "done":
        return "done"
    if not await _claim(db, SETTING_ID, "finish.lease_until"):
        return "running"
    _spawn(finish(db, actor=actor, claimed=True))
    return "started"


async def finish(db=None, *, actor: dict | None = None, claimed: bool = False, batch: int = BATCH, progress=None) -> dict:
    """Die Neuberechnung abschließen: alle still auswerten, den stillen Modus beenden, je Person EINE Sammel-Nachricht.
    Gefahrlos wiederholbar - fertig ist fertig, abgebrochen geht beim Stand weiter, doppelt geschickt wird nichts."""
    db = db if db is not None else get_db()
    doc = await db.settings.find_one({"id": SETTING_ID}, {"_id": 0})
    if not doc:
        return {"status": "missing"}
    if (doc.get("finish") or {}).get("phase") == "done":
        return {"status": "done", **_summary(doc.get("finish") or {})}
    if not claimed and not await _claim(db, SETTING_ID, "finish.lease_until"):
        return {"status": "running"}
    marker = str(doc.get("marker") or MARKER)
    try:
        run = (await db.settings.find_one({"id": SETTING_ID}, {"_id": 0, "finish": 1}) or {}).get("finish") or {}
        if run.get("phase") in (None, "evaluate"):
            run = await _evaluate_all(db, run, actor=actor, batch=batch, progress=progress)
        if run.get("phase") == "notify":
            run = await _notify_all(db, run, marker=marker, batch=batch, progress=progress)
    except Exception:  # noqa: BLE001 - der Stand bleibt, der nächste Lauf macht dort weiter
        logger.exception("[achievements] Abschluss der Neuberechnung abgebrochen - er lässt sich fortsetzen")
        return {"status": "failed"}
    finally:
        await _release(db, SETTING_ID, "finish.lease_until")
    return {"status": "done", **_summary(run)}


def _summary(run: dict) -> dict:
    return {key: run.get(key) for key in ("evaluated", "awarded", "notified", "users_total", "started_at", "finished_at")}


FINALIST_MISSING = {"finalist": {"$exists": False}}


async def backfill_finalists(db=None, *, progress=None) -> dict:
    """Schritt 0: an vorhandenen Pokalen nur ``finalist`` und ``final_match_id`` ergänzen, wo sie fehlen (seit #2337 stehen
    sie an jeder neuen Auszeichnung) - mit derselben Rechnung wie dort, ``awards.tournament_outcome``. Bewusst nicht
    „Pokale nachtragen“ (``rebuild_all_awards``): das stempelt die heutige Jahreswertung, leitet Ränge neu ab und löscht.
    Hier bleiben Rang, Saison, Art, ``updated_at`` und der Bestand, wie sie sind; was das Feld schon trägt, wird nie
    überschrieben. Keine Meldung, kein Discord, gefahrlos wiederholbar."""
    db = db if db is not None else get_db()
    try:
        from services.awards import tournament_outcome
    except ImportError:  # ohne #2337 gibt es das Feld nicht - dann ist nichts nachzutragen
        logger.warning("[achievements] Neuberechnung: Finalisten-Nachtrag übersprungen - awards.tournament_outcome fehlt")
        return {"tournaments": 0, "awards": 0, "skipped": True}
    tournament_ids = sorted(await db.tournament_awards.distinct("tournament_id", FINALIST_MISSING))
    changed = 0
    for tournament_id in tournament_ids:
        outcome = await tournament_outcome(db, tournament_id)
        finalists = sorted(outcome.get("finalists") or ())
        if finalists:
            result = await db.tournament_awards.update_many(
                {"tournament_id": tournament_id, "registration_id": {"$in": finalists}, **FINALIST_MISSING},
                {"$set": {"finalist": True, "final_match_id": outcome.get("final_match_id")}})
            changed += getattr(result, "modified_count", 0)
        result = await db.tournament_awards.update_many(
            {"tournament_id": tournament_id, **FINALIST_MISSING}, {"$set": {"finalist": False, "final_match_id": None}})
        changed += getattr(result, "modified_count", 0)
    logger.info("[achievements] Neuberechnung: Finalisten an %d Pokalen aus %d Turnieren ergänzt", changed, len(tournament_ids))
    if progress:
        progress(f"Finalisten ergänzt: {changed} Pokale aus {len(tournament_ids)} Turnieren")
    return {"tournaments": len(tournament_ids), "awards": changed}


async def _evaluate_all(db, run: dict, *, actor, batch: int, progress) -> dict:
    """Schritt 1: alle Konten still auswerten, samt Folge-Stufen. Danach endet der stille Modus."""
    from services.achievement_core import evaluator

    evaluate = evaluator()
    if not run.get("phase"):
        # Der stille Modus gilt, bis alle durch sind - auch wenn ihn jemand von Hand abgeschaltet hat.
        await db.settings.update_one({"id": SETTING_ID}, {"$set": {"active": True}})
        with quiet_scope():
            backfilled = await backfill_finalists(db, progress=progress)
        run = {"phase": "evaluate", "started_at": now_utc().isoformat(), "by": _actor(actor), "cursor": None, "finalists_backfilled": backfilled,
               "evaluated": 0, "awarded": 0, "notified": 0, "users_total": await db.users.count_documents(ACCOUNTS)}
        await db.settings.update_one({"id": SETTING_ID}, {"$set": {f"finish.{k}": v for k, v in run.items()}})
        await _extend(db, SETTING_ID, "finish.lease_until")
    evaluated, awarded = int(run.get("evaluated") or 0), int(run.get("awarded") or 0)
    total = int(run.get("users_total") or 0)
    async for ids in account_batches(db, run.get("cursor"), batch):
        with quiet_scope():
            for user_id in ids:
                try:
                    gained = int(await evaluate(user_id, None, announce=()) or 0)
                    awarded += gained
                    rounds = 0
                    while gained and rounds < FOLLOW_UP_ROUNDS:
                        gained = int(await evaluate(user_id, set(FOLLOW_UP_SOURCES), announce=()) or 0)
                        awarded += gained
                        rounds += 1
                except Exception:  # noqa: BLE001 - ein Konto hält die anderen nicht auf
                    logger.warning("[achievements] Neuberechnung: ein Konto ließ sich nicht auswerten", exc_info=True)
                evaluated += 1
        await _extend(db, SETTING_ID, "finish.lease_until", {"finish.cursor": ids[-1], "finish.evaluated": evaluated, "finish.awarded": awarded})
        logger.info("[achievements] Neuberechnung: %d von %d Konten ausgewertet, %d Stufen still vergeben", evaluated, total, awarded)
        if progress:
            progress(f"{evaluated} von {total} Konten ausgewertet, {awarded} Stufen still vergeben")
    # Ab hier meldet jede Vergabe wieder laut - die Sammel-Nachrichten zählen danach alles, was still kam.
    await db.settings.update_one({"id": SETTING_ID}, {"$set": {
        "active": False, "ended_at": now_utc().isoformat(), "finish.phase": "notify", "finish.cursor": None,
    }})
    logger.info("[achievements] Neuberechnung: stiller Modus beendet")
    return {**run, "phase": "notify", "cursor": None, "evaluated": evaluated, "awarded": awarded}


def notification_text(count: int) -> tuple[str, str]:
    """Titel und Text der Sammel-Nachricht."""
    if count == 1:
        return "Erfolge neu berechnet", "Wir haben die Erfolge neu berechnet – du hast einen neuen."
    return "Erfolge neu berechnet", f"Wir haben die Erfolge neu berechnet – du hast {count} neue."


async def _notify_all(db, run: dict, *, marker: str, batch: int, progress) -> dict:
    """Schritt 2: je Person mit still vergebenen Stufen EINE Nachricht - Postfach und Push, kein Discord."""
    from services.user_notifications import create_user_notification

    negative = {g["code"] async for g in db.achievement_groups.find({"is_negative": True}, {"_id": 0, "code": 1})}
    notified = int(run.get("notified") or 0)
    async for ids in account_batches(db, run.get("cursor"), batch):
        counts: dict[str, int] = {}
        async for row in db.user_achievements.find({"user_id": {"$in": ids}, "recount_id": marker}, {"_id": 0, "user_id": 1, "group_code": 1}):
            if row.get("group_code") not in negative:
                counts[row["user_id"]] = counts.get(row["user_id"], 0) + 1
        for user_id in ids:
            count = counts.get(user_id, 0)
            if not count:
                continue
            title, body = notification_text(count)
            created = await create_user_notification(
                user_id, title, body, url=NOTIFY_URL, kind=NOTIFY_KIND,
                meta={"category": "achievements", "count": count, "dedupe_key": f"{NOTIFY_KIND}:{marker}", "no_discord": True},
            )
            notified += 1 if created else 0
        await _extend(db, SETTING_ID, "finish.lease_until", {"finish.cursor": ids[-1], "finish.notified": notified})
        logger.info("[achievements] Neuberechnung: %d Sammel-Nachrichten verschickt", notified)
        if progress:
            progress(f"{notified} Sammel-Nachrichten verschickt")
    finished = now_utc().isoformat()
    await db.settings.update_one({"id": SETTING_ID}, {"$set": {"finish.phase": "done", "finish.cursor": None, "finish.finished_at": finished}})
    logger.info("[achievements] Neuberechnung abgeschlossen")
    return {**run, "phase": "done", "cursor": None, "notified": notified, "finished_at": finished}


# ------------------------------------------------------------------ Hintergrund

def _spawn(coro) -> None:
    """Im Hintergrund laufen lassen; die Verwaltung fragt den Stand ab. Die Aufgabe bleibt bis zum Ende gehalten."""
    task = asyncio.get_running_loop().create_task(coro)
    _jobs.add(task)
    task.add_done_callback(_jobs.discard)


async def wait_for_jobs() -> None:
    """Warten, bis alle Hintergrund-Läufe fertig sind (Tests, Herunterfahren)."""
    while _jobs:
        await asyncio.gather(*list(_jobs), return_exceptions=True)
