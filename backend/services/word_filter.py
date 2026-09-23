"""Wortfilter (#417, Moderation II): eine erste automatische Stufe für Text - ohne Cloud.

Die Moderation pflegt unter Admin → Moderation → Wortfilter eine Liste (deutsch und englisch
gemischt); je Eintrag heißt es „zurückhalten“ oder „nur markieren“. Geprüft wird beim Senden in
Direktnachrichten, Team-, Turnier- und Match-Chat sowie beim Speichern von Profil-Bio,
Anzeigename, Teamname und Benutzername.

- **zurückhalten**: die Nachricht wird gespeichert, ist aber nur für den Absender sichtbar
  („wird geprüft“); ein Moderator gibt sie frei oder weist sie zurück. Zurückgewiesen zählt als
  Treffer (``moderation_strikes``, Grundlage für die Stufen aus #416). Bei Namen und Bio heißt
  zurückhalten: die Änderung wird abgewiesen, bevor sie jemand sieht.
- **markieren**: alles geht normal durch, der Fund steht nur in der Moderationsliste.

Normalisiert wird, keine freien regulären Ausdrücke: Kleinschreibung, Umlaute, Leetspeak
(``sch31ß3``), Akzente; längere Begriffe werden auch mit Trennzeichen dazwischen erkannt
(``s.c.h.e.i.s.s.e``), kurze nur als ganzes Wort - sonst fängt „ass“ jedes „Passwort“.
Der Server entscheidet, nie der Client; der Filter fängt Offensichtliches, Kontext bleibt Sache
der Meldungen und der Moderation.
"""
from __future__ import annotations

import re
import unicodedata

from fastapi import HTTPException

from models import new_id, now_utc

SETTINGS_ID = "word_filter"
ACTIONS = ("hold", "flag")
COMPACT_MIN = 5          # ab dieser Länge (ohne Trennzeichen) zählt auch ein Fund mit Trennzeichen oder als Wortteil
TERM_MIN, TERM_MAX = 2, 60
MAX_ENTRIES = 2000
KINDS = ("direct", "team", "tournament", "match", "bio", "display_name", "team_name", "username")
CHAT_COLLECTIONS = {"direct": "direct_messages", "team": "team_chat_messages", "tournament": "tournament_chat_messages", "match": "match_chat_messages"}
KIND_LABELS = {"direct": "Direktnachricht", "team": "Team-Chat", "tournament": "Turnier-Chat", "match": "Match-Chat", "bio": "Profil-Bio",
               "display_name": "Anzeigename", "team_name": "Teamname", "username": "Benutzername"}
_UMLAUTS = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "€": "e", "!": "i", "|": "l", "+": "t"})
_NON_ALNUM = re.compile(r"[^a-z0-9]+")


def normalize(text: str | None) -> str:
    """Kleinschreibung, Umlaute, Akzente, Leetspeak - was ein Mensch als dasselbe Wort liest."""
    value = str(text or "").lower()
    for source, target in _UMLAUTS.items():
        value = value.replace(source, target)
    value = unicodedata.normalize("NFKD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = value.translate(_LEET)
    return _NON_ALNUM.sub(" ", value).strip()


def compact(text: str | None) -> str:
    return normalize(text).replace(" ", "")


def normalize_term(term: str | None) -> str:
    return normalize(term)


def find_matches(entries: list[dict], text: str | None) -> list[dict]:
    """Welche Einträge im Text vorkommen: kurze nur als ganzes Wort, längere auch am Stück ohne Trennzeichen."""
    if not text:
        return []
    words = normalize(text)
    if not words:
        return []
    word_set = set(words.split())
    joined = compact(text)
    found = []
    for entry in entries:
        term = normalize_term(entry.get("term"))
        if not term:
            continue
        term_compact = term.replace(" ", "")
        if len(term_compact) >= COMPACT_MIN:
            if term_compact in joined:
                found.append(entry)
        elif " " in term:
            if f" {term} " in f" {words} ":
                found.append(entry)
        elif term in word_set:
            found.append(entry)
    return found


def verdict_for(matches: list[dict]) -> str | None:
    if any(entry.get("action") == "hold" for entry in matches):
        return "hold"
    return "flag" if matches else None


async def load_config(db) -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID}, {"_id": 0}) or {}
    entries = [e for e in (doc.get("entries") or []) if isinstance(e, dict) and e.get("term")]
    return {"enabled": bool(doc.get("enabled")), "entries": entries}


async def save_config(db, *, enabled: bool | None = None, entries: list[dict] | None = None) -> dict:
    update: dict = {"updated_at": now_utc().isoformat()}
    if enabled is not None:
        update["enabled"] = bool(enabled)
    if entries is not None:
        update["entries"] = entries
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": update, "$setOnInsert": {"id": SETTINGS_ID}}, upsert=True)
    return await load_config(db)


def clean_entry(term: str, action: str, note: str | None = None) -> dict:
    cleaned = " ".join(str(term or "").split())
    if not TERM_MIN <= len(cleaned) <= TERM_MAX:
        raise HTTPException(400, f"Ein Eintrag hat {TERM_MIN} bis {TERM_MAX} Zeichen.")
    if not normalize_term(cleaned):
        raise HTTPException(400, "Der Eintrag enthält keine Buchstaben oder Ziffern.")
    if action not in ACTIONS:
        raise HTTPException(400, "Wirkung ist „zurückhalten“ oder „markieren“.")
    return {"id": new_id(), "term": cleaned, "action": action, "note": str(note or "").strip()[:200] or None, "created_at": now_utc().isoformat()}


async def check_text(db, text: str | None) -> dict:
    """Die Entscheidung für einen Text: {action: None|flag|hold, matched: [Begriffe]}."""
    config = await load_config(db)
    if not config["enabled"] or not text:
        return {"action": None, "matched": []}
    matches = find_matches(config["entries"], text)
    return {"action": verdict_for(matches), "matched": sorted({m["term"] for m in matches})}


async def _record_item(db, *, kind: str, ref_id: str | None, user_id: str, text: str, matched: list[str], action: str, context: dict | None) -> dict:
    now = now_utc().isoformat()
    item = {
        "id": new_id(), "kind": kind, "collection": CHAT_COLLECTIONS.get(kind), "ref_id": ref_id, "user_id": user_id,
        "excerpt": str(text or "")[:300], "matched": matched, "action": action,
        "state": "pending" if action == "hold" else "flagged", "context": context or {}, "created_at": now, "updated_at": now,
    }
    await db.moderation_items.insert_one(item)
    item.pop("_id", None)
    return item


async def screen_message(db, doc: dict, *, kind: str, context: dict | None = None) -> str | None:
    """Vor dem Speichern einer Chat-Nachricht: `held` heißt nur der Absender sieht sie, `flagged` geht durch."""
    result = await check_text(db, doc.get("message"))
    if not result["action"]:
        return None
    doc["moderation"] = {"state": "held" if result["action"] == "hold" else "flagged", "checked_at": now_utc().isoformat()}
    await _record_item(db, kind=kind, ref_id=doc.get("id"), user_id=doc.get("user_id") or doc.get("sender_id"), text=doc.get("message") or "",
                       matched=result["matched"], action=result["action"], context=context)
    return result["action"]


async def screen_field(db, text: str | None, *, kind: str, user_id: str, ref_id: str | None = None, context: dict | None = None) -> None:
    """Vor dem Speichern eines Namens oder einer Bio: zurückhalten heißt abweisen, markieren heißt notieren."""
    result = await check_text(db, text)
    if not result["action"]:
        return
    if result["action"] == "hold":
        await _record_item(db, kind=kind, ref_id=ref_id, user_id=user_id, text=text or "", matched=result["matched"], action="hold", context={**(context or {}), "rejected": True})
        await db.moderation_items.update_one({"ref_id": ref_id, "kind": kind, "user_id": user_id, "state": "pending"}, {"$set": {"state": "rejected", "decided_by": "automatisch"}})
        raise HTTPException(400, f"{KIND_LABELS.get(kind, 'Der Text')} enthält ein Wort, das hier nicht erlaubt ist.")
    await _record_item(db, kind=kind, ref_id=ref_id, user_id=user_id, text=text or "", matched=result["matched"], action="flag", context=context)


def visible_to(message: dict, viewer_id: str | None) -> bool:
    """Zurückgehaltene und zurückgewiesene Nachrichten sieht nur, wer sie geschrieben hat."""
    state = (message.get("moderation") or {}).get("state")
    if state not in ("held", "rejected"):
        return True
    author = message.get("user_id") or message.get("sender_id")
    return bool(viewer_id) and author == viewer_id


def public_moderation(message: dict) -> dict:
    """Was Web und App über den Zustand erfahren: nur der Zustand, nie die Treffer."""
    state = (message.get("moderation") or {}).get("state")
    out = dict(message)
    if state:
        out["moderation"] = {"state": state}
    return out


async def review(db, item: dict, *, decision: str, moderator_id: str, note: str | None = None) -> dict:
    """Freigeben, zurückweisen oder als gesehen abhaken. Zurückgewiesen = Treffer für die Stufen (#416)."""
    now = now_utc().isoformat()
    if decision == "noted":
        new_state = "noted"
    elif decision == "release":
        new_state = "released"
    elif decision == "reject":
        new_state = "rejected"
    else:
        raise HTTPException(400, "Entscheidung ist „release“, „reject“ oder „noted“.")
    if item.get("state") not in ("pending", "flagged"):
        raise HTTPException(409, "Dieser Fund ist schon entschieden.")
    if decision in ("release", "reject") and item.get("state") != "pending":
        raise HTTPException(409, "Nur zurückgehaltene Nachrichten lassen sich freigeben oder zurückweisen.")
    collection = item.get("collection")
    if collection and item.get("ref_id"):
        await db[collection].update_one({"id": item["ref_id"]}, {"$set": {
            "moderation.state": new_state, "moderation.reviewed_by": moderator_id, "moderation.reviewed_at": now, "updated_at": now,
        }})
    await db.moderation_items.update_one({"id": item["id"]}, {"$set": {"state": new_state, "decided_by": moderator_id, "decided_at": now, "note": (note or "").strip() or None, "updated_at": now}})
    if new_state == "rejected":
        # Zurückgewiesen zählt als Treffer - und stößt die Stufe an (#416).
        from services.moderation_standing import add_strike
        await add_strike(db, item["user_id"], source="word_filter", kind=item.get("kind"), ref_id=item.get("ref_id"),
                         item_id=item["id"], moderator_id=moderator_id, note=note)
    return await db.moderation_items.find_one({"id": item["id"]}, {"_id": 0})


def export_entries(config: dict) -> list[dict]:
    return [{"term": e["term"], "action": e.get("action") or "flag", "note": e.get("note") or None} for e in config.get("entries") or []]


def import_entries(current: list[dict], incoming: list[dict], *, replace: bool) -> list[dict]:
    """Eine Liste aus einem Export übernehmen - Doppelte fallen weg, ungültige Zeilen brechen ab."""
    result: list[dict] = [] if replace else list(current)
    seen = {normalize_term(e.get("term")) for e in result}
    for row in incoming:
        if not isinstance(row, dict):
            raise HTTPException(400, "Jede Zeile braucht `term` und `action`.")
        entry = clean_entry(row.get("term"), row.get("action") or "flag", row.get("note"))
        key = normalize_term(entry["term"])
        if key in seen:
            continue
        seen.add(key)
        result.append(entry)
    if len(result) > MAX_ENTRIES:
        raise HTTPException(400, f"Höchstens {MAX_ENTRIES} Einträge.")
    return result
