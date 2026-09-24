"""Vereinsdaten und Vorstand aus Dolibarr (#326, Teil 1): eine Quelle für Impressum, Kontakt und
Datenschutzerklärung statt doppelter Pflege.

Das Vereinsmodul liefert ``/vereine/organization`` (Name, ZVR, Vereinsbehörde, Anschrift, Kontakt,
Gründung, Zweck) und ``/vereine/board`` (Funktionen mit heutigen Inhabern; Namen nur, wo die Person
eingewilligt hat - sonst ``null``). Die Website liest beides stündlich (Job ``dolibarr_public``) und
auf Knopfdruck und hält den Stand mit Zeitpunkt in ``dolibarr_public``. Ein Ausfall ändert nichts:
der letzte gute Stand bleibt, der Fehler steht daneben - nie werden „andere“ Vereinsdaten gezeigt,
weil Dolibarr gerade nicht antwortet.

Übernommen werden die Werte nur, wenn der Betreiber den Schalter „Vereinsdaten aus Dolibarr
übernehmen“ gesetzt hat (``legal_from_dolibarr`` in den Branding-Einstellungen); von Hand gepflegte
Felder bleiben Rückfall, und alles Redaktionelle (Datenschutz-E-Mail, inhaltlich Verantwortlicher,
Hosting, UID, Zusatztexte) bleibt von Hand. Namen: ``null`` heißt keine Einwilligung - dann bleibt
die vertretungsbefugte Person, wie sie von Hand eingetragen ist; nie aus anderen Quellen
rekonstruieren. Vorstandsnamen aus einem Stand, der älter ist als ``NAME_MAX_AGE_HOURS``, werden
zurückgehalten, damit ein Widerruf zeitnah wirkt.

Kanäle (Teil 4): ``organization.channels`` sind die öffentlichen Kanäle des Vereins, wie er sie im
Modul unter *Einrichtung > Vereine > Kanäle und Konten* pflegt (Twitch, YouTube, Discord …, in seiner
Reihenfolge). Mit dem Schalter ``channels_from_dolibarr`` nimmt der Footer sie statt der Liste von Hand
(``channels_public``) - stehen dort keine, bleibt die Liste von Hand.

Statuten (Teil 3): ``/vereine/statutes`` liefert die beschlossenen Fassungen mit Stand (geltend,
künftig, aufgehoben) - nur, wenn der Verein sie im Modul für die Öffentlichkeit freigibt, und nie den
Entwurf. Die Website hält sie im selben Stand (``statutes``), zeigt sie mit demselben Schalter auf der
Vorstandsseite und liefert das PDF nur für eine Fassung aus dem Stand und nur, wenn die Bytes zur
Prüfsumme der Vereinsakte passen (``statutes_pdf``). Ein älteres Modul ohne Statuten-API ändert am
Rest nichts: der Fehler steht als ``statutes_error`` daneben.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
from datetime import datetime, timezone

from models import now_utc
from services.dolibarr_client import DolibarrClient, DolibarrError

COLLECTION = "dolibarr_public"
STATE_ID = "state"
NAME_MAX_AGE_HOURS = 48
COUNTRY_NAMES = {"AT": "Österreich", "DE": "Deutschland", "CH": "Schweiz", "IT": "Italien", "LI": "Liechtenstein"}
# Wer den Verein nach außen vertritt: bevorzugt der Obmann / die Obfrau (Funktionscode beginnt so).
REPRESENTATIVE_CODES = ("obmann", "obfrau", "praesident", "vorsitz")
# Felder, die der Schalter aus Dolibarr übernimmt - alles andere bleibt von Hand.
OVERLAY_FIELDS = ("legal_name", "zvr_number", "register_authority", "street_address", "postal_code", "city", "country", "phone",
                  "representative_name", "representative_role")
# Netzwerk-Kürzel aus Dolibarrs Wörterbuch → Plattform-Schlüssel der Website (Symbole in `lib/socialIcons.js`).
CHANNEL_PLATFORMS = {"twitter": "x", "x": "x", "youtube": "youtube", "twitch": "twitch", "discord": "discord", "instagram": "instagram",
                     "tiktok": "tiktok", "facebook": "facebook", "whatsapp": "whatsapp", "telegram": "telegram", "threads": "threads",
                     "bluesky": "bluesky", "mastodon": "mastodon", "kick": "kick", "linkedin": "linkedin", "reddit": "reddit", "steam": "steam",
                     "github": "github", "snapchat": "snapchat", "pinterest": "pinterest", "vimeo": "vimeo", "spotify": "spotify",
                     "website": "website", "email": "email"}
# Was die Website von einer Statutenfassung nach außen gibt - keine Prüfsummen, keine Quelle.
STATUTE_FIELDS = ("id", "version", "decided_on", "valid_from", "valid_to", "state", "size")
# PDF je Prüfsumme: eine beschlossene Fassung ändert sich nie, ihre Prüfsumme auch nicht.
_PDF_CACHE: dict[str, bytes] = {}
PDF_CACHE_LIMIT = 8


def _age_hours(value, now: datetime | None = None) -> float | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return ((now or datetime.now(timezone.utc)) - moment).total_seconds() / 3600


def names_withheld(fetched_at, now: datetime | None = None) -> bool:
    """Zu alt für Personennamen: ein Widerruf in Dolibarr muss zeitnah auf der Website wirken."""
    age = _age_hours(fetched_at, now)
    return age is None or age > NAME_MAX_AGE_HOURS


def representative(board: list[dict] | None, *, fetched_at=None, now: datetime | None = None) -> dict | None:
    """Die vertretungsbefugte Person: eine Vorstandsfunktion mit `represents`, bevorzugt Obmann/Obfrau,
    nur mit freigegebenem Namen (sonst None - dann bleibt der Eintrag von Hand)."""
    if names_withheld(fetched_at, now):
        return None
    candidates = [f for f in board or [] if f.get("represents") and f.get("board")]
    candidates.sort(key=lambda f: 0 if str(f.get("code") or "").lower().startswith(REPRESENTATIVE_CODES) else 1)
    for function in candidates:
        for holder in function.get("holders") or []:
            if holder.get("name"):
                return {"name": str(holder["name"]).strip(), "role": str(function.get("label") or "").strip(), "code": function.get("code"), "since": holder.get("since")}
    return None


def legal_overlay(organization: dict | None, board: list[dict] | None, *, fetched_at=None, now: datetime | None = None) -> dict:
    """Was aus Dolibarr ins Impressum kommt - nur belegte Felder, nie Leerstrings."""
    org = organization or {}
    address = org.get("address") or {}
    register = org.get("register") or {}
    values = {
        "legal_name": org.get("name"),
        "zvr_number": register.get("number") if str(register.get("kind") or "ZVR").upper() == "ZVR" else None,
        "register_authority": org.get("authority"),
        "street_address": address.get("street"),
        "postal_code": address.get("zip"),
        "city": address.get("town"),
        "country": COUNTRY_NAMES.get(str(address.get("country_code") or "").upper()),
        "phone": org.get("phone"),
    }
    person = representative(board, fetched_at=fetched_at, now=now)
    if person:
        values["representative_name"] = person["name"]
        values["representative_role"] = person["role"]
    return {key: str(value).strip() for key, value in values.items() if value not in (None, "") and str(value).strip()}


def board_public(board: list[dict] | None, *, fetched_at=None, now: datetime | None = None) -> list[dict]:
    """Der Vorstand für die Website: Funktion und Inhaber, Namen nur bei Einwilligung (sonst null),
    keine Rechnungsprüfer, keine Interna."""
    withheld = names_withheld(fetched_at, now)
    rows = []
    for function in board or []:
        if not function.get("board"):
            continue
        rows.append({
            "code": function.get("code"), "label": function.get("label"), "represents": bool(function.get("represents")),
            "holders": [{"name": None if withheld else (holder.get("name") or None), "since": holder.get("since")} for holder in function.get("holders") or []],
        })
    return rows


def channels_public(organization: dict | None) -> list[dict]:
    """Die öffentlichen Kanäle des Vereins aus Dolibarr in der Form der Social Links: nur mit Adresse, in der
    Reihenfolge des Vereins; das Netzwerk-Kürzel wird zum Plattform-Schlüssel der Website."""
    out = []
    for row in (organization or {}).get("channels") or []:
        if not isinstance(row, dict) or not str(row.get("url") or "").strip():
            continue
        network = str(row.get("network") or "").strip().lower()
        platform = CHANNEL_PLATFORMS.get(network, network or "custom")
        out.append({
            "platform": platform, "label": str(row.get("label") or row.get("network_label") or platform).strip(),
            "url": str(row["url"]).strip(), "enabled": True, "stream": bool(row.get("stream")), "live_url": str(row.get("live_url") or ""),
        })
    return out


def organization_public(organization: dict | None) -> dict:
    """Was vom Verein öffentlich ist - für die Vereinsseite: Name, Gründung, Zweck, gemeinnützig, Website, Kanäle."""
    org = organization or {}
    return {
        "name": org.get("name") or "", "founded": org.get("founded") or None, "purpose": org.get("purpose") or "",
        "nonprofit": bool(org.get("nonprofit")), "url": org.get("url") or "", "email": org.get("email") or "",
        "channels": channels_public(org),
    }


async def refresh(db, settings: dict, client: DolibarrClient) -> dict:
    """Alles neu lesen. Ein Fehler lässt den letzten Stand stehen und wird daneben vermerkt; die Statuten
    hängen an einem eigenen Vermerk, damit ein Modul ohne Statuten-API Vereinsdaten und Vorstand nicht sperrt."""
    now = now_utc().isoformat()
    try:
        organization = await client.organization()
        board = await client.board()
    except DolibarrError as exc:
        await db[COLLECTION].update_one({"id": STATE_ID}, {"$set": {"error": exc.kind, "error_text": exc.text, "error_at": now}, "$setOnInsert": {"id": STATE_ID}}, upsert=True)
        return {"ok": False, "kind": exc.kind, "text": exc.text}
    update = {"organization": organization, "board": board, "fetched_at": now}
    unset = {"error": "", "error_text": "", "error_at": ""}
    statutes_state = None
    try:
        statutes = await client.statutes()
    except DolibarrError as exc:
        update.update({"statutes_error": exc.kind, "statutes_error_at": now})
    else:
        statutes_state = statutes.get("state")
        update.update({"statutes": statutes, "statutes_fetched_at": now})
        unset.update({"statutes_error": "", "statutes_error_at": ""})
    await db[COLLECTION].update_one({"id": STATE_ID}, {"$set": update, "$unset": unset, "$setOnInsert": {"id": STATE_ID}}, upsert=True)
    return {"ok": True, "fetched_at": now, "functions": len(board), "statutes": statutes_state}


async def refresh_due() -> dict:
    """Der stündliche Job: nur mit Anbindung; ohne sie gibt es nichts zu lesen."""
    from database import get_db
    from services.dolibarr_client import load_settings

    db = get_db()
    settings = await load_settings(db)
    if settings.get("mode") == "off":
        return {"ok": False, "kind": "not_configured"}
    try:
        client = DolibarrClient(settings)
    except DolibarrError as exc:
        return {"ok": False, "kind": exc.kind}
    return await refresh(db, settings, client)


def _statute_version(row: dict) -> dict:
    return {key: row.get(key) for key in STATUTE_FIELDS}


def statutes_public(state: dict, *, switch_on: bool) -> dict:
    """Die Statuten für die Website: nur mit Schalter und nur, wenn der Verein sie im Modul für die
    Öffentlichkeit freigibt; sonst ``available`` False mit dem Grund. Nie der Entwurf, nie Prüfsummen."""
    if not switch_on:
        return {"available": False, "reason": "switch_off"}
    statutes = state.get("statutes")
    if not isinstance(statutes, dict):
        return {"available": False, "reason": "unavailable" if state.get("statutes_error") else "not_fetched"}
    if statutes.get("state") == "not_published":
        return {"available": False, "reason": "not_published"}
    current = statutes.get("current")
    return {
        "available": True, "state": statutes.get("state"),
        "current": _statute_version(current) if isinstance(current, dict) else None,
        "versions": [_statute_version(row) for row in statutes.get("versions") or [] if isinstance(row, dict) and row.get("id")],
        "fetched_at": state.get("statutes_fetched_at"),
    }


def statutes_admin(state: dict) -> dict:
    """Für den Reiter Rechtliches: Stand, geltende Fassung, Zahl der Fassungen, Fehler."""
    statutes = state.get("statutes") if isinstance(state.get("statutes"), dict) else None
    current = statutes.get("current") if statutes else None
    return {
        "state": statutes.get("state") if statutes else None,
        "current": _statute_version(current) if isinstance(current, dict) else None,
        "versions": len(statutes.get("versions") or []) if statutes else 0,
        "fetched_at": state.get("statutes_fetched_at"), "error": state.get("statutes_error"),
    }


async def statutes_pdf(db, branding: dict, version_id: int, client: DolibarrClient) -> tuple[bytes, dict]:
    """Das PDF einer freigegebenen Fassung: nur eine aus dem Stand (``not_found`` sonst) und nur, wenn die
    Bytes zur Prüfsumme der Vereinsakte passen (``invalid_response`` sonst). Einmal geholt, bleibt es im Speicher."""
    state = await snapshot(db)
    public = statutes_public(state, switch_on=bool(branding.get("legal_from_dolibarr")))
    rows = (state.get("statutes") or {}).get("versions") or [] if public.get("available") else []
    row = next((row for row in rows if isinstance(row, dict) and int(row.get("id") or 0) == int(version_id)), None)
    if row is None:
        raise DolibarrError("not_found", 404)
    expected = str(row.get("sha256") or "")
    cached = _PDF_CACHE.get(expected) if expected else None
    if cached is not None:
        return cached, row
    data = await client.statute_pdf(int(version_id))
    try:
        content = base64.b64decode(str(data.get("content") or ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise DolibarrError("invalid_response", 200) from exc
    if not content or not expected or hashlib.sha256(content).hexdigest() != expected:
        raise DolibarrError("invalid_response", 200)
    if len(_PDF_CACHE) >= PDF_CACHE_LIMIT:
        _PDF_CACHE.clear()
    _PDF_CACHE[expected] = content
    return content, row


async def snapshot(db) -> dict:
    return await db[COLLECTION].find_one({"id": STATE_ID}, {"_id": 0}) or {}


async def public_legal_source(db, branding: dict) -> tuple[dict, dict]:
    """Der Overlay für die öffentliche Projektion und die Herkunftsangabe - leer, solange der Schalter aus ist."""
    if not branding.get("legal_from_dolibarr"):
        return {}, {"dolibarr": False}
    state = await snapshot(db)
    if not state.get("organization"):
        return {}, {"dolibarr": True, "fetched_at": None, "fields": [], "error": state.get("error")}
    overlay = legal_overlay(state.get("organization"), state.get("board"), fetched_at=state.get("fetched_at"))
    return overlay, {"dolibarr": True, "fetched_at": state.get("fetched_at"), "fields": sorted(overlay), "error": state.get("error")}


# ---------------------------------------------------------------- Vorstandsseite (#326 Teil 2)

# Funktionscodes von Dolibarr auf die drei Kernposten der Website; „Stellvertretung“ wird eigener Posten.
BOARD_CORE = {
    "obmann": ("obmann", "obfrau", "obperson", "praesident", "präsident", "vorsitz"),
    "kassier": ("kassier", "schatzmeister", "finanz"),
    "schriftfuehrer": ("schriftfuehrer", "schriftführer", "sekretaer", "sekretär", "schrift"),
}
DEPUTY_MARKERS = ("stv", "stellvertret", "vize", "deputy")


def board_slug(code: str | None, label: str | None) -> str:
    raw = f"{code or ''} {label or ''}".lower()
    deputy = any(marker in raw for marker in DEPUTY_MARKERS)
    core = next((slug for slug, needles in BOARD_CORE.items() if any(needle in raw for needle in needles)), None)
    if core:
        return f"{core}-stv" if deputy else core
    import re
    return re.sub(r"[^a-z0-9]+", "-", str(code or label or "funktion").lower()).strip("-") or "funktion"


def _normalized_name(value) -> str:
    return " ".join(str(value or "").lower().replace("-", " ").split())


async def board_positions(db, branding: dict) -> list[dict] | None:
    """Der Vorstand aus Dolibarr in der Form der Website-Vorstandsposten - None, wenn der Schalter aus
    ist oder Dolibarr noch keinen Vorstand geliefert hat (dann gilt die Liste von Hand).

    Name nur mit Einwilligung (sonst „Name nicht freigegeben“, kein Foto, kein Profil). Foto und
    Profil-Link kommen nur über das Konto, dessen Dolibarr-Mitgliedschaft dieselbe Funktion trägt und
    das im Mitgliederverzeichnis steht (eigene Entscheidung, #410)."""
    if not branding.get("legal_from_dolibarr"):
        return None
    state = await snapshot(db)
    if state.get("board") is None:
        return None
    rows = board_public(state.get("board"), fetched_at=state.get("fetched_at"))
    codes = [row["code"] for row in rows if row.get("code")]
    candidates: dict[str, list[str]] = {}
    if codes:
        async for membership in db.memberships.find({"member_status": {"$in": ["active", "honorary"]}, "dolibarr.functions.code": {"$in": codes}}, {"_id": 0, "user_id": 1, "dolibarr.functions": 1}):
            for fn in (membership.get("dolibarr") or {}).get("functions") or []:
                if fn.get("code") in codes and membership.get("user_id"):
                    candidates.setdefault(fn["code"], []).append(membership["user_id"])
    user_ids = sorted({uid for ids in candidates.values() for uid in ids})
    profiles: dict[str, dict] = {}
    users: dict[str, dict] = {}
    if user_ids:
        async for profile in db.club_member_profiles.find({"user_id": {"$in": user_ids}, "is_active": {"$ne": False}, "directory_blocked": {"$ne": True}},
                                                          {"_id": 0, "user_id": 1, "slug": 1, "display_name": 1, "gamertag": 1, "real_name": 1, "photo_url": 1, "gender": 1}):
            profiles[profile["user_id"]] = profile
        async for user in db.users.find({"id": {"$in": user_ids}}, {"_id": 0, "id": 1, "display_name": 1, "username": 1, "gender": 1}):
            users[user["id"]] = user

    def person_for(code: str, name: str) -> dict | None:
        wanted = _normalized_name(name)
        matches = []
        for uid in candidates.get(code, []):
            profile = profiles.get(uid)
            if not profile:
                continue  # nicht im Verzeichnis: nur der Name aus Dolibarr
            names = {_normalized_name(profile.get(k)) for k in ("real_name", "display_name", "gamertag")} | {_normalized_name(users.get(uid, {}).get("display_name"))}
            if wanted in names:
                matches.append(profile)
        if len(matches) != 1:
            single = [profiles[uid] for uid in candidates.get(code, []) if uid in profiles]
            matches = single if len(single) == 1 else []
        if not matches:
            return None
        profile = matches[0]
        return {
            "id": profile.get("user_id"), "slug": profile.get("slug"), "display_name": name, "gamertag": profile.get("gamertag") or name,
            "real_name": name if (profile.get("gamertag") and _normalized_name(profile.get("gamertag")) != wanted) else None,
            "avatar_url": profile.get("photo_url"), "photo_url": profile.get("photo_url"), "gender": profile.get("gender"),
            "profile_url": f"/members/{profile.get('slug')}" if profile.get("slug") else None, "source": "member_profile",
        }

    positions = []
    for index, row in enumerate(rows):
        holders = row.get("holders") or []
        for offset, holder in enumerate(holders or [None]):
            name = (holder or {}).get("name")
            withheld = holder is not None and not name
            person = person_for(row["code"], name) if name else None
            if name and not person:
                person = {"display_name": name, "gamertag": name, "real_name": None, "avatar_url": None, "photo_url": None, "profile_url": None, "source": "dolibarr"}
            slug = board_slug(row.get("code"), row.get("label"))
            positions.append({
                "id": f"dolibarr-{row.get('code')}-{offset}", "slug": slug if offset == 0 else f"{slug}-{offset + 1}", "code": row.get("code"),
                "title_male": row.get("label"), "title_female": row.get("label"), "display_title": row.get("label"), "description": "",
                "allow_deputy": False, "is_active": True, "is_default": False, "order_index": index * 10 + offset, "source": "dolibarr",
                "represents": bool(row.get("represents")), "since": (holder or {}).get("since"),
                "vacant": holder is None, "name_withheld": withheld, "user": person, "deputy_user": None,
            })
    return positions


async def board_source(db, branding: dict) -> dict:
    """Für den Admin: führt Dolibarr den Vorstand, und seit wann steht der Stand?"""
    state = await snapshot(db)
    return {
        "dolibarr": bool(branding.get("legal_from_dolibarr")) and state.get("board") is not None,
        "switch_on": bool(branding.get("legal_from_dolibarr")), "has_board": state.get("board") is not None,
        "fetched_at": state.get("fetched_at"), "error": state.get("error"), "names_withheld": names_withheld(state.get("fetched_at")) if state.get("board") is not None else False,
        "functions": len([row for row in (state.get("board") or []) if row.get("board")]),
    }


async def admin_view(db, branding: dict) -> dict:
    """Für den Reiter Rechtliches: Stand, Fehler, was übernommen würde, der Vorstand mit Einwilligungsstand."""
    state = await snapshot(db)
    has_data = bool(state.get("organization"))
    overlay = legal_overlay(state.get("organization"), state.get("board"), fetched_at=state.get("fetched_at")) if has_data else {}
    person = representative(state.get("board"), fetched_at=state.get("fetched_at")) if has_data else None
    return {
        "enabled": bool(branding.get("legal_from_dolibarr")),
        "has_data": has_data,
        "fetched_at": state.get("fetched_at"),
        "names_withheld": names_withheld(state.get("fetched_at")) if has_data else False,
        "error": state.get("error"), "error_text": state.get("error_text"), "error_at": state.get("error_at"),
        "overlay": overlay,
        "representative": person,
        "board": board_public(state.get("board"), fetched_at=state.get("fetched_at")) if has_data else [],
        "organization": organization_public(state.get("organization")) if has_data else None,
        "fields": list(OVERLAY_FIELDS),
        "statutes": statutes_admin(state),
        "channels": channels_public(state.get("organization")) if has_data else [],
    }
