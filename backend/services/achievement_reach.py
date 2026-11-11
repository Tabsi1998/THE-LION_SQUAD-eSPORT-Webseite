"""Was an Erfolgen erreichbar ist (#2339) - eine Regel für die Anzeige „x von y“, Kategorie-Meister, Sammler,
Geheimnisträger und Hundert Prozent.

- **Nicht mehr erreichbar** (``retired`` an Gruppe oder Stufe, mit ``retired_reason``; oder ``available_until`` in der
  Vergangenheit): Nur wer die Stufe hat, sieht sie. Sie zählt nirgends mit - nicht in „x von y“, Seltenheit, Kategorien,
  Sammler, Kategorie-Meister oder Hundert Prozent - und wird nicht mehr automatisch vergeben. Von Hand geht weiter.
- **Erreichbar** ist eine Stufe, die man selbst schaffen kann: öffentlich, nicht geheim, nicht negativ, nicht von Hand,
  nicht nur für die Leitung (``staff_only``) oder eine gewählte bzw. vom Verein vergebene Aufgabe (``role_only``: Vorstand,
  Verifizierter Streamer), nicht retired; Verein nur für Mitglieder. Die Meta-Gruppen (``META_GROUPS``:
  Kategorie-Meister, Hundert Prozent, Sammler, Geheimnisträger) zählen in keiner Kategorie mit - so hängt keine an sich.
- **Eine Kategorie ist abgeschlossen**, wenn die Person jede erreichbare Stufe darin hat. Gezählt wird für Mitglieder wie
  Nicht-Mitglieder gleich (Verein mit seinen Mitglieder-Stufen); Nicht-Mitglieder können den Verein nur nie abschließen.
- **Mit zählt** (Sammler, „N Erfolge freigeschaltet“) jede erhaltene Stufe außer Negativem und nicht mehr Erreichbarem -
  auch von Hand vergebene und geheime.

Ohne Rück-Importe: Kern (``achievement_core``), Zähler und Anzeige lesen von hier.
"""
from __future__ import annotations

from datetime import datetime, timezone

from achievement_catalog import CATEGORIES, category_v2
from models import now_utc

# Die Meta-Gruppen: Sie messen andere Erfolge und zählen deshalb in keiner Kategorie mit.
META_GROUPS = frozenset({"categories_complete", "completionist", "achievements_unlocked", "hidden_found"})
# Kategorien, die Kategorie-Meister kennt: alle außer Geheim und Negativ - in dieser Reihenfolge stehen sie im Text.
MASTER_CATEGORIES: tuple[str, ...] = tuple(
    key for key, meta in sorted(CATEGORIES.items(), key=lambda item: item[1]["order"]) if not meta.get("hidden") and not meta.get("negative")
)
# Wer die Gruppen der Leitung (Turnierleitung, Schiedsrichter) sieht: Bereich Turnierleitung oder Ligen - oder ein Einsatz
# als Turnier- bzw. Liga-Leitung.
STAFF_AREAS = ("tournaments", "leagues")
RETIRED_FIELDS = ("retired", "retired_reason", "available_until")


def parse_when(value) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def is_retired(doc: dict | None, now: datetime | None = None) -> bool:
    """Kennzeichen ``retired`` - oder ``available_until`` liegt in der Vergangenheit."""
    if not doc:
        return False
    if doc.get("retired"):
        return True
    until = parse_when(doc.get("available_until"))
    return bool(until and (now or now_utc()) >= until)


def tier_retired(tier: dict | None, group: dict | None, now: datetime | None = None) -> bool:
    return is_retired(group, now) or is_retired(tier, now)


def retired_reason(tier: dict | None, group: dict | None) -> str | None:
    for doc in (tier, group):
        if doc and (doc.get("retired") or doc.get("available_until")) and str(doc.get("retired_reason") or "").strip():
            return str(doc["retired_reason"]).strip()
    return None


def listed(group: dict | None) -> bool:
    """Steht die Gruppe im Katalog der Seite: nicht negativ, öffentlich oder geheim (abgeschaltete zählen nicht)."""
    return bool(group) and not group.get("is_negative") and bool(group.get("public") or group.get("hidden"))


def is_manual(tier: dict, group: dict) -> bool:
    return bool(tier.get("manual_only") or group.get("manual_only") or not tier.get("condition_key") or not tier.get("progress_target"))


def is_member_only(tier: dict | None, group: dict | None) -> bool:
    return bool((group or {}).get("member_only") or (tier or {}).get("member_only") or category_v2((group or {}).get("category")) == "club")


def reachable(tier: dict, group: dict | None, *, member: bool = True, now: datetime | None = None) -> bool:
    """Eine Stufe, die man selbst schaffen kann (siehe oben). ``member``: Vereins-Stufen zählen nur für Mitglieder."""
    if not listed(group) or group.get("hidden") or not group.get("public") or group.get("code") in META_GROUPS:
        return False
    if group.get("staff_only") or group.get("role_only") or is_manual(tier, group) or tier_retired(tier, group, now):
        return False
    if is_member_only(tier, group) and not member:
        return False
    return category_v2(group.get("category")) in MASTER_CATEGORIES


def countable(tier: dict | None, group: dict | None, now: datetime | None = None) -> bool:
    """Zählt mit, wenn man sie hat: jede Stufe außer Negativem und nicht mehr Erreichbarem."""
    return bool(tier) and listed(group) and not tier_retired(tier, group, now)


def category_progress(groups: dict[str, dict], tiers, earned, *, now: datetime | None = None) -> dict[str, dict]:
    """Je Kategorie von Kategorie-Meister: ``earned`` (erreichbare Stufen, die die Person hat), ``total`` (alle
    erreichbaren) und ``complete``. Der Verein zählt mit seinen Mitglieder-Stufen - abschließen kann ihn nur, wer sie hat."""
    now = now or now_utc()
    earned = set(earned or ())
    out = {key: {"earned": 0, "total": 0, "complete": False} for key in MASTER_CATEGORIES}
    for tier in tiers:
        group = groups.get(tier.get("group_code"))
        if not reachable(tier, group, member=True, now=now):
            continue
        row = out[category_v2(group.get("category"))]
        row["total"] += 1
        if tier.get("code") in earned:
            row["earned"] += 1
    for row in out.values():
        row["complete"] = row["total"] > 0 and row["earned"] >= row["total"]
    return out


def completed_categories(progress: dict[str, dict]) -> list[str]:
    return [key for key, row in progress.items() if row.get("complete")]


def all_reachable_done(progress: dict[str, dict], *, member: bool) -> bool:
    """Hundert Prozent: jede Kategorie mit erreichbaren Stufen ist abgeschlossen - der Verein nur für Mitglieder."""
    wanted = [key for key, row in progress.items() if row.get("total") and (member or key != "club")]
    return bool(wanted) and all(progress[key]["complete"] for key in wanted)


def countable_earned(groups: dict[str, dict], tiers: dict[str, dict], earned, now: datetime | None = None) -> list[str]:
    """Die erhaltenen Stufen, die mitzählen (Sammler, „N Erfolge freigeschaltet“)."""
    now = now or now_utc()
    out = []
    for code in earned or ():
        tier = tiers.get(code)
        if tier and countable(tier, groups.get(tier.get("group_code")), now):
            out.append(code)
    return out


async def apply_catalog_retirement(collection, docs: list[dict]) -> None:
    """Das Kennzeichen aus dem Code-Katalog übernehmen (Seed) - aber nur, wenn sich die Entscheidung im Code geändert hat
    (``retired_catalog`` merkt sie sich). So bleibt, was die Verwaltung selbst gesetzt hat, über jeden Neustart erhalten,
    und ein späteres „retired“ im Code kommt trotzdem an."""
    plain = [doc["code"] for doc in docs if not doc.get("retired")]
    if plain:
        await collection.update_many({"code": {"$in": plain}, "retired_catalog": {"$ne": False}},
                                     {"$set": {"retired": False, "retired_reason": None, "retired_catalog": False}})
    for doc in docs:
        if doc.get("retired"):
            await collection.update_one({"code": doc["code"], "retired_catalog": {"$ne": True}},
                                        {"$set": {"retired": True, "retired_reason": doc.get("retired_reason"), "retired_catalog": True}})


# Pionier: „eines der ersten hundert Konten“ (achievement_counters._pioneer). Sobald es hundert Konten gibt, ist er nicht
# mehr erreichbar - erreichbar bis zur Registrierung des hundertsten Kontos.
PIONEER_GROUP = "pioneer"
PIONEER_ACCOUNTS = 100
PIONEER_REASON = "Nur die ersten hundert Konten der Plattform – die Plätze sind vergeben."


# Wann ein Anspruch entstanden ist, wo der Zähler es weiß (Review M1): „erreichbar bis“ sperrt dann nur Ansprüche, die nach
# dem Datum entstanden sind - Altansprüche (das 40. Konto, das nie ausgewertet wurde) bekommen den Erfolg weiter.
# Gruppe → Feld am Konto. Für alle anderen Gruppen sperrt das Datum jede automatische Vergabe ab dann.
CLAIM_DATE_FIELDS: dict[str, str] = {PIONEER_GROUP: "created_at"}
# Hat die Verwaltung „nicht mehr erreichbar“ selbst gesetzt oder geleert (Admin oder Import), merkt sich die Gruppe bzw.
# Stufe das - keine Regel überschreibt es dann (Review M2).
MANUAL_FLAG = "retired_manual"
PIONEER_RULE_FLAG = "pioneer_rule_applied"


async def apply_rules(db) -> None:
    """Regeln, die sich aus den Daten ergeben (Seed): Pionier bekommt ``available_until``, sobald es das hundertste Konto
    gibt - einmal (Merker ``pioneer_rule_applied``) und nie gegen eine Entscheidung der Verwaltung (``retired_manual``)."""
    group = await db.achievement_groups.find_one({"code": PIONEER_GROUP}, {"_id": 0, "code": 1, PIONEER_RULE_FLAG: 1, MANUAL_FLAG: 1})
    if not group or group.get(PIONEER_RULE_FLAG) or group.get(MANUAL_FLAG):
        return
    rows = await db.users.find({"created_at": {"$nin": [None, ""]}}, {"_id": 0, "created_at": 1}).sort("created_at", 1).skip(PIONEER_ACCOUNTS - 1).limit(1).to_list(1)
    if not rows:
        return
    stamp = rows[0]["created_at"]
    await db.achievement_groups.update_one(
        {"code": PIONEER_GROUP, PIONEER_RULE_FLAG: {"$ne": True}, MANUAL_FLAG: {"$ne": True}},
        {"$set": {"available_until": stamp.isoformat() if isinstance(stamp, datetime) else str(stamp), "retired_reason": PIONEER_REASON,
                  PIONEER_RULE_FLAG: True}},
    )


def retired_changes(current: dict | None, updates: dict) -> bool:
    """Ändert ``updates`` etwas an „nicht mehr erreichbar“? (Verwaltung und Import - dann gilt ``retired_manual``.) Ein
    mitgeschicktes ``available_until: null`` bei leerem Feld ist keine Änderung."""
    current = current or {}
    for key in RETIRED_FIELDS:
        if key not in updates:
            continue
        old, new = current.get(key), updates.get(key)
        if key == "retired":
            old, new = bool(old), bool(new)
        elif key == "available_until":
            old, new = parse_when(old), parse_when(new)
        else:
            old, new = (str(old or "").strip() or None), (str(new or "").strip() or None)
        if old != new:
            return True
    return False


async def load_catalog(db) -> tuple[dict[str, dict], dict[str, dict]]:
    groups = {g["code"]: g async for g in db.achievement_groups.find({}, {"_id": 0})}
    tiers = {t["code"]: t async for t in db.achievements.find({}, {"_id": 0})}
    return groups, tiers


async def retired_group_codes(db, now: datetime | None = None, *, user_id: str | None = None) -> frozenset[str]:
    """Die Gruppen, die nicht mehr erreichbar sind - für die Vergabe (``achievement_core.due_tiers``). Mit ``user_id``
    bleibt eine Gruppe mit Anspruchsdatum (``CLAIM_DATE_FIELDS``, Pionier) offen, wenn der Anspruch vor ``available_until``
    entstand; das Kennzeichen ``retired`` selbst sperrt immer."""
    now = now or now_utc()
    query = {"$or": [{"retired": True}, {"available_until": {"$nin": [None, ""]}}]}
    rows = await db.achievement_groups.find(query, {"_id": 0, "code": 1, "retired": 1, "available_until": 1}).to_list(1000)
    out: set[str] = set()
    user: dict | None = None
    for group in rows:
        if not is_retired(group, now):
            continue
        field = CLAIM_DATE_FIELDS.get(group["code"])
        if field and user_id and not group.get("retired"):
            if user is None:
                user = await db.users.find_one({"id": user_id}, {"_id": 0, "id": 1, **{key: 1 for key in CLAIM_DATE_FIELDS.values()}}) or {}
            claimed, until = parse_when(user.get(field)), parse_when(group.get("available_until"))
            if claimed and until and claimed <= until:
                continue
        out.add(group["code"])
    return frozenset(out)


async def is_staff_person(db, user: dict | None) -> bool:
    """Sieht die Gruppen der Leitung: Bereich Turnierleitung oder Ligen (Rolle oder Freigabe), sonst ein Einsatz als
    Turnier- oder Liga-Leitung. Ohne Zwei-Faktor-Prüfung - es geht nur ums Zeigen, nicht ums Verwalten."""
    from services.permissions import holds_area

    if not user or not user.get("id"):
        return False
    if holds_area(user, *STAFF_AREAS):
        return True
    if await db.tournament_staff_assignments.find_one({"user_id": user["id"]}, {"_id": 1}):
        return True
    return bool(await db.league_staff.find_one({"user_id": user["id"]}, {"_id": 1}))
